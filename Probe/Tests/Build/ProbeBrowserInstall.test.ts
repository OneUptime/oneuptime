import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import BrowserType from "Common/Types/BrowserType";

/*
 * Image-size regression tests for the probe's Playwright browsers.
 *
 * `npx playwright install` with no browser list installs every engine
 * Playwright ships -- Chromium, Firefox AND WebKit. The probe can never launch
 * WebKit: Common/Types/BrowserType.ts enables only Chromium and Firefox (Webkit
 * is present but commented out), and
 * Probe/Utils/Monitors/MonitorTypes/SyntheticMonitor.ts throws
 * BadDataException("Invalid Browser Type.") for anything that is not one of the
 * two. So the WebKit payload (~90MB compressed / ~250MB extracted) was pure
 * dead weight in every probe image.
 *
 * It is worse than the browser itself: `--with-deps` apt-installs each engine's
 * system dependencies, and WebKit's exclusive set (gstreamer, libflite,
 * libwoff, libhyphen, libmanette -- 150-300MB) is installed into the image
 * proper, so it survives the `rm -rf /var/lib/apt/lists/*` on the next line.
 *
 * Naming browsers explicitly does NOT weaken `--with-deps`: each named
 * browser's full dependency set is still installed. This is purely subtractive.
 *
 * The important test here is the coupling one: the set of engines in the image
 * is derived from the enum, not hardcoded. Re-enable Webkit in BrowserType and
 * the suite fails and tells you the image needs updating -- which is the
 * failure mode you want, rather than a synthetic monitor that only breaks in
 * production when someone first selects the new browser.
 */

const PROBE_ROOT: string = path.resolve(__dirname, "..", "..");

const dockerfile: string = fs.readFileSync(
  path.join(PROBE_ROOT, "Dockerfile.tpl"),
  "utf8",
);

/*
 * Collapse a Dockerfile into logical instructions, joining `\` continuations so
 * a multi-line RUN is examined as the single layer it actually produces.
 * Comment lines are dropped -- the comment above the install deliberately names
 * WebKit, and a plain substring search would match it.
 */
const readInstructions: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const instructions: Array<string> = [];
  let pending: string | null = null;

  for (const rawLine of source.split("\n")) {
    const line: string = rawLine.trim();

    if (pending === null) {
      if (line === "" || line.startsWith("#")) {
        continue;
      }
      pending = line;
    } else {
      if (line.startsWith("#")) {
        continue;
      }
      pending = `${pending} ${line}`;
    }

    if (pending.endsWith("\\")) {
      pending = pending.slice(0, -1).trim();
      continue;
    }

    instructions.push(pending);
    pending = null;
  }

  if (pending !== null) {
    instructions.push(pending);
  }

  return instructions;
};

const instructions: Array<string> = readInstructions(dockerfile);

const browserInstallInstruction: string = instructions.find((line: string) => {
  return /^RUN\s/.test(line) && /npx\s+playwright\s+install/.test(line);
})!;

/*
 * The engine names passed to `playwright install`, with flags stripped. The
 * capture stops at the next shell operator so the trailing `&& rm -rf ...` in
 * the same RUN is not mistaken for a browser name.
 */
const installedBrowsers: Array<string> = ((): Array<string> => {
  const match: RegExpMatchArray | null = browserInstallInstruction.match(
    /npx\s+playwright\s+install([^&|;]*)/,
  );

  return (match?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .filter((token: string) => {
      return token !== "" && !token.startsWith("-");
    })
    .sort();
})();

// Every engine Playwright can install, so "not installed" is checkable.
const ALL_PLAYWRIGHT_ENGINES: Array<string> = ["chromium", "firefox", "webkit"];

/*
 * BrowserType values are capitalised for display ("Chromium"); Playwright's CLI
 * engine names are lowercase. This mapping is the whole contract between the
 * enum and the image.
 */
const selectableEngines: Array<string> = Object.values(BrowserType)
  .map((value: string) => {
    return value.toLowerCase();
  })
  .sort();

describe("Probe Playwright browser install", () => {
  test("installs exactly chromium and firefox", () => {
    expect(browserInstallInstruction).toBeDefined();
    expect(installedBrowsers).toEqual(["chromium", "firefox"]);
  });

  test("does not install webkit", () => {
    /*
     * The saving. WebKit is not a selectable BrowserType, so shipping it buys
     * nothing but pull time and CVE surface on every probe, everywhere.
     */
    expect(installedBrowsers).not.toContain("webkit");
    expect(browserInstallInstruction).not.toMatch(/\bwebkit\b/);
  });

  test("installs exactly the engines the product can select", () => {
    /*
     * The coupling test. If Webkit is re-enabled in Common/Types/BrowserType.ts
     * this fails: the enum and the image have diverged, and a synthetic monitor
     * configured for the new browser would fail at launch inside the probe.
     * Fix by adding the engine to the `npx playwright install` list in
     * Probe/Dockerfile.tpl.
     */
    expect(installedBrowsers).toEqual(selectableEngines);
  });

  test("never ships an engine the probe would refuse to launch", () => {
    /*
     * Same invariant from the other direction, and the one that catches a
     * regression to a bare `npx playwright install`: anything not in the enum
     * must be absent from the image.
     */
    for (const engine of ALL_PLAYWRIGHT_ENGINES) {
      if (!selectableEngines.includes(engine)) {
        expect(installedBrowsers).not.toContain(engine);
      }
    }
  });

  test("keeps --with-deps so the named browsers still get their system libraries", () => {
    /*
     * The regression this change could cause. Naming browsers is subtractive
     * only while `--with-deps` remains: drop it and Chromium/Firefox are
     * installed without their apt dependencies and fail to launch at runtime,
     * which surfaces as every synthetic monitor going down at once.
     */
    expect(browserInstallInstruction).toMatch(
      /npx\s+playwright\s+install\s+--with-deps\s/,
    );
  });

  test("refreshes and then drops the apt lists in the same layer", () => {
    /*
     * `--with-deps` shells out to apt, so the lists have to be present, and
     * they must be removed inside this same RUN or the metadata ships in the
     * image.
     */
    expect(browserInstallInstruction).toMatch(
      /apt-get\s+update.*npx\s+playwright\s+install.*rm\s+-rf\s+\/var\/lib\/apt\/lists\/\*/,
    );
  });

  test("browsers land on the path the probe actually reads", () => {
    /*
     * SyntheticMonitor.getPlaywrightBrowsersPath() reads
     * PLAYWRIGHT_BROWSERS_PATH and falls back to ~/.cache/ms-playwright. If the
     * ENV and the chmod target ever drift apart, a non-root probe finds the
     * directory but cannot traverse it, and every browser monitor throws
     * "Chrome executable path not found."
     */
    const browsersPath: string = "/ms-playwright-browsers";

    expect(dockerfile).toContain(
      `ENV PLAYWRIGHT_BROWSERS_PATH=${browsersPath}`,
    );
    expect(browserInstallInstruction).toContain(`chmod -R 755 ${browsersPath}`);
  });
});

describe("BrowserType enum drives the probe image", () => {
  test("only Chromium and Firefox are selectable today", () => {
    /*
     * Documents the state the image is trimmed for. If this fails, the enum
     * changed and Probe/Dockerfile.tpl's install list needs to change with it.
     */
    expect(Object.values(BrowserType)).toEqual(["Chromium", "Firefox"]);
  });

  test("every selectable browser has a launch branch in SyntheticMonitor", () => {
    /*
     * Guards the other half of the contract: installing an engine is pointless
     * if nothing can launch it. SyntheticMonitor throws
     * BadDataException("Invalid Browser Type.") once it runs out of branches.
     */
    const syntheticMonitor: string = fs.readFileSync(
      path.join(
        PROBE_ROOT,
        "Utils",
        "Monitors",
        "MonitorTypes",
        "SyntheticMonitor.ts",
      ),
      "utf8",
    );

    for (const browserType of Object.values(BrowserType)) {
      expect(syntheticMonitor).toContain(
        `data.browserType === BrowserType.${browserType}`,
      );
    }

    expect(syntheticMonitor).toContain(
      'throw new BadDataException("Invalid Browser Type.")',
    );
  });
});
