import {
  APIRequestContext,
  APIResponse,
  ConsoleMessage,
  FrameLocator,
  Locator,
  Page,
  expect,
  test,
} from "@playwright/test";
import { mkdir } from "fs/promises";
import path from "path";

/*
 * The recorded page's own images, stylesheets and web fonts, end to end
 * (#4119). The production player replays ?assets=site (Fixture/Fixture.js):
 * a page shaped like the Power Pages portal in the issue, whose assets live
 * on a second origin - the recorded site - that Fixture/server.js runs and
 * logs every request to.
 *
 * rrweb keeps every <img>, and every stylesheet the recorder could not read,
 * as an address, so the replay has to load them from the recorded site. The
 * replay document's policy used to refuse them all: every image played back
 * broken, and the portal's offline banner - hidden by a rule in a stylesheet
 * on another host - took over every replay. What only a real browser can
 * say is pinned here:
 *  - what the replay loads: the page's images, the stylesheet the recorder
 *    could not inline, web fonts served with CORS, and an image a later
 *    mutation adds;
 *  - what still cannot load, and that the player names it and links to why;
 *  - what the recorded page still cannot do: run script, connect, or load
 *    a frame or media;
 *  - which referrer each of its requests carries;
 *  - Mask all text, whose replay loads none of the page's images;
 *  - a seek back, which rebuilds the page in a new Replayer that fails the
 *    same addresses again, without their being counted twice.
 *
 * Each test tags the recorded addresses with its own &run= token and reads
 * back only its own requests, and every wait is on state - the phase word,
 * element state, the server's log, the console - never on a sleep.
 */

const artifacts: string = path.resolve(
  __dirname,
  "../../../output/playwright/session-replay-ui",
);
const applicationRoute: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/rum/20000000-0000-4000-8000-000000000001";
const sessionId: string = "a".repeat(32);
const playerRoute: string = `${applicationRoute}/session-replay/${sessionId}`;
const stageIframeSelector: string = '[data-testid="replay-stage"] iframe';
/*
 * Where every "didn't load" surface links: REPLAY_ASSET_FAILURE_DOCS_PATH
 * and REPLAY_ASSET_FAILURE_DOCS_ANCHOR in ReplayRecordedAssets.ts, under
 * whatever the docs root is.
 */
const FAILURE_DOCS_PATTERN: RegExp =
  /\/rum\/session-replay-troubleshooting#images-icons-or-styles-are-missing-in-the-replay$/;
const CLOCK_PATTERN: RegExp = /(\d+):(\d+(?:\.\d+)?)\s*\//;

/* One request Fixture/server.js answered, from /__fixture/asset-log. */
interface LoggedRequest {
  /* "asset": the recorded site. "dashboard": the connect probe. */
  origin: string;
  path: string;
  query: string;
  run: string | null;
  from: string | null;
  referer: string | null;
  secFetchDest: string | null;
  secFetchSite: string | null;
  status: number;
}

interface ImageState {
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
}

/* One test's recorded site, as the page it opened sees it. */
interface RecordedSite {
  run: string;
  /* The page's origin: the Dashboard's, and so the replay document's. */
  dashboardOrigin: string;
  assetOrigin: string;
}

const replayFrame: (page: Page) => FrameLocator = (
  page: Page,
): FrameLocator => {
  return page.frameLocator(stageIframeSelector);
};

const phase: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("replay-phase");
};

/* A token no other test, repeat or retry shares. */
const uniqueRun: (label: string) => string = (label: string): string => {
  return `${label}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
};

/* The address Fixture.js records for a file on the recorded site. */
const assetUrl: (site: RecordedSite, name: string) => string = (
  site: RecordedSite,
  name: string,
): string => {
  return `${site.assetOrigin}/replay-assets/${name}?run=${site.run}`;
};

/* Every console message from now on, the replay document's included. */
const watchConsole: (page: Page) => Array<string> = (
  page: Page,
): Array<string> => {
  const messages: Array<string> = [];

  page.on("console", (message: ConsoleMessage): void => {
    messages.push(message.text());
  });

  return messages;
};

const hasConsoleMessage: (
  messages: Array<string>,
  matches: (message: string) => boolean,
) => Promise<void> = async (
  messages: Array<string>,
  matches: (message: string) => boolean,
): Promise<void> => {
  await expect
    .poll((): boolean => {
      return messages.some(matches);
    })
    .toBe(true);
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

const clockSeconds: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  const text: string = await page.getByTestId("replay-time").innerText();
  const match: RegExpMatchArray | null = text.match(CLOCK_PATTERN);

  if (!match) {
    throw new Error(`Unreadable replay clock: ${text}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
};

/*
 * Opens the player on ?assets=site with a fresh run token and waits for the
 * replay to be drawing the recorded page.
 */
const openRecordedSite: (
  page: Page,
  label: string,
  query?: string,
) => Promise<RecordedSite> = async (
  page: Page,
  label: string,
  query: string = "",
): Promise<RecordedSite> => {
  const run: string = uniqueRun(label);

  await page.goto(`${playerRoute}?assets=site&run=${run}${query}`);
  await expect(phase(page)).toHaveText("playing", { timeout: 30000 });
  await expect(
    replayFrame(page).getByText("Complete your order"),
  ).toBeVisible();

  const origins: { dashboard: string; asset: string } = await page.evaluate(
    (): { dashboard: string; asset: string } => {
      return {
        dashboard: window.location.origin,
        asset: (window as unknown as { __sessionReplayAssetOrigin: string })
          .__sessionReplayAssetOrigin,
      };
    },
  );

  return {
    run: run,
    dashboardOrigin: origins.dashboard,
    assetOrigin: origins.asset,
  };
};

/*
 * The server writes an entry before it answers, so anything the page has
 * finished loading - or failing to - is already in the log.
 */
const readLog: (
  request: APIRequestContext,
  site: RecordedSite,
) => Promise<Array<LoggedRequest>> = async (
  request: APIRequestContext,
  site: RecordedSite,
): Promise<Array<LoggedRequest>> => {
  const response: APIResponse = await request.get(
    `/__fixture/asset-log?run=${site.run}`,
  );

  expect(response.ok()).toBe(true);

  return (await response.json()) as Array<LoggedRequest>;
};

/* Every path the recorded site was asked for, once each, sorted. */
const requestedPaths: (
  request: APIRequestContext,
  site: RecordedSite,
) => Promise<Array<string>> = async (
  request: APIRequestContext,
  site: RecordedSite,
): Promise<Array<string>> => {
  const paths: Set<string> = new Set<string>();

  for (const entry of await readLog(request, site)) {
    if (entry.origin === "asset") {
      paths.add(entry.path);
    }
  }

  return Array.from(paths).sort();
};

const requestsFor: (
  log: Array<LoggedRequest>,
  requestedPath: string,
) => Array<LoggedRequest> = (
  log: Array<LoggedRequest>,
  requestedPath: string,
): Array<LoggedRequest> => {
  return log.filter((entry: LoggedRequest): boolean => {
    return entry.path === requestedPath;
  });
};

const describeRequest: (entry: LoggedRequest) => string = (
  entry: LoggedRequest,
): string => {
  return `${entry.path} <- ${entry.referer ?? "(no referer)"}`;
};

const imageState: (
  frame: FrameLocator,
  id: string,
) => Promise<ImageState> = async (
  frame: FrameLocator,
  id: string,
): Promise<ImageState> => {
  return frame
    .locator(`#${id}`)
    .evaluate((image: HTMLImageElement): ImageState => {
      return {
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      };
    });
};

/*
 * An image that finished: at its natural size when it loaded, 0 x 0 when it
 * failed or was refused. complete alone is true for all three.
 */
const expectImage: (
  frame: FrameLocator,
  id: string,
  naturalWidth: number,
  naturalHeight: number,
) => Promise<void> = async (
  frame: FrameLocator,
  id: string,
  naturalWidth: number,
  naturalHeight: number,
): Promise<void> => {
  await expect
    .poll(
      async (): Promise<ImageState> => {
        return imageState(frame, id);
      },
      { message: `#${id}` },
    )
    .toEqual({
      complete: true,
      naturalWidth: naturalWidth,
      naturalHeight: naturalHeight,
    });
};

/* "loaded" or "error" once the replay document has tried the face. */
const expectFont: (
  frame: FrameLocator,
  family: string,
  status: string,
) => Promise<void> = async (
  frame: FrameLocator,
  family: string,
  status: string,
): Promise<void> => {
  await expect
    .poll(
      async (): Promise<string> => {
        return frame
          .locator("html")
          .evaluate((root: HTMLElement, name: string): string => {
            const face: FontFace | undefined = Array.from(
              root.ownerDocument.fonts,
            ).find((candidate: FontFace): boolean => {
              return candidate.family.replace(/["']/g, "") === name;
            });

            return face ? face.status : "absent";
          }, family);
      },
      { message: `the ${family} web font` },
    )
    .toBe(status);
};

/* Session details, on its Fidelity tab. */
const openFidelityDetails: (page: Page) => Promise<Locator> = async (
  page: Page,
): Promise<Locator> => {
  await page
    .getByRole("button", { name: "Session details", exact: true })
    .click();

  const dialog: Locator = page.getByRole("dialog", {
    name: "Session details",
  });

  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: /Fidelity/ }).click();

  return dialog;
};

/* The addresses the Missing assets section lists, sorted. */
const listedMissingAssets: (page: Page) => Promise<Array<string>> = async (
  page: Page,
): Promise<Array<string>> => {
  const section: Locator = page.getByTestId("details-section-missing-assets");

  if ((await section.count()) === 0) {
    return [];
  }

  const addresses: Array<string> = await section
    .locator("div[title]")
    .evaluateAll((rows: Array<Element>): Array<string> => {
      return rows.map((row: Element): string => {
        return row.getAttribute("title") ?? "";
      });
    });

  return addresses.sort();
};

/*
 * Adds an element the recorded page never had to the replay document, as a
 * recorded mutation would, pointing at an address that fails. It turns "and
 * nothing else was reported" into a state to wait for: any failure counted
 * before it is in the report it arrives in.
 */
const addFailingElement: (
  page: Page,
  element: { tagName: "img" | "link"; id: string; url: string },
) => Promise<void> = async (
  page: Page,
  element: { tagName: "img" | "link"; id: string; url: string },
): Promise<void> => {
  await replayFrame(page)
    .locator("body")
    .evaluate(
      (
        body: HTMLElement,
        added: { tagName: "img" | "link"; id: string; url: string },
      ): void => {
        const doc: Document = body.ownerDocument;

        if (added.tagName === "link") {
          const link: HTMLLinkElement = doc.createElement("link");

          link.id = added.id;
          link.rel = "stylesheet";
          link.href = added.url;
          doc.head.appendChild(link);
          return;
        }

        const image: HTMLImageElement = doc.createElement("img");

        image.id = added.id;
        image.alt = "probe";
        image.src = added.url;
        body.appendChild(image);
      },
      element,
    );
};

/* ---- What the replay loads. ---- */

test("the replay loads the recorded page's images, the stylesheet the recorder could not inline and its web fonts", async ({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}) => {
  const site: RecordedSite = await openRecordedSite(page, "loads");
  const frame: FrameLocator = replayFrame(page);

  /* #4119's picture: the header logo, and the banner's web and close icons. */
  await expectImage(frame, "fixture-asset-logo", 120, 32);
  await expectImage(frame, "fixture-asset-web", 16, 16);
  await expectImage(frame, "fixture-asset-close", 16, 16);

  /*
   * The stylesheet on the recorded site applies: the offline banner it
   * hides stays hidden, and the nav has the colour it gives it.
   */
  await expect(frame.locator("#fixture-offline-banner")).toBeHidden();
  await expect(frame.locator("#fixture-asset-nav")).toHaveCSS(
    "color",
    "rgb(1, 2, 3)",
  );

  /* An image the page added after the rebuild, by an incremental mutation. */
  await expect(frame.locator("#fixture-asset-late")).toBeAttached({
    timeout: 15000,
  });
  await expectImage(frame, "fixture-asset-late", 30, 30);

  /* A data: image drew before the fix too, and still does. */
  await expectImage(frame, "fixture-asset-data", 20, 20);

  /* Web fonts served with CORS: the stylesheet's, and the recorded <style>'s. */
  await expectFont(frame, "FixtureCorsFont", "loaded");
  await expectFont(frame, "FixtureInlineFont", "loaded");

  /* Every one of them came from the recorded site. */
  await expect
    .poll(async (): Promise<Array<string>> => {
      return requestedPaths(request, site);
    })
    .toEqual(
      expect.arrayContaining([
        "/replay-assets/background.svg",
        "/replay-assets/close.svg",
        "/replay-assets/font-cors.woff2",
        "/replay-assets/font-inline.woff2",
        "/replay-assets/inline-style-bg.svg",
        "/replay-assets/late.svg",
        "/replay-assets/logo.svg",
        "/replay-assets/site.css",
        "/replay-assets/web.svg",
      ]),
    );

  await page.getByTestId("replay-play-pause").click();
  await expect(phase(page)).toHaveText("paused");
  await screenshot(page, "session-replay-recorded-assets");
});

/* ---- What still cannot load, and what the player says about it. ---- */

test("what the recorded site will not serve stays missing, and the player names it and links to why", async ({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}) => {
  const site: RecordedSite = await openRecordedSite(page, "refused");
  const frame: FrameLocator = replayFrame(page);

  /* An image that 404s, and one its site serves to itself only (CORP). */
  await expectImage(frame, "fixture-asset-missing", 0, 0);
  await expectImage(frame, "fixture-asset-corp", 0, 0);
  /* A web font its site serves without CORS. */
  await expectFont(frame, "FixturePortalFont", "error");

  /* Each was asked for: the site answered, and the browser would not use it. */
  const log: Array<LoggedRequest> = await readLog(request, site);

  for (const [requestedPath, status] of [
    ["/replay-assets/missing.svg", 404],
    ["/replay-assets/corp.svg", 200],
    ["/replay-assets/font-portal.woff2", 200],
  ] as Array<[string, number]>) {
    expect(
      requestsFor(log, requestedPath).map((entry: LoggedRequest): number => {
        return entry.status;
      }),
      requestedPath,
    ).toContain(status);
  }

  /*
   * The capture notes lead with them, by count and by site. A font is not
   * among them: nothing on the page fails when a font does.
   */
  const notes: Locator = page.getByTestId("replay-capture-notes");
  const summary: Locator = page.getByTestId("replay-capture-notes-summary");

  await expect(summary).toHaveText(
    "1 capture note: 2 images didn't load in this replay",
  );
  await summary.click();

  const note: Locator = notes.getByTestId("replay-capture-note-assets");

  await expect(note).toBeVisible();
  await expect(note).toContainText("2 images didn't load in this replay");
  await expect(note).toContainText(
    `These, from ${new URL(site.assetOrigin).host}, did not load in your browser`,
  );

  const docs: Locator = note.getByTestId("replay-capture-note-assets-docs");

  await expect(docs).toHaveAttribute("href", FAILURE_DOCS_PATTERN);
  await expect(docs).toHaveAttribute("target", "_blank");
  /* A Mask inputs recording loads its images: nothing says they are off. */
  await expect(notes.getByTestId("replay-capture-note-images-off")).toHaveCount(
    0,
  );

  /* Details > Fidelity lists each address that failed - and none that loaded. */
  const dialog: Locator = await openFidelityDetails(page);

  await expect
    .poll(async (): Promise<Array<string>> => {
      return listedMissingAssets(page);
    })
    .toEqual([assetUrl(site, "corp.svg"), assetUrl(site, "missing.svg")]);
  await expect(
    page.getByTestId("replay-details-missing-assets-docs"),
  ).toHaveAttribute("href", FAILURE_DOCS_PATTERN);
  /* The tab counts them: this recording has no gaps or notices of its own. */
  await expect(
    dialog
      .getByRole("tab", { name: /Fidelity/ })
      .locator("span")
      .first(),
  ).toHaveText("2");
});

test("a recording that loads nothing from its site has no asset notes, and a React Native one is never told its images are off", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(playerRoute);
  await expect(phase(page)).toHaveText("playing", { timeout: 30000 });

  /* Played past the rebuild and on through incremental frames. */
  const step: Locator = replayFrame(page).locator("#fixture-stage-step");

  await expect(step).toBeVisible();

  const firstFrame: string = await step.innerText();

  await expect(step).not.toHaveText(firstFrame, { timeout: 10000 });
  await expect(page.getByTestId("replay-capture-note-assets")).toHaveCount(0);
  await expect(page.getByTestId("replay-capture-note-images-off")).toHaveCount(
    0,
  );

  /*
   * A React Native recording is made under Mask all text, but it carries no
   * image address to load. Its own capture notes are listed, so the list has
   * been drawn - without either note.
   */
  await page.goto(`${playerRoute}?recorder=mobile`);
  await expect(phase(page)).toHaveText("playing", { timeout: 30000 });
  await expect(
    replayFrame(page).locator('[data-oneuptime-mobile-view="view"]').first(),
  ).toBeVisible();

  const notes: Locator = page.getByTestId("replay-capture-notes");

  await expect(notes).toBeVisible();
  await expect(notes.getByTestId("replay-capture-note-images-off")).toHaveCount(
    0,
  );
  await expect(notes.getByTestId("replay-capture-note-assets")).toHaveCount(0);
});

/* ---- What the recorded page still cannot do. ---- */

test("the recorded page still runs nothing, connects nowhere and loads no frame or media", async ({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}) => {
  const consoleMessages: Array<string> = watchConsole(page);
  const site: RecordedSite = await openRecordedSite(page, "inert");
  const frame: FrameLocator = replayFrame(page);

  /*
   * rrweb keeps an onerror attribute as it was recorded (it renames only
   * onload, onclick and onmouse*). The 404 image has failed, so its handler
   * was tried - and the sandbox refused it. It would have set a flag on this
   * window and sent a beacon to the recorded site.
   */
  await expectImage(frame, "fixture-asset-missing", 0, 0);
  await hasConsoleMessage(consoleMessages, (message: string): boolean => {
    return message.includes("sandboxed") && message.includes("allow-scripts");
  });
  expect(
    await page.evaluate((): unknown => {
      return (window as unknown as { __replayAssetScript?: unknown })
        .__replayAssetScript;
    }),
  ).toBeUndefined();
  /* The recorded <script> was rebuilt as an inert <noscript>. */
  await expect(frame.locator("#fixture-asset-strip noscript")).toHaveCount(1);
  await expect(frame.locator("script")).toHaveCount(0);

  /*
   * Connecting. The page's own policy (connect-src 'self', which the replay
   * iframe inherits) allows this origin, so only the replay's connect-src
   * 'none' can refuse the fetch from the replay document; the same fetch
   * from the Dashboard's window goes through.
   */
  const probeUrl: string = `${site.dashboardOrigin}/__fixture/connect-probe?run=${site.run}`;

  expect(
    await frame
      .locator("html")
      .evaluate(async (_root: HTMLElement, url: string): Promise<string> => {
        try {
          await fetch(url);
          return "sent";
        } catch {
          return "refused";
        }
      }, `${probeUrl}&from=replay`),
  ).toBe("refused");
  expect(
    await page.evaluate(async (url: string): Promise<number> => {
      return (await fetch(url)).status;
    }, `${probeUrl}&from=dashboard`),
  ).toBe(200);
  await hasConsoleMessage(consoleMessages, (message: string): boolean => {
    return (
      message.includes("connect-probe") &&
      message.includes("connect-src 'none'")
    );
  });

  /* The <audio> and the <iframe>: the browser tried, the policy refused. */
  await hasConsoleMessage(consoleMessages, (message: string): boolean => {
    return message.includes("clip.mp3") && message.includes("media-src 'none'");
  });
  await hasConsoleMessage(consoleMessages, (message: string): boolean => {
    return message.startsWith("Framing") && message.includes(site.assetOrigin);
  });

  /*
   * So the recorded site never heard of them, nor of the beacon, and the
   * probe arrived from the Dashboard's window only.
   */
  const log: Array<LoggedRequest> = await readLog(request, site);

  expect(
    log
      .filter((entry: LoggedRequest): boolean => {
        return [
          "/replay-assets/beacon.gif",
          "/replay-assets/clip.mp3",
          "/replay-assets/frame.html",
        ].includes(entry.path);
      })
      .map(describeRequest),
  ).toEqual([]);
  expect(
    requestsFor(log, "/__fixture/connect-probe").map(
      (entry: LoggedRequest): string | null => {
        return entry.from;
      },
    ),
  ).toEqual(["dashboard"]);
});

test("no request the replay makes carries the player's address, and the page's own elements send no referrer", async ({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}) => {
  const site: RecordedSite = await openRecordedSite(page, "referrer");
  const frame: FrameLocator = replayFrame(page);
  /* Requested by an element of the page: <img> and <link>. */
  const elementRequests: Array<string> = [
    "/replay-assets/close.svg",
    "/replay-assets/corp.svg",
    "/replay-assets/late.svg",
    "/replay-assets/logo.svg",
    "/replay-assets/missing.svg",
    "/replay-assets/site.css",
    "/replay-assets/web.svg",
  ];
  /* Requested by CSS the recording inlined: a style attribute, a <style>. */
  const inlinedCssRequests: Array<string> = [
    "/replay-assets/background.svg",
    "/replay-assets/font-inline.woff2",
    "/replay-assets/inline-style-bg.svg",
  ];
  /* Requested by the stylesheet the replay loaded from the recorded site. */
  const stylesheetRequests: Array<string> = [
    "/replay-assets/font-cors.woff2",
    "/replay-assets/font-portal.woff2",
  ];

  await expect(frame.locator("#fixture-asset-late")).toBeAttached({
    timeout: 15000,
  });
  await expectImage(frame, "fixture-asset-late", 30, 30);
  await expectFont(frame, "FixtureCorsFont", "loaded");
  await expectFont(frame, "FixturePortalFont", "error");
  await expectFont(frame, "FixtureInlineFont", "loaded");
  await expect
    .poll(async (): Promise<Array<string>> => {
      return requestedPaths(request, site);
    })
    .toEqual(
      expect.arrayContaining([
        ...elementRequests,
        ...inlinedCssRequests,
        ...stylesheetRequests,
      ]),
    );

  const log: Array<LoggedRequest> = (await readLog(request, site)).filter(
    (entry: LoggedRequest): boolean => {
      return entry.origin === "asset";
    },
  );

  /* Nothing carries the player's path, or the session id in it. */
  expect(
    log
      .filter((entry: LoggedRequest): boolean => {
        const referer: string = entry.referer ?? "";

        return referer.includes("/dashboard/") || referer.includes(sessionId);
      })
      .map(describeRequest),
  ).toEqual([]);

  /* The page's own <img> and <link> requests carry no Referer at all. */
  expect(
    log
      .filter((entry: LoggedRequest): boolean => {
        return elementRequests.includes(entry.path) && entry.referer !== null;
      })
      .map(describeRequest),
  ).toEqual([]);

  /*
   * CSS the recording inlined carries the Dashboard's origin at most: after
   * rrweb's document.open(), Chromium no longer applies the replay
   * document's no-referrer to the fetches CSS makes.
   */
  expect(
    log
      .filter((entry: LoggedRequest): boolean => {
        return (
          inlinedCssRequests.includes(entry.path) &&
          entry.referer !== null &&
          entry.referer !== `${site.dashboardOrigin}/`
        );
      })
      .map(describeRequest),
  ).toEqual([]);

  /*
   * A stylesheet loaded from its own address sends that address for what it
   * loads, as it does on the recorded site.
   */
  expect(
    log
      .filter((entry: LoggedRequest): boolean => {
        return (
          stylesheetRequests.includes(entry.path) &&
          entry.referer !== null &&
          entry.referer !== assetUrl(site, "site.css")
        );
      })
      .map(describeRequest),
  ).toEqual([]);
});

/* ---- Mask all text. ---- */

test("a Mask all text recording loads none of the page's images, keeps its stylesheet and fonts, and says why", async ({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}) => {
  const consoleMessages: Array<string> = watchConsole(page);
  const site: RecordedSite = await openRecordedSite(
    page,
    "masked",
    "&masking=all",
  );
  const frame: FrameLocator = replayFrame(page);

  /* The page's chrome still loads: its stylesheet, and its web fonts. */
  await expect(frame.locator("#fixture-offline-banner")).toBeHidden();
  await expect(frame.locator("#fixture-asset-nav")).toHaveCSS(
    "color",
    "rgb(1, 2, 3)",
  );
  await expectFont(frame, "FixtureCorsFont", "loaded");

  /* No recorded image does, the later one included; a data: image draws. */
  await expect(frame.locator("#fixture-asset-late")).toBeAttached({
    timeout: 15000,
  });

  for (const id of [
    "fixture-asset-logo",
    "fixture-asset-web",
    "fixture-asset-close",
    "fixture-asset-missing",
    "fixture-asset-corp",
    "fixture-asset-late",
  ]) {
    await expectImage(frame, id, 0, 0);
  }

  await expectImage(frame, "fixture-asset-data", 20, 20);

  /* The replay's policy refused them, so the recorded site never saw one. */
  await hasConsoleMessage(consoleMessages, (message: string): boolean => {
    return (
      message.includes(assetUrl(site, "late.svg")) &&
      message.includes('"img-src data: blob:"')
    );
  });

  const paths: Array<string> = await requestedPaths(request, site);

  expect(paths).toContain("/replay-assets/site.css");
  expect(
    paths.filter((requestedPath: string): boolean => {
      return requestedPath.endsWith(".svg");
    }),
  ).toEqual([]);

  /* The player says why the page has no images... */
  const summary: Locator = page.getByTestId("replay-capture-notes-summary");

  await expect(summary).toHaveText("1 capture note: images are not loaded");
  await summary.click();

  const imagesOff: Locator = page.getByTestId("replay-capture-note-images-off");

  await expect(imagesOff).toBeVisible();
  await expect(imagesOff).toContainText("Images are not loaded");
  await expect(imagesOff).toContainText("recorded under Mask all text");

  /*
   * ...and reports none of the refused images as a failure. A stylesheet
   * that fails now is reported, and alone: every refusal came before it.
   */
  await addFailingElement(page, {
    tagName: "link",
    id: "e2e-missing-stylesheet",
    url: assetUrl(site, "missing.css"),
  });
  await expect(summary).toHaveText(
    "2 capture notes: 1 stylesheet didn't load in this replay, images are not loaded",
  );
  await openFidelityDetails(page);
  await expect
    .poll(async (): Promise<Array<string>> => {
      return listedMissingAssets(page);
    })
    .toEqual([assetUrl(site, "missing.css")]);
});

/* ---- A seek back. ---- */

test("seeking back rebuilds the page in a new Replayer, and what fails again is not counted twice", async ({
  page,
  request,
}: {
  page: Page;
  request: APIRequestContext;
}) => {
  /* 0:40 plays from the second chunk's snapshot, in a Replayer of its own. */
  const site: RecordedSite = await openRecordedSite(page, "seek", "&t=40");
  const frame: FrameLocator = replayFrame(page);
  const summary: Locator = page.getByTestId("replay-capture-notes-summary");
  const missingPath: string = "/replay-assets/missing.svg";

  await expect(summary).toHaveText(
    "1 capture note: 2 images didn't load in this replay",
  );

  const asksBeforeSeek: number = requestsFor(
    await readLog(request, site),
    missingPath,
  ).length;

  /*
   * Home goes back to the first chunk, which the engine rebuilds in a new
   * Replayer - a new iframe, replacing the one marked here.
   */
  await page
    .locator(stageIframeSelector)
    .evaluateAll((iframes: Array<Element>): void => {
      for (const iframe of iframes) {
        iframe.setAttribute("data-e2e-replayer", "before-seek");
      }
    });
  await blurFocus(page);
  await page.keyboard.press("Home");
  await expect
    .poll(async (): Promise<Array<string | null>> => {
      return page
        .locator(stageIframeSelector)
        .evaluateAll((iframes: Array<Element>): Array<string | null> => {
          return iframes.map((iframe: Element): string | null => {
            return iframe.getAttribute("data-e2e-replayer");
          });
        });
    })
    .toEqual([null]);
  await expect
    .poll(async (): Promise<number> => {
      return clockSeconds(page);
    })
    .toBeLessThan(30);

  /* Its rebuild asked for the same images again, and they failed again. */
  await expect
    .poll(async (): Promise<number> => {
      return requestsFor(await readLog(request, site), missingPath).length;
    })
    .toBeGreaterThan(asksBeforeSeek);
  await expectImage(frame, "fixture-asset-missing", 0, 0);
  await expectImage(frame, "fixture-asset-corp", 0, 0);

  /*
   * A new address that fails now is reported beside the first two and
   * nothing else: had the rebuild's failures been counted again, they would
   * be in the same report.
   */
  await addFailingElement(page, {
    tagName: "img",
    id: "e2e-missing-image",
    url: assetUrl(site, "probe-missing.svg"),
  });
  await expectImage(frame, "e2e-missing-image", 0, 0);
  await expect(summary).toHaveText(
    "1 capture note: 3 images didn't load in this replay",
  );
  await openFidelityDetails(page);
  await expect
    .poll(async (): Promise<Array<string>> => {
      return listedMissingAssets(page);
    })
    .toEqual([
      assetUrl(site, "corp.svg"),
      assetUrl(site, "missing.svg"),
      assetUrl(site, "probe-missing.svg"),
    ]);
});
