import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../src/wikimedia-source.js', import.meta.url), 'utf8');
const seeds = JSON.parse(fs.readFileSync(new URL('../assets/photos.json', import.meta.url), 'utf8'));
function harness({ offline = false, cached } = {}) {
  const storage = new Map();
  if (cached) storage.set('oceanWindow.wikimedia.v1', JSON.stringify(cached));
  let now = 1_800_000_000_000;
  let requests = 0, active = 0, maxActive = 0;
  class ClockDate extends Date { static now() { return now; } }
  const sandbox = { URL, URLSearchParams, AbortController, setTimeout, clearTimeout, Date: ClockDate,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async () => {
      const id = ++requests;
      active++; maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
      if (offline) throw new Error('offline');
      return { ok: true, json: async () => ({ query: { pages: { [id]: {
        pageid: id, title: `File:Beautiful beach ${id}.jpg`, imageinfo: [{
          mime: 'image/jpeg', width: 1920, height: 1280,
          thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Beach${id}.jpg/1920px-Beach${id}.jpg`,
          descriptionurl: `https://commons.wikimedia.org/wiki/File:Beach${id}.jpg`,
          extmetadata: { Artist: { value: '<a href="https://example.com">A &amp; B</a>' },
            LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
            ImageDescription: { value: 'Calm turquoise coast.' } }
        }]
      } } } }) };
    } };
  vm.runInNewContext(code, sandbox);
  return { api: sandbox.__oceanSource, storage, advance: ms => { now += ms; },
    stats: () => ({ requests, maxActive }), config: { photos: seeds, refreshHours: 1, targetPhotoCount: 18 } };
}

test('Commons discovery uses bounded concurrency and fresh metadata cache avoids new requests', async () => {
  const h = harness();
  const photos = await h.api.load(h.config);
  assert.equal(photos.length, 18);
  assert.equal(h.stats().requests, 12);
  assert.ok(h.stats().maxActive <= 3);
  assert.equal(photos[0].author, 'A & B');
  assert.equal((await h.api.load(h.config)).length, 18);
  assert.equal(h.stats().requests, 12);
  assert.equal(h.api.getCached({ targetPhotoCount: 5 }).length, 5);
});

test('configured expiry refreshes and concurrent callers share one request batch', async () => {
  const h = harness();
  await Promise.all([h.api.load(h.config), h.api.load(h.config)]);
  assert.equal(h.stats().requests, 12);
  h.advance(61 * 60_000);
  await h.api.load(h.config);
  assert.equal(h.stats().requests, 24);
});

test('network outage keeps online seed metadata and backs off repeated API requests', async () => {
  const h = harness({ offline: true });
  assert.equal((await h.api.load(h.config)).length, seeds.length);
  const calls = h.stats().requests;
  await h.api.load(h.config);
  assert.equal(h.stats().requests, calls);
  h.advance(16 * 60_000);
  await h.api.load(h.config);
  assert.equal(h.stats().requests, calls + 12);
});

test('cache accepts only Commons photographs and safe source/license URLs', async () => {
  const bad = { ...seeds[0], id: 'bad', imageUrl: 'https://example.com/track.jpg' };
  const h = harness({ offline: true, cached: { version: 1, fetchedAt: 1_799_000_000_000,
    photos: [bad, { ...seeds[0], sourceUrl: 'javascript:alert(1)' }, seeds[1]] } });
  assert.equal(h.api.getCached().length, 1);
  assert.equal(h.api.getCached()[0].id, seeds[1].id);
});
