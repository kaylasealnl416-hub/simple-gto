import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const port = Number(process.env.SMOKE_PORT || 4183);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const screenshotDir = process.env.SMOKE_SCREENSHOT_DIR || join(tmpdir(), "simple-gto-smoke");
const playwrightFallback = "/Users/sunda/.hermes/node/lib/node_modules/playwright/index.mjs";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importPlaywright() {
  if (existsSync(playwrightFallback)) {
    return import(pathToFileURL(playwrightFallback).href);
  }
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright is not available. Install it locally or run from a Codex environment that provides Playwright.");
  }
}

async function waitForServer() {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      await wait(200);
    }
  }
  throw new Error(`Server did not become ready at ${baseUrl}`);
}

function startServer() {
  return spawn("bun", ["./scripts/serve.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function stopServer(server) {
  if (!server || server.exitCode != null) return;
  server.kill("SIGINT");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    wait(1500).then(() => {
      if (server.exitCode == null) {
        server.kill("SIGTERM");
      }
    })
  ]);
}

async function checkTable(page, label) {
  await page.goto(`${baseUrl}/#autostart`, { waitUntil: "networkidle" });
  await page.waitForSelector(".table-screen", { timeout: 15_000 });
  const screenshotPath = join(screenshotDir, `simple-gto-${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  return {
    label,
    title: await page.title(),
    url: page.url(),
    tableVisible: await page.locator(".table-screen").isVisible(),
    seatCount: await page.locator(".seat").count(),
    optionsVisible: await page.locator("[data-action='open-options']").isVisible(),
    screenshotPath
  };
}

async function runBrowserChecks() {
  const { chromium } = await importPlaywright();
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const consoleIssues = [];

  try {
    const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    desktopPage.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleIssues.push(`${message.type()}: ${message.text()}`);
      }
    });
    desktopPage.on("pageerror", (error) => {
      consoleIssues.push(`pageerror: ${error.message}`);
    });

    const desktop = await checkTable(desktopPage, "desktop");
    await desktopPage.locator("[data-action='open-options']").click();
    await desktopPage.waitForSelector("[data-action='restart-session']", { timeout: 5000 });
    const optionsScreenshotPath = join(screenshotDir, "simple-gto-options.png");
    await desktopPage.screenshot({ path: optionsScreenshotPath, fullPage: false });
    const options = {
      panelVisible: await desktopPage.locator("[data-action='restart-session']").isVisible(),
      resetMemoryVisible: await desktopPage.locator("[data-action='reset-hero-memory']").isVisible(),
      screenshotPath: optionsScreenshotPath
    };

    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    mobilePage.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleIssues.push(`${message.type()}: ${message.text()}`);
      }
    });
    mobilePage.on("pageerror", (error) => {
      consoleIssues.push(`pageerror: ${error.message}`);
    });
    const mobile = await checkTable(mobilePage, "mobile");

    return { desktop, options, mobile, consoleIssues };
  } finally {
    await browser.close();
  }
}

function assertSmokeResult(result) {
  const failures = [];
  for (const viewport of [result.desktop, result.mobile]) {
    if (viewport.title !== "简单GTO") failures.push(`${viewport.label}: unexpected title ${viewport.title}`);
    if (!viewport.tableVisible) failures.push(`${viewport.label}: table screen not visible`);
    if (viewport.seatCount !== 8) failures.push(`${viewport.label}: expected 8 seats, got ${viewport.seatCount}`);
    if (!viewport.optionsVisible) failures.push(`${viewport.label}: options button not visible`);
  }
  if (!result.options.panelVisible) failures.push("desktop: options panel did not open");
  if (!result.options.resetMemoryVisible) failures.push("desktop: reset memory control missing");
  if (result.consoleIssues.length > 0) failures.push(`console issues: ${result.consoleIssues.join("; ")}`);
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

const server = startServer();
let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer();
  const result = await runBrowserChecks();
  assertSmokeResult(result);
  console.log(JSON.stringify({ ok: true, baseUrl, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, baseUrl, error: error.message, serverOutput }, null, 2));
  process.exitCode = 1;
} finally {
  await stopServer(server);
}
