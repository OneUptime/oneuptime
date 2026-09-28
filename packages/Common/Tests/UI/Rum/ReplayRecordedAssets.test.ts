import { describe, expect, it } from "@jest/globals";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import slugify from "../../../Server/Types/MarkdownSlugify";
import {
  REPLAY_ASSET_FAILURE_DOCS_ANCHOR,
  REPLAY_ASSET_FAILURE_DOCS_PATH,
  ReplayAssetFailure,
  ReplayPlaybackAssetNote,
  buildReplayPlaybackAssetNotes,
  describeReplayAssetFailureTarget,
  doesReplayLoadRecordedImages,
  formatReplayAssetFailureDescription,
  formatReplayAssetFailureHosts,
  formatReplayAssetFailureTitle,
  getReplayAssetFailureDocsHref,
  summarizeReplayAssetFailures,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayRecordedAssets";

/*
 * What the replay does with the recorded page's own images and stylesheets,
 * from github.com/OneUptime/oneuptime/issues/4119: a Power Pages recording
 * played back with every image broken and a hidden "You're offline" banner
 * on show, because the player refused to load any of them - and nothing on
 * screen said why.
 *
 * The recorder keeps addresses, not files, so the replay has to fetch them
 * while it plays; what cannot be fetched must be named, and a recording
 * made under Mask all text must stay the wireframe that mode promises.
 */

const WEB_RECORDER: string = "dom";
const DOCS_ROOT: string = "https://oneuptime.example/docs";

function failure(
  kind: "image" | "stylesheet",
  url: string,
): ReplayAssetFailure {
  return { kind: kind, url: url, host: new URL(url).host };
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

describe("doesReplayLoadRecordedImages", () => {
  it("loads the page's images for both modes that record readable content", () => {
    expect(
      doesReplayLoadRecordedImages(
        SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      ),
    ).toBe(true);
    expect(
      doesReplayLoadRecordedImages(SessionReplayMaskingMode.MaskInputsOnly),
    ).toBe(true);
  });

  it("never loads them for a Mask all text recording, whose promise is a wireframe", () => {
    expect(
      doesReplayLoadRecordedImages(SessionReplayMaskingMode.MaskAllText),
    ).toBe(false);
  });

  it.each([[""], [null], [undefined], ["maskinputsonly"], ["MaskEverything"]])(
    "fails closed - as Mask all text - for the absent or unknown mode %p",
    (mode: string | null | undefined) => {
      expect(doesReplayLoadRecordedImages(mode)).toBe(false);
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
    });
  });

  it("is empty for no failures", () => {
    expect(summarizeReplayAssetFailures([])).toEqual({
      images: 0,
      stylesheets: 0,
      hosts: [],
    });
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
        formatReplayAssetFailureTitle({
          images: images,
          stylesheets: stylesheets,
          hosts: ["a.example"],
        }),
      ).toBe(title);
    },
  );
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
  it("explains, for one asset, why it is fetched now and what can stop it", () => {
    const text: string = formatReplayAssetFailureDescription({
      images: 1,
      stylesheets: 0,
      hosts: ["wbdynprod.powerappsportals.com"],
    });

    expect(text).toContain("the replay loads them from the recorded site");
    expect(text).toContain(
      "This one, from wbdynprod.powerappsportals.com, did not load in your browser",
    );
    expect(text).toContain("it may need the user's sign-in");
    expect(text).toContain("refuse to serve it to other sites");
    expect(text).toContain("a signed link may have expired");
    expect(text).toContain("the file is gone");
    /* It may have been fine for the user: never claim they saw it broken. */
    expect(text).toContain("The user may still have seen it.");
  });

  it("speaks in the plural, and names every host, for several", () => {
    const text: string = formatReplayAssetFailureDescription({
      images: 2,
      stylesheets: 1,
      hosts: ["content.powerapps.com", "wbdynprod.powerappsportals.com"],
    });

    expect(text).toContain(
      "These, from content.powerapps.com and wbdynprod.powerappsportals.com, did not load",
    );
    expect(text).toContain("they may need the user's sign-in");
    expect(text).toContain("the files are gone");
    expect(text).toContain("The user may still have seen them.");
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

  it("says why a Mask all text recording shows no images, without a failure count", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [],
        maskingMode: SessionReplayMaskingMode.MaskAllText,
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
    );

    expect(notes).toEqual([
      {
        key: "images-off",
        testId: "replay-capture-note-images-off",
        title: "Images are not loaded",
        description: expect.stringContaining(
          "recorded under Mask all text, which plays back as a wireframe",
        ),
        docsHref: null,
      },
    ]);
  });

  it("does not claim Mask all text for a mode it cannot read, but still plays it as one", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [],
        maskingMode: "",
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]?.key).toBe("images-off");
    expect(notes[0]?.description).not.toContain("recorded under Mask all text");
    expect(notes[0]?.description).toContain("not one this dashboard knows");
  });

  it("puts the failure note first when a Mask all text stylesheet failed too", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [
          failure("stylesheet", "https://content.powerapps.com/pwa-style.css"),
        ],
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
  });

  it("never tells a React Native recording its images are not loaded", () => {
    /* Its view tree carries no image addresses; every image is a placeholder. */
    expect(
      buildReplayPlaybackAssetNotes({
        failures: [],
        maskingMode: SessionReplayMaskingMode.MaskAllText,
        recorderKind: "rn-view-tree",
        docsRoot: DOCS_ROOT,
      }),
    ).toEqual([]);
  });
});
