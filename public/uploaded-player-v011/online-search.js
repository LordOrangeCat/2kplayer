/** Build a provider search URL without scraping, downloading, or extracting media. */
export function buildYouTubeSearchUrl(query) {
  const normalized = String(query ?? '').trim();
  if (!normalized) throw new TypeError('A search query is required.');
  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', normalized);
  return url.toString();
}
