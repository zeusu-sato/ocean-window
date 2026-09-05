import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const seeds = JSON.parse(fs.readFileSync('assets/photos.json', 'utf8'));

// Real HTTPS request paths with deterministic local response bytes; no live network in regressions.
test.beforeEach(async ({ page }) => {
  await page.route('https://commons.wikimedia.org/w/api.php**', route => route.abort());
  await page.route(/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//, route => {
    const photo = seeds.find(item => item.imageUrl === route.request().url());
    return photo ? route.fulfill({ path: path.resolve('assets', photo.filename), contentType: 'image/jpeg' }) : route.abort();
  });
});

test('empty only: code and Markdown keep opaque background and chat never changes', async ({ page }) => {
  await page.goto('/');
  const ocean = page.locator('.ocean-window');
  await expect(ocean).toBeVisible();
  const photo = await ocean.getAttribute('data-photo');
  const chatBefore = await page.locator('.chat').evaluate(el => ({ html: el.innerHTML, bg: getComputedStyle(el).backgroundColor }));
  for (const button of ['#open-code', '#open-markdown']) {
    await page.click(button);
    await expect(ocean).toBeHidden();
    await expect(page.locator('.document')).toBeVisible();
    expect(await page.locator('.document').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 12, 24)');
    await expect.poll(() => page.evaluate(() => __oceanWindow.status()[0].timerActive)).toBe(false);
    await page.click('#close-file');
    await expect(ocean).toBeVisible();
    expect(await ocean.getAttribute('data-photo')).toBe(photo);
  }
  expect(await page.locator('.chat').evaluate(el => ({ html: el.innerHTML, bg: getComputedStyle(el).backgroundColor }))).toEqual(chatBefore);
  await page.screenshot({ path: 'docs/preview-narrow.png' });
});

test('all ten photos load and shuffle once per cycle without adjacent repeat', async ({ page }) => {
  await page.goto('/');
  const ocean = page.locator('.ocean-window');
  await expect(ocean).toBeVisible();
  await page.locator('.editor-group-container').hover();
  const count = await page.evaluate(() => __oceanWindowConfig.photos.length);
  const seen = [];
  for (let i = 0; i < count + 1; i++) {
    const current = await ocean.getAttribute('data-photo');
    seen.push(current);
    if (i < count) {
      await page.getByRole('button', { name: '次の海へ' }).click();
      await expect(ocean).not.toHaveAttribute('data-photo', current);
    }
  }
  expect(new Set(seen.slice(0, count)).size).toBe(count);
  expect(seen[count]).not.toBe(seen[count - 1]);
});

test('ten minute timer, manual pause and open-file suspension', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const ocean = page.locator('.ocean-window');
  await expect(ocean).toBeVisible();
  const first = await ocean.getAttribute('data-photo');
  await page.clock.runFor(600_001);
  await expect(ocean).not.toHaveAttribute('data-photo', first);
  const second = await ocean.getAttribute('data-photo');
  await page.locator('.editor-group-container').hover();
  await page.getByRole('button', { name: '自動切り替えを一時停止', exact: true }).click();
  await page.clock.runFor(1_200_000);
  expect(await ocean.getAttribute('data-photo')).toBe(second);
  await page.getByRole('button', { name: '自動切り替えを再開', exact: true }).click();
  await page.click('#open-code');
  await page.clock.runFor(1_200_000);
  expect(await ocean.getAttribute('data-photo')).toBe(second);
  await page.click('#close-file');
  await page.clock.runFor(600_001);
  await expect(ocean).not.toHaveAttribute('data-photo', second);
});

test('broken photos fall back to standard empty editor', async ({ page }) => {
  await page.route(/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//, route => route.abort());
  await page.goto('/');
  await expect(page.locator('.editor-group-watermark')).toBeVisible();
  await expect(page.locator('.ocean-window')).toBeHidden();
});

test('hiding the editor area suspends its timer and reshowing it keeps the photo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.ocean-window')).toBeVisible();
  const first = await page.locator('.ocean-window').getAttribute('data-photo');
  await page.evaluate(() => document.querySelector('.part.editor').style.display = 'none');
  await expect.poll(() => page.evaluate(() => __oceanWindow.status()[0].timerActive)).toBe(false);
  await page.evaluate(() => document.querySelector('.part.editor').style.display = '');
  await expect.poll(() => page.evaluate(() => __oceanWindow.status()[0].timerActive)).toBe(true);
  await expect(page.locator('.ocean-window')).toHaveAttribute('data-photo', first);
});

test('split lifecycle, reduced motion, and unload cleanup', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.ocean-window')).toBeVisible();
  expect(await page.locator('.ow-scene').first().evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.evaluate(() => {
    const split = document.createElement('div');
    split.className = 'editor-group-container empty';
    split.id = 'new-split';
    document.querySelector('.content').append(split);
  });
  await expect(page.locator('.ocean-window[data-ready="true"]')).toHaveCount(2);
  await page.evaluate(() => document.querySelector('#new-split').remove());
  await expect.poll(() => page.evaluate(() => __oceanWindow.status().length)).toBe(1);
  await page.evaluate(() => __oceanWindow.dispose());
  await expect(page.locator('.ocean-window')).toHaveCount(0);
  await expect(page.locator('.editor-group-watermark')).toBeVisible();
});
