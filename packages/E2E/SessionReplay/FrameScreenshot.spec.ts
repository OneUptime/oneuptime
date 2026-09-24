import {
  Browser,
  BrowserContext,
  Download,
  FrameLocator,
  Locator,
  Page,
  Request,
  expect,
  test,
} from "@playwright/test";
import { mkdir, readFile } from "fs/promises";
import path from "path";

/*
 * The paused frame's screenshot dock, end to end: the production player, a
 * real recorded replay (Fixture/Fixture.js) and the browser APIs a viewer's
 * click actually goes through - the download, the async clipboard, and
 * createImageBitmap reading the PNG back.
 *
 * The unit tests pin the capture's parts under jsdom, which has no layout,
 * no SVG image decoding and no canvas. What only a real browser can say is
 * pinned here: the dock is offered exactly while the viewer has stopped on
 * a frame; the file is a PNG of the RECORDED viewport at the display's
 * density (not of the scaled stage); its pixels are the paused page's
 * pixels - not a blank canvas, not the stage's own chrome; it is named
 * after the session and the playhead; the clipboard and every way it can
 * fail read as the dock says; and a capture neither writes to the live
 * replay document nor touches the network.
 *
 * Every test is independent and waits on state (the phase word, testids,
 * data-state), never on sleeps.
 */

const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/session-replay-ui",
);
const applicationRoute: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/rum/20000000-0000-4000-8000-000000000001";
const playerRoute: string = `${applicationRoute}/session-replay/${"a".repeat(32)}`;
const fixtureOrigin: string = "http://127.0.0.1:4212";
const stageIframeSelector: string = '[data-testid="replay-stage"] iframe';
/*
 * The recorded viewports, from the manifest header and the Meta event in
 * Fixture.js (1200x760 for the browser recording, 390x844 for the React
 * Native one). The PNG is drawn at these sizes whatever the stage shows.
 */
const recordedWidth: number = 1200;
const recordedHeight: number = 760;
const mobileRecordedWidth: number = 390;
const mobileRecordedHeight: number = 844;
/* ReplayFrameCapture's REPLAY_FRAME_MAX_PIXEL_RATIO. */
const maxPixelRatio: number = 2;
/* The first eight characters of the fixture's session id, then the playhead. */
const FILE_NAME_PATTERN: RegExp =
  /^session-replay-aaaaaaaa-\d+m\d{2}\.\ds\.png$/;
const FILE_OFFSET_PATTERN: RegExp = /-(?:(\d+)h)?(\d+)m(\d{2})\.(\d)s\.png$/;
const CLOCK_PATTERN: RegExp = /(\d+):(\d+(?:\.\d+)?)\s*\//;
const CSS_RGB_PATTERN: RegExp = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/;
const PNG_SIGNATURE_HEX: string = "89504e470d0a1a0a";
const SIZE_DETAIL: string = `${recordedWidth} × ${recordedHeight} PNG`;

type Rgb = [number, number, number];

interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PixelPoint {
  x: number;
  y: number;
}

interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /* Also count the pixels within 24 of this colour on every channel. */
  near?: Rgb | undefined;
}

interface RegionSummary {
  total: number;
  darkPixels: number;
  nearPixels: number;
  distinctColours: number;
  /* The most frequent colour: the region's background. */
  dominant: Rgb;
}

interface PngInspection {
  width: number;
  height: number;
  /* [r, g, b, a] per requested point. */
  pixels: Array<Array<number>>;
  regions: Array<RegionSummary>;
}

interface SavedScreenshot {
  fileName: string;
  bytes: Buffer;
}

interface StageProjection {
  /* The replay iframe's top-left corner on the page. */
  x: number;
  y: number;
  /* Page pixels per recorded pixel. */
  scale: number;
  width: number;
  height: number;
}

interface LiveElement {
  left: number;
  top: number;
  width: number;
  height: number;
  background: string;
  color: string;
}

interface PngEncoderProbe {
  calls: number;
  hold: boolean;
  fail: boolean;
  release: () => void;
}

/* ---- Navigation and the dock. ---- */

const replayFrame: (page: Page) => FrameLocator = (
  page: Page,
): FrameLocator => {
  return page.frameLocator(stageIframeSelector);
};

const dock: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("replay-screenshot-actions");
};

const copyButton: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("replay-screenshot-copy");
};

const downloadButton: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("replay-screenshot-download");
};

const preview: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("replay-screenshot-preview");
};

const failureCard: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("replay-screenshot-error");
};

const phase: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("replay-phase");
};

const openPlayer: (page: Page, query?: string) => Promise<void> = async (
  page: Page,
  query: string = "",
): Promise<void> => {
  await page.goto(`${playerRoute}${query}`);
  await expect(phase(page)).toHaveText("playing", { timeout: 30000 });
  await expect(
    replayFrame(page).getByText("Complete your order"),
  ).toBeVisible();
};

const openMobilePlayer: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.goto(`${playerRoute}?recorder=mobile`);
  await expect(phase(page)).toHaveText("playing", { timeout: 30000 });
  await expect(
    replayFrame(page).locator('[data-oneuptime-mobile-view="view"]').first(),
  ).toBeVisible();
};

const pausePlayer: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.getByTestId("replay-play-pause").click();
  await expect(phase(page)).toHaveText("paused");
  await expect(dock(page)).toBeVisible();
};

/* Keys reach the player's shortcuts from the page, not from a control. */
const blurFocus: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.evaluate((): void => {
    const active: Element | null = document.activeElement;

    if (active instanceof HTMLElement) {
      active.blur();
    }
  });
};

const screenshot: (page: Page, name: string) => Promise<void> = async (
  page: Page,
  name: string,
): Promise<void> => {
  await mkdir(artifacts, { recursive: true });
  await page.screenshot({
    path: path.join(artifacts, `${name}.png`),
    fullPage: true,
  });
};

/* A clean artifact: the camera flash has faded and the dock has faded in. */
const settleDock: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await expect(page.getByTestId("replay-screenshot-flash")).toHaveCount(0);
  await expect
    .poll(async (): Promise<string> => {
      return dock(page).evaluate((element: HTMLElement): string => {
        return getComputedStyle(element).opacity;
      });
    })
    .toBe("1");
};

const noHorizontalOverflow: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  expect(
    await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    }),
  ).toBeLessThanOrEqual(1);
};

const boxOf: (locator: Locator) => Promise<ElementBox> = async (
  locator: Locator,
): Promise<ElementBox> => {
  const box: Awaited<ReturnType<Locator["boundingBox"]>> =
    await locator.boundingBox();

  expect(box).not.toBeNull();

  return box!;
};

const centreOf: (box: ElementBox) => PixelPoint = (
  box: ElementBox,
): PixelPoint => {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/* Whether the element is what a pointer at its centre would hit. */
const isTopmostAtCentre: (locator: Locator) => Promise<boolean> = async (
  locator: Locator,
): Promise<boolean> => {
  return locator.evaluate((element: HTMLElement): boolean => {
    const rect: DOMRect = element.getBoundingClientRect();
    const hit: Element | null = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );

    return hit === element || element.contains(hit);
  });
};

const devicePixelRatio: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return page.evaluate((): number => {
    return window.devicePixelRatio;
  });
};

/* ---- The clock and the file name. ---- */

const secondsOfClock: (text: string) => number = (text: string): number => {
  const match: RegExpMatchArray | null = text.match(CLOCK_PATTERN);

  if (!match) {
    throw new Error(`Unreadable replay clock: ${text}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
};

const clockSeconds: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return secondsOfClock(await page.getByTestId("replay-time").innerText());
};

/* "session-replay-aaaaaaaa-1m05.3s.png" -> 65.3 */
const offsetSecondsOf: (fileName: string) => number = (
  fileName: string,
): number => {
  const match: RegExpMatchArray | null = fileName.match(FILE_OFFSET_PATTERN);

  if (!match) {
    throw new Error(`The file name carries no playhead: ${fileName}`);
  }

  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 10
  );
};

/* ---- Downloads and the PNG itself. ---- */

const saveDownload: (
  page: Page,
  trigger: () => Promise<void>,
) => Promise<SavedScreenshot> = async (
  page: Page,
  trigger: () => Promise<void>,
): Promise<SavedScreenshot> => {
  const downloadPromise: Promise<Download> = page.waitForEvent("download");

  await trigger();

  const download: Download = await downloadPromise;

  return {
    fileName: download.suggestedFilename(),
    bytes: await readFile(await download.path()),
  };
};

const downloadFrame: (page: Page) => Promise<SavedScreenshot> = async (
  page: Page,
): Promise<SavedScreenshot> => {
  return saveDownload(page, async (): Promise<void> => {
    await downloadButton(page).click();
  });
};

/* The PNG signature, then IHDR's width and height (big-endian). */
const readPngSize: (bytes: Buffer) => { width: number; height: number } = (
  bytes: Buffer,
): { width: number; height: number } => {
  expect(bytes.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE_HEX);
  expect(bytes.subarray(12, 16).toString("latin1")).toBe("IHDR");

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

/*
 * Decodes the PNG in the page, exactly as the browser would show it, and
 * reads pixels back. colorSpaceConversion "none" keeps the stored values.
 */
const inspectPng: (
  page: Page,
  bytes: Buffer,
  probe: { points?: Array<PixelPoint>; regions?: Array<PixelRegion> },
) => Promise<PngInspection> = async (
  page: Page,
  bytes: Buffer,
  probe: { points?: Array<PixelPoint>; regions?: Array<PixelRegion> },
): Promise<PngInspection> => {
  return page.evaluate(
    async (input: {
      base64: string;
      points: Array<PixelPoint>;
      regions: Array<PixelRegion>;
    }): Promise<PngInspection> => {
      const binary: string = atob(input.base64);
      const data: Uint8Array<ArrayBuffer> = new Uint8Array(binary.length);

      for (let index: number = 0; index < binary.length; index++) {
        data[index] = binary.charCodeAt(index);
      }

      const bitmap: ImageBitmap = await createImageBitmap(
        new Blob([data], { type: "image/png" }),
        { colorSpaceConversion: "none", premultiplyAlpha: "none" },
      );
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      const context: CanvasRenderingContext2D | null = canvas.getContext("2d", {
        willReadFrequently: true,
      });

      if (!context) {
        throw new Error("No 2D canvas to decode the PNG with.");
      }

      context.drawImage(bitmap, 0, 0);

      const clamp: (value: number, max: number) => number = (
        value: number,
        max: number,
      ): number => {
        return Math.min(max - 1, Math.max(0, Math.round(value)));
      };

      const pixels: Array<Array<number>> = input.points.map(
        (point: PixelPoint): Array<number> => {
          return Array.from(
            context.getImageData(
              clamp(point.x, bitmap.width),
              clamp(point.y, bitmap.height),
              1,
              1,
            ).data,
          );
        },
      );

      const regions: Array<RegionSummary> = input.regions.map(
        (region: PixelRegion): RegionSummary => {
          const left: number = clamp(region.x, bitmap.width);
          const top: number = clamp(region.y, bitmap.height);
          const width: number = Math.max(
            1,
            Math.min(bitmap.width - left, Math.round(region.width)),
          );
          const height: number = Math.max(
            1,
            Math.min(bitmap.height - top, Math.round(region.height)),
          );
          const image: ImageData = context.getImageData(
            left,
            top,
            width,
            height,
          );
          const counts: Map<string, number> = new Map<string, number>();
          let darkPixels: number = 0;
          let nearPixels: number = 0;

          for (let index: number = 0; index < image.data.length; index += 4) {
            const red: number = image.data[index]!;
            const green: number = image.data[index + 1]!;
            const blue: number = image.data[index + 2]!;
            const key: string = `${red},${green},${blue}`;

            counts.set(key, (counts.get(key) ?? 0) + 1);

            if (0.2126 * red + 0.7152 * green + 0.0722 * blue < 96) {
              darkPixels++;
            }

            if (
              region.near &&
              Math.abs(red - region.near[0]) <= 24 &&
              Math.abs(green - region.near[1]) <= 24 &&
              Math.abs(blue - region.near[2]) <= 24
            ) {
              nearPixels++;
            }
          }

          let dominant: string = "0,0,0";
          let dominantCount: number = -1;

          counts.forEach((count: number, key: string): void => {
            if (count > dominantCount) {
              dominant = key;
              dominantCount = count;
            }
          });

          const channels: Array<number> = dominant.split(",").map(Number);

          return {
            total: width * height,
            darkPixels: darkPixels,
            nearPixels: nearPixels,
            distinctColours: counts.size,
            dominant: [channels[0]!, channels[1]!, channels[2]!],
          };
        },
      );

      return {
        width: bitmap.width,
        height: bitmap.height,
        pixels: pixels,
        regions: regions,
      };
    },
    {
      base64: bytes.toString("base64"),
      points: probe.points ?? [],
      regions: probe.regions ?? [],
    },
  );
};

/* ---- Colours. ---- */

const parseCssColour: (css: string) => Rgb = (css: string): Rgb => {
  const match: RegExpMatchArray | null = css.match(CSS_RGB_PATTERN);

  if (!match) {
    throw new Error(`Not an rgb() colour: ${css}`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const luminance: (colour: ReadonlyArray<number>) => number = (
  colour: ReadonlyArray<number>,
): number => {
  return 0.2126 * colour[0]! + 0.7152 * colour[1]! + 0.0722 * colour[2]!;
};

const expectColour: (
  actual: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
  label: string,
) => void = (
  actual: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
  label: string,
): void => {
  const distance: number = Math.max(
    Math.abs(actual[0]! - expected[0]!),
    Math.abs(actual[1]! - expected[1]!),
    Math.abs(actual[2]! - expected[2]!),
  );

  expect(
    distance,
    `${label}: the PNG has rgb(${actual.slice(0, 3).join(", ")}), the paused page rgb(${expected
      .slice(0, 3)
      .join(", ")})`,
  ).toBeLessThanOrEqual(3);
};

/* ---- The live replay document. ---- */

/* Where the stage draws the recording, to map page pixels to recorded ones. */
const stageProjection: (page: Page) => Promise<StageProjection> = async (
  page: Page,
): Promise<StageProjection> => {
  const iframe: Locator = page.locator(stageIframeSelector);
  const box: ElementBox = await boxOf(iframe);
  const width: number = Number(await iframe.getAttribute("width"));
  const height: number = Number(await iframe.getAttribute("height"));

  return {
    x: box.x,
    y: box.y,
    scale: box.width / width,
    width: width,
    height: height,
  };
};

const toRecordedBox: (
  projection: StageProjection,
  box: ElementBox,
) => ElementBox = (
  projection: StageProjection,
  box: ElementBox,
): ElementBox => {
  return {
    x: (box.x - projection.x) / projection.scale,
    y: (box.y - projection.y) / projection.scale,
    width: box.width / projection.scale,
    height: box.height / projection.scale,
  };
};

const liveElement: (
  page: Page,
  selector: string,
) => Promise<LiveElement> = async (
  page: Page,
  selector: string,
): Promise<LiveElement> => {
  return replayFrame(page)
    .locator(selector)
    .first()
    .evaluate((element: Element): LiveElement => {
      const rect: DOMRect = element.getBoundingClientRect();
      const style: CSSStyleDeclaration = getComputedStyle(element);

      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        background: style.backgroundColor,
        color: style.color,
      };
    });
};

/*
 * The colour the paused page paints at a recorded point: the first painted
 * background from the element there up to the root.
 */
const liveBackgroundAt: (
  page: Page,
  point: PixelPoint,
) => Promise<Rgb> = async (page: Page, point: PixelPoint): Promise<Rgb> => {
  const css: string = await replayFrame(page)
    .locator("body")
    .evaluate((body: HTMLElement, at: PixelPoint): string => {
      const isPainted: (value: string) => boolean = (
        value: string,
      ): boolean => {
        return (
          value !== "" &&
          value !== "transparent" &&
          value !== "rgba(0, 0, 0, 0)"
        );
      };
      let element: Element | null = body.ownerDocument.elementFromPoint(
        at.x,
        at.y,
      );

      while (element) {
        const background: string = getComputedStyle(element).backgroundColor;

        if (isPainted(background)) {
          return background;
        }

        element = element.parentElement;
      }

      const bodyBackground: string = getComputedStyle(body).backgroundColor;

      return isPainted(bodyBackground) ? bodyBackground : "rgb(255, 255, 255)";
    }, point);

  return parseCssColour(css);
};

/* ---- Instrumentation installed before the page loads. ---- */

/*
 * Wraps canvas.toBlob, the capture's last step, so a test can count
 * captures, hold one mid-flight or make the encoder refuse. Nothing else in
 * the player encodes a canvas.
 */
const instrumentPngEncoder: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.addInitScript((): void => {
    const original: HTMLCanvasElement["toBlob"] =
      HTMLCanvasElement.prototype.toBlob;
    const held: Array<() => void> = [];
    const probe: PngEncoderProbe = {
      calls: 0,
      hold: false,
      fail: false,
      release: (): void => {
        held.splice(0).forEach((encode: () => void): void => {
          encode();
        });
      },
    };

    HTMLCanvasElement.prototype.toBlob = function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ): void {
      probe.calls += 1;

      if (probe.fail) {
        window.setTimeout((): void => {
          callback(null);
        }, 0);
        return;
      }

      const encode: () => void = (): void => {
        original.call(this, callback, type, quality);
      };

      if (probe.hold) {
        held.push(encode);
        return;
      }

      encode();
    };

    Object.defineProperty(window, "__pngEncoder", {
      value: probe,
      configurable: true,
    });
  });
};

const pngEncoder: (page: Page) => Promise<{ calls: number }> = async (
  page: Page,
): Promise<{ calls: number }> => {
  return page.evaluate((): { calls: number } => {
    const probe: PngEncoderProbe = (
      window as unknown as { __pngEncoder: PngEncoderProbe }
    ).__pngEncoder;

    return { calls: probe.calls };
  });
};

const setPngEncoder: (
  page: Page,
  mode: { hold?: boolean; fail?: boolean },
) => Promise<void> = async (
  page: Page,
  mode: { hold?: boolean; fail?: boolean },
): Promise<void> => {
  await page.evaluate((next: { hold?: boolean; fail?: boolean }): void => {
    const probe: PngEncoderProbe = (
      window as unknown as { __pngEncoder: PngEncoderProbe }
    ).__pngEncoder;

    probe.hold = Boolean(next.hold);
    probe.fail = Boolean(next.fail);
  }, mode);
};

const releasePngEncoder: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.evaluate((): void => {
    const probe: PngEncoderProbe = (
      window as unknown as { __pngEncoder: PngEncoderProbe }
    ).__pngEncoder;

    probe.hold = false;
    probe.release();
  });
};

/* A clipboard whose write() refuses with the given DOMException name. */
const refuseClipboardWrites: (
  page: Page,
  errorName: string,
) => Promise<void> = async (page: Page, errorName: string): Promise<void> => {
  await page.addInitScript((name: string): void => {
    if (typeof Clipboard === "undefined") {
      return;
    }

    Clipboard.prototype.write = function write(): Promise<void> {
      return Promise.reject(
        new DOMException("The clipboard refused the image.", name),
      );
    };
  }, errorName);
};

/* Records whether the camera flash was ever mounted. */
const watchForFlash: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.evaluate((): void => {
    const seen: { count: number } = { count: 0 };

    Object.defineProperty(window, "__screenshotFlash", {
      value: seen,
      configurable: true,
    });

    new MutationObserver((records: Array<MutationRecord>): void => {
      for (const record of records) {
        record.addedNodes.forEach((node: Node): void => {
          if (
            node instanceof HTMLElement &&
            node.getAttribute("data-testid") === "replay-screenshot-flash"
          ) {
            seen.count += 1;
          }
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
};

const flashCount: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return page.evaluate((): number => {
    return (window as unknown as { __screenshotFlash: { count: number } })
      .__screenshotFlash.count;
  });
};

/* ---- The dock and when it is offered. ---- */

test("the screenshot dock is offered only while the viewer has paused on a frame", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page);

  /* Playing: the picture is moving, so there is no frame to take. */
  await expect(dock(page)).toHaveCount(0);
  await expect(page.getByTestId("replay-screenshot")).toHaveCount(0);

  await pausePlayer(page);

  const group: Locator = page.getByRole("group", {
    name: "Screenshot of this frame",
  });

  await expect(group).toBeVisible();
  await expect(
    group.getByRole("button", { name: "Copy image", exact: true }),
  ).toBeEnabled();
  await expect(
    group.getByRole("button", { name: "Download", exact: true }),
  ).toBeEnabled();
  await expect(copyButton(page)).toHaveAttribute("data-state", "idle");
  await expect(downloadButton(page)).toHaveAttribute("data-state", "idle");
  await expect(copyButton(page)).toHaveAttribute(
    "title",
    "Copy this frame to the clipboard as a PNG",
  );
  await expect(downloadButton(page)).toHaveAttribute(
    "title",
    "Download this frame as a PNG",
  );
  /* Nothing has been captured yet, so there is no card and nothing to say. */
  await expect(preview(page)).toHaveCount(0);
  await expect(failureCard(page)).toHaveCount(0);
  await expect(page.getByTestId("replay-screenshot-status")).toHaveText("");

  /* It sits in the stage's bottom-right corner, on top of everything. */
  const container: ElementBox = await boxOf(
    page.getByTestId("replay-stage-container"),
  );
  const dockBox: ElementBox = await boxOf(dock(page));

  expect(dockBox.x).toBeGreaterThanOrEqual(container.x);
  expect(dockBox.y).toBeGreaterThanOrEqual(container.y);
  expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(
    container.x + container.width,
  );
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(
    container.y + container.height,
  );
  expect(centreOf(dockBox).x).toBeGreaterThan(centreOf(container).x);
  expect(centreOf(dockBox).y).toBeGreaterThan(centreOf(container).y);
  expect(
    container.x + container.width - (dockBox.x + dockBox.width),
  ).toBeLessThanOrEqual(32);
  expect(
    container.y + container.height - (dockBox.y + dockBox.height),
  ).toBeLessThanOrEqual(32);
  expect(await isTopmostAtCentre(copyButton(page))).toBe(true);
  expect(await isTopmostAtCentre(downloadButton(page))).toBe(true);
  /* The paused Play button in the middle of the stage stays reachable too. */
  await expect(page.getByTestId("replay-overlay-paused")).toBeVisible();
  expect(
    await isTopmostAtCentre(page.getByTestId("replay-overlay-paused")),
  ).toBe(true);

  await settleDock(page);
  await screenshot(page, "session-replay-screenshot-dock");

  /* The stage's own Play button resumes, and the dock goes with the pause. */
  await page.getByTestId("replay-overlay-paused").click();
  await expect(phase(page)).toHaveText("playing");
  await expect(dock(page)).toHaveCount(0);

  /* Pausing from the keyboard offers it again. */
  await blurFocus(page);
  await page.keyboard.press("k");
  await expect(phase(page)).toHaveText("paused");
  await expect(dock(page)).toBeVisible();

  /* The transport's play button takes it away again. */
  await page.getByTestId("replay-play-pause").click();
  await expect(phase(page)).toHaveText("playing");
  await expect(dock(page)).toHaveCount(0);

  /* The end of the recording is not a paused frame: the ended card owns it. */
  await blurFocus(page);
  await page.keyboard.press("End");
  await expect(phase(page)).toHaveText("ended");
  await expect(page.getByTestId("replay-overlay-ended")).toBeVisible();
  await expect(dock(page)).toHaveCount(0);
});

/* ---- Download. ---- */

test("download saves the paused frame as a png of the recorded viewport, named after the playhead", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page);
  await pausePlayer(page);

  const iframe: Locator = page.locator(stageIframeSelector);

  /* The Replayer sizes its iframe to the recording; the stage scales it. */
  await expect(iframe).toHaveAttribute("width", String(recordedWidth));
  await expect(iframe).toHaveAttribute("height", String(recordedHeight));

  const drawn: ElementBox = await boxOf(iframe);

  expect(drawn.width).toBeLessThan(recordedWidth);

  const ratio: number = await devicePixelRatio(page);
  const pausedAt: number = await clockSeconds(page);

  await watchForFlash(page);

  const saved: SavedScreenshot = await downloadFrame(page);

  expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
  expect(Math.abs(offsetSecondsOf(saved.fileName) - pausedAt)).toBeLessThan(
    0.15,
  );
  /* The recorded size times the display's density, not the drawn size. */
  expect(readPngSize(saved.bytes)).toEqual({
    width: recordedWidth * ratio,
    height: recordedHeight * ratio,
  });

  /* The confirmation card names the file and shows what was taken. */
  const card: Locator = preview(page);

  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-action", "download");
  await expect(card).toContainText("Screenshot downloaded");
  await expect(page.getByTestId("replay-screenshot-preview-detail")).toHaveText(
    saved.fileName,
  );
  await expect(
    page.getByTestId("replay-screenshot-preview-detail"),
  ).toHaveAttribute("title", saved.fileName);

  const thumbnail: Locator = page.getByTestId("replay-screenshot-thumbnail");

  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveAttribute("alt", "The captured frame");
  await expect(thumbnail).toHaveAttribute("src", /^blob:/);
  /* The thumbnail IS the file: the same PNG, at its full size. */
  await expect
    .poll(async (): Promise<Array<number>> => {
      return thumbnail.evaluate((image: HTMLImageElement): Array<number> => {
        return image.complete
          ? [image.naturalWidth, image.naturalHeight]
          : [0, 0];
      });
    })
    .toEqual([recordedWidth * ratio, recordedHeight * ratio]);

  const thumbnailUrl: string = (await thumbnail.getAttribute("src")) ?? "";

  await expect(page.getByTestId("replay-screenshot-status")).toHaveText(
    `Screenshot downloaded as ${saved.fileName}.`,
  );
  await expect(downloadButton(page)).toHaveAttribute("data-state", "done");
  await expect(copyButton(page)).toHaveAttribute("data-state", "idle");

  /* The camera flash went off and has faded away. */
  expect(await flashCount(page)).toBe(1);
  await expect(page.getByTestId("replay-screenshot-flash")).toHaveCount(0);

  /* The check goes back to the icon, then the card leaves by itself. */
  await expect(downloadButton(page)).toHaveAttribute("data-state", "idle", {
    timeout: 5000,
  });
  await expect(card).toHaveCount(0, { timeout: 10000 });
  await expect(dock(page)).toBeVisible();

  /* And its object URL was released with it. */
  expect(
    await page.evaluate(async (url: string): Promise<string> => {
      try {
        await fetch(url);
        return "readable";
      } catch {
        return "revoked";
      }
    }, thumbnailUrl),
  ).toBe("revoked");
});

test("the confirmation card can be dismissed by hand", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page);
  await pausePlayer(page);
  await downloadFrame(page);
  await expect(preview(page)).toBeVisible();

  const dismiss: Locator = page.getByTestId(
    "replay-screenshot-preview-dismiss",
  );

  const thumbnailUrl: string =
    (await page
      .getByTestId("replay-screenshot-thumbnail")
      .getAttribute("src")) ?? "";

  expect(thumbnailUrl).toMatch(/^blob:/);
  await expect(dismiss).toHaveAttribute("aria-label", "Dismiss");
  await dismiss.click();
  await expect(preview(page)).toHaveCount(0);
  /* The dock stays: the frame can be taken again. */
  await expect(dock(page)).toBeVisible();
  await expect(downloadButton(page)).toBeEnabled();
  /* Dismissing released the thumbnail's object URL straight away. */
  expect(
    await page.evaluate(async (url: string): Promise<string> => {
      try {
        await fetch(url);
        return "readable";
      } catch {
        return "revoked";
      }
    }, thumbnailUrl),
  ).toBe("revoked");
});

test("the downloaded picture is the paused page, pixel for pixel on flat colour", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page);
  await pausePlayer(page);

  const projection: StageProjection = await stageProjection(page);
  const ratio: number = await devicePixelRatio(page);

  expect(projection.scale).toBeLessThan(1);

  /*
   * The stage's own chrome, where it sits over the picture at click time,
   * in recorded pixels. The dock's far end may hang past the recording
   * into the stage's margin; what lies over the recording is checked.
   */
  const chrome: Array<{ label: string; centre: PixelPoint }> = [
    {
      label: "the paused Play button",
      centre: centreOf(
        toRecordedBox(
          projection,
          await boxOf(page.getByTestId("replay-overlay-paused")),
        ),
      ),
    },
    {
      label: "the Copy image button",
      centre: centreOf(
        toRecordedBox(projection, await boxOf(copyButton(page))),
      ),
    },
    {
      label: "the Download button",
      centre: centreOf(
        toRecordedBox(projection, await boxOf(downloadButton(page))),
      ),
    },
  ].filter((item: { centre: PixelPoint }): boolean => {
    return (
      item.centre.x > 4 &&
      item.centre.x < recordedWidth - 4 &&
      item.centre.y > 4 &&
      item.centre.y < recordedHeight - 4
    );
  });

  expect(
    chrome.map((item: { label: string }): string => {
      return item.label;
    }),
  ).toEqual(
    expect.arrayContaining(["the paused Play button", "the Copy image button"]),
  );

  const saved: SavedScreenshot = await downloadFrame(page);

  /*
   * Flat-colour boxes of the recorded checkout page, located on the STAGE
   * (page pixels divided by the stage scale) and cross-checked against the
   * replay document's own layout, sampled away from their text.
   */
  const targets: Array<{
    label: string;
    selector: string;
    at: (box: ElementBox) => PixelPoint;
  }> = [
    {
      label: "the dark Place order button",
      selector: "#place-order",
      at: (box: ElementBox): PixelPoint => {
        return { x: box.x + 12, y: box.y + box.height / 2 };
      },
    },
    {
      label: "the header bar",
      selector: "header",
      at: (box: ElementBox): PixelPoint => {
        return { x: box.x + 12, y: box.y + 12 };
      },
    },
    {
      label: "the product swatch",
      selector: ".swatch",
      at: centreOf,
    },
    {
      label: "the first form field",
      selector: ".field",
      at: (box: ElementBox): PixelPoint => {
        return { x: box.x + 6, y: box.y + box.height / 2 };
      },
    },
    {
      label: "the order summary card",
      selector: "aside",
      at: (box: ElementBox): PixelPoint => {
        return { x: box.x + box.width - 12, y: box.y + 12 };
      },
    },
  ];
  const points: Array<PixelPoint> = [];
  const expected: Array<{ label: string; colour: Rgb }> = [];

  for (const target of targets) {
    const onStage: ElementBox = toRecordedBox(
      projection,
      await boxOf(replayFrame(page).locator(target.selector).first()),
    );
    const live: LiveElement = await liveElement(page, target.selector);

    /* The stage draws the document where its own layout puts it. */
    expect(Math.abs(onStage.x - live.left)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(onStage.y - live.top)).toBeLessThanOrEqual(1.5);

    const point: PixelPoint = target.at(onStage);

    expect(point.y).toBeLessThan(recordedHeight);
    points.push({ x: point.x * ratio, y: point.y * ratio });
    expected.push({
      label: target.label,
      colour: parseCssColour(live.background),
    });
  }

  /*
   * The page background shows between the header and the columns. It is
   * the BODY's background, which the viewport takes over - the capture has
   * to move it onto the frame for it to show there at all.
   */
  const header: LiveElement = await liveElement(page, "header");
  const main: LiveElement = await liveElement(page, "main");
  const gap: PixelPoint = {
    x: main.left / 2,
    y: (header.top + header.height + main.top) / 2,
  };
  const pageBackground: Rgb = await liveBackgroundAt(page, gap);
  const bodyBackground: Rgb = parseCssColour(
    (await liveElement(page, "body")).background,
  );

  expect(pageBackground).toEqual(bodyBackground);
  points.push({ x: gap.x * ratio, y: gap.y * ratio });
  expected.push({ label: "the page background", colour: pageBackground });

  /* Not a comparison of white with white: the samples really differ. */
  expect(luminance(expected[0]!.colour)).toBeLessThan(60);
  expect(
    new Set(
      expected.map((item: { colour: Rgb }): string => {
        return item.colour.join(",");
      }),
    ).size,
  ).toBeGreaterThanOrEqual(4);

  const heading: LiveElement = await liveElement(page, "h1");
  const link: LiveElement = await liveElement(page, "#fixture-account-link");
  const linkColour: Rgb = parseCssColour(link.color);
  const chromeRegions: Array<PixelRegion> = chrome.map(
    (item: { centre: PixelPoint }): PixelRegion => {
      return {
        x: (item.centre.x - 4) * ratio,
        y: (item.centre.y - 4) * ratio,
        width: 9 * ratio,
        height: 9 * ratio,
      };
    },
  );
  const inspection: PngInspection = await inspectPng(page, saved.bytes, {
    points: points,
    regions: [
      /* The heading's glyphs. */
      {
        x: heading.left * ratio,
        y: heading.top * ratio,
        width: heading.width * ratio,
        height: heading.height * ratio,
      },
      /* The empty band of page background above the columns. */
      {
        x: 4 * ratio,
        y: (header.top + header.height + 4) * ratio,
        width: (main.left - 8) * ratio,
        height: (main.top - header.top - header.height - 8) * ratio,
      },
      /* The link, in its own colour and underline. */
      {
        x: link.left * ratio,
        y: link.top * ratio,
        width: link.width * ratio,
        height: link.height * ratio,
        near: linkColour,
      },
      ...chromeRegions,
    ],
  });

  expect(inspection.width).toBe(recordedWidth * ratio);
  expect(inspection.height).toBe(recordedHeight * ratio);

  inspection.pixels.forEach((pixel: Array<number>, index: number): void => {
    expectColour(pixel, expected[index]!.colour, expected[index]!.label);
    /* Opaque: the stage paints the replay iframe white underneath. */
    expect(pixel[3]).toBe(255);
  });

  /* The heading's text was drawn, and drawn dark. */
  expect(inspection.regions[0]!.darkPixels).toBeGreaterThan(150);
  /* Flat background has nothing on it. */
  expect(inspection.regions[1]!.darkPixels).toBe(0);
  expect(inspection.regions[1]!.distinctColours).toBe(1);
  expectColour(
    inspection.regions[1]!.dominant,
    bodyBackground,
    "the background band",
  );
  /*
   * The link keeps its colour: an SVG image has no browsing context, so
   * without the capture carrying it across nothing in it is a :link.
   */
  expect(luminance(linkColour)).toBeLessThan(120);
  expect(inspection.regions[2]!.nearPixels).toBeGreaterThan(40);

  /* None of the stage's chrome is in the picture - only the page under it. */
  for (let index: number = 0; index < chrome.length; index++) {
    const underneath: Rgb = await liveBackgroundAt(page, chrome[index]!.centre);

    /* The dark glass would pull this far below the page's light colours. */
    expect(luminance(underneath)).toBeGreaterThan(200);
    expectColour(
      inspection.regions[3 + index]!.dominant,
      underneath,
      `under ${chrome[index]!.label}`,
    );
  }
});

test("a recorded scroll offset is kept in the picture", async ({
  page,
}: {
  page: Page;
}) => {
  /*
   * The fixture scrolls #fixture-recorded-scroll to 120px at 0:09, which
   * takes its only text out of its 48px window. A clone has no layout and
   * so no scroll: without the capture putting the offset back, the text
   * would be drawn at the top of the box.
   */
  await openPlayer(page, "?t=10");
  await pausePlayer(page);

  const scroller: Locator = replayFrame(page).locator(
    "#fixture-recorded-scroll",
  );

  await expect
    .poll(async (): Promise<number> => {
      return scroller.evaluate((element: HTMLElement): number => {
        return element.scrollTop;
      });
    })
    .toBe(120);

  const ratio: number = await devicePixelRatio(page);
  const box: LiveElement = await liveElement(page, "#fixture-recorded-scroll");
  const inner: PixelRegion = {
    x: (box.left + 2) * ratio,
    y: (box.top + 2) * ratio,
    width: (box.width - 4) * ratio,
    height: (box.height - 4) * ratio,
  };
  const scrolled: SavedScreenshot = await downloadFrame(page);
  const scrolledInspection: PngInspection = await inspectPng(
    page,
    scrolled.bytes,
    { regions: [inner] },
  );

  expect(scrolledInspection.regions[0]!.darkPixels).toBe(0);
  expectColour(
    scrolledInspection.regions[0]!.dominant,
    await liveBackgroundAt(page, {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    }),
    "the scrolled-away box",
  );

  /*
   * The same box before 0:09, unscrolled, shows its text. A fresh load at
   * the start rather than a seek back: going back over a scroll is the
   * Replayer's business, and this test is about the capture.
   */
  await openPlayer(page);
  await pausePlayer(page);
  expect(await clockSeconds(page)).toBeLessThan(9);
  await expect
    .poll(async (): Promise<number> => {
      return scroller.evaluate((element: HTMLElement): number => {
        return element.scrollTop;
      });
    })
    .toBe(0);
  expect(await liveElement(page, "#fixture-recorded-scroll")).toEqual(box);

  const unscrolled: SavedScreenshot = await downloadFrame(page);

  expect(offsetSecondsOf(unscrolled.fileName)).toBeLessThan(9);

  const unscrolledInspection: PngInspection = await inspectPng(
    page,
    unscrolled.bytes,
    { regions: [inner] },
  );

  expect(unscrolledInspection.regions[0]!.darkPixels).toBeGreaterThan(40);
});

/* ---- Copy. ---- */

test("copy image puts the paused frame on the clipboard as a png", async ({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: fixtureOrigin,
  });
  await openPlayer(page);
  await pausePlayer(page);

  const downloads: Array<Download> = [];

  page.on("download", (download: Download): void => {
    downloads.push(download);
  });

  const ratio: number = await devicePixelRatio(page);
  const button: LiveElement = await liveElement(page, "#place-order");

  await copyButton(page).click();

  const card: Locator = preview(page);

  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-action", "copy");
  await expect(card).toContainText("Copied to clipboard");
  await expect(page.getByTestId("replay-screenshot-preview-detail")).toHaveText(
    SIZE_DETAIL,
  );
  await expect(page.getByTestId("replay-screenshot-thumbnail")).toBeVisible();
  await expect(page.getByTestId("replay-screenshot-status")).toHaveText(
    "Screenshot copied to the clipboard.",
  );
  await expect(copyButton(page)).toHaveAttribute("data-state", "done");

  const clipboard: { types: Array<string>; base64: string } =
    await page.evaluate(
      async (): Promise<{
        types: Array<string>;
        base64: string;
      }> => {
        const items: Array<ClipboardItem> = await navigator.clipboard.read();
        const types: Array<string> = [];
        let base64: string = "";

        for (const item of items) {
          types.push(...item.types);

          if (!base64 && item.types.includes("image/png")) {
            const blob: Blob = await item.getType("image/png");
            const bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
            let binary: string = "";

            for (let index: number = 0; index < bytes.length; index++) {
              binary += String.fromCharCode(bytes[index]!);
            }

            base64 = btoa(binary);
          }
        }

        return { types: types, base64: base64 };
      },
    );

  expect(clipboard.types).toContain("image/png");
  expect(clipboard.base64.length).toBeGreaterThan(0);

  const copied: Buffer = Buffer.from(clipboard.base64, "base64");

  expect(readPngSize(copied)).toEqual({
    width: recordedWidth * ratio,
    height: recordedHeight * ratio,
  });

  /* It is the picture, not an empty PNG of the right size. */
  const heading: LiveElement = await liveElement(page, "h1");
  const inspection: PngInspection = await inspectPng(page, copied, {
    points: [
      {
        x: (button.left + 12) * ratio,
        y: (button.top + button.height / 2) * ratio,
      },
    ],
    regions: [
      {
        x: heading.left * ratio,
        y: heading.top * ratio,
        width: heading.width * ratio,
        height: heading.height * ratio,
      },
    ],
  });

  /* What the clipboard hands back decodes at the size it was given. */
  expect([inspection.width, inspection.height]).toEqual([
    recordedWidth * ratio,
    recordedHeight * ratio,
  ]);
  expectColour(
    inspection.pixels[0]!,
    parseCssColour(button.background),
    "the Place order button on the clipboard",
  );
  expect(inspection.regions[0]!.darkPixels).toBeGreaterThan(150);

  /* Copying does not also download. */
  expect(downloads).toHaveLength(0);

  await settleDock(page);
  await screenshot(page, "session-replay-screenshot-copied");
});

test("without an image clipboard, copy says why at once and download instead saves the frame", async ({
  page,
}: {
  page: Page;
}) => {
  await instrumentPngEncoder(page);
  await page.addInitScript((): void => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await openPlayer(page);
  await pausePlayer(page);

  const downloads: Array<Download> = [];

  page.on("download", (download: Download): void => {
    downloads.push(download);
  });

  /* The button already says so before it is pressed. */
  await expect(copyButton(page)).toHaveAttribute(
    "title",
    "This browser can't copy images - use Download",
  );

  await copyButton(page).click();

  const card: Locator = failureCard(page);

  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("role", "alert");
  await expect(card).toHaveAttribute("data-recovery", "download");
  await expect(card).toContainText("This browser can't copy images");
  await expect(card).toContainText(
    "It has no image clipboard. Download the PNG instead - it is the same picture.",
  );
  await expect(page.getByTestId("replay-screenshot-recover")).toHaveText(
    "Download instead",
  );
  /* Nothing to try: no frame was drawn and nothing was saved. */
  expect((await pngEncoder(page)).calls).toBe(0);
  expect(downloads).toHaveLength(0);
  await expect(copyButton(page)).toHaveAttribute("data-state", "idle");
  await expect(preview(page)).toHaveCount(0);

  await settleDock(page);
  await screenshot(page, "session-replay-screenshot-error");

  const saved: SavedScreenshot = await saveDownload(
    page,
    async (): Promise<void> => {
      await page.getByTestId("replay-screenshot-recover").click();
    },
  );

  expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
  expect(readPngSize(saved.bytes).width).toBe(
    recordedWidth * (await devicePixelRatio(page)),
  );
  expect((await pngEncoder(page)).calls).toBe(1);
  await expect(card).toHaveCount(0);
  await expect(preview(page)).toHaveAttribute("data-action", "download");
  await expect(preview(page)).toContainText("Screenshot downloaded");

  /* The failure card can also just be dismissed. */
  await copyButton(page).click();
  await expect(card).toBeVisible();
  await expect(preview(page)).toHaveCount(0);
  await page.getByTestId("replay-screenshot-error-dismiss").click();
  await expect(card).toHaveCount(0);
  await expect(dock(page)).toBeVisible();
  expect(downloads).toHaveLength(1);
});

test("on a page that is not a secure context, copy says images need https", async ({
  page,
}: {
  page: Page;
}) => {
  await page.addInitScript((): void => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: false,
    });
  });
  await openPlayer(page);
  await pausePlayer(page);

  await expect(copyButton(page)).toHaveAttribute(
    "title",
    "Copying images needs a secure (https) page - use Download",
  );
  await copyButton(page).click();
  await expect(failureCard(page)).toContainText("Copying images needs HTTPS");
  await expect(failureCard(page)).toHaveAttribute("data-recovery", "download");

  const saved: SavedScreenshot = await saveDownload(
    page,
    async (): Promise<void> => {
      await page.getByTestId("replay-screenshot-recover").click();
    },
  );

  expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
  readPngSize(saved.bytes);
});

[
  {
    errorName: "NotAllowedError",
    title: "Clipboard access was blocked",
    description:
      "Allow clipboard access for this site in the browser, or download the PNG instead.",
  },
  {
    errorName: "DataError",
    title: "This browser can't copy images",
    description:
      "It has no image clipboard. Download the PNG instead - it is the same picture.",
  },
  {
    errorName: "AbortError",
    title: "Couldn't copy the image",
    description: "The clipboard did not take it. Download the PNG instead.",
  },
].forEach(
  (scenario: { errorName: string; title: string; description: string }) => {
    test(`a clipboard that refuses with ${scenario.errorName} keeps the drawn png for download instead`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await instrumentPngEncoder(page);
      await refuseClipboardWrites(page, scenario.errorName);
      await openPlayer(page);
      await pausePlayer(page);

      await copyButton(page).click();

      const card: Locator = failureCard(page);

      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("data-recovery", "download");
      await expect(card).toContainText(scenario.title);
      await expect(card).toContainText(scenario.description);
      await expect(page.getByTestId("replay-screenshot-status")).toHaveText("");
      await expect(copyButton(page)).toHaveAttribute("data-state", "idle");
      /* The frame WAS drawn - only the clipboard said no. */
      expect((await pngEncoder(page)).calls).toBe(1);

      /*
       * "Download instead" saves the PNG that was already drawn: the frame
       * on the stage is the same one, so it is not drawn a second time.
       */
      const saved: SavedScreenshot = await saveDownload(
        page,
        async (): Promise<void> => {
          await page.getByTestId("replay-screenshot-recover").click();
        },
      );

      expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
      expect(readPngSize(saved.bytes)).toEqual({
        width: recordedWidth * (await devicePixelRatio(page)),
        height: recordedHeight * (await devicePixelRatio(page)),
      });
      expect((await pngEncoder(page)).calls).toBe(1);
      await expect(card).toHaveCount(0);
      await expect(preview(page)).toHaveAttribute("data-action", "download");
      await expect(page.getByTestId("replay-screenshot-status")).toHaveText(
        `Screenshot downloaded as ${saved.fileName}.`,
      );
    });
  },
);

test("a frame the browser will not encode offers to try again, and trying again delivers it", async ({
  page,
}: {
  page: Page;
}) => {
  await instrumentPngEncoder(page);
  await openPlayer(page);
  await pausePlayer(page);

  const downloads: Array<Download> = [];

  page.on("download", (download: Download): void => {
    downloads.push(download);
  });

  await setPngEncoder(page, { fail: true });
  await downloadButton(page).click();

  const card: Locator = failureCard(page);

  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-recovery", "retry");
  await expect(card).toContainText("Couldn't save this frame");
  await expect(card).toContainText(
    "The browser would not export the picture as a PNG.",
  );
  await expect(page.getByTestId("replay-screenshot-recover")).toHaveText(
    "Try again",
  );
  await expect(downloadButton(page)).toHaveAttribute("data-state", "idle");
  await expect(downloadButton(page)).toBeEnabled();
  expect(downloads).toHaveLength(0);

  await setPngEncoder(page, {});

  const saved: SavedScreenshot = await saveDownload(
    page,
    async (): Promise<void> => {
      await page.getByTestId("replay-screenshot-recover").click();
    },
  );

  expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
  readPngSize(saved.bytes);
  expect((await pngEncoder(page)).calls).toBe(2);
  await expect(card).toHaveCount(0);
  await expect(preview(page)).toHaveAttribute("data-action", "download");
});

test("when the frame cannot be drawn, copy reports that rather than the clipboard's complaint", async ({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: fixtureOrigin,
  });
  await instrumentPngEncoder(page);
  await openPlayer(page);
  await pausePlayer(page);

  /*
   * The clipboard was handed the pending image and rejects once it fails;
   * the viewer must hear why the image failed, and be offered another go -
   * not "Download instead", which would fail the same way.
   */
  await setPngEncoder(page, { fail: true });
  await copyButton(page).click();

  const card: Locator = failureCard(page);

  await expect(card).toBeVisible();
  await expect(card).toContainText("Couldn't save this frame");
  await expect(card).toHaveAttribute("data-recovery", "retry");
  await expect(card).not.toContainText("clipboard");

  await setPngEncoder(page, {});
  await page.getByTestId("replay-screenshot-recover").click();
  await expect(card).toHaveCount(0);
  await expect(preview(page)).toHaveAttribute("data-action", "copy");
  await expect(preview(page)).toContainText("Copied to clipboard");
  expect(
    await page.evaluate(async (): Promise<Array<string>> => {
      const types: Array<string> = [];

      for (const item of await navigator.clipboard.read()) {
        types.push(...item.types);
      }

      return types;
    }),
  ).toContain("image/png");
});

/* ---- A capture in flight. ---- */

test("the dock is busy while a frame is drawn and a second press starts nothing", async ({
  page,
}: {
  page: Page;
}) => {
  await instrumentPngEncoder(page);
  await openPlayer(page);
  await pausePlayer(page);

  const downloads: Array<Download> = [];

  page.on("download", (download: Download): void => {
    downloads.push(download);
  });

  await setPngEncoder(page, { hold: true });

  const downloadPromise: Promise<Download> = page.waitForEvent("download");

  /* Two presses in the same task, before React has re-rendered. */
  await downloadButton(page).evaluate((button: HTMLButtonElement): void => {
    button.click();
    button.click();
  });
  await expect
    .poll(async (): Promise<number> => {
      return (await pngEncoder(page)).calls;
    })
    .toBe(1);

  await expect(downloadButton(page)).toHaveAttribute("data-state", "busy");
  await expect(downloadButton(page)).toHaveAttribute("aria-busy", "true");
  await expect(downloadButton(page)).toBeDisabled();
  /* The other action waits too: one capture at a time. */
  await expect(copyButton(page)).toBeDisabled();
  await expect(copyButton(page)).toHaveAttribute("data-state", "idle");
  await expect(copyButton(page)).not.toHaveAttribute("aria-busy", "true");

  await releasePngEncoder(page);

  const download: Download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(FILE_NAME_PATTERN);
  await expect(downloadButton(page)).toHaveAttribute("data-state", "done");
  await expect(downloadButton(page)).toBeEnabled();
  await expect(copyButton(page)).toBeEnabled();
  await expect(downloadButton(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(downloadButton(page)).toHaveAttribute("data-state", "idle", {
    timeout: 5000,
  });
  expect(downloads).toHaveLength(1);
  expect((await pngEncoder(page)).calls).toBe(1);
});

test("pressing play mid-capture still delivers the paused frame, named after the paused playhead", async ({
  page,
}: {
  page: Page;
}) => {
  await instrumentPngEncoder(page);
  await openPlayer(page);
  await pausePlayer(page);

  const first: SavedScreenshot = await downloadFrame(page);

  await setPngEncoder(page, { hold: true });

  const downloadPromise: Promise<Download> = page.waitForEvent("download");

  await downloadButton(page).click();
  await expect(downloadButton(page)).toHaveAttribute("data-state", "busy");

  const pausedAt: number = await clockSeconds(page);

  await page.getByTestId("replay-play-pause").click();
  await expect(phase(page)).toHaveText("playing");
  await expect(dock(page)).toHaveCount(0);
  /* Let the page move on: the pointer appears and the text changes. */
  await expect
    .poll(async (): Promise<number> => {
      return clockSeconds(page);
    })
    .toBeGreaterThan(pausedAt + 1.5);

  await releasePngEncoder(page);

  const late: Download = await downloadPromise;
  const lateBytes: Buffer = await readFile(await late.path());

  /* The frame was cloned at the click: the same name, the same picture. */
  expect(late.suggestedFilename()).toBe(first.fileName);
  expect(lateBytes.equals(first.bytes)).toBe(true);

  /* The dock that asked is gone, and so is anything it would have shown. */
  await expect(preview(page)).toHaveCount(0);
  await expect(failureCard(page)).toHaveCount(0);

  /* A fresh pause starts clean. */
  await page.getByTestId("replay-play-pause").click();
  await expect(phase(page)).toHaveText("paused");
  await expect(dock(page)).toBeVisible();
  await expect(preview(page)).toHaveCount(0);
  await expect(failureCard(page)).toHaveCount(0);
  await expect(downloadButton(page)).toHaveAttribute("data-state", "idle");
});

/* ---- The playhead and the file name. ---- */

test("a seek while paused names the next screenshot after the new playhead and draws the new frame", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page);
  await pausePlayer(page);

  const ratio: number = await devicePixelRatio(page);
  const start: SavedScreenshot = await downloadFrame(page);
  const startOffset: number = offsetSecondsOf(start.fileName);

  /* ArrowRight is +5s. */
  await blurFocus(page);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async (): Promise<number> => {
      return clockSeconds(page);
    })
    .toBeGreaterThanOrEqual(startOffset + 4.9);
  await expect(phase(page)).toHaveText("paused");
  await expect(dock(page)).toBeVisible();

  const later: SavedScreenshot = await downloadFrame(page);
  const laterOffset: number = offsetSecondsOf(later.fileName);

  expect(later.fileName).toMatch(FILE_NAME_PATTERN);
  expect(Math.abs(laterOffset - startOffset - 5)).toBeLessThanOrEqual(0.15);
  expect(Math.abs(laterOffset - (await clockSeconds(page)))).toBeLessThan(0.15);

  /*
   * The new frame, not the old one: by 0:05 the recorded pointer has
   * moved onto the page, and the stage's pointer is drawn into the PNG
   * where the stage shows it. Located on the stage, once its move settles.
   */
  const pointer: Locator = page.locator(".replayer-mouse").first();
  const settled: { box: ElementBox | null } = { box: null };

  await expect
    .poll(
      async (): Promise<boolean> => {
        const current: ElementBox = await boxOf(pointer);
        const isSettled: boolean =
          settled.box !== null &&
          Math.abs(settled.box.x - current.x) < 0.5 &&
          Math.abs(settled.box.y - current.y) < 0.5;

        settled.box = current;

        return isSettled;
      },
      { intervals: [250] },
    )
    .toBe(true);

  const projection: StageProjection = await stageProjection(page);
  const pointerCentre: PixelPoint = centreOf(
    toRecordedBox(projection, settled.box!),
  );
  const pointerRegion: PixelRegion = {
    x: (pointerCentre.x - 2) * ratio,
    y: (pointerCentre.y - 2) * ratio,
    width: 5 * ratio,
    height: 5 * ratio,
  };
  const withPointer: RegionSummary = (
    await inspectPng(page, later.bytes, { regions: [pointerRegion] })
  ).regions[0]!;
  const withoutPointer: RegionSummary = (
    await inspectPng(page, start.bytes, { regions: [pointerRegion] })
  ).regions[0]!;

  /* The stage's indigo dot, over the page... */
  expect(withPointer.dominant[2] - withPointer.dominant[0]).toBeGreaterThan(40);
  /* ...where the earlier frame, before the pointer moved, has none. */
  expect(withoutPointer.dominant[2] - withoutPointer.dominant[0]).toBeLessThan(
    20,
  );

  /* "." is +1s. */
  await blurFocus(page);
  await page.keyboard.press(".");
  await expect
    .poll(async (): Promise<number> => {
      return clockSeconds(page);
    })
    .toBeGreaterThanOrEqual(laterOffset + 0.9);
  await expect(phase(page)).toHaveText("paused");

  const nudged: SavedScreenshot = await downloadFrame(page);

  expect(
    Math.abs(offsetSecondsOf(nudged.fileName) - laterOffset - 1),
  ).toBeLessThanOrEqual(0.15);
});

test("a seek while paused withdraws a failed copy of the previous frame", async ({
  page,
}: {
  page: Page;
}) => {
  await instrumentPngEncoder(page);
  await refuseClipboardWrites(page, "NotAllowedError");
  await openPlayer(page);
  await pausePlayer(page);

  const pausedAt: number = await clockSeconds(page);

  await copyButton(page).click();
  await expect(failureCard(page)).toContainText("Clipboard access was blocked");
  expect((await pngEncoder(page)).calls).toBe(1);

  /*
   * Its "Download instead" would save the PNG of the frame the viewer has
   * just left, so the card goes with that frame.
   */
  await blurFocus(page);
  await page.keyboard.press(".");
  await expect
    .poll(async (): Promise<number> => {
      return clockSeconds(page);
    })
    .toBeGreaterThanOrEqual(pausedAt + 0.9);
  await expect(phase(page)).toHaveText("paused");
  await expect(failureCard(page)).toHaveCount(0);
  await expect(dock(page)).toBeVisible();

  /* A download now draws the new frame and is named after it. */
  const saved: SavedScreenshot = await downloadFrame(page);

  expect((await pngEncoder(page)).calls).toBe(2);
  expect(
    Math.abs(offsetSecondsOf(saved.fileName) - (await clockSeconds(page))),
  ).toBeLessThan(0.15);
  expect(offsetSecondsOf(saved.fileName)).toBeGreaterThanOrEqual(
    pausedAt + 0.9,
  );
});

test("past the first minute the file name spells minutes and seconds", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page, "?t=65");
  await pausePlayer(page);

  const pausedAt: number = await clockSeconds(page);

  expect(pausedAt).toBeGreaterThanOrEqual(65);

  const saved: SavedScreenshot = await downloadFrame(page);
  const MINUTE_PATTERN: RegExp = /^session-replay-aaaaaaaa-1m0\d\.\ds\.png$/;

  expect(saved.fileName).toMatch(MINUTE_PATTERN);
  expect(Math.abs(offsetSecondsOf(saved.fileName) - pausedAt)).toBeLessThan(
    0.15,
  );
});

test("with several tabs the file name says which tab was captured", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page, "?tabs=multiple");
  await pausePlayer(page);

  const TAB_ONE_PATTERN: RegExp =
    /^session-replay-aaaaaaaa-tab-1-\d+m\d{2}\.\ds\.png$/;
  const TAB_TWO_PATTERN: RegExp =
    /^session-replay-aaaaaaaa-tab-2-\d+m\d{2}\.\ds\.png$/;
  const first: SavedScreenshot = await downloadFrame(page);

  expect(first.fileName).toMatch(TAB_ONE_PATTERN);

  const tabs: Locator = page.getByTestId("replay-tab-pill");

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(phase(page)).toHaveText(/^(paused|playing)$/, {
    timeout: 30000,
  });

  if ((await phase(page).innerText()) === "playing") {
    await pausePlayer(page);
  }

  await expect(dock(page)).toBeVisible();

  const second: SavedScreenshot = await downloadFrame(page);

  expect(second.fileName).toMatch(TAB_TWO_PATTERN);
  readPngSize(second.bytes);
});

/* ---- The live document and the network. ---- */

test("capturing never writes to the replay document and makes no network request", async ({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: fixtureOrigin,
  });
  /* Past 0:09, so a recorded scroll offset is part of what gets read. */
  await openPlayer(page, "?t=10");
  await pausePlayer(page);
  await expect
    .poll(async (): Promise<number> => {
      return replayFrame(page)
        .locator("#fixture-recorded-scroll")
        .evaluate((element: HTMLElement): number => {
          return element.scrollTop;
        });
    })
    .toBe(120);

  /*
   * Watched from the Dashboard's side: every mutation of the replay
   * document during the capture is recorded. Proven live first with a
   * mutation of our own, which is undone before the snapshot is taken.
   */
  await page.evaluate((selector: string): void => {
    const iframe: HTMLIFrameElement | null = document.querySelector(selector);
    const replayDocument: Document | null = iframe
      ? iframe.contentDocument
      : null;

    if (!replayDocument) {
      throw new Error("No replay document to watch.");
    }

    const log: Array<string> = [];

    Object.defineProperty(window, "__replayMutations", {
      value: log,
      configurable: true,
    });

    new MutationObserver((records: Array<MutationRecord>): void => {
      for (const record of records) {
        log.push(
          `${record.type} on <${(record.target as Element).nodeName}> ${
            record.attributeName ?? ""
          }`,
        );
      }
    }).observe(replayDocument, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    replayDocument.body.setAttribute("data-e2e-probe", "1");
    replayDocument.body.removeAttribute("data-e2e-probe");
  }, stageIframeSelector);

  const readMutations: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    return page.evaluate((): Array<string> => {
      return (window as unknown as { __replayMutations: Array<string> })
        .__replayMutations;
    });
  };

  await expect.poll(readMutations).toHaveLength(2);
  await page.evaluate((): void => {
    (
      window as unknown as { __replayMutations: Array<string> }
    ).__replayMutations.length = 0;
  });

  interface LiveDocumentState {
    html: string;
    styleSheets: number;
    adoptedStyleSheets: number;
    rootScroll: Array<number>;
    recordedScroll: number;
    activeElement: string;
  }

  const readLiveDocument: () => Promise<LiveDocumentState> =
    async (): Promise<LiveDocumentState> => {
      return replayFrame(page)
        .locator("html")
        .evaluate((root: HTMLElement): LiveDocumentState => {
          const replayDocument: Document = root.ownerDocument;
          const scroller: Element | null = replayDocument.querySelector(
            "#fixture-recorded-scroll",
          );
          const scrolling: Element =
            replayDocument.scrollingElement ?? replayDocument.documentElement;

          return {
            html: root.outerHTML,
            styleSheets: replayDocument.styleSheets.length,
            adoptedStyleSheets: replayDocument.adoptedStyleSheets.length,
            rootScroll: [scrolling.scrollLeft, scrolling.scrollTop],
            recordedScroll: scroller ? scroller.scrollTop : -1,
            activeElement: replayDocument.activeElement
              ? replayDocument.activeElement.nodeName
              : "",
          };
        });
    };

  const before: LiveDocumentState = await readLiveDocument();
  const requests: Array<string> = [];
  const recordRequest: (request: Request) => void = (
    request: Request,
  ): void => {
    requests.push(request.url());
  };

  page.on("request", recordRequest);

  const saved: SavedScreenshot = await downloadFrame(page);

  await expect(preview(page)).toHaveAttribute("data-action", "download");
  await copyButton(page).click();
  await expect(preview(page)).toHaveAttribute("data-action", "copy");

  page.off("request", recordRequest);

  readPngSize(saved.bytes);
  expect(await readMutations()).toEqual([]);
  expect(await readLiveDocument()).toEqual(before);

  /*
   * blob: and data: URLs never leave the browser: the file's and the
   * thumbnail's object URLs, and the SVG image the frame is drawn through.
   * The fixture's own traffic (API calls, chunk reads, the heartbeat) is
   * answered in-page by Fixture.js and never reaches the network, so
   * anything else here would be the capture fetching something.
   */
  const offBrowser: Array<string> = requests.filter((url: string): boolean => {
    return !url.startsWith("blob:") && !url.startsWith("data:");
  });

  expect(offBrowser).toEqual([]);
});

/* ---- Text selection. ---- */

test("text selection mode hides the dock and leaving it brings the dock back", async ({
  page,
}: {
  page: Page;
}) => {
  await openPlayer(page);

  const toggle: Locator = page.getByTestId("replay-select-text");

  /* Selecting text from playback pauses - but inspection is not a frame to take. */
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(phase(page)).toHaveText("paused");
  await expect(dock(page)).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(phase(page)).toHaveText("paused");
  await expect(dock(page)).toBeVisible();

  /* From a pause with a card showing, the card goes with the dock. */
  await downloadFrame(page);
  await expect(preview(page)).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(dock(page)).toHaveCount(0);
  await expect(preview(page)).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(dock(page)).toBeVisible();
  await expect(preview(page)).toHaveCount(0);

  /* And the capture still works on the document selection mode touched. */
  const saved: SavedScreenshot = await downloadFrame(page);

  expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
  expect(readPngSize(saved.bytes).height).toBe(
    recordedHeight * (await devicePixelRatio(page)),
  );
});

/* ---- Keyboard. ---- */

test("the dock works from the keyboard without reaching the player's shortcuts", async ({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: fixtureOrigin,
  });
  await openPlayer(page);
  await pausePlayer(page);

  /* Copy, then Download, in tab order. */
  await copyButton(page).focus();
  await page.keyboard.press("Tab");
  await expect(downloadButton(page)).toBeFocused();

  /* Enter on Download saves the frame; it does not also toggle playback. */
  const saved: SavedScreenshot = await saveDownload(
    page,
    async (): Promise<void> => {
      await page.keyboard.press("Enter");
    },
  );

  expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
  await expect(phase(page)).toHaveText("paused");
  await expect(preview(page)).toHaveAttribute("data-action", "download");

  /* Space on Copy copies; the player's Space (play/pause) stays out of it. */
  await copyButton(page).focus();
  await page.keyboard.press("Space");
  await expect(preview(page)).toHaveAttribute("data-action", "copy");
  await expect(phase(page)).toHaveText("paused");
  await expect(dock(page)).toBeVisible();
});

/* ---- Layouts. ---- */

[390, 320].forEach((width: number) => {
  test(`the dock fits a ${width}px phone and keeps its accessible names`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: width, height: 844 });
    await openPlayer(page);
    await pausePlayer(page);
    await noHorizontalOverflow(page);

    const group: Locator = page.getByRole("group", {
      name: "Screenshot of this frame",
    });
    const copy: Locator = group.getByRole("button", {
      name: "Copy image",
      exact: true,
    });
    const save: Locator = group.getByRole("button", {
      name: "Download",
      exact: true,
    });

    await expect(copy).toBeVisible();
    await expect(save).toBeVisible();

    /* Icon-only on a phone: the words are for screen readers. */
    await expect
      .poll(async (): Promise<number> => {
        return (await boxOf(copy)).width;
      })
      .toBeLessThanOrEqual(36);
    /* 32px targets (h-8), give or take the entry transition's sub-pixel. */
    expect((await boxOf(copy)).height).toBeGreaterThanOrEqual(31.5);
    expect((await boxOf(save)).height).toBeGreaterThanOrEqual(31.5);
    /* The label is still in the button, clipped to the sr-only pixel. */
    const labelSize: Array<number> = await copy.evaluate(
      (button: HTMLElement): Array<number> => {
        const label: Element | null = button.querySelector("span");
        const rect: DOMRect | undefined = label?.getBoundingClientRect();

        return rect ? [rect.width, rect.height] : [-1, -1];
      },
    );

    expect(labelSize[0]).toBeGreaterThan(0);
    expect(labelSize[0]).toBeLessThanOrEqual(1.01);
    expect(labelSize[1]).toBeGreaterThan(0);
    expect(labelSize[1]).toBeLessThanOrEqual(1.01);
    await expect(copy).toHaveText("Copy image");
    await expect(save).toHaveText("Download");

    await dock(page).scrollIntoViewIfNeeded();

    const dockBox: ElementBox = await boxOf(dock(page));
    const stage: ElementBox = await boxOf(
      page.getByTestId("replay-stage-container"),
    );

    expect(dockBox.x).toBeGreaterThanOrEqual(0);
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(width);
    expect(dockBox.x).toBeGreaterThanOrEqual(stage.x);
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(
      stage.x + stage.width,
    );
    expect(await isTopmostAtCentre(copy)).toBe(true);
    expect(await isTopmostAtCentre(save)).toBe(true);

    /* The card fits the phone too, and the file is still the full frame. */
    const saved: SavedScreenshot = await downloadFrame(page);

    expect(readPngSize(saved.bytes)).toEqual({
      width: recordedWidth * (await devicePixelRatio(page)),
      height: recordedHeight * (await devicePixelRatio(page)),
    });
    await expect(preview(page)).toBeVisible();

    const cardBox: ElementBox = await boxOf(preview(page));

    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width);
    await noHorizontalOverflow(page);

    await settleDock(page);
    await screenshot(page, `session-replay-screenshot-phone-${width}`);
  });

  test(`on a ${width}px phone the confirmation card stays on the stage and off its controls`, async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: width, height: 844 });
    await openPlayer(page);
    await pausePlayer(page);
    await downloadFrame(page);
    await expect(preview(page)).toBeVisible();
    await expect(page.getByTestId("replay-screenshot-thumbnail")).toBeVisible();

    /*
     * A phone's stage is a short strip. The card is drawn over the picture,
     * so it has to fit inside the stage rather than climb out over the
     * address bar above it, where the Fit / Width / 1:1 segments and Select
     * text live - for the five seconds it shows, those would be covered and
     * could not be pressed.
     */
    const stage: ElementBox = await boxOf(
      page.getByTestId("replay-stage-container"),
    );
    const cardBox: ElementBox = await boxOf(preview(page));

    expect
      .soft(cardBox.y, "the card's top edge is above the stage")
      .toBeGreaterThanOrEqual(stage.y - 1);
    expect
      .soft(
        cardBox.y + cardBox.height,
        "the card's bottom edge is below the stage",
      )
      .toBeLessThanOrEqual(stage.y + stage.height + 1);

    const controls: Array<Locator> = [
      page.getByTestId("replay-select-text"),
      ...(await page
        .getByTestId("replay-fit-toggle")
        .getByRole("button")
        .all()),
    ];

    expect(controls.length).toBe(4);

    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      expect
        .soft(
          await isTopmostAtCentre(control),
          `"${await control.innerText()}" is covered by the confirmation card`,
        )
        .toBe(true);
    }
  });
});

test("theater mode keeps the dock inside the fullscreen player and downloads still work", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);

  const normalWidth: number = (await boxOf(page.locator(stageIframeSelector)))
    .width;

  await blurFocus(page);
  await page.keyboard.press("f");
  await expect
    .poll(async (): Promise<boolean> => {
      return page.evaluate((): boolean => {
        const root: Element | null = document.querySelector(
          '[data-testid="replay-player"]',
        );

        return Boolean(root) && document.fullscreenElement === root;
      });
    })
    .toBe(true);

  await pausePlayer(page);

  /* The fullscreen root clips everything outside it: the dock is inside. */
  expect(
    await dock(page).evaluate((element: HTMLElement): boolean => {
      return Boolean(document.fullscreenElement?.contains(element));
    }),
  ).toBe(true);

  const root: ElementBox = await boxOf(page.getByTestId("replay-player"));
  const dockBox: ElementBox = await boxOf(dock(page));

  expect(dockBox.x).toBeGreaterThanOrEqual(root.x);
  expect(dockBox.y).toBeGreaterThanOrEqual(root.y);
  expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(root.x + root.width);
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(root.y + root.height);
  expect(await isTopmostAtCentre(downloadButton(page))).toBe(true);

  /* A bigger picture on screen is still the recorded viewport in the file. */
  await expect
    .poll(async (): Promise<number> => {
      return (await boxOf(page.locator(stageIframeSelector))).width;
    })
    .toBeGreaterThan(normalWidth);

  const saved: SavedScreenshot = await downloadFrame(page);

  expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
  expect(readPngSize(saved.bytes)).toEqual({
    width: recordedWidth * (await devicePixelRatio(page)),
    height: recordedHeight * (await devicePixelRatio(page)),
  });
  await expect(preview(page)).toBeVisible();

  await settleDock(page);
  await screenshot(page, "session-replay-screenshot-theater");
});

test("the picture does not depend on how the stage is fitted or scrolled", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPlayer(page);
  await pausePlayer(page);

  const stage: Locator = page.getByTestId("replay-stage");
  const fit: Locator = page.getByTestId("replay-fit-toggle");
  const contained: SavedScreenshot = await downloadFrame(page);

  /* Width: the stage scrolls; the dock stays in the visible corner. */
  await fit.getByRole("button", { name: "Width", exact: true }).click();
  await expect(stage).toHaveAttribute("data-replay-fit", "width");
  await expect(dock(page)).toBeVisible();

  const dockBefore: ElementBox = await boxOf(dock(page));

  await stage.evaluate((element: HTMLElement): void => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async (): Promise<number> => {
      return stage.evaluate((element: HTMLElement): number => {
        return element.scrollTop;
      });
    })
    .toBeGreaterThan(0);

  const dockAfter: ElementBox = await boxOf(dock(page));

  /* Drawn over the scroll box, not in it: the scroll does not move it. */
  expect(Math.abs(dockAfter.x - dockBefore.x)).toBeLessThan(0.5);
  expect(Math.abs(dockAfter.y - dockBefore.y)).toBeLessThan(0.5);

  /* Clear of the stage's scrollbar: inside its client box. */
  const clientRight: number = await stage.evaluate(
    (element: HTMLElement): number => {
      return (
        element.getBoundingClientRect().left +
        element.clientLeft +
        element.clientWidth
      );
    },
  );

  expect(dockAfter.x + dockAfter.width).toBeLessThanOrEqual(clientRight);

  const widened: SavedScreenshot = await downloadFrame(page);

  /* 1:1: drawn at full size in a scroll box. */
  await fit.getByRole("button", { name: "1:1", exact: true }).click();
  await expect(stage).toHaveAttribute("data-replay-fit", "actual");
  await expect(dock(page)).toBeVisible();

  const actual: SavedScreenshot = await downloadFrame(page);

  /* Same frame, same file: the stage's scale and scroll are not in it. */
  expect(widened.fileName).toBe(contained.fileName);
  expect(actual.fileName).toBe(contained.fileName);
  expect(widened.bytes.equals(contained.bytes)).toBe(true);
  expect(actual.bytes.equals(contained.bytes)).toBe(true);
});

/* ---- Other displays and recordings. ---- */

[2, 3].forEach((deviceScaleFactor: number) => {
  test(`a ${deviceScaleFactor}x display gets a png at ${Math.min(
    deviceScaleFactor,
    maxPixelRatio,
  )}x the recorded viewport`, async ({ browser }: { browser: Browser }) => {
    const context: BrowserContext = await browser.newContext({
      deviceScaleFactor: deviceScaleFactor,
    });

    try {
      const page: Page = await context.newPage();

      await openPlayer(page);
      await pausePlayer(page);
      expect(await devicePixelRatio(page)).toBe(deviceScaleFactor);

      const ratio: number = Math.min(deviceScaleFactor, maxPixelRatio);
      const button: LiveElement = await liveElement(page, "#place-order");
      const saved: SavedScreenshot = await downloadFrame(page);

      expect(readPngSize(saved.bytes)).toEqual({
        width: recordedWidth * ratio,
        height: recordedHeight * ratio,
      });

      /* Denser, not bigger: the page lands at the same place, scaled. */
      const inspection: PngInspection = await inspectPng(page, saved.bytes, {
        points: [
          {
            x: (button.left + 12) * ratio,
            y: (button.top + button.height / 2) * ratio,
          },
        ],
        regions: [
          {
            x: 0,
            y: 0,
            width: recordedWidth * ratio,
            height: 40 * ratio,
          },
        ],
      });

      expectColour(
        inspection.pixels[0]!,
        parseCssColour(button.background),
        "the Place order button",
      );

      /* The copy card speaks in CSS pixels whatever the density. */
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: fixtureOrigin,
      });
      await copyButton(page).click();
      await expect(
        page.getByTestId("replay-screenshot-preview-detail"),
      ).toHaveText(SIZE_DETAIL);
    } finally {
      await context.close();
    }
  });
});

test("a react native recording is captured at its own size without the phone frame", async ({
  page,
}: {
  page: Page;
}) => {
  await openMobilePlayer(page);
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-replay-frame",
    "phone",
  );
  await pausePlayer(page);

  const iframe: Locator = page.locator(stageIframeSelector);

  await expect(iframe).toHaveAttribute("width", String(mobileRecordedWidth));
  await expect(iframe).toHaveAttribute("height", String(mobileRecordedHeight));

  const ratio: number = await devicePixelRatio(page);
  const saved: SavedScreenshot = await downloadFrame(page);

  expect(saved.fileName).toMatch(FILE_NAME_PATTERN);
  expect(readPngSize(saved.bytes)).toEqual({
    width: mobileRecordedWidth * ratio,
    height: mobileRecordedHeight * ratio,
  });

  /*
   * The recorded screen reaches the very corner of the file: the stage's
   * phone bezel is chrome around the picture, not part of it.
   */
  const corner: PixelPoint = { x: 2, y: 2 };
  /* The dark action bar and the masked block, away from their contents. */
  const bar: PixelPoint = { x: 18 + 8, y: 724 + 8 };
  const masked: PixelPoint = { x: 18 + 177, y: 342 + 58 };
  const points: Array<PixelPoint> = [corner, bar, masked];
  const inspection: PngInspection = await inspectPng(page, saved.bytes, {
    points: points.map((point: PixelPoint): PixelPoint => {
      return { x: point.x * ratio, y: point.y * ratio };
    }),
  });
  const labels: Array<string> = [
    "the screen's corner",
    "the action bar",
    "the masked block",
  ];

  for (let index: number = 0; index < points.length; index++) {
    expectColour(
      inspection.pixels[index]!,
      await liveBackgroundAt(page, points[index]!),
      labels[index]!,
    );
  }

  expect(luminance(inspection.pixels[0]!)).toBeGreaterThan(200);
  expect(luminance(inspection.pixels[1]!)).toBeLessThan(80);
});
