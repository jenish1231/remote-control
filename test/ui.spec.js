import { test, expect } from '@playwright/test';

const ACTIVE = 'http://127.0.0.1:4101/';
const IDLE = 'http://127.0.0.1:4102/';
const TOKEN = 'http://127.0.0.1:4103/';

// Each test mutates the shared fake player, so run them in order.
test.describe.configure({ mode: 'serial' });

test.describe('active player', () => {
  test('shows now playing info', async ({ page }) => {
    await page.goto(ACTIVE);
    await expect(page.locator('#title')).toHaveText('First Song');
    await expect(page.locator('#artist')).toHaveText('Artist A');
    await expect(page.locator('#player')).toHaveText('Spotify');
    await expect(page.locator('#duration')).toHaveText('3:20');
  });

  test('play and pause toggle the button', async ({ page }) => {
    await page.goto(ACTIVE);
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('next and previous change the track', async ({ page }) => {
    await page.goto(ACTIVE);
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(page.locator('#title')).toHaveText('Second Song');
    await page.getByRole('button', { name: 'Previous track' }).click();
    await expect(page.locator('#title')).toHaveText('First Song');
  });

  test('volume slider sets volume', async ({ page }) => {
    await page.goto(ACTIVE);
    await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('40');
    await page.getByRole('slider', { name: 'Volume' }).fill('70');
    await expect.poll(async () => (await (await page.request.get(ACTIVE + 'now-playing')).json()).volume).toBe(70);
  });

  test('mute toggles', async ({ page }) => {
    await page.goto(ACTIVE);
    await page.getByRole('button', { name: 'Mute' }).click();
    await expect(page.getByRole('button', { name: 'Unmute' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Unmute' }).click();
    await expect(page.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('seek slider moves position', async ({ page }) => {
    await page.goto(ACTIVE);
    await page.getByRole('slider', { name: 'Seek' }).fill('90');
    await expect(page.locator('#elapsed')).toHaveText('1:30');
    await expect.poll(async () => (await (await page.request.get(ACTIVE + 'now-playing')).json()).track.position).toBe(90);
  });

  test('updates from other clients arrive via SSE', async ({ page }) => {
    await page.goto(ACTIVE);
    await expect(page.locator('#title')).toHaveText('First Song');
    await page.request.post(ACTIVE + 'next');
    await expect(page.locator('#title')).toHaveText('Second Song');
    await page.request.post(ACTIVE + 'previous');
  });

  test('fits a phone screen without horizontal scroll', async ({ page }) => {
    await page.goto(ACTIVE);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});

test('no player: shows empty state and disables transport', async ({ page }) => {
  await page.goto(IDLE);
  await expect(page.locator('#player')).toHaveText('No media player open');
  await expect(page.locator('#title')).toHaveText('Open Spotify or Music on your Mac');
  for (const name of ['Play', 'Next track', 'Previous track']) {
    await expect(page.getByRole('button', { name })).toBeDisabled();
  }
});

test.describe('token auth', () => {
  test('without token shows unauthorized message', async ({ page }) => {
    await page.goto(TOKEN);
    await expect(page.getByRole('status')).toContainText('Unauthorized');
  });

  test('with token in URL works', async ({ page }) => {
    await page.goto(TOKEN + '?token=s3cret');
    await expect(page.locator('#title')).toHaveText('First Song');
  });
});
