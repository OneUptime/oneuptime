import {
  Browser,
  BrowserContext,
  expect,
  Locator,
  Page,
  Route,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  DOCS_SCREEN_FIXTURES,
  DOCS_SCREEN_LANGUAGES,
  DocsScreen,
  DocsScreenFixture,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenList";
import {
  continuesFrom,
  planLanguages,
  screenAddress,
  screenFile,
  SCREEN_PIXEL_RATIO,
  STATIC_FOLDER,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenFiles";
import {
  compareFingerprints,
  DocsScreenFingerprint,
  DocsScreenFingerprints,
} from "../../App/FeatureSet/Docs/Screens/DocsScreenFingerprint";
import ScreenDriver from "./ScreenDriver";
import {
  FORCE,
  LANGUAGES,
  LanguageResult,
  MODE,
  readFingerprints,
  RESULTS,
  SHOTS,
  ShotResult,
  writeFingerprints,
} from "./DocsScreenRun";

/*
 * THE DOCS' SCREENSHOTS (#6823), drawn from the offline fixtures: one test
 * per docs language, walking every shot of DocsScreenList.ts in order.
 * `npm run docs-screens` writes the pictures whose page changed;
 * `npm run docs-screens:check` only says which did (README.md).
 *
 * Each shot opens its page in its fixture, does its steps by the words on
 * screen in this language, reads its fingerprint, and - when that differs
 * from the one recorded, or there is no picture yet - draws it: the crop,
 * light theme, at SCREEN_PIXEL_RATIO, encoded as WebP by Chromium itself.
 * A shot whose steps start with all of the previous shot's goes on from
 * that page instead of opening it again.
 */

// How Chromium encodes a shot: lossy WebP, at a quality text stays sharp at.
const WEBP_QUALITY: number = 0.8;

interface OpenShot {
  context: BrowserContext;
  page: Page;
  driver: ScreenDriver;
  shot: DocsScreen;
  problems: Array<string>;
}

// Closes a shot's context; one that will not close is left to the browser.
async function closeShot(open: OpenShot | null): Promise<void> {
  try {
    await open?.context.close();
  } catch {
    // The next shot opens a context of its own either way.
  }
}

async function openShot(
  browser: Browser,
  shot: DocsScreen,
  lang: string,
): Promise<OpenShot> {
  const fixture: DocsScreenFixture = DOCS_SCREEN_FIXTURES[shot.fixture]!;
  const origin: string = `http://127.0.0.1:${fixture.port}`;
  const context: BrowserContext = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: SCREEN_PIXEL_RATIO,
    colorScheme: "light",
    locale: "en-GB",
    timezoneId: "Europe/London",
    reducedMotion: "reduce",
  });
  const page: Page = await context.newPage();
  const problems: Array<string> = [];

  page.on("pageerror", (error: Error) => {
    problems.push(`the page threw: ${error.message.split("\n")[0]}`);
  });
  // Nothing in a shot comes from outside the machine.
  await page.route(
    (url: URL) => {
      return url.origin !== origin;
    },
    async (route: Route) => {
      problems.push(`asked for ${route.request().url()}`);
      await route.abort();
    },
  );
  await ScreenDriver.prepare(page, fixture, lang);

  const driver: ScreenDriver = new ScreenDriver(page, lang);
  await driver.open(`${origin}${screenAddress(shot, fixture, lang)}`);

  for (const action of shot.state) {
    await driver.act(action);
  }

  return { context, page, driver, shot, problems };
}

// Encodes a PNG as WebP in a blank page of its own.
async function toWebp(encoder: Page, png: Buffer): Promise<Buffer> {
  const dataUrl: string = await encoder.evaluate(
    async ({ base64, quality }: { base64: string; quality: number }) => {
      const image: HTMLImageElement = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      return canvas.toDataURL("image/webp", quality);
    },
    { base64: png.toString("base64"), quality: WEBP_QUALITY },
  );

  if (!dataUrl.startsWith("data:image/webp;base64,")) {
    throw new Error("Chromium did not encode the shot as WebP.");
  }

  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

for (const lang of LANGUAGES) {
  test(`docs screens in ${lang}`, async ({ browser }: { browser: Browser }) => {
    const recorded: DocsScreenFingerprints = readFingerprints(lang);
    const drawn: Record<string, DocsScreenFingerprint> = {};
    const results: Array<ShotResult> = [];
    const encoderContext: BrowserContext = await browser.newContext();
    const encoder: Page = await encoderContext.newPage();
    let open: OpenShot | null = null;

    for (const shot of SHOTS) {
      const fixture: DocsScreenFixture = DOCS_SCREEN_FIXTURES[shot.fixture]!;

      // A language this fixture cannot draw shows the English picture.
      if (!planLanguages(fixture, DOCS_SCREEN_LANGUAGES).drawn.includes(lang)) {
        continue;
      }

      try {
        if (open && continuesFrom(open.shot, shot)) {
          for (const action of shot.state.slice(open.shot.state.length)) {
            await open.driver.act(action);
          }
          open.shot = shot;
        } else {
          await closeShot(open);
          open = null;
          open = await openShot(browser, shot, lang);
        }

        const crop: Locator = open.driver.crop(shot.crop);
        await expect(crop).toBeVisible({ timeout: 30000 });
        await open.driver.settle();

        if (open.problems.length > 0) {
          throw new Error(open.problems.join("; "));
        }

        const fingerprint: DocsScreenFingerprint =
          await open.driver.fingerprint(crop);
        const reasons: Array<string> = compareFingerprints(
          recorded[shot.name],
          fingerprint,
        );
        const file: string = path.join(
          STATIC_FOLDER,
          screenFile(lang, shot.name),
        );

        if (MODE === "check") {
          results.push({
            name: shot.name,
            lang,
            status: reasons.length > 0 ? "stale" : "current",
            reasons,
          });
          continue;
        }

        if (reasons.length === 0 && !FORCE && fs.existsSync(file)) {
          results.push({ name: shot.name, lang, status: "current", reasons });
          continue;
        }

        const png: Buffer = await open.driver.draw(
          crop,
          shot.padding,
          shot.highlight,
        );
        const webp: Buffer = await toWebp(encoder, png);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, webp);
        drawn[shot.name] = fingerprint;
        results.push({
          name: shot.name,
          lang,
          status: "written",
          reasons,
          bytes: webp.length,
        });
      } catch (error) {
        results.push({
          name: shot.name,
          lang,
          status: "failed",
          reasons: [
            (error instanceof Error ? error.message : String(error))
              .split("\n")
              .filter(Boolean)
              .slice(0, 3)
              .join(" "),
          ],
        });
        // The next shot opens its page afresh.
        await closeShot(open);
        open = null;
      }
    }

    await closeShot(open);
    await encoderContext.close();

    if (MODE === "write") {
      writeFingerprints(lang, drawn);
    }

    const result: LanguageResult = { lang, mode: MODE, shots: results };
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.writeFileSync(
      path.join(RESULTS, `${lang}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    );

    // Writing, a shot that could not be drawn fails the run; checking, the issue lists it.
    if (MODE === "write") {
      expect(
        results.filter((entry: ShotResult): boolean => {
          return entry.status === "failed";
        }),
      ).toEqual([]);
    }
  });
}
