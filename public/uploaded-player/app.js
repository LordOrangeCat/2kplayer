import {
  openDatabase, getAllTracks, getTrack, saveTrack, saveTracks, deleteTrack,
  getPlaylists, savePlaylist, deletePlaylist, getSetting, setSetting, getAllSettings,
  estimateStorage, requestPersistentStorage
} from './db.js';
import { DEFAULT_THEME, applyTheme, validateTheme } from './theme.js';
import { makeBackup, validateBackup } from './backup.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SUPPORTED_EXTENSIONS = new Set(['flac', 'wav', 'mp3', 'aac', 'm4a']);
const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
const WINDOW_MODE = new URLSearchParams(location.search).get('window');
const PLAYLIST_MODE = WINDOW_MODE === 'playlist';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('2kplayer-window-commands') : null;

const state = {
  tracks: [], playlists: [], queue: [], currentTrackId: null, lastPosition: 0,
  activeView: 'all', activePlaylistId: null, addingToPlaylist: false,
  shuffle: false, repeat: false, search: '', isPlaying: false, eq: {
    bands: Array(10).fill(0), bass: 0, treble: 0, warmth: 0, width: 1
  }, theme: structuredClone(DEFAULT_THEME), visualizerEnabled: true,
  restoredPosition: 0, lastPersistedSecond: -1, objectUrl: null, renderLimit: 200, dspEnabled: false
};

const nativeAudio = $('#audio');
const dspAudio = $('#dspAudio');
let audio = nativeAudio;
let toastTimeout;
let audioContext = null;
let mediaSource = null;
let equalizerNodes = [];
let bassNode = null;
let trebleNode = null;
let warmthNode = null;
let analyser = null;
let widthNodes = null;
let graphReady = false;
let visualizerFrame = 0;
let currentPlaylistCommandPending = false;
let skipNextPausePersist = false;
let pendingWorker = null;
let reloadAfterUpdate = false;

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function extensionOf(name = '') { return name.includes('.') ? name.split('.').pop().toLowerCase() : ''; }
function formatName(track) { return (track?.extension || extensionOf(track?.filename || '') || 'audio').toUpperCase(); }
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const remainder = s % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}
function announce(message, duration = 2700) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), duration);
}
function setBusy(isBusy, label = '') {
  $('#libraryStatus').textContent = isBusy ? (label || 'WORKING…') : 'LIBRARY READY';
  if (isBusy) $('#libraryStatus').setAttribute('aria-live', 'polite');
}
function trackById(id) { return state.tracks.find(track => track.id === id); }
function playlistById(id) { return state.playlists.find(playlist => playlist.id === id); }
function trackIdsToTracks(ids) { return ids.map(trackById).filter(Boolean); }
function sortedTracks(list) { return [...list].sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })); }
function titleFromFilename(filename) { return filename.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim() || filename; }

async function persistSetting(key, value) {
  try { await setSetting(key, value); }
  catch (error) { announce(`Could not save ${key}: ${error.message}`); }
}
async function saveQueue() { await persistSetting('queue', state.queue); }
async function savePlaybackPosition(force = false) {
  const second = Math.floor(audio.currentTime || 0);
  if (!force && second === state.lastPersistedSecond) return;
  state.lastPersistedSecond = second;
  state.lastPosition = audio.currentTime || 0;
  await persistSetting('lastPosition', state.lastPosition);
  await persistSetting('currentTrackId', state.currentTrackId);
}

async function refreshLibrary({ restoreSession = false } = {}) {
  state.tracks = sortedTracks(await getAllTracks());
  state.playlists = await getPlaylists();
  state.playlists.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const storedQueue = await getSetting('queue');
  state.queue = Array.isArray(storedQueue) ? storedQueue.filter(id => state.tracks.some(track => track.id === id)) : [];
  const storedCurrent = await getSetting('currentTrackId');
  if (restoreSession) {
    state.currentTrackId = state.tracks.some(track => track.id === storedCurrent && track.blob) ? storedCurrent : null;
  } else if (state.currentTrackId && !state.tracks.some(track => track.id === state.currentTrackId && track.blob)) {
    state.currentTrackId = null;
  }
  const storedPosition = await getSetting('lastPosition');
  state.restoredPosition = Number.isFinite(storedPosition) ? Math.max(0, storedPosition) : 0;
  const volume = await getSetting('volume');
  audio.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
  $('#volumeBar').value = String(audio.volume);
  const shuffle = await getSetting('shuffle'); state.shuffle = Boolean(shuffle);
  const repeat = await getSetting('repeat'); state.repeat = Boolean(repeat);
  state.dspEnabled = (await getSetting('dspEnabled')) === true;
  const storedEq = await getSetting('eqProfile');
  if (storedEq && Array.isArray(storedEq.bands) && storedEq.bands.length === 10) {
    state.eq = { ...state.eq, ...storedEq, bands: storedEq.bands.map(value => Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0) };
  }
  const visualizerEnabled = await getSetting('visualizerEnabled');
  state.visualizerEnabled = visualizerEnabled !== false;
  const savedTheme = await getSetting('theme');
  if (savedTheme) {
    try { state.theme = validateTheme(savedTheme); }
    catch { state.theme = structuredClone(DEFAULT_THEME); }
  }
  applyTheme(state.theme);
  updateEqControls();
  if (!PLAYLIST_MODE && restoreSession && state.currentTrackId) {
    const track = trackById(state.currentTrackId);
    if (track?.blob) await loadTrack(track, { autoplay: false, restore: true });
  }
  renderAll();
  await updateStorageStatus();
  if (!PLAYLIST_MODE) updateMediaSession();
}

function renderAll() {
  if (PLAYLIST_MODE) {
    renderPopout();
    return;
  }
  renderNavigation();
  renderLibrary();
  renderQueuePreview();
  renderNowPlaying();
  renderPlaybackControls();
  publishState();
}
function renderNavigation() {
  $('#allCount').textContent = state.tracks.length;
  $('#favoriteCount').textContent = state.tracks.filter(track => track.favorite).length;
  $('#queueCount').textContent = state.queue.length;
  $$('.nav-item[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.activeView));
  $('#playlistNav').innerHTML = state.playlists.length ? state.playlists.map(playlist => `
    <button class="nav-item ${state.activeView === 'playlist' && state.activePlaylistId === playlist.id ? 'active' : ''}" data-playlist-id="${escapeHTML(playlist.id)}" title="${escapeHTML(playlist.name)}">
      <span class="nav-glyph">♫</span><span>${escapeHTML(playlist.name)}</span><span class="nav-count">${playlist.trackIds.length}</span>
    </button>`).join('') : '<p class="empty-nav">No playlists yet.</p>';
  $('#shuffleButton').classList.toggle('active', state.shuffle);
  $('#repeatButton').classList.toggle('active', state.repeat);
  $('#visualizerToggle').classList.toggle('active', state.visualizerEnabled);
}
function viewInfo() {
  switch (state.activeView) {
    case 'favorites': return { title: 'Favorites', eyebrow: 'YOUR FAVORITES', tracks: state.tracks.filter(track => track.favorite) };
    case 'queue': return { title: 'Play queue', eyebrow: 'TEMPORARY QUEUE', tracks: trackIdsToTracks(state.queue) };
    case 'playlist': {
      const playlist = playlistById(state.activePlaylistId);
      return { title: playlist?.name || 'Playlist', eyebrow: 'PLAYLIST COLLECTION', tracks: trackIdsToTracks(playlist?.trackIds || []), playlist };
    }
    default: return { title: 'All tracks', eyebrow: 'YOUR LIBRARY', tracks: state.tracks };
  }
}
function renderLibrary() {
  const info = viewInfo();
  $('#viewTitle').innerHTML = `${escapeHTML(info.title)} <span class="title-count" id="titleCount">${info.tracks.length}</span>`;
  $('#viewEyebrow').textContent = info.eyebrow;
  $('#librarySummary').textContent = `${info.tracks.length.toLocaleString()} ${info.tracks.length === 1 ? 'track' : 'tracks'} ${state.search ? 'matched' : 'indexed'}`;
  const detailBar = $('#playlistDetailBar');
  detailBar.classList.toggle('hidden', state.activeView !== 'playlist');
  if (state.activeView === 'playlist' && info.playlist) {
    detailBar.innerHTML = `<div><b>${escapeHTML(info.playlist.name)}</b><small>${info.playlist.trackIds.length} tracks · ${escapeHTML(new Date(info.playlist.createdAt || Date.now()).toLocaleDateString())}</small></div><div class="detail-actions"><button class="text-button" id="addPlaylistTracks">＋ ADD TRACKS</button><button class="text-button" id="renamePlaylist">RENAME</button><button class="text-button" id="deletePlaylistButton">DELETE</button></div>`;
  } else detailBar.innerHTML = '';

  let list = info.tracks;
  if (!['queue', 'playlist'].includes(state.activeView)) list = sortedTracks(list);
  const query = state.search.trim().toLocaleLowerCase();
  if (query) list = list.filter(track => [track.title, track.artist, track.album, track.filename].some(field => String(field || '').toLocaleLowerCase().includes(query)));
  if (state.addingToPlaylist && state.activeView === 'playlist') {
    const existingIds = new Set(info.playlist?.trackIds || []);
    list = sortedTracks(state.tracks.filter(track => !existingIds.has(track.id)));
    $('#viewTitle').innerHTML = `Add tracks <span class="title-count">${list.length}</span>`;
    $('#viewEyebrow').textContent = `ADDING TO ${String(info.playlist?.name || 'PLAYLIST').toUpperCase()}`;
    detailBar.classList.remove('hidden');
    detailBar.innerHTML = `<div><b>Select tracks to add</b><small>Click ＋ on any track</small></div><button class="text-button" id="doneAddingTracks">DONE</button>`;
  }
  const displayedList = list.slice(0, state.renderLimit);
  const remaining = Math.max(0, list.length - displayedList.length);
  $('#trackRows').innerHTML = list.length ? displayedList.map((track, index) => renderTrackRow(track, index, {
    inPlaylist: state.activeView === 'playlist' && !state.addingToPlaylist,
    allowAdd: state.addingToPlaylist,
    queueMode: state.activeView === 'queue'
  })).join('') + (remaining ? `<div class="load-more-wrap"><button class="button button-outline" id="loadMoreTracks">Load next ${Math.min(200, remaining)} tracks · ${remaining.toLocaleString()} remaining</button></div>` : '') : renderEmptyList(info);
  $('#openQueue').classList.toggle('hidden', state.activeView === 'queue');
}
function renderEmptyList(info) {
  if (state.search) return '<div class="track-empty">No tracks match that search.</div>';
  if (state.activeView === 'favorites') return '<div class="track-empty">No favorites yet. Tap ♡ on a track to keep it close.</div>';
  if (state.activeView === 'queue') return '<div class="track-empty">Your queue is empty. Use ＋ on a track to add it.</div>';
  if (state.activeView === 'playlist') return '<div class="track-empty">This playlist is empty. Choose “Add tracks” to fill it.</div>';
  return '<div class="empty-state"><div class="empty-record">♫</div><h3>Your speakers are waiting.</h3><p>Import a few local audio files to get started. Nothing leaves your device unless you choose an online feature.</p><button class="button button-accent" id="emptyImport">＋ Import audio</button><span class="format-hint">FLAC · WAV · MP3 · AAC / M4A</span></div>';
}
function renderTrackRow(track, index, options = {}) {
  const current = track.id === state.currentTrackId;
  const missing = !track.blob || track.unavailable;
  const format = formatName(track);
  const title = track.title || titleFromFilename(track.filename || 'Unknown track');
  return `<div class="track-row ${current ? 'current' : ''} ${missing ? 'missing-track' : ''}" role="listitem" data-track-row="${escapeHTML(track.id)}">
    <span class="track-row-number">${current && state.isPlaying ? '♫' : String(index + 1).padStart(2, '0')}</span>
    <div class="track-title-wrap"><button class="row-art play-row" data-id="${escapeHTML(track.id)}" title="${missing ? 'Audio file unavailable' : 'Play track'}" ${missing ? 'disabled' : ''}>${current && state.isPlaying ? 'Ⅱ' : (missing ? '!' : '▶')}</button><div class="track-title-copy"><div class="track-title" title="${escapeHTML(title)}">${escapeHTML(title)}</div><div class="track-artist">${escapeHTML(track.artist || 'Unknown artist')}${missing ? ' · <span class="missing-label">FILE NEEDED</span>' : ''}</div></div></div>
    <span class="track-album" title="${escapeHTML(track.album || '—')}">${escapeHTML(track.album || '—')}</span>
    <span class="format-chip">${escapeHTML(format)}</span><span class="track-duration">${Number.isFinite(track.duration) && track.duration > 0 ? formatTime(track.duration) : '—:——'}</span>
    <div class="row-actions">
      ${options.allowAdd ? `<button class="icon-button add-to-playlist" data-id="${escapeHTML(track.id)}" title="Add to playlist">＋</button>` : ''}
      ${options.inPlaylist ? `<button class="icon-button remove-from-playlist" data-id="${escapeHTML(track.id)}" title="Remove from playlist">−</button>` : ''}
      <button class="icon-button add-to-queue" data-id="${escapeHTML(track.id)}" title="Add to queue">＋≡</button>
      <button class="icon-button favorite-button ${track.favorite ? 'is-favorite' : ''}" data-id="${escapeHTML(track.id)}" title="${track.favorite ? 'Remove favorite' : 'Add favorite'}" aria-label="${track.favorite ? 'Remove favorite' : 'Add favorite'}">${track.favorite ? '♥' : '♡'}</button>
    </div>
  </div>`;
}
function renderQueuePreview() {
  const next = state.queue.filter(id => id !== state.currentTrackId).slice(0, 4).map(trackById).filter(Boolean);
  $('#queuePreview').innerHTML = next.length ? next.map((track, index) => `<div class="queue-preview-item"><span class="queue-num">${String(index + 1).padStart(2, '0')}</span><div class="queue-copy"><b>${escapeHTML(track.title)}</b><small>${escapeHTML(track.artist || 'Unknown artist')}</small></div><button class="icon-button remove-from-queue" data-id="${escapeHTML(track.id)}" aria-label="Remove from queue" title="Remove from queue">×</button></div>`).join('') : '<p class="queue-empty">Your queue is taking a breather.</p>';
}
function renderNowPlaying() {
  const track = trackById(state.currentTrackId);
  const title = track?.title || 'Nothing playing';
  const artist = track?.artist || 'Import audio to begin';
  $('#nowTitle').textContent = title;
  $('#nowArtist').textContent = artist;
  $('#nowFormat').textContent = track ? `${formatName(track)} / LOCAL` : 'NO SOURCE';
  $('#outputMode').textContent = state.dspEnabled ? 'WEB AUDIO DSP' : 'NATIVE';
  $('#outputHint').textContent = state.dspEnabled ? 'Audio is routed through Web Audio processing' : 'Using the browser-native audio path';
  $('#nowRate').textContent = track?.sampleRate ? `${Math.round(track.sampleRate / 1000 * 10) / 10} KHZ` : 'OUTPUT UNKNOWN';
  $('#dockTitle').textContent = title;
  $('#dockArtist').textContent = artist;
  $('#dockFavorite').textContent = track?.favorite ? '♥' : '♡';
  $('#dockFavorite').classList.toggle('is-favorite', Boolean(track?.favorite));
  $('#dockThumb').textContent = track ? '♫' : '◌';
}
function renderPlaybackControls() {
  $('#playButton').textContent = state.isPlaying ? 'Ⅱ' : '▶';
  $('#playButton').setAttribute('aria-label', state.isPlaying ? 'Pause' : 'Play');
  $('#shuffleButton').classList.toggle('active', state.shuffle);
  $('#repeatButton').classList.toggle('active', state.repeat);
  $('#visualizerToggle').classList.toggle('active', state.visualizerEnabled);
  $('#seekBar').value = String(audio.duration > 0 ? Math.round((audio.currentTime / audio.duration) * 1000) : 0);
  $('#elapsedTime').textContent = formatTime(audio.currentTime || 0);
  $('#totalTime').textContent = formatTime(audio.duration || 0);
}

async function updateStorageStatus() {
  const estimate = await estimateStorage();
  if (!estimate || !Number.isFinite(estimate.quota) || estimate.quota <= 0) {
    $('#storageText').textContent = 'Storage estimate unavailable in this browser.';
    $('#storagePercent').textContent = '—';
    $('#storageBar').style.width = '0%';
    return;
  }
  const used = estimate.usage || 0;
  const percent = Math.min(100, Math.round(used / estimate.quota * 100));
  $('#storagePercent').textContent = `${percent}%`;
  $('#storageBar').style.width = `${percent}%`;
  $('#storageText').textContent = `${formatBytes(used)} used · browser storage can be cleared. Keep a separate backup.`;
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const level = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, level)).toFixed(level >= 2 ? 1 : 0)} ${units[level]}`;
}

async function importAudioFiles(fileList) {
  const files = [...(fileList || [])];
  const accepted = files.filter(file => SUPPORTED_EXTENSIONS.has(extensionOf(file.name)) || /^audio\/(flac|wav|mpeg|mp4|aac|x-flac)$/i.test(file.type));
  if (!accepted.length) {
    announce('No supported audio files found. Choose FLAC, WAV, MP3, AAC, or M4A files.');
    return;
  }
  setBusy(true, 'IMPORTING…');
  const existingByKey = new Map(state.tracks.map(track => [track.sourceKey, track]).filter(([key]) => Boolean(key)));
  const pending = [];
  let skipped = 0;
  let relinked = 0;
  let newlyAdded = 0;
  for (const file of accepted) {
    const relativeName = file.webkitRelativePath || file.name;
    const sourceKey = `${relativeName}|${file.size}|${file.lastModified}`;
    const basename = file.name.toLocaleLowerCase();
    let existing = existingByKey.get(sourceKey);
    if (!existing) {
      existing = state.tracks.find(track => (!track.blob || track.unavailable) && String(track.filename || '').split('/').pop().toLocaleLowerCase() === basename && track.size === file.size && track.lastModified === file.lastModified);
    }
    if (existing) {
      if (!existing.blob || existing.unavailable) {
        pending.push({ ...existing, filename: relativeName, extension: extensionOf(file.name), mimeType: file.type || existing.mimeType || '', sourceKey, size: file.size, lastModified: file.lastModified, blob: file, unavailable: false });
        existingByKey.delete(existing.sourceKey);
        relinked++;
      } else { skipped++; }
      continue;
    }
    const extension = extensionOf(file.name);
    const track = {
      id: crypto.randomUUID(), title: titleFromFilename(file.name), artist: 'Unknown artist', album: '',
      filename: relativeName, extension, mimeType: file.type || '',
      size: file.size, lastModified: file.lastModified, sourceKey, addedAt: new Date().toISOString(),
      favorite: false, duration: null, sampleRate: null, unavailable: false, blob: file
    };
    pending.push(track);
    existingByKey.set(sourceKey, track);
    newlyAdded++;
  }
  try {
    for (let offset = 0; offset < pending.length; offset += 40) {
      const batch = pending.slice(offset, offset + 40);
      await saveTracks(batch);
      setBusy(true, `IMPORT ${Math.min(offset + batch.length, pending.length)}/${pending.length}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await refreshLibrary();
    state.activeView = 'all';
    renderAll();
    await persistSetting('lastImportAt', new Date().toISOString());
    const parts = [];
    if (newlyAdded) parts.push(`${newlyAdded} imported`);
    if (relinked) parts.push(`${relinked} missing file${relinked === 1 ? '' : 's'} relinked`);
    if (skipped) parts.push(`${skipped} duplicate${skipped === 1 ? '' : 's'} skipped`);
    announce(parts.length ? `${parts.join(' · ')}. Audio stays in this browser's local storage.` : 'All selected tracks were already imported.', 4500);
  } catch (error) {
    announce(`Import stopped: ${error.name === 'QuotaExceededError' ? 'browser storage is full' : error.message}. Some earlier batches may have been saved.`, 5000);
    await refreshLibrary();
  } finally {
    setBusy(false);
  }
}

async function loadTrack(track, { autoplay = true, restore = false } = {}) {
  if (!track) return;
  if (!track.blob) {
    announce('The track is in your library index, but its audio file is not stored here. Import the original file to play it.');
    return;
  }
  try {
    const targetAudio = state.dspEnabled ? dspAudio : nativeAudio;
    if (!audio.paused) skipNextPausePersist = true;
    audio.pause();
    for (const element of [nativeAudio, dspAudio]) {
      if (element !== targetAudio) {
        element.pause();
        if (element.hasAttribute('src')) { element.removeAttribute('src'); element.load(); }
      }
    }
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(track.blob);
    audio = targetAudio;
    audio.src = state.objectUrl;
    audio.load();
    state.currentTrackId = track.id;
    state.restoredPosition = restore ? state.restoredPosition : 0;
    state.lastPersistedSecond = -1;
    const position = state.restoredPosition;
    const loadedAudio = audio;
    loadedAudio.addEventListener('loadedmetadata', async function seekRestored() {
      loadedAudio.removeEventListener('loadedmetadata', seekRestored);
      if (position > 0 && Number.isFinite(loadedAudio.duration)) loadedAudio.currentTime = Math.min(position, Math.max(0, loadedAudio.duration - 0.5));
      if (restore) await persistSetting('lastPosition', position);
      if (Number.isFinite(loadedAudio.duration) && loadedAudio.duration > 0 && track.duration !== loadedAudio.duration) {
        track.duration = loadedAudio.duration;
        await saveTrack(track).catch(() => {});
        renderLibrary();
      }
      renderPlaybackControls();
    }, { once: true });
    await persistSetting('currentTrackId', track.id);
    if (!restore) { state.lastPosition = 0; await persistSetting('lastPosition', 0); }
    state.isPlaying = false;
    renderAll();
    if (autoplay) {
      if (state.dspEnabled) {
        const graphOk = await prepareAudioGraph();
        if (!graphOk) {
          const failedAudio = audio;
          const fallback = nativeAudio;
          fallback.volume = failedAudio.volume;
          fallback.addEventListener('loadedmetadata', function seekFallback() { if (position > 0 && Number.isFinite(fallback.duration)) fallback.currentTime = Math.min(position, Math.max(0, fallback.duration - 0.5)); }, { once: true });
          fallback.src = state.objectUrl; fallback.load();
          audio = fallback;
          state.dspEnabled = false; await persistSetting('dspEnabled', false);
          if (failedAudio !== fallback && failedAudio.hasAttribute('src')) { failedAudio.pause(); failedAudio.removeAttribute('src'); failedAudio.load(); }
          updateEqControls();
          renderAll();
        }
      }
      await audio.play();
    }
    updateMediaSession();
    publishState();
  } catch (error) {
    state.isPlaying = false;
    renderPlaybackControls();
    announce(`Couldn't play this file in the current browser: ${error.message || 'unsupported format'}. Try another supported browser or codec.`, 5000);
  }
}
async function prepareAudioGraph() {
  if (graphReady) {
    if (audioContext?.state === 'suspended') await audioContext.resume();
    return true;
  }
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    $('#eqEngineStatus').textContent = 'UNAVAILABLE';
    announce('Web Audio is unavailable. Native playback remains available; EQ is disabled.');
    return false;
  }
  try {
    audioContext = new AudioContextConstructor();
    mediaSource = audioContext.createMediaElementSource(audio);
    bassNode = audioContext.createBiquadFilter(); bassNode.type = 'lowshelf'; bassNode.frequency.value = 90;
    trebleNode = audioContext.createBiquadFilter(); trebleNode.type = 'highshelf'; trebleNode.frequency.value = 8000;
    equalizerNodes = EQ_FREQUENCIES.map(frequency => {
      const filter = audioContext.createBiquadFilter(); filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1.0; return filter;
    });
    warmthNode = audioContext.createWaveShaper(); warmthNode.oversample = '4x'; updateWarmthCurve(state.eq.warmth);
    analyser = audioContext.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.78;
    const upmixer = audioContext.createGain();
    upmixer.channelCount = 2; upmixer.channelCountMode = 'explicit'; upmixer.channelInterpretation = 'speakers';
    const splitter = audioContext.createChannelSplitter(2);
    const merger = audioContext.createChannelMerger(2);
    const leftToLeft = audioContext.createGain();
    const rightToLeft = audioContext.createGain();
    const leftToRight = audioContext.createGain();
    const rightToRight = audioContext.createGain();
    widthNodes = { upmixer, splitter, merger, leftToLeft, rightToLeft, leftToRight, rightToRight };
    updateStereoWidth(state.eq.width);

    mediaSource.connect(bassNode);
    let prior = bassNode;
    for (const filter of equalizerNodes) { prior.connect(filter); prior = filter; }
    prior.connect(trebleNode);
    trebleNode.connect(warmthNode);
    warmthNode.connect(upmixer);
    upmixer.connect(splitter);
    splitter.connect(leftToLeft, 0); leftToLeft.connect(merger, 0, 0);
    splitter.connect(rightToLeft, 1); rightToLeft.connect(merger, 0, 0);
    splitter.connect(leftToRight, 0); leftToRight.connect(merger, 0, 1);
    splitter.connect(rightToRight, 1); rightToRight.connect(merger, 0, 1);
    merger.connect(analyser);
    analyser.connect(audioContext.destination);
    graphReady = true;
    await audioContext.resume();
    applyEqToNodes();
    $('#eqEngineStatus').textContent = 'WEB AUDIO / ACTIVE';
    $('#toggleDSP').textContent = 'Disable DSP';
    drawVisualizer();
    return true;
  } catch (error) {
    try { audioContext?.close(); } catch {}
    audioContext = null; mediaSource = null; graphReady = false;
    $('#eqEngineStatus').textContent = 'UNAVAILABLE';
    announce(`Browser audio processing could not start: ${error.message}. Native playback will be attempted.`, 5000);
    return false;
  }
}
function updateWarmthCurve(amount) {
  if (!warmthNode || !audioContext) return;
  const curve = new Float32Array(2048);
  if (amount <= 0) {
    for (let i = 0; i < curve.length; i++) curve[i] = (i * 2 / (curve.length - 1)) - 1;
  } else {
    const drive = 1 + amount * 9;
    const norm = Math.tanh(drive);
    for (let i = 0; i < curve.length; i++) {
      const x = (i * 2 / (curve.length - 1)) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
  }
  warmthNode.curve = curve;
}
function updateStereoWidth(width) {
  if (!widthNodes) return;
  const half = 0.5;
  widthNodes.leftToLeft.gain.value = half * (1 + width);
  widthNodes.rightToLeft.gain.value = half * (1 - width);
  widthNodes.leftToRight.gain.value = half * (1 - width);
  widthNodes.rightToRight.gain.value = half * (1 + width);
}
function applyEqToNodes() {
  if (!graphReady) return;
  state.eq.bands.forEach((gain, index) => { equalizerNodes[index].gain.value = gain; });
  bassNode.gain.value = state.eq.bass;
  trebleNode.gain.value = state.eq.treble;
  updateWarmthCurve(state.eq.warmth);
  updateStereoWidth(state.eq.width);
}
async function setDspEnabled(enabled) {
  if (state.dspEnabled === enabled) return;
  const from = audio;
  const target = enabled ? dspAudio : nativeAudio;
  const wasPlaying = !from.paused;
  const position = Number.isFinite(from.currentTime) ? from.currentTime : 0;
  const volume = from.volume;
  const track = trackById(state.currentTrackId);
  if (from !== target) {
    if (wasPlaying) skipNextPausePersist = true;
    from.pause();
    audio = target;
    target.volume = volume;
    if (track?.blob && state.objectUrl) {
      target.src = state.objectUrl;
      target.load();
      try {
        await new Promise(resolve => {
          if (target.readyState >= 1) { resolve(); return; }
          target.addEventListener('loadedmetadata', resolve, { once: true });
          target.addEventListener('error', resolve, { once: true });
        });
        if (position > 0 && Number.isFinite(target.duration)) target.currentTime = Math.min(position, Math.max(0, target.duration - 0.5));
      } catch { /* Playback error handler will describe any unsupported file. */ }
    }
    if (from.hasAttribute('src')) { from.removeAttribute('src'); from.load(); }
  }
  state.dspEnabled = enabled;
  await persistSetting('dspEnabled', enabled);
  if (enabled && track?.blob) {
    const graphOk = await prepareAudioGraph();
    if (!graphOk) {
      const failedAudio = audio;
      failedAudio.pause();
      const fallback = nativeAudio;
      fallback.volume = volume;
      if (state.objectUrl) { fallback.addEventListener('loadedmetadata', function seekFallback() { if (position > 0 && Number.isFinite(fallback.duration)) fallback.currentTime = Math.min(position, Math.max(0, fallback.duration - 0.5)); }, { once: true }); fallback.src = state.objectUrl; fallback.load(); }
      audio = fallback;
      if (failedAudio !== fallback && failedAudio.hasAttribute('src')) { failedAudio.removeAttribute('src'); failedAudio.load(); }
      state.dspEnabled = false;
      await persistSetting('dspEnabled', false);
      announce('DSP could not initialize in this browser. Returned to native playback.', 4500);
    }
  }
  updateEqControls();
  if (wasPlaying && track?.blob) {
    try { await audio.play(); } catch (error) { announce(`Could not switch audio mode: ${error.message}`); }
  }
  announce(enabled ? 'DSP enabled. Audio is routed through Web Audio processing.' : 'DSP disabled. Playback uses the browser-native audio path.');
  renderAll();
}

async function togglePlayback() {
  const track = trackById(state.currentTrackId);
  if (!track) {
    const first = state.queue.map(trackById).find(Boolean) || state.tracks.find(item => item.blob);
    if (!first) { announce('Import some audio first.'); return; }
    await loadTrack(first, { autoplay: true });
    return;
  }
  if (!audio.src) { await loadTrack(track, { autoplay: true }); return; }
  if (audio.paused) {
    if (state.dspEnabled) await prepareAudioGraph();
    try { await audio.play(); } catch (error) { announce(`Playback could not start: ${error.message}`); }
  } else audio.pause();
}
async function playNext(direction = 1) {
  const available = state.queue.filter(id => Boolean(trackById(id)?.blob));
  if (!available.length) {
    announce('Queue is empty. Add tracks with ＋≡.');
    return;
  }
  let index = available.indexOf(state.currentTrackId);
  if (index === -1) index = direction > 0 ? -1 : 0;
  let nextIndex;
  if (state.shuffle && direction > 0 && available.length > 1) {
    const choices = available.filter(id => id !== state.currentTrackId);
    nextIndex = available.indexOf(choices[Math.floor(Math.random() * choices.length)]);
  } else {
    nextIndex = index + direction;
    if (nextIndex < 0) nextIndex = state.repeat ? available.length - 1 : 0;
    if (nextIndex >= available.length) {
      if (state.repeat) nextIndex = 0;
      else { audio.pause(); state.isPlaying = false; renderPlaybackControls(); announce('Queue finished.'); return; }
    }
  }
  await loadTrack(trackById(available[nextIndex]), { autoplay: true });
}
async function queueTrack(id) {
  const track = trackById(id);
  if (!track) return;
  state.queue.push(id);
  await saveQueue();
  renderAll();
  announce(`Added “${track.title}” to the queue.`);
}
async function playTrackFromLibrary(id) {
  const index = state.queue.indexOf(id);
  if (index === -1) state.queue = [id, ...state.queue];
  else if (index > 0) state.queue = [...state.queue.slice(index), ...state.queue.slice(0, index)];
  await saveQueue();
  await loadTrack(trackById(id), { autoplay: true });
}
async function toggleFavorite(id) {
  const track = trackById(id);
  if (!track) return;
  track.favorite = !track.favorite;
  await saveTrack(track);
  renderAll();
}
async function removeQueueTrack(id) {
  const index = state.queue.indexOf(id);
  if (index >= 0) state.queue.splice(index, 1);
  await saveQueue();
  renderAll();
}
async function clearQueue() {
  state.queue = [];
  await saveQueue();
  renderAll();
  announce('Queue cleared. Current playback continues.');
}

async function createPlaylist(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const playlist = { id: crypto.randomUUID(), name: trimmed, trackIds: [], createdAt: new Date().toISOString() };
  state.playlists.push(playlist);
  await savePlaylist(playlist);
  state.playlists.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  state.activeView = 'playlist'; state.activePlaylistId = playlist.id; state.addingToPlaylist = false; state.renderLimit = 200;
  renderAll();
  announce(`Playlist “${trimmed}” created.`);
}
async function addTrackToPlaylist(trackId, playlistId = state.activePlaylistId) {
  const playlist = playlistById(playlistId);
  if (!playlist || !trackById(trackId)) return;
  if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId);
  await savePlaylist(playlist);
  renderAll();
  announce(`Added to “${playlist.name}”.`);
}
async function removeTrackFromPlaylist(trackId) {
  const playlist = playlistById(state.activePlaylistId);
  if (!playlist) return;
  playlist.trackIds = playlist.trackIds.filter(id => id !== trackId);
  await savePlaylist(playlist);
  renderAll();
}
async function removePlaylist(id) {
  const playlist = playlistById(id);
  if (!playlist || !confirm(`Delete playlist “${playlist.name}”? The original audio files will not be touched.`)) return;
  await deletePlaylist(id);
  state.playlists = state.playlists.filter(item => item.id !== id);
  state.activeView = 'all'; state.activePlaylistId = null; state.addingToPlaylist = false;
  renderAll();
  announce('Playlist deleted. Audio files were not changed.');
}
async function renamePlaylist(id) {
  const playlist = playlistById(id);
  if (!playlist) return;
  const name = prompt('Rename playlist:', playlist.name);
  if (name === null || !name.trim()) return;
  playlist.name = name.trim().slice(0, 64);
  await savePlaylist(playlist);
  renderAll();
}
function openAddToPlaylist(trackId) {
  currentPlaylistCommandPending = trackId;
  $('#addTracksHelp').textContent = `Choose where to add “${trackById(trackId)?.title || 'this track'}”.`;
  $('#playlistChoices').innerHTML = state.playlists.length ? state.playlists.map(playlist => `<button class="playlist-choice" data-choice-id="${escapeHTML(playlist.id)}"><span>♫ &nbsp;${escapeHTML(playlist.name)}</span><small>${playlist.trackIds.length} tracks →</small></button>`).join('') : '<p class="track-empty">No playlists yet. Create one from the sidebar first.</p>';
  $('#addTracksDialog').showModal();
}

function renderEqControls() {
  $('#eqBands').innerHTML = EQ_FREQUENCIES.map((frequency, index) => `<div class="eq-band"><output id="eqVal${index}">0 dB</output><input id="eqBand${index}" type="range" min="-12" max="12" step="0.5" value="0" aria-label="${frequency} hertz equalizer band"><label for="eqBand${index}">${EQ_LABELS[index]}</label></div>`).join('');
  for (let index = 0; index < EQ_FREQUENCIES.length; index++) {
    $(`#eqBand${index}`).addEventListener('input', async event => {
      state.eq.bands[index] = Number(event.target.value);
      $(`#eqVal${index}`).textContent = `${state.eq.bands[index] > 0 ? '+' : ''}${state.eq.bands[index]} dB`;
      applyEqToNodes(); await persistSetting('eqProfile', state.eq);
    });
  }
  for (const [id, key, output, suffix] of [['bassGain','bass','bassValue',' dB'],['trebleGain','treble','trebleValue',' dB']]) {
    $(`#${id}`).addEventListener('input', async event => {
      state.eq[key] = Number(event.target.value); $(`#${output}`).textContent = `${state.eq[key] > 0 ? '+' : ''}${state.eq[key]}${suffix}`;
      applyEqToNodes(); await persistSetting('eqProfile', state.eq);
    });
  }
  $('#warmthGain').addEventListener('input', async event => {
    state.eq.warmth = Number(event.target.value); $('#warmthValue').textContent = state.eq.warmth === 0 ? 'Off' : `${Math.round(state.eq.warmth * 100)}%`;
    applyEqToNodes(); await persistSetting('eqProfile', state.eq);
  });
  $('#stereoWidth').addEventListener('input', async event => {
    state.eq.width = Number(event.target.value); $('#widthValue').textContent = `${Math.round(state.eq.width * 100)}%`;
    applyEqToNodes(); await persistSetting('eqProfile', state.eq);
  });
  updateEqControls();
}
function updateEqControls() {
  if (!$('#eqBands')) return;
  state.eq.bands.forEach((gain, index) => {
    const input = $(`#eqBand${index}`); const output = $(`#eqVal${index}`);
    if (input) input.value = String(gain);
    if (output) output.textContent = `${gain > 0 ? '+' : ''}${gain} dB`;
  });
  for (const key of ['bass','treble']) {
    const input = $(`#${key}Gain`); const output = $(`#${key}Value`);
    if (input) input.value = String(state.eq[key]);
    if (output) output.textContent = `${state.eq[key] > 0 ? '+' : ''}${state.eq[key]} dB`;
  }
  if ($('#warmthGain')) { $('#warmthGain').value = String(state.eq.warmth); $('#warmthValue').textContent = state.eq.warmth === 0 ? 'Off' : `${Math.round(state.eq.warmth * 100)}%`; }
  if ($('#stereoWidth')) { $('#stereoWidth').value = String(state.eq.width); $('#widthValue').textContent = `${Math.round(state.eq.width * 100)}%`; }
  applyEqToNodes();
  if ($('#eqEngineStatus')) $('#eqEngineStatus').textContent = state.dspEnabled ? (graphReady ? 'WEB AUDIO / ACTIVE' : 'DSP ON / READY') : 'NATIVE / DSP OFF';
  if ($('#toggleDSP')) { $('#toggleDSP').textContent = state.dspEnabled ? 'Disable DSP' : 'Enable DSP'; $('#toggleDSP').classList.toggle('button-accent', !state.dspEnabled); $('#toggleDSP').classList.toggle('button-outline', state.dspEnabled); }
}
function drawVisualizer() {
  cancelAnimationFrame(visualizerFrame);
  const canvas = $('#visualizer');
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;
  const render = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.clearRect(0, 0, width, height);
    if (state.visualizerEnabled && state.isPlaying && analyser && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data);
      const bars = Math.min(36, Math.floor(width / (3 * dpr)));
      const barWidth = Math.max(1, width / bars - 2 * dpr);
      for (let i = 0; i < bars; i++) {
        const value = data[Math.floor(i * data.length / bars)] / 255;
        const barHeight = Math.max(2 * dpr, value * height * 0.94);
        const x = i * (width / bars);
        context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--visualizer').trim() || '#f3a712';
        context.globalAlpha = 0.36 + value * 0.64;
        context.fillRect(x, height - barHeight, barWidth, barHeight);
      }
      context.globalAlpha = 1;
    } else {
      context.fillStyle = '#3c3421';
      const bars = Math.min(18, Math.floor(width / (4 * dpr)));
      const barWidth = Math.max(1, width / bars - 2 * dpr);
      for (let i = 0; i < bars; i++) {
        const h = (i % 4 === 0 ? 7 : i % 3 === 0 ? 4 : 2) * dpr;
        context.fillRect(i * width / bars, height - h, barWidth, h);
      }
    }
    if (state.visualizerEnabled && state.isPlaying && analyser && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      visualizerFrame = requestAnimationFrame(render);
    }
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width*dpr)); canvas.height = Math.max(1, Math.floor(rect.height*dpr));
    context.clearRect(0,0,canvas.width,canvas.height); return;
  }
  render();
}
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const track = trackById(state.currentTrackId);
  try {
    if (track && 'MediaMetadata' in window) navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist || 'Unknown artist', album: track.album || '2kPlayer Library' });
  } catch { /* Metadata support varies between browsers. */ }
  const actions = {
    play: () => togglePlayback(),
    pause: () => audio.pause(),
    previoustrack: () => playNext(-1),
    nexttrack: () => playNext(1),
    seekbackward: event => { audio.currentTime = Math.max(0, audio.currentTime - (event.seekOffset || 10)); },
    seekforward: event => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (event.seekOffset || 10)); }
  };
  for (const [action, handler] of Object.entries(actions)) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* The browser may support only a subset of media-session actions. */ }
  }
}

function publishState() {
  if (!channel || PLAYLIST_MODE) return;
  try { channel.postMessage({ type: 'PLAYER_STATE', currentTrackId: state.currentTrackId, isPlaying: state.isPlaying, queue: state.queue, at: Date.now() }); } catch {}
}
function renderPopout() {
  const mode = document.body.dataset.popview || 'queue';
  const ids = mode === 'queue' ? state.queue : state.tracks.map(track => track.id);
  const tracks = ids.map(trackById).filter(Boolean);
  const visible = tracks.slice(0, state.renderLimit);
  const remaining = Math.max(0, tracks.length - visible.length);
  $('#popoutRows').innerHTML = tracks.length ? visible.map((track, index) => renderTrackRow(track, index, { queueMode: mode === 'queue' })).join('') + (remaining ? `<div class="load-more-wrap"><button class="button button-outline" id="loadMorePopout">Load next ${Math.min(200, remaining)} tracks · ${remaining.toLocaleString()} remaining</button></div>` : '') : `<div class="track-empty">${mode === 'queue' ? 'Queue is empty. Add tracks from the main window.' : 'No local tracks yet. Import them in the main player.'}</div>`;
  $('#popoutNotice').textContent = channel ? 'Click ▶ to play in the main window, or ＋≡ to add to its queue.' : 'Cross-window commands are unavailable here. Use Play queue in the main player window as the fallback.';
  $$('.segmented button').forEach(button => button.classList.toggle('active', button.dataset.popview === mode));
}
function openPlaylistWindow() {
  const url = new URL(location.href);
  url.searchParams.set('window', 'playlist');
  const popup = window.open(url.toString(), '2kPlayerPlaylist', 'popup=yes,width=920,height=720,resizable=yes,scrollbars=yes');
  if (!popup) announce('Popup blocked. Allow popups for the separate window, or use Play queue in this window as the fallback.');
  else announce('Playlist window opened. Browser window behavior can vary.');
}

async function exportBackup() {
  const settings = await getAllSettings();
  const backup = makeBackup({ tracks: state.tracks, playlists: state.playlists, settings });
  downloadFile(`2kplayer-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
  announce('Library metadata backup exported. Audio files are not included.', 4000);
}
async function importBackupFile(file) {
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('That file is not valid JSON.'); }
  const backup = validateBackup(parsed);
  const existing = new Map((await getAllTracks()).map(track => [track.id, track]));
  const tracks = backup.tracks.map(item => {
    const found = existing.get(item.id);
    if (found) return { ...found, ...item, blob: found.blob, unavailable: !found.blob };
    return { ...item, blob: undefined, unavailable: true, extension: item.extension || extensionOf(item.filename || '') };
  });
  for (let offset = 0; offset < tracks.length; offset += 40) await saveTracks(tracks.slice(offset, offset + 40));
  for (const playlist of backup.playlists) await savePlaylist({ ...playlist, trackIds: playlist.trackIds });
  for (const setting of backup.settings) await setSetting(setting.key, setting.value);
  await refreshLibrary();
  announce('Backup merged. Tracks without local audio files will need to be imported again.', 5000);
}
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function exportTheme() {
  downloadFile('2kplayer-theme.json', JSON.stringify(state.theme, null, 2), 'application/json');
}
async function importThemeFile(file) {
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('Theme file is not valid JSON.'); }
  state.theme = validateTheme(parsed);
  applyTheme(state.theme);
  await persistSetting('theme', state.theme);
  announce(`Theme “${state.theme.name}” applied.`);
}

function setupEvents() {
  $('#importFiles').addEventListener('click', () => $('#filePicker').click());
  $('#emptyImport')?.addEventListener('click', () => $('#filePicker').click());
  $('#filePicker').addEventListener('change', async event => { await importAudioFiles(event.target.files); event.target.value = ''; });
  $('#scanFolder').addEventListener('click', () => $('#folderPicker').click());
  $('#folderPicker').addEventListener('change', async event => { await importAudioFiles(event.target.files); event.target.value = ''; });
  $('#searchInput').addEventListener('input', event => { state.search = event.target.value; state.renderLimit = 200; renderLibrary(); });
  $$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => { state.activeView = button.dataset.view; state.activePlaylistId = null; state.addingToPlaylist = false; state.renderLimit = 200; renderAll(); }));
  $('#playlistNav').addEventListener('click', event => {
    const button = event.target.closest('[data-playlist-id]'); if (!button) return;
    state.activeView = 'playlist'; state.activePlaylistId = button.dataset.playlistId; state.addingToPlaylist = false; state.search = ''; state.renderLimit = 200; $('#searchInput').value = ''; renderAll();
  });
  $('#playlistDetailBar').addEventListener('click', async event => {
    if (event.target.closest('#addPlaylistTracks')) { state.addingToPlaylist = true; state.search = ''; state.renderLimit = 200; $('#searchInput').value = ''; renderLibrary(); return; }
    if (event.target.closest('#doneAddingTracks')) { state.addingToPlaylist = false; renderLibrary(); return; }
    if (event.target.closest('#deletePlaylistButton')) { await removePlaylist(state.activePlaylistId); return; }
    if (event.target.closest('#renamePlaylist')) { await renamePlaylist(state.activePlaylistId); }
  });
  $('#trackRows').addEventListener('click', async event => {
    if (event.target.closest('#loadMoreTracks')) { state.renderLimit += 200; renderLibrary(); return; }
    const play = event.target.closest('.play-row'); if (play) { await playTrackFromLibrary(play.dataset.id); return; }
    const add = event.target.closest('.add-to-queue'); if (add) { await queueTrack(add.dataset.id); return; }
    const favorite = event.target.closest('.favorite-button'); if (favorite?.dataset.id) { await toggleFavorite(favorite.dataset.id); return; }
    const addPlaylist = event.target.closest('.add-to-playlist'); if (addPlaylist) { await addTrackToPlaylist(addPlaylist.dataset.id); return; }
    const removePlaylist = event.target.closest('.remove-from-playlist'); if (removePlaylist) { await removeTrackFromPlaylist(removePlaylist.dataset.id); return; }
    if (event.target.closest('#emptyImport')) $('#filePicker').click();
  });
  $('#queuePreview').addEventListener('click', async event => { const button = event.target.closest('.remove-from-queue'); if (button) await removeQueueTrack(button.dataset.id); });
  $('#openQueue').addEventListener('click', () => { state.activeView = 'queue'; state.activePlaylistId = null; state.renderLimit = 200; renderAll(); });
  $('#clearQueue').addEventListener('click', clearQueue);
  $('#createPlaylist').addEventListener('click', () => { $('#createPlaylistDialog').showModal(); $('#newPlaylistName').focus(); });
  $('#createPlaylistForm').addEventListener('submit', async event => { event.preventDefault(); await createPlaylist($('#newPlaylistName').value); $('#newPlaylistName').value = ''; $('#createPlaylistDialog').close(); });
  $('#playlistChoices').addEventListener('click', async event => { const button = event.target.closest('[data-choice-id]'); if (!button) return; await addTrackToPlaylist(currentPlaylistCommandPending, button.dataset.choiceId); $('#addTracksDialog').close(); });
  $('#openPlaylistWindow').addEventListener('click', openPlaylistWindow);
  $('#playlistClose').addEventListener('click', () => window.close());
  $('#playlistRefresh').addEventListener('click', refreshLibrary);
  $$('.segmented button').forEach(button => button.addEventListener('click', () => { document.body.dataset.popview = button.dataset.popview; state.renderLimit = 200; renderPopout(); }));
  $('#popoutRows').addEventListener('click', event => {
    if (event.target.closest('#loadMorePopout')) { state.renderLimit += 200; renderPopout(); return; }
    const play = event.target.closest('.play-row'); if (play && channel) { channel.postMessage({ type: 'PLAY_TRACK', id: play.dataset.id }); $('#popoutNotice').textContent = 'Playback command sent to the main player.'; return; }
    const add = event.target.closest('.add-to-queue'); if (add && channel) { channel.postMessage({ type: 'QUEUE_TRACK', id: add.dataset.id }); $('#popoutNotice').textContent = 'Queue command sent to the main player.'; }
  });
  $('#openEq').addEventListener('click', () => { updateEqControls(); $('#eqDialog').showModal(); });
  $('#toggleDSP').addEventListener('click', () => setDspEnabled(!state.dspEnabled));
  $('#eqReset').addEventListener('click', async () => { state.eq = { bands: Array(10).fill(0), bass: 0, treble: 0, warmth: 0, width: 1 }; updateEqControls(); await persistSetting('eqProfile', state.eq); announce('EQ reset to neutral.'); });
  $('#openThemes').addEventListener('click', () => $('#themeDialog').showModal());
  $('#importTheme').addEventListener('click', () => $('#themePicker').click());
  $('#themePicker').addEventListener('change', async event => { const file = event.target.files?.[0]; if (file) { try { await importThemeFile(file); } catch (error) { announce(`Theme rejected: ${error.message}`, 4500); } } event.target.value = ''; });
  $('#exportTheme').addEventListener('click', exportTheme);
  $('#resetTheme').addEventListener('click', async () => { state.theme = structuredClone(DEFAULT_THEME); applyTheme(state.theme); await persistSetting('theme', state.theme); announce('Signature theme restored.'); });
  $('#backupButton').addEventListener('click', () => $('#backupDialog').showModal());
  $('#exportBackup').addEventListener('click', exportBackup);
  $('#importBackup').addEventListener('click', () => $('#backupPicker').click());
  $('#backupPicker').addEventListener('change', async event => { const file = event.target.files?.[0]; if (file) { try { if (!confirm('Merge this backup into the current library? Existing audio files will not be deleted, but metadata may be updated.')) return; await importBackupFile(file); $('#backupDialog').close(); } catch (error) { announce(`Backup rejected: ${error.message}`, 5000); } finally { event.target.value = ''; } } });
  $('#dismissUpdate').addEventListener('click', () => $('#updateNotice').classList.add('hidden'));
  $('#installUpdate').addEventListener('click', () => {
    if (!pendingWorker) return;
    reloadAfterUpdate = true;
    pendingWorker.postMessage({ type: 'SKIP_WAITING' });
    $('#installUpdate').disabled = true;
    $('#installUpdate').textContent = 'Installing…';
  });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (reloadAfterUpdate) location.reload();
  });
  $('#protectStorage').addEventListener('click', async () => {
    const persisted = await requestPersistentStorage();
    announce(persisted ? 'The browser granted persistent-storage protection. This is not a replacement for a separate backup.' : 'Persistent storage is not available or was not granted. Export a separate backup and keep your original audio files.', 5000);
  });
  $('#playButton').addEventListener('click', togglePlayback);
  $('#previousButton').addEventListener('click', async () => { if (audio.currentTime > 4) audio.currentTime = 0; else await playNext(-1); });
  $('#nextButton').addEventListener('click', () => playNext(1));
  $('#shuffleButton').addEventListener('click', async () => { state.shuffle = !state.shuffle; await persistSetting('shuffle', state.shuffle); renderAll(); announce(state.shuffle ? 'Shuffle enabled. Library order stays unchanged.' : 'Shuffle disabled.'); });
  $('#repeatButton').addEventListener('click', async () => { state.repeat = !state.repeat; await persistSetting('repeat', state.repeat); renderAll(); announce(state.repeat ? 'Repeat queue enabled.' : 'Repeat queue disabled.'); });
  $('#dockFavorite').addEventListener('click', () => { if (state.currentTrackId) toggleFavorite(state.currentTrackId); });
  $('#seekBar').addEventListener('input', event => { if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = (Number(event.target.value) / 1000) * audio.duration; });
  $('#volumeBar').addEventListener('input', async event => { audio.volume = Number(event.target.value); await persistSetting('volume', audio.volume); });
  $('#visualizerToggle').addEventListener('click', async () => {
    const next = !state.visualizerEnabled;
    if (next && !state.dspEnabled) { $('#eqDialog').showModal(); announce('Live spectrum needs the Web Audio path. Enable DSP in the equalizer first.'); return; }
    state.visualizerEnabled = next; await persistSetting('visualizerEnabled', state.visualizerEnabled); renderAll(); drawVisualizer();
  });
  for (const element of [nativeAudio, dspAudio]) {
    element.addEventListener('play', () => { if (element !== audio) return; state.isPlaying = true; renderAll(); drawVisualizer(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
    element.addEventListener('pause', () => { if (element !== audio) { if (skipNextPausePersist) skipNextPausePersist = false; return; } state.isPlaying = false; renderPlaybackControls(); drawVisualizer(); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; if (skipNextPausePersist) skipNextPausePersist = false; else void savePlaybackPosition(true); publishState(); });
    element.addEventListener('timeupdate', () => { if (element !== audio) return; renderPlaybackControls(); if (Math.floor(audio.currentTime) % 5 === 0) void savePlaybackPosition(); });
    element.addEventListener('durationchange', () => { if (element === audio) renderPlaybackControls(); });
    element.addEventListener('ended', () => { if (element === audio) playNext(1); });
    element.addEventListener('error', () => { if (element === audio && audio.currentSrc) announce('This file could not be decoded by the current browser. The track remains in your library.', 5000); });
  }
  window.addEventListener('beforeunload', () => { void savePlaybackPosition(true); if (state.objectUrl) URL.revokeObjectURL(state.objectUrl); });
  window.addEventListener('resize', () => drawVisualizer());
  document.addEventListener('click', event => { const close = event.target.closest('[data-close]'); if (close) $(`#${close.dataset.close}`)?.close(); });
  document.addEventListener('keydown', event => {
    if (PLAYLIST_MODE) return;
    const tag = event.target?.tagName;
    const typing = ['INPUT','TEXTAREA','SELECT'].includes(tag) || event.target?.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); return; }
    if (typing || ['DIALOG'].includes(tag) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 5); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); }
    else if (event.key.toLowerCase() === 'n') playNext(1);
    else if (event.key.toLowerCase() === 'p') playNext(-1);
  });
  if (channel) {
    channel.onmessage = async event => {
      const message = event.data || {};
      if (PLAYLIST_MODE) {
        if (message.type === 'PLAYER_STATE') { state.currentTrackId = message.currentTrackId; state.isPlaying = message.isPlaying; state.queue = message.queue || state.queue; renderPopout(); }
        return;
      }
      if (message.type === 'PLAY_TRACK') await playTrackFromLibrary(message.id);
      if (message.type === 'QUEUE_TRACK') await queueTrack(message.id);
      if (message.type === 'GET_STATE') publishState();
    };
  }
}

async function boot() {
  if (PLAYLIST_MODE) {
    document.body.classList.add('playlist-mode');
    $('#appShell').classList.add('hidden');
    $('#playlistWindow').classList.remove('hidden');
    document.title = '2kPlayer — Playlist';
    renderEqControls();
  } else renderEqControls();
  setupEvents();
  try {
    await openDatabase();
    await refreshLibrary({ restoreSession: !PLAYLIST_MODE });
    if (channel && PLAYLIST_MODE) channel.postMessage({ type: 'GET_STATE' });
    // This isolated review preview intentionally does not install an app-shell worker.
  } catch (error) {
    announce(`Local storage is unavailable: ${error.message}`, 6500);
    $('#libraryStatus').textContent = 'STORAGE ERROR';
    $('#trackRows').innerHTML = `<div class="track-empty">2kPlayer could not open its local database. Try a supported browser in a secure context. ${escapeHTML(error.message)}</div>`;
  }
  if (PLAYLIST_MODE) renderPopout();
  drawVisualizer();
}

boot();

