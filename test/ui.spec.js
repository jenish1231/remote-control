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

test.describe('trackpad', () => {
  const PAD = TOKEN + '?token=s3cret';
  const calls = async (page) => (await page.request.get(TOKEN + '__pointer-calls')).json();
  const pad = (page) => page.getByRole('region', { name: 'Trackpad' });

  test.beforeEach(async ({ page }) => {
    await page.request.delete(TOKEN + '__pointer-calls');
  });

  test('switches between media and trackpad views and remembers the choice', async ({ page }) => {
    await page.goto(PAD);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await page.getByRole('radio', { name: 'Trackpad' }).check();
    await expect(pad(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play' })).toBeHidden();
    await page.reload();
    await expect(pad(page)).toBeVisible();
    await page.getByRole('radio', { name: 'Media' }).check();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(pad(page)).toBeHidden();
  });

  async function openPad(page) {
    await page.goto(PAD);
    await page.getByRole('radio', { name: 'Trackpad' }).check();
    return (await pad(page).boundingBox());
  }

  test('dragging moves the pointer in the drag direction', async ({ page }) => {
    const box = await openPad(page);
    await page.mouse.move(box.x + 40, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 70, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await calls(page)).filter(([op]) => op === 'move').reduce((s, [, dx]) => s + dx, 0)).toBeGreaterThan(100);
    const moves = (await calls(page)).filter(([op]) => op === 'move');
    expect(moves.reduce((s, [, , dy]) => s + dy, 0)).toBeLessThan(0);
    expect((await calls(page)).some(([op]) => op === 'click')).toBe(false);
  });

  test('tap clicks, double tap double-clicks', async ({ page }) => {
    const box = await openPad(page);
    await page.mouse.click(box.x + 50, box.y + 50);
    await expect.poll(() => calls(page)).toEqual([['click', 'left', 1]]);
    await page.waitForTimeout(400);
    await page.mouse.click(box.x + 50, box.y + 50);
    await page.mouse.click(box.x + 50, box.y + 50);
    await expect.poll(() => calls(page)).toEqual([['click', 'left', 1], ['click', 'left', 1], ['click', 'left', 2]]);
  });

  test('two-finger tap right-clicks and two-finger drag scrolls', async ({ page }) => {
    const box = await openPad(page);
    const touch = (type, pointerId, x, y) => pad(page).dispatchEvent(type, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, clientX: box.x + x, clientY: box.y + y });
    await touch('pointerdown', 1, 50, 50);
    await touch('pointerdown', 2, 90, 50);
    await touch('pointerup', 1, 50, 50);
    await touch('pointerup', 2, 90, 50);
    await expect.poll(() => calls(page)).toEqual([['click', 'right', 1]]);

    await page.request.delete(TOKEN + '__pointer-calls');
    await touch('pointerdown', 1, 50, 50);
    await touch('pointerdown', 2, 90, 50);
    for (let y = 60; y <= 150; y += 10) {
      await touch('pointermove', 1, 50, y);
      await touch('pointermove', 2, 90, y);
    }
    await touch('pointerup', 1, 50, 150);
    await touch('pointerup', 2, 90, 150);
    await expect.poll(async () => (await calls(page)).filter(([op]) => op === 'scroll').reduce((s, [, , dy]) => s + dy, 0)).toBeGreaterThan(0);
    expect((await calls(page)).some(([op]) => op === 'move' || op === 'click')).toBe(false);
  });

  test('click buttons send left and right clicks', async ({ page }) => {
    await openPad(page);
    await page.getByRole('button', { name: 'Left click' }).click();
    await page.getByRole('button', { name: 'Right click' }).click();
    await expect.poll(() => calls(page)).toEqual([['click', 'left', 1], ['click', 'right', 1]]);
  });

  test('without a token the trackpad explains it is disabled', async ({ page }) => {
    await page.goto(ACTIVE);
    await page.getByRole('radio', { name: 'Trackpad' }).check();
    await expect(page.getByRole('status')).toContainText('REMOTE_CONTROL_TOKEN');
    await page.getByRole('radio', { name: 'Media' }).check();
    await expect(page.getByRole('status')).toBeEmpty();
  });

  test('desktop right mouse button right-clicks', async ({ page }) => {
    const box = await openPad(page);
    await page.mouse.click(box.x + 50, box.y + 50, { button: 'right' });
    await expect.poll(() => calls(page)).toEqual([['click', 'right', 1]]);
  });
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
