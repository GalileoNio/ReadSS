import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9334;
const URL_UNDER_TEST = "http://127.0.0.1:4173/";
const OUT = path.join(import.meta.dirname, "qa");
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), "readss-marketing-qa-"));
const child = spawn(
  EDGE,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-gpu",
    "--disable-crash-reporter",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);
child.on("error", (error) => console.error("edge:", error.message));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((entry) => entry.type === "page");
      if (page) return page;
    } catch {}
    await wait(200);
  }
  throw new Error("devtools did not start");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let id = 0;
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const next = ++id;
          return new Promise((resolveCall, rejectCall) => {
            pending.set(next, { resolve: resolveCall, reject: rejectCall });
            ws.send(JSON.stringify({ id: next, method, params }));
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  });
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "evaluation failed");
  }
  return result.result.value;
}

async function capture(cdp, name, fullPage = false) {
  let params = { format: "jpeg", quality: 84, captureBeyondViewport: fullPage };
  if (fullPage) {
    const metrics = await cdp.send("Page.getLayoutMetrics");
    const { width, height } = metrics.cssContentSize;
    params = {
      ...params,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    };
  }
  const shot = await cdp.send("Page.captureScreenshot", params);
  writeFileSync(path.join(OUT, name), Buffer.from(shot.data, "base64"));
}

async function setViewport(cdp, width, height, mobile = false) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await wait(180);
}

const page = await pageTarget();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
await setViewport(cdp, 1440, 1100);
await cdp.send("Page.navigate", { url: URL_UNDER_TEST });
await wait(1800);

const desktop = await evaluate(
  cdp,
  `(() => {
    const cards = [...document.querySelectorAll('.card')].map(card => {
      const r = card.getBoundingClientRect();
      return { id: card.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const grid = document.querySelector('.card-grid');
    const cs = getComputedStyle(grid);
    const visibleText = [...document.querySelectorAll('.card__body > p')].map(p => getComputedStyle(p).fontSize);
    const h1 = document.querySelector('.masthead h1');
    const h1Style = getComputedStyle(h1);
    const deviceImages = [...document.querySelectorAll('.device-laptop__screen img, .device-phone__screen img')].map(img => {
      const r = img.getBoundingClientRect();
      return { src: img.getAttribute('src'), w: Math.round(r.width), h: Math.round(r.height), natural: [img.naturalWidth, img.naturalHeight] };
    });
    return {
      viewport: [innerWidth, innerHeight],
      page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      columns: cs.gridTemplateColumns,
      gap: cs.gap,
      cards,
      h1: { size: h1Style.fontSize, lines: Math.round(h1.getBoundingClientRect().height / parseFloat(h1Style.lineHeight)) },
      deviceImages,
      cardCopySize: visibleText,
      bodyOverflow: getComputedStyle(document.body).overflowX,
      iconLoaded: document.querySelector('.brand img')?.complete,
      imagesLoaded: [...document.images].every(img => img.complete && img.naturalWidth > 0)
    };
  })()`,
);
console.log("DESKTOP", JSON.stringify(desktop, null, 2));
await capture(cdp, "desktop-top.jpg");
await capture(cdp, "desktop-full.jpg", true);

await evaluate(cdp, `document.querySelector('[data-open="brand"]').click()`);
await wait(450);
const brandDialog = await evaluate(
  cdp,
  `(() => {
    const dialog = document.querySelector('#detail-dialog');
    const active = document.activeElement;
    return {
      open: dialog.open,
      labelledby: dialog.getAttribute('aria-labelledby'),
      activeId: active?.id || active?.className || active?.tagName,
      panelVisible: !document.querySelector('[data-panel="brand"]').hidden,
      modalCount: document.querySelectorAll('dialog[open]').length,
      htmlLocked: document.documentElement.classList.contains('dialog-open')
    };
  })()`,
);
console.log("BRAND DIALOG", JSON.stringify(brandDialog, null, 2));
await capture(cdp, "desktop-dialog-brand.jpg");

await evaluate(cdp, `document.querySelector('[data-close]').click()`);
await wait(250);
const closed = await evaluate(
  cdp,
  `(() => ({
    open: document.querySelector('#detail-dialog').open,
    activeLabel: document.activeElement?.getAttribute('aria-label'),
    locked: document.documentElement.classList.contains('dialog-open')
  }))()`,
);
console.log("AFTER CLOSE", JSON.stringify(closed, null, 2));

await evaluate(cdp, `document.querySelector('[data-open="experience"]').click()`);
await wait(350);
await evaluate(
  cdp,
  `(() => {
    const form = document.querySelector('#demo-form');
    form.querySelector('button[type="submit"]').click();
  })()`,
);
await wait(150);
const invalidForm = await evaluate(
  cdp,
  `(() => ({
    errors: [...document.querySelectorAll('.field__error')].map(el => el.textContent),
    invalid: [...document.querySelectorAll('#demo-form [aria-invalid="true"]')].map(el => el.id),
    focused: document.activeElement?.id,
    successHidden: document.querySelector('#form-success').hidden,
    status: document.querySelector('.form-status')?.textContent
  }))()`,
);
console.log("INVALID FORM", JSON.stringify(invalidForm, null, 2));

await evaluate(
  cdp,
  `(() => {
    const set = (id, value) => {
      const el = document.querySelector(id);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#applicant-name', '林默');
    set('#applicant-email', 'not-an-email');
    set('#applicant-interest', 'reading');
    document.querySelector('#demo-form button[type="submit"]').click();
  })()`,
);
await wait(150);
const invalidEmail = await evaluate(
  cdp,
  `(() => ({
    emailError: document.querySelector('#email-error').textContent,
    focused: document.activeElement?.id,
    nameError: document.querySelector('#name-error').textContent
  }))()`,
);
console.log("INVALID EMAIL", JSON.stringify(invalidEmail, null, 2));

await evaluate(
  cdp,
  `(() => {
    const email = document.querySelector('#applicant-email');
    email.value = 'lin@example.com';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#demo-form button[type="submit"]').click();
  })()`,
);
await wait(250);
const validForm = await evaluate(
  cdp,
  `(() => ({
    formHidden: document.querySelector('#demo-form').hidden,
    successHidden: document.querySelector('#form-success').hidden,
    successText: document.querySelector('#form-success')?.innerText,
    focusedClass: document.activeElement?.className,
    networkResources: performance.getEntriesByType('resource').filter(r => /fetch|xmlhttprequest|beacon/.test(r.initiatorType)).length
  }))()`,
);
console.log("VALID FORM", JSON.stringify(validForm, null, 2));
await capture(cdp, "desktop-form-success.jpg");

await evaluate(cdp, `document.querySelector('[data-reset-form]').click()`);
await wait(150);
const restarted = await evaluate(
  cdp,
  `(() => ({
    formHidden: document.querySelector('#demo-form').hidden,
    successHidden: document.querySelector('#form-success').hidden,
    focused: document.activeElement?.id,
    errors: [...document.querySelectorAll('.field__error')].every(el => !el.textContent)
  }))()`,
);
console.log("RESTART FORM", JSON.stringify(restarted, null, 2));
await capture(cdp, "desktop-form.jpg");
await evaluate(cdp, `document.querySelector('[data-close]').click()`);
await wait(250);

await setViewport(cdp, 1024, 1100);
await cdp.send("Page.navigate", { url: URL_UNDER_TEST });
await wait(1200);
const tablet = await evaluate(
  cdp,
  `(() => {
    const grid = getComputedStyle(document.querySelector('.card-grid'));
    const rects = [...document.querySelectorAll('.card')].map(c => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return {
      viewport: [innerWidth, innerHeight],
      page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      columns: grid.gridTemplateColumns,
      cards: rects,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth
    };
  })()`,
);
console.log("TABLET", JSON.stringify(tablet, null, 2));
await capture(cdp, "tablet-top.jpg");

await setViewport(cdp, 390, 844, true);
await cdp.send("Page.navigate", { url: URL_UNDER_TEST });
await wait(1400);
const mobile = await evaluate(
  cdp,
  `(() => {
    const grid = getComputedStyle(document.querySelector('.card-grid'));
    const first = document.querySelector('.card').getBoundingClientRect();
    const h1 = document.querySelector('.masthead h1');
    const h1Style = getComputedStyle(h1);
    return {
      viewport: [innerWidth, innerHeight],
      page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      columns: grid.gridTemplateColumns,
      bodyOverflow: getComputedStyle(document.body).overflowX,
      firstCard: { w: Math.round(first.width), h: Math.round(first.height) },
      h1: { size: h1Style.fontSize, lines: Math.round(h1.getBoundingClientRect().height / parseFloat(h1Style.lineHeight)) },
      teaserCopy: document.querySelector('.form-teaser__tick span').textContent,
      navWidth: Math.round(document.querySelector('.site-nav').getBoundingClientRect().width)
    };
  })()`,
);
console.log("MOBILE", JSON.stringify(mobile, null, 2));
await capture(cdp, "mobile-top.jpg");
await evaluate(cdp, `document.querySelector('#device').scrollIntoView()`);
await wait(350);
await capture(cdp, "mobile-device.jpg");
await evaluate(cdp, `window.scrollTo(0, document.documentElement.scrollHeight)`);
await wait(600);
await evaluate(cdp, `window.scrollTo(0, document.documentElement.scrollHeight)`);
await wait(300);
await capture(cdp, "mobile-bottom-2.jpg");

await evaluate(cdp, `document.querySelector('[data-open="experience"]').click()`);
await wait(350);
await capture(cdp, "mobile-form.jpg");
await evaluate(cdp, `document.querySelector('.form-card').scrollIntoView({ block: 'center' })`);
await wait(300);
await capture(cdp, "mobile-form-fields.jpg");

child.kill();
await wait(300);
process.exit(0);
