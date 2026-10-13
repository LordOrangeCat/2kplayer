const BACKUP_FORMAT = '2kplayer-library-backup';
const BACKUP_VERSION = 1;

export function makeBackup({ tracks, playlists, settings, createdAt = new Date().toISOString() }) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    includesAudioBytes: false,
    tracks: tracks.map(({ id, title, artist, album, filename, extension, mimeType, size, lastModified, sourceKey, duration, sampleRate, favorite, addedAt, unavailable }) => ({
      id, title, artist, album, filename, extension, mimeType, size, lastModified, sourceKey, duration, sampleRate, favorite: Boolean(favorite), addedAt, unavailable: Boolean(unavailable)
    })),
    playlists: playlists.map(({ id, name, trackIds, createdAt: playlistCreatedAt }) => ({ id, name, trackIds: [...trackIds], createdAt: playlistCreatedAt })),
    settings: settings.filter(({ key }) => ['queue', 'currentTrackId', 'lastPosition', 'volume', 'theme', 'shuffle', 'repeat', 'visualizerEnabled'].includes(key))
  };
}

export function validateBackup(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Backup must be a JSON object.');
  if (input.format !== BACKUP_FORMAT || input.version !== BACKUP_VERSION) throw new Error('This is not a supported 2kPlayer backup.');
  if (!Array.isArray(input.tracks) || !Array.isArray(input.playlists) || !Array.isArray(input.settings)) throw new Error('Backup is missing required library sections.');
  if (input.tracks.length > 100_000 || input.playlists.length > 10_000) throw new Error('Backup exceeds the safety limits.');
  for (const track of input.tracks) {
    if (!track || typeof track.id !== 'string' || typeof track.title !== 'string') throw new Error('Backup contains an invalid track record.');
  }
  for (const playlist of input.playlists) {
    if (!playlist || typeof playlist.id !== 'string' || typeof playlist.name !== 'string' || !Array.isArray(playlist.trackIds) || playlist.trackIds.some(id => typeof id !== 'string')) {
      throw new Error('Backup contains an invalid playlist.');
    }
  }
  for (const setting of input.settings) {
    if (!setting || typeof setting.key !== 'string' || !['queue', 'currentTrackId', 'lastPosition', 'volume', 'theme', 'shuffle', 'repeat', 'visualizerEnabled'].includes(setting.key)) {
      throw new Error('Backup contains an unsupported setting.');
    }
  }
  return input;
}

export { BACKUP_FORMAT, BACKUP_VERSION };
