/* Wikimedia Commons photo discovery. Metadata only is stored here; images use the browser cache.
 * API reference: https://www.mediawiki.org/wiki/API:Imageinfo
 * CORS reference: https://www.mediawiki.org/wiki/API:Cross-site_requests
 */
(() => {
  'use strict';
  const CACHE_KEY = 'oceanWindow.wikimedia.v1';
  const RETRY_DELAY = 15 * 60 * 1000;
  const LIMIT = 200;
  const API = 'https://commons.wikimedia.org/w/api.php';
  const places = [
    ["Anse Source d'Argent", 'ラ・ディーグ島', 'セーシェル'],
    ['Whitehaven Beach', 'ホワイトヘブン', 'オーストラリア'],
    ['Saona Island', 'サオナ島', 'ドミニカ共和国'],
    ['Beaches of the Maldives', 'モルディブの海岸', 'モルディブ'],
    ['Furuzamami Beach', '古座間味ビーチ', '日本・沖縄'],
    ['Navagio', 'ナヴァイオビーチ', 'ギリシャ'],
    ['Grace Bay', 'グレースベイ', 'タークス・カイコス諸島'],
    ['Lanikai Beach', 'ラニカイビーチ', 'アメリカ・ハワイ'],
    ['Maya Bay', 'マヤ湾', 'タイ'],
    ['Nacpan Beach', 'ナクパンビーチ', 'フィリピン'],
    ['Nungwi', 'ヌングイ', 'タンザニア・ザンジバル'],
    ['Seven Mile Beach, Grand Cayman', 'セブンマイルビーチ', 'ケイマン諸島']
  ];
  const excluded = /\b(?:map|chart|diagram|painting|drawing|illustration|portrait|selfie|nude|nudist|woman|women|man|men|girl|boy|people|crowd|tourists|sunbathing|swimming|snorkeling|diving|surfer|surfing|boat|boats|yacht|ship|ferry|cruise|harbo[u]?r|marina|airport|aircraft|helicopter|hotel|resort|restaurant|building|construction|road|parking|sign|logo|flag|fish|bird|crab|lizard|turtle|shell|coral|seaweed|rubbish|trash|waste|storm|cyclone|hurricane|tsunami|collage|banner|panorama)\b/i;
  const artificial = /(?:AI[- ]generated|artificial intelligence|synthetic image|midjourney|stable diffusion|DALL-E)/i;
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
    ndash: '–', mdash: '—', copy: '©', eacute: 'é', uuml: 'ü', ouml: 'ö', auml: 'ä' };
  let pending = null;
  let retryAt = 0;
  let memory = null;

  function options(config = {}) {
    const count = Number(config.targetPhotoCount);
    const hours = Number(config.refreshHours);
    return { target: Number.isInteger(count) && count >= 1 ? Math.min(count, LIMIT) : 60,
      ttl: (Number.isFinite(hours) && hours >= 1 ? Math.min(hours, 168) : 24) * 60 * 60 * 1000 };
  }

  function plain(value, max = 240) {
    // Metadata contains HTML. Never parse it into the workbench DOM or use innerHTML.
    return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? whole;
      const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : '';
    }).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function safeURL(value, kind) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      if (kind === 'image' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) &&
          url.pathname.startsWith('/wikipedia/commons/') && /\.jpe?g$/i.test(url.pathname)) {
        url.search = ''; // Exclude API-added tracking parameters; stable URL benefits the HTTP cache.
        return url.href;
      }
      if (kind === 'source' && url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/File:')) return url.href;
      if (kind === 'license' && url.hostname === 'creativecommons.org' &&
          /^\/(?:licenses\/by(?:-sa)?\/[1-4]\.0|licenses\/by(?:-sa)?\/2\.5|publicdomain\/(?:zero|mark)\/1\.0)\/?$/.test(url.pathname)) return url.href;
    } catch { /* Ignore invalid remote or cached metadata. */ }
    return '';
  }

  function normalize(photo) {
    if (!photo || typeof photo !== 'object') return null;
    const imageUrl = safeURL(photo.imageUrl, 'image');
    const sourceUrl = safeURL(photo.sourceUrl, 'source');
    const licenseUrl = safeURL(photo.licenseUrl, 'license');
    const license = plain(photo.license, 40);
    if (!imageUrl || !sourceUrl || !licenseUrl || !/^(?:CC BY(?:-SA)? [1-4]\.[05]|CC0|Public domain)$/i.test(license)) return null;
    const id = plain(photo.id, 120), label = plain(photo.label, 160), author = plain(photo.author);
    if (!id || !label || !author) return null;
    const position = /^\d{1,3}% \d{1,3}%$/.test(photo.position || '') ? photo.position : '50% 50%';
    return { id, label, country: plain(photo.country, 100), imageUrl, sourceUrl, author, license, licenseUrl, position };
  }

  function unique(items) {
    const found = new Set();
    return items.map(normalize).filter(photo => {
      if (!photo) return false;
      let key;
      try { key = decodeURIComponent(new URL(photo.sourceUrl).pathname).replaceAll('_', ' '); }
      catch { return false; }
      if (found.has(key)) return false;
      found.add(key);
      return true;
    }).slice(0, LIMIT);
  }

  function readCache() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (raw?.version === 1 && Number.isFinite(raw.fetchedAt) && Array.isArray(raw.photos)) {
        const cached = { fetchedAt: raw.fetchedAt, photos: unique(raw.photos.slice(0, LIMIT)),
          requestedCount: Number.isInteger(raw.requestedCount) ? Math.min(LIMIT, Math.max(1, raw.requestedCount)) : raw.photos.length };
        if (cached.photos.length && (!memory || cached.fetchedAt > memory.fetchedAt)) memory = cached;
      }
    } catch { /* Storage may be unavailable, full, or contain a partial older write. */ }
    return memory;
  }

  function getCached(config = {}) { return (readCache()?.photos || []).slice(0, options(config).target); }

  // Webviews can be recreated with a different origin. Transfer only normalized
  // photo metadata; image bytes continue to use Chromium's ordinary HTTP cache.
  function exportCache() {
    const cached = readCache();
    return cached ? { version: 1, fetchedAt: cached.fetchedAt, requestedCount: cached.requestedCount,
      photos: cached.photos.map(photo => ({ ...photo })) } : null;
  }

  function importCache(raw) {
    if (raw?.version !== 1 || !Number.isFinite(raw.fetchedAt) || raw.fetchedAt < 0 ||
        raw.fetchedAt > Date.now() || !Array.isArray(raw.photos)) return false;
    const photos = unique(raw.photos.slice(0, LIMIT));
    if (!photos.length) return false;
    const previous = readCache();
    if (previous && previous.fetchedAt > raw.fetchedAt) return false;
    memory = { fetchedAt: raw.fetchedAt, photos,
      requestedCount: Number.isInteger(raw.requestedCount) ? Math.min(LIMIT, Math.max(1, raw.requestedCount)) : photos.length };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, ...memory })); } catch { /* Memory remains available. */ }
    return true;
  }

  function metadataPhoto(page, place) {
    const info = page.imageinfo?.[0];
    if (!info || info.mime !== 'image/jpeg' || Math.min(info.width, info.height) < 900 ||
        info.width / info.height > 2.2 || info.width / info.height < .45) return null;
    const meta = info.extmetadata || {};
    const value = key => meta[key]?.value || '';
    const description = plain(`${page.title} ${value('ImageDescription')}`, 4000);
    if (excluded.test(description) || artificial.test(description + ' ' + value('Categories'))) return null;
    let license = plain(value('LicenseShortName'), 40);
    let licenseUrl = value('LicenseUrl');
    if (license === 'Public domain') licenseUrl ||= 'https://creativecommons.org/publicdomain/mark/1.0/';
    if (license === 'CC0') licenseUrl ||= 'https://creativecommons.org/publicdomain/zero/1.0/';
    let imageUrl = info.thumburl;
    // Wikimedia uses standard thumbnail buckets. Portraits need a narrower bucket to avoid 2560+ px downloads.
    if (info.height > info.width && imageUrl) imageUrl = imageUrl.replace(/\/\d+px-/, '/1280px-');
    return normalize({ id: `commons-${page.pageid}`, label: place[1], country: place[2], imageUrl,
      sourceUrl: info.descriptionurl, author: plain(value('Artist')), license, licenseUrl, position: '50% 50%' });
  }

  async function discover(place, count) {
    const url = new URL(API);
    url.search = new URLSearchParams({ action: 'query', format: 'json', origin: '*',
      generator: 'search', gsrsearch: `incategory:"${place[0]}" filetype:bitmap`,
      gsrnamespace: '6', gsrlimit: String(count), gsrsort: 'random', prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1920',
      iiextmetadatalanguage: 'en',
      iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription|Categories',
      maxlag: '5'
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url.href, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) return [];
      const data = await response.json();
      if (data.error) return [];
      return Object.values(data.query?.pages || {}).map(page => metadataPhoto(page, place)).filter(Boolean);
    } catch { return []; }
    finally { clearTimeout(timeout); }
  }

  async function refresh(seeds, previous, target) {
    let cursor = 0;
    const count = Math.max(10, Math.ceil(target * 1.5 / places.length));
    const batches = new Array(places.length);
    async function worker() {
      while (cursor < places.length) {
        const index = cursor++;
        batches[index] = await discover(places[index], count);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    // Interleave regions so the cap cannot discard all photos from later destinations.
    const discovered = [];
    for (let row = 0; row < count; row++) for (const batch of batches) if (batch[row]) discovered.push(batch[row]);
    if (!discovered.length) {
      retryAt = Date.now() + RETRY_DELAY;
      return unique([...(previous?.photos || []), ...seeds]).slice(0, target);
    }
    const photos = unique([...discovered, ...seeds, ...(previous?.photos || [])]);
    memory = { fetchedAt: Date.now(), requestedCount: target, photos };
    retryAt = 0;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 1, ...memory })); } catch { /* Memory cache remains available. */ }
    globalThis.dispatchEvent?.(new Event('ocean-window-catalog-change'));
    return photos.slice(0, target);
  }

  function load(config = {}) {
    const previous = readCache();
    const seeds = Array.isArray(config.photos) ? config.photos : [];
    const { target, ttl } = options(config);
    const now = Date.now();
    if (previous && previous.fetchedAt <= now && now - previous.fetchedAt < ttl &&
        (previous.requestedCount >= target || previous.photos.length >= target)) return Promise.resolve(unique([...previous.photos, ...seeds]).slice(0, target));
    if (now < retryAt) return Promise.resolve(unique([...(previous?.photos || []), ...seeds]).slice(0, target));
    if (!pending) pending = refresh(seeds, previous, target).finally(() => { pending = null; });
    return pending.then(photos => photos.slice(0, target));
  }

  globalThis.__oceanSource = Object.freeze({ getCached, load, exportCache, importCache,
    normalizePhotos: items => Array.isArray(items) ? unique(items.slice(0, LIMIT)) : [] });
})();
