import { describe, expect, it } from "@jest/globals";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import slugify from "../../../Server/Types/MarkdownSlugify";
import {
  REPLAY_ASSET_FAILURE_DOCS_ANCHOR,
  REPLAY_ASSET_FAILURE_DOCS_PATH,
  REPLAY_RECORDED_REFERRER_META_ATTRIBUTE,
  RecordedPageAddress,
  ReplayAssetFailure,
  ReplayAssetFailureSummary,
  ReplayPlaybackAssetNote,
  buildReplayPlaybackAssetNotes,
  describeReplayAssetFailureTarget,
  formatReplayAssetFailureDescription,
  formatReplayAssetFailureHosts,
  formatReplayAssetFailureTitle,
  getReplayAssetFailureDocsHref,
  isMaskedReplay,
  prepareRecordedEventsForPlayback,
  summarizeReplayAssetFailures,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayRecordedAssets";

/*
 * What the replay does with the recorded page's own images, stylesheets and
 * fonts, from github.com/OneUptime/oneuptime/issues/4119: a Power Pages
 * recording played back with every image broken and a hidden "You're
 * offline" banner on show, because the player refused to load any of them -
 * and nothing on screen said why.
 *
 * The recorder keeps addresses, not files, so the replay has to fetch them
 * while it plays; what cannot be fetched must be named; a recording made
 * under Mask all text must stay the wireframe that mode promises; and what
 * the recorded page itself says about referrers, relative addresses and
 * tracking pixels must not make the replay request more than the page's
 * assets.
 */

const WEB_RECORDER: string = "dom";
const DOCS_ROOT: string = "https://oneuptime.example/docs";
const PAGE: string = "https://shop.example.com/checkout";

function failure(
  kind: "image" | "stylesheet",
  url: string,
): ReplayAssetFailure {
  return { kind: kind, url: url, host: new URL(url).host };
}

function summary(
  overrides: Partial<ReplayAssetFailureSummary>,
): ReplayAssetFailureSummary {
  return {
    images: 0,
    stylesheets: 0,
    hosts: ["a.example"],
    isTruncated: false,
    ...overrides,
  };
}

function image(attributes: Record<string, string>): HTMLImageElement {
  const element: HTMLImageElement = document.createElement("img");

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  return element;
}

function link(rel: string, href: string): HTMLLinkElement {
  const element: HTMLLinkElement = document.createElement("link");

  element.setAttribute("rel", rel);
  element.setAttribute("href", href);

  return element;
}

/* ---- rrweb's recorded shapes, as the recorder emits them. ---- */

interface RecordedElement {
  type: 2;
  id: number;
  tagName: string;
  attributes: Record<string, unknown>;
  childNodes: Array<unknown>;
}

interface RecordedEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

let nextId: number = 1;

function element(
  tagName: string,
  attributes: Record<string, unknown>,
  childNodes: Array<unknown> = [],
): RecordedElement {
  nextId += 1;

  return {
    type: 2,
    id: nextId,
    tagName: tagName,
    attributes: attributes,
    childNodes: childNodes,
  };
}

function meta(href: string | undefined): RecordedEvent {
  return {
    type: 4,
    timestamp: 1,
    data:
      href === undefined
        ? { width: 1200, height: 760 }
        : { href, width: 1200, height: 760 },
  };
}

function snapshot(head: Array<unknown>, body: Array<unknown>): RecordedEvent {
  return {
    type: 2,
    timestamp: 2,
    data: {
      node: {
        type: 0,
        id: 1,
        childNodes: [
          element("html", {}, [
            element("head", {}, head),
            element("body", {}, body),
          ]),
        ],
      },
      initialOffset: { top: 0, left: 0 },
    },
  };
}

function mutation(data: Record<string, unknown>): RecordedEvent {
  return {
    type: 3,
    timestamp: 3,
    data: {
      source: 0,
      texts: [],
      attributes: [],
      removes: [],
      adds: [],
      ...data,
    },
  };
}

describe("isMaskedReplay", () => {
  it("does not mask the two modes that record readable content", () => {
    expect(
      isMaskedReplay(SessionReplayMaskingMode.MaskSensitiveInputsOnly),
    ).toBe(false);
    expect(isMaskedReplay(SessionReplayMaskingMode.MaskInputsOnly)).toBe(false);
  });

  it("masks a Mask all text recording, whose promise is a wireframe", () => {
    expect(isMaskedReplay(SessionReplayMaskingMode.MaskAllText)).toBe(true);
  });

  it.each([[""], [null], [undefined], ["maskinputsonly"], ["MaskEverything"]])(
    "fails closed - as Mask all text - for the absent or unknown mode %p",
    (mode: string | null | undefined) => {
      expect(isMaskedReplay(mode)).toBe(true);
    },
  );
});

describe("describeReplayAssetFailureTarget", () => {
  it("names a failed image by its absolute address and host", () => {
    expect(
      describeReplayAssetFailureTarget(
        image({ src: "https://wbdynprod.powerappsportals.com/logo.png" }),
        true,
      ),
    ).toEqual({
      kind: "image",
      url: "https://wbdynprod.powerappsportals.com/logo.png",
      host: "wbdynprod.powerappsportals.com",
    });
  });

  it("keeps a port, and counts plain-http images as well as https ones", () => {
    expect(
      describeReplayAssetFailureTarget(
        image({ src: "http://intranet.example:8080/img/web.png" }),
        true,
      ),
    ).toEqual({
      kind: "image",
      url: "http://intranet.example:8080/img/web.png",
      host: "intranet.example:8080",
    });
  });

  it("prefers the candidate srcset picked over the plain src", () => {
    const element: HTMLImageElement = image({
      src: "https://cdn.example/small.png",
    });

    Object.defineProperty(element, "currentSrc", {
      configurable: true,
      value: "https://cdn.example/large.png",
    });

    expect(describeReplayAssetFailureTarget(element, true)?.url).toBe(
      "https://cdn.example/large.png",
    );
  });

  it("ignores data: and blob: images, which no site owner can fix", () => {
    expect(
      describeReplayAssetFailureTarget(
        image({ src: "data:image/png;base64,AAAA" }),
        true,
      ),
    ).toBeNull();
    expect(
      describeReplayAssetFailureTarget(
        image({ src: "blob:https://site.example/2d0c8f1e" }),
        true,
      ),
    ).toBeNull();
    expect(describeReplayAssetFailureTarget(image({}), true)).toBeNull();
  });

  it.each([[""], ["   "]])(
    "ignores an image whose src is %p: no request was made, and the reflected src is the replay page itself",
    (source: string) => {
      /*
       * An empty src fails at once, without a request; its reflected src
       * resolves "" to the document's own address - in a replay, the
       * Dashboard's player page.
       */
      expect(
        describeReplayAssetFailureTarget(image({ src: source }), true),
      ).toBeNull();
    },
  );

  it("never reports the replay document's own address as a recorded asset", () => {
    const player: string =
      "https://oneuptime.example/dashboard/p/rum/a/session-replay/s?t=12";
    const iframe: HTMLIFrameElement = document.createElement("iframe");
    document.body.appendChild(iframe);

    const doc: Document = iframe.contentDocument as Document;
    const foreign: HTMLImageElement = doc.createElement("img");

    /*
     * After rrweb's document.open() the replay document's address is the
     * player page (jsdom's iframe stays about:blank, so it is set here).
     */
    Object.defineProperty(doc, "URL", { configurable: true, value: player });
    foreign.setAttribute("src", "#top");
    Object.defineProperty(foreign, "currentSrc", {
      configurable: true,
      value: `${player}#top`,
    });

    expect(describeReplayAssetFailureTarget(foreign, true)).toBeNull();

    iframe.remove();
  });

  it("does not count an image when the replay does not load images at all", () => {
    expect(
      describeReplayAssetFailureTarget(
        image({ src: "https://cdn.example/logo.png" }),
        false,
      ),
    ).toBeNull();
  });

  it.each([["stylesheet"], ["alternate stylesheet"], ["STYLESHEET"]])(
    "names a failed <link rel=%p> as a stylesheet, whatever the images policy",
    (rel: string) => {
      expect(
        describeReplayAssetFailureTarget(
          link(rel, "https://content.powerapps.com/pwa-style.css"),
          false,
        ),
      ).toEqual({
        kind: "stylesheet",
        url: "https://content.powerapps.com/pwa-style.css",
        host: "content.powerapps.com",
      });
    },
  );

  it("ignores a stylesheet link with no address", () => {
    expect(
      describeReplayAssetFailureTarget(link("stylesheet", ""), true),
    ).toBeNull();
  });

  it.each([["preload"], ["icon"], ["prefetch"], [""]])(
    "ignores a <link rel=%p>, which is not a stylesheet",
    (rel: string) => {
      expect(
        describeReplayAssetFailureTarget(
          link(rel, "https://cdn.example/thing.css"),
          true,
        ),
      ).toBeNull();
    },
  );

  it("ignores media, frames, objects and scripts, which the policy refuses on purpose", () => {
    for (const tagName of [
      "video",
      "audio",
      "source",
      "track",
      "iframe",
      "object",
      "embed",
      "script",
      "input",
    ]) {
      const element: HTMLElement = document.createElement(tagName);

      element.setAttribute("src", "https://cdn.example/thing");
      expect(describeReplayAssetFailureTarget(element, true)).toBeNull();
    }
  });

  it("ignores targets that are not elements at all", () => {
    expect(describeReplayAssetFailureTarget(null, true)).toBeNull();
    expect(describeReplayAssetFailureTarget(undefined, true)).toBeNull();
    expect(describeReplayAssetFailureTarget(window, true)).toBeNull();
    expect(
      describeReplayAssetFailureTarget({} as unknown as EventTarget, true),
    ).toBeNull();
  });

  it("recognises an element from another window, where instanceof would fail", () => {
    /*
     * The replay document is an iframe's: its <img> is an instance of THAT
     * window's HTMLImageElement, never of this one's.
     */
    const iframe: HTMLIFrameElement = document.createElement("iframe");
    document.body.appendChild(iframe);

    const foreign: HTMLImageElement = (
      iframe.contentDocument as Document
    ).createElement("img");

    foreign.setAttribute("src", "https://cdn.example/foreign.png");

    expect(foreign instanceof HTMLImageElement).toBe(false);
    expect(describeReplayAssetFailureTarget(foreign, true)?.url).toBe(
      "https://cdn.example/foreign.png",
    );

    iframe.remove();
  });
});

describe("summarizeReplayAssetFailures", () => {
  it("counts each kind and lists distinct hosts in the order they failed", () => {
    expect(
      summarizeReplayAssetFailures([
        failure("image", "https://content.powerapps.com/img/web.png"),
        failure("image", "https://wbdynprod.powerappsportals.com/logo.png"),
        failure("image", "https://content.powerapps.com/img/close.png"),
        failure("stylesheet", "https://content.powerapps.com/pwa-style.css"),
      ]),
    ).toEqual({
      images: 3,
      stylesheets: 1,
      hosts: ["content.powerapps.com", "wbdynprod.powerappsportals.com"],
      isTruncated: false,
    });
  });

  it("is empty for no failures, and carries the truncation it is told", () => {
    expect(summarizeReplayAssetFailures([])).toEqual({
      images: 0,
      stylesheets: 0,
      hosts: [],
      isTruncated: false,
    });
    expect(summarizeReplayAssetFailures([], true).isTruncated).toBe(true);
  });

  it("stays linear for a recording built to fail from thousands of hosts", () => {
    const flood: Array<ReplayAssetFailure> = Array.from(
      { length: 50000 },
      (_: unknown, index: number): ReplayAssetFailure => {
        return {
          kind: "image",
          url: `https://h${index}.attacker.example/x.png`,
          host: `h${index}.attacker.example`,
        };
      },
    );
    const started: number = Date.now();
    const result: ReplayAssetFailureSummary =
      summarizeReplayAssetFailures(flood);

    expect(result.hosts).toHaveLength(50000);
    /* A quadratic scan of 50,000 hosts takes seconds; a Set, milliseconds. */
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("formatReplayAssetFailureTitle", () => {
  it.each([
    [1, 0, "1 image didn't load in this replay"],
    [3, 0, "3 images didn't load in this replay"],
    [0, 1, "1 stylesheet didn't load in this replay"],
    [0, 2, "2 stylesheets didn't load in this replay"],
    [2, 1, "2 images and 1 stylesheet didn't load in this replay"],
  ])(
    "%p images and %p stylesheets read %p",
    (images: number, stylesheets: number, title: string) => {
      expect(
        formatReplayAssetFailureTitle(
          summary({ images: images, stylesheets: stylesheets }),
        ),
      ).toBe(title);
    },
  );

  it("says 'at least' once the list was cut short", () => {
    expect(
      formatReplayAssetFailureTitle(
        summary({ images: 190, stylesheets: 10, isTruncated: true }),
      ),
    ).toBe("At least 190 images and 10 stylesheets didn't load in this replay");
  });
});

describe("formatReplayAssetFailureHosts", () => {
  it.each([
    [[], ""],
    [["a.example"], "a.example"],
    [["a.example", "b.example"], "a.example and b.example"],
    [
      ["a.example", "b.example", "c.example"],
      "a.example, b.example and c.example",
    ],
    [
      ["a.example", "b.example", "c.example", "d.example"],
      "a.example, b.example, c.example and 1 other site",
    ],
    [
      ["a.example", "b.example", "c.example", "d.example", "e.example"],
      "a.example, b.example, c.example and 2 other sites",
    ],
  ])("%p reads %p", (hosts: Array<string>, text: string) => {
    expect(formatReplayAssetFailureHosts(hosts)).toBe(text);
  });
});

describe("formatReplayAssetFailureDescription", () => {
  it("explains, for one image, why it is fetched now and what can stop it", () => {
    const text: string = formatReplayAssetFailureDescription(
      summary({ images: 1, hosts: ["wbdynprod.powerappsportals.com"] }),
    );

    expect(text).toContain(
      "Recordings keep each image's address rather than the file itself, so the replay loads images from the recorded site while you watch.",
    );
    expect(text).toContain(
      "This one, from wbdynprod.powerappsportals.com, did not load in your browser",
    );
    expect(text).toContain("it may need the user's sign-in");
    expect(text).toContain("refuse to serve it to other sites");
    expect(text).toContain("a signed link may have expired");
    expect(text).toContain("the file is gone");
    /* The viewer's own blocker can be the cause, not the recorded site. */
    expect(text).toContain(
      "or something in your browser, such as an ad or tracker blocker, refused it",
    );
    /* It may have been fine for the user: never claim they saw it broken. */
    expect(text).toContain("The user may still have seen it.");
  });

  it("speaks in the plural, and names every host, for several", () => {
    const text: string = formatReplayAssetFailureDescription(
      summary({
        images: 2,
        stylesheets: 1,
        hosts: ["content.powerapps.com", "wbdynprod.powerappsportals.com"],
      }),
    );

    expect(text).toContain(
      "Recordings keep the address of each image, and of each stylesheet the recorder could not read",
    );
    expect(text).toContain(
      "These, from content.powerapps.com and wbdynprod.powerappsportals.com, did not load",
    );
    expect(text).toContain("they may need the user's sign-in");
    expect(text).toContain("the files are gone");
    expect(text).toContain("The user may still have seen them.");
  });

  it("does not talk about images when only stylesheets failed", () => {
    /*
     * The case a Mask all text recording can reach, right above a note that
     * says its images are never loaded.
     */
    const one: string = formatReplayAssetFailureDescription(
      summary({ stylesheets: 1, hosts: ["content.powerapps.com"] }),
    );
    const several: string = formatReplayAssetFailureDescription(
      summary({ stylesheets: 2, hosts: ["content.powerapps.com"] }),
    );

    expect(one).toContain(
      "The recorder could not read this stylesheet, so the recording keeps its address",
    );
    expect(several).toContain(
      "The recorder could not read these stylesheets, so the recording keeps their addresses",
    );

    for (const text of [one, several]) {
      expect(text).not.toMatch(/\bimages?\b/);
    }
  });

  it("speaks in the plural once the list was cut short, even for one kind", () => {
    const text: string = formatReplayAssetFailureDescription(
      summary({ images: 200, isTruncated: true }),
    );

    expect(text).toContain("These, from a.example");
    expect(text).toContain("the files are gone");
  });
});

describe("getReplayAssetFailureDocsHref", () => {
  it("links the troubleshooting entry, under the docs root it is given", () => {
    expect(getReplayAssetFailureDocsHref(DOCS_ROOT)).toBe(
      `${DOCS_ROOT}/rum/session-replay-troubleshooting#images-icons-or-styles-are-missing-in-the-replay`,
    );
    expect(REPLAY_ASSET_FAILURE_DOCS_PATH).toBe(
      "/rum/session-replay-troubleshooting",
    );
  });

  it("uses the anchor the docs renderer gives that entry's heading", () => {
    expect(slugify("Images, icons or styles are missing in the replay")).toBe(
      REPLAY_ASSET_FAILURE_DOCS_ANCHOR,
    );
  });
});

describe("buildReplayPlaybackAssetNotes", () => {
  it("says nothing for a readable recording whose assets all loaded", () => {
    expect(
      buildReplayPlaybackAssetNotes({
        failures: [],
        isTruncated: false,
        maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      }),
    ).toEqual([]);
  });

  it("turns the failures into one note that links to the docs", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [
          failure("image", "https://content.powerapps.com/img/web.png"),
          failure("image", "https://content.powerapps.com/img/close.png"),
        ],
        isTruncated: false,
        maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({
      key: "assets-failed",
      testId: "replay-capture-note-assets",
      title: "2 images didn't load in this replay",
      description: expect.stringContaining(
        "These, from content.powerapps.com, did not load in your browser",
      ),
      docsHref: getReplayAssetFailureDocsHref(DOCS_ROOT),
    });
  });

  it("carries the truncation into the note's title", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [failure("image", "https://cdn.example/1.png")],
        isTruncated: true,
        maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
    );

    expect(notes[0]?.title).toBe("At least 1 image didn't load in this replay");
  });

  it("says a Mask all text recording loads no images or web fonts, and that data: images still show", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [],
        isTruncated: false,
        maskingMode: SessionReplayMaskingMode.MaskAllText,
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({
      key: "images-off",
      testId: "replay-capture-note-images-off",
      title: "Images and web fonts are not loaded",
      description: expect.stringContaining(
        "recorded under Mask all text, which plays back as a wireframe",
      ),
      docsHref: null,
    });
    expect(notes[0]?.description).toContain("the player never loads them");
    /* A data: image is inside the recording itself: it shows, and must be said to. */
    expect(notes[0]?.description).toContain(
      "An image the page held as a data: URL is part of the recording itself, and still shows.",
    );
  });

  it("does not call a session whose mode was not reported a wireframe, only says what the player withholds", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [],
        isTruncated: false,
        maskingMode: "",
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]?.key).toBe("images-off");
    expect(notes[0]?.description).toBe(
      "This session's masking mode was not reported, so, to be safe, the player does not load the page's images or web fonts.",
    );
    expect(notes[0]?.description).not.toContain("wireframe");
  });

  it("names a mode it does not recognise rather than claiming Mask all text", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [],
        isTruncated: false,
        maskingMode: "MaskEverything",
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
    );

    expect(notes[0]?.description).toBe(
      "This session's masking mode (MaskEverything) is not one this dashboard recognises, so, to be safe, the player does not load the page's images or web fonts.",
    );
  });

  it("puts the failure note first when a Mask all text stylesheet failed too, and keeps the two consistent", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [
          failure("stylesheet", "https://content.powerapps.com/pwa-style.css"),
        ],
        isTruncated: false,
        maskingMode: SessionReplayMaskingMode.MaskAllText,
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
    );

    expect(
      notes.map((note: ReplayPlaybackAssetNote): string => {
        return note.key;
      }),
    ).toEqual(["assets-failed", "images-off"]);
    expect(notes[0]?.title).toBe("1 stylesheet didn't load in this replay");
    /* The note above "Images ... are not loaded" must not say images load. */
    expect(notes[0]?.description).not.toMatch(/\bimages?\b/);
  });

  it("never tells a React Native recording its images are not loaded", () => {
    /* Its view tree carries no image addresses; every image is a placeholder. */
    expect(
      buildReplayPlaybackAssetNotes({
        failures: [],
        isTruncated: false,
        maskingMode: SessionReplayMaskingMode.MaskAllText,
        recorderKind: "rn-view-tree",
        docsRoot: DOCS_ROOT,
      }),
    ).toEqual([]);
  });
});

describe("prepareRecordedEventsForPlayback", () => {
  /*
   * rrweb rebuilds recorded attributes as they were, and the replay
   * document's address is the Dashboard's player page - so a recorded
   * referrer control would send that address (project, application and
   * session ids) with the page's image requests, a relative poster would
   * be requested from the Dashboard itself, and a tracking pixel would
   * count another sale from the viewer's browser.
   */

  it("removes every recorded referrerpolicy, from the snapshot down to the deepest node", () => {
    const pixel: RecordedElement = element("img", {
      src: "https://tracker.example/sale.png",
      referrerpolicy: "no-referrer-when-downgrade",
    });
    const nested: RecordedElement = element("a", {
      href: "https://shop.example.com/help",
      referrerpolicy: "unsafe-url",
    });
    const sheet: RecordedElement = element("link", {
      rel: "stylesheet",
      href: "https://cdn.example/site.css",
      referrerpolicy: "unsafe-url",
    });
    const events: Array<RecordedEvent> = [
      meta(PAGE),
      snapshot(
        [sheet],
        [element("div", {}, [element("p", {}, [nested])]), pixel],
      ),
    ];

    prepareRecordedEventsForPlayback(events);

    for (const node of [pixel, nested, sheet]) {
      expect(node.attributes).not.toHaveProperty("referrerpolicy");
    }

    /* Nothing else about them changes. */
    expect(pixel.attributes["src"]).toBe("https://tracker.example/sale.png");
    expect(sheet.attributes["href"]).toBe("https://cdn.example/site.css");
  });

  it("removes referrerpolicy from nodes a mutation adds, and from an attribute mutation that sets it", () => {
    const added: RecordedElement = element("img", {
      src: "https://cdn.example/late.png",
      referrerpolicy: "unsafe-url",
    });
    const change: Record<string, unknown> = {
      referrerpolicy: "unsafe-url",
      alt: "logo",
    };
    const events: Array<RecordedEvent> = [
      meta(PAGE),
      mutation({
        adds: [{ parentId: 5, nextId: null, node: added }],
        attributes: [{ id: 9, attributes: change }],
      }),
    ];

    prepareRecordedEventsForPlayback(events);

    expect(added.attributes).not.toHaveProperty("referrerpolicy");
    expect(change).toEqual({ alt: "logo" });
  });

  it.each([["referrer"], ["Referrer"], [" referrer "]])(
    "neutralises a recorded <meta name=%p>, in the snapshot and when a mutation adds one",
    (name: string) => {
      const recorded: RecordedElement = element("meta", {
        name: name,
        content: "unsafe-url",
      });
      const added: RecordedElement = element("meta", {
        name: name,
        content: "unsafe-url",
      });

      prepareRecordedEventsForPlayback([
        meta(PAGE),
        snapshot([recorded], []),
        mutation({ adds: [{ parentId: 3, nextId: null, node: added }] }),
      ]);

      for (const node of [recorded, added]) {
        expect(node.attributes).not.toHaveProperty("name");
        /* Kept under another name, so the replay stays inspectable. */
        expect(node.attributes[REPLAY_RECORDED_REFERRER_META_ATTRIBUTE]).toBe(
          name,
        );
        expect(node.attributes["content"]).toBe("unsafe-url");
      }
    },
  );

  it("leaves every other <meta> alone", () => {
    const description: RecordedElement = element("meta", {
      name: "description",
      content: "Checkout",
    });

    prepareRecordedEventsForPlayback([meta(PAGE), snapshot([description], [])]);

    expect(description.attributes).toEqual({
      name: "description",
      content: "Checkout",
    });
  });

  it("drops an attribute mutation that would turn an element into a referrer <meta>", () => {
    const change: Record<string, unknown> = {
      name: "referrer",
      content: "unsafe-url",
    };

    prepareRecordedEventsForPlayback([
      meta(PAGE),
      mutation({ attributes: [{ id: 4, attributes: change }] }),
    ]);

    expect(change).toEqual({ content: "unsafe-url" });
  });

  it.each([
    ["/media/poster.jpg", "https://shop.example.com/media/poster.jpg"],
    ["poster.jpg", "https://shop.example.com/poster.jpg"],
    ["../img/poster.jpg", "https://shop.example.com/img/poster.jpg"],
  ])(
    "resolves a relative poster %p against the recorded page, never the Dashboard",
    (poster: string, resolved: string) => {
      const video: RecordedElement = element("video", { poster: poster });

      prepareRecordedEventsForPlayback([meta(PAGE), snapshot([], [video])]);

      expect(video.attributes["poster"]).toBe(resolved);
    },
  );

  it.each([
    ["https://cdn.example/poster.jpg"],
    ["//cdn.example/poster.jpg"],
    ["data:image/png;base64,AAAA"],
    ["blob:https://shop.example.com/1"],
  ])("leaves the poster %p as it is", (poster: string) => {
    const video: RecordedElement = element("video", { poster: poster });

    prepareRecordedEventsForPlayback([meta(PAGE), snapshot([], [video])]);

    expect(video.attributes["poster"]).toBe(poster);
  });

  it("resolves the legacy background attribute the same way", () => {
    const body: RecordedElement = element("body", { background: "img/bg.gif" });

    prepareRecordedEventsForPlayback([
      meta("https://shop.example.com/store/"),
      snapshot([], [body]),
    ]);

    expect(body.attributes["background"]).toBe(
      "https://shop.example.com/store/img/bg.gif",
    );
  });

  it("resolves against a recorded <base href> for everything after it", () => {
    const base: RecordedElement = element("base", {
      href: "https://assets.shop.example.com/v2/",
    });
    const video: RecordedElement = element("video", { poster: "poster.jpg" });

    prepareRecordedEventsForPlayback([meta(PAGE), snapshot([base], [video])]);

    expect(video.attributes["poster"]).toBe(
      "https://assets.shop.example.com/v2/poster.jpg",
    );
  });

  it("drops a relative poster it has nothing to resolve against, rather than sending it to the Dashboard", () => {
    const video: RecordedElement = element("video", {
      poster: "/media/poster.jpg",
    });
    const change: Record<string, unknown> = { poster: "/media/next.jpg" };

    /* A chunk whose Meta sits in the previous chunk (an oversized snapshot). */
    prepareRecordedEventsForPlayback([
      snapshot([], [video]),
      mutation({ attributes: [{ id: 12, attributes: change }] }),
    ]);

    expect(video.attributes).not.toHaveProperty("poster");
    /* A mutation's null removes the attribute rather than keeping an old one. */
    expect(change).toEqual({ poster: null });
  });

  it("resolves a relative poster set by a later mutation against the page", () => {
    const change: Record<string, unknown> = { poster: "/media/next.jpg" };

    prepareRecordedEventsForPlayback([
      meta(PAGE),
      mutation({ attributes: [{ id: 12, attributes: change }] }),
    ]);

    expect(change).toEqual({
      poster: "https://shop.example.com/media/next.jpg",
    });
  });

  it("carries the page's address to a later chunk through the context its caller keeps", () => {
    /* Most chunks carry no Meta of their own (see RecordedPageAddress). */
    const context: RecordedPageAddress = { base: null };
    const change: Record<string, unknown> = { poster: "/media/next.jpg" };

    prepareRecordedEventsForPlayback([meta(PAGE), snapshot([], [])], context);
    prepareRecordedEventsForPlayback(
      [mutation({ attributes: [{ id: 12, attributes: change }] })],
      context,
    );

    expect(context.base).toBe(PAGE);
    expect(change).toEqual({
      poster: "https://shop.example.com/media/next.jpg",
    });
  });

  it("follows the page as a later Meta moves it", () => {
    const first: RecordedElement = element("video", { poster: "/a.jpg" });
    const second: RecordedElement = element("video", { poster: "/b.jpg" });

    prepareRecordedEventsForPlayback([
      meta("https://one.example.com/"),
      snapshot([], [first]),
      meta("https://two.example.com/"),
      snapshot([], [second]),
    ]);

    expect(first.attributes["poster"]).toBe("https://one.example.com/a.jpg");
    expect(second.attributes["poster"]).toBe("https://two.example.com/b.jpg");
  });

  it.each([
    [{ width: "1", height: "1" }],
    [{ width: "0", height: "0" }],
    [{ width: "1px", height: "1px" }],
    [{ width: "1", height: "0" }],
  ])(
    "does not request a pixel-sized image %p: a tracking pixel would count another sale",
    (size: Record<string, string>) => {
      const pixel: RecordedElement = element("img", {
        ...size,
        src: "https://www.shareasale.com/sale.cfm?tracking=ORD-1001&amount=129.00",
        srcset: "https://www.shareasale.com/sale.cfm?x=1 1x",
        alt: "",
      });

      prepareRecordedEventsForPlayback([meta(PAGE), snapshot([], [pixel])]);

      expect(pixel.attributes).not.toHaveProperty("src");
      expect(pixel.attributes).not.toHaveProperty("srcset");
      /* Its box stays, so nothing around it moves. */
      expect(pixel.attributes["width"]).toBe(size["width"]);
    },
  );

  it.each([
    [{ width: "2", height: "1" }],
    [{ width: "1" }],
    [{ height: "1" }],
    [{ width: "auto", height: "1" }],
    [{}],
  ])(
    "keeps the image %p, which is not pixel-sized",
    (size: Record<string, string>) => {
      const photo: RecordedElement = element("img", {
        ...size,
        src: "https://cdn.example/photo.jpg",
      });

      prepareRecordedEventsForPlayback([meta(PAGE), snapshot([], [photo])]);

      expect(photo.attributes["src"]).toBe("https://cdn.example/photo.jpg");
    },
  );

  it("does not treat a pixel-sized element that is not an image as a pixel", () => {
    const iframe: RecordedElement = element("iframe", {
      width: "1",
      height: "1",
      src: "https://tracker.example/frame",
    });

    prepareRecordedEventsForPlayback([meta(PAGE), snapshot([], [iframe])]);

    expect(iframe.attributes["src"]).toBe("https://tracker.example/frame");
  });

  it("ignores events it has no business with, and survives malformed ones", () => {
    const custom: RecordedEvent = {
      type: 5,
      timestamp: 4,
      data: {
        tag: "oneuptime.click",
        payload: { referrerpolicy: "unsafe-url" },
      },
    };
    const scroll: RecordedEvent = {
      type: 3,
      timestamp: 5,
      data: { source: 3, id: 7, x: 0, y: 120 },
    };

    expect((): void => {
      prepareRecordedEventsForPlayback([
        custom,
        scroll,
        { type: 2, timestamp: 6, data: null },
        { type: 2, timestamp: 7, data: { node: null } },
        {
          type: 3,
          timestamp: 8,
          data: { source: 0, adds: "nope", attributes: [null, 3] },
        },
        {
          type: 3,
          timestamp: 9,
          data: { source: 0, adds: [null, { node: 5 }] },
        },
        null as unknown as RecordedEvent,
      ]);
    }).not.toThrow();

    expect(custom.data).toEqual({
      tag: "oneuptime.click",
      payload: { referrerpolicy: "unsafe-url" },
    });
    expect(scroll.data).toEqual({ source: 3, id: 7, x: 0, y: 120 });
  });

  it("walks a DOM too deep for recursion without overflowing the stack", () => {
    let deepest: RecordedElement = element("img", {
      src: "https://cdn.example/deep.png",
      referrerpolicy: "unsafe-url",
    });
    const leaf: RecordedElement = deepest;

    for (let depth: number = 0; depth < 50000; depth++) {
      deepest = element("div", {}, [deepest]);
    }

    expect((): void => {
      prepareRecordedEventsForPlayback([meta(PAGE), snapshot([], [deepest])]);
    }).not.toThrow();
    expect(leaf.attributes).not.toHaveProperty("referrerpolicy");
  });
});
