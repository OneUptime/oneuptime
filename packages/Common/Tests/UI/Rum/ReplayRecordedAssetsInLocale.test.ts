import { describe, expect, it } from "@jest/globals";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  ReplayAssetFailure,
  ReplayAssetFailureSummary,
  ReplayPlaybackAssetNote,
  buildReplayPlaybackAssetNotes,
  formatReplayAssetFailureDescription,
  formatReplayAssetFailureHosts,
  formatReplayAssetFailureTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayRecordedAssets";

/*
 * The capture notes about what the replay could not load, in the reader's
 * language (#6369): the title that counts what failed, the hosts it came
 * from, why it was fetched and what can stop it, and the masked replay's
 * note. Each sentence is looked up whole; a count is the whole sentence's
 * plural, the hosts are joined by the language's own list words, and the
 * explanation and the host list are in the language of the paragraph
 * they go into. Without a translator every note reads its English.
 */

const MARKING: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

const WEB_RECORDER: string = "dom";
const DOCS_ROOT: string = "https://oneuptime.example/docs";

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

function failure(
  kind: "image" | "stylesheet",
  url: string,
): ReplayAssetFailure {
  return { kind: kind, url: url, host: new URL(url).host };
}

describe("formatReplayAssetFailureTitle in the reader's language", () => {
  it("looks a count of one kind up as the whole sentence's plural", () => {
    expect(formatReplayAssetFailureTitle(summary({ images: 3 }), MARKING)).toBe(
      "⟦3 images didn't load in this replay⟧",
    );
    expect(
      formatReplayAssetFailureTitle(summary({ stylesheets: 2 }), MARKING),
    ).toBe("⟦2 stylesheets didn't load in this replay⟧");
    expect(
      formatReplayAssetFailureTitle(
        summary({ images: 200, isTruncated: true }),
        MARKING,
      ),
    ).toBe("⟦At least 200 images didn't load in this replay⟧");
  });

  it("names both counts in the sentence's language", () => {
    expect(
      formatReplayAssetFailureTitle(
        summary({ images: 2, stylesheets: 3 }),
        MARKING,
      ),
    ).toBe("⟦⟦2 images⟧ and ⟦3 stylesheets⟧ didn't load in this replay⟧");
    expect(
      formatReplayAssetFailureTitle(
        summary({ images: 190, stylesheets: 10, isTruncated: true }),
        MARKING,
      ),
    ).toBe(
      "⟦At least ⟦190 images⟧ and ⟦10 stylesheets⟧ didn't load in this replay⟧",
    );
  });
});

describe("formatReplayAssetFailureHosts in the reader's language", () => {
  it("joins the hosts with the language's own list words, keeping each host as written", () => {
    expect(formatReplayAssetFailureHosts(["a.example"], MARKING)).toBe(
      "a.example",
    );
    expect(
      formatReplayAssetFailureHosts(["a.example", "b.example"], MARKING),
    ).toBe("⟦a.example and b.example⟧");
    expect(
      formatReplayAssetFailureHosts(
        ["a.example", "b.example", "c.example"],
        MARKING,
      ),
    ).toBe("⟦a.example, b.example and c.example⟧");
    expect(
      formatReplayAssetFailureHosts(
        ["a.example", "b.example", "c.example", "d.example", "e.example"],
        MARKING,
      ),
    ).toBe("⟦a.example, b.example, c.example and 2 other sites⟧");
  });
});

describe("formatReplayAssetFailureDescription in the reader's language", () => {
  it("words one asset as one paragraph, its explanation and host in place", () => {
    expect(
      formatReplayAssetFailureDescription(summary({ images: 1 }), MARKING),
    ).toBe(
      "⟦⟦Recordings keep each image's address rather than the file itself, so the replay loads images from the recorded site while you watch.⟧ This one, from a.example, did not load in your browser: it may need the user's sign-in, the site may refuse to serve it to other sites, a signed link may have expired, the file is gone, or something in your browser, such as an ad or tracker blocker, refused it. The user may still have seen it.⟧",
    );
  });

  it("words several assets as the other paragraph, with the host list in its language", () => {
    expect(
      formatReplayAssetFailureDescription(
        summary({ stylesheets: 2, hosts: ["a.example", "b.example"] }),
        MARKING,
      ),
    ).toBe(
      "⟦⟦The recorder could not read these stylesheets, so the recording keeps their addresses and the replay loads them from the recorded site while you watch.⟧ These, from ⟦a.example and b.example⟧, did not load in your browser: they may need the user's sign-in, the site may refuse to serve them to other sites, a signed link may have expired, the files are gone, or something in your browser, such as an ad or tracker blocker, refused them. The user may still have seen them.⟧",
    );
  });

  it("writes the English word for word without a translator", () => {
    expect(
      formatReplayAssetFailureDescription(
        summary({ images: 1, stylesheets: 1, hosts: ["a.example", "b.example"] }),
      ),
    ).toBe(
      "Recordings keep the address of each image, and of each stylesheet the recorder could not read, rather than the file itself, so the replay loads them from the recorded site while you watch. These, from a.example and b.example, did not load in your browser: they may need the user's sign-in, the site may refuse to serve them to other sites, a signed link may have expired, the files are gone, or something in your browser, such as an ad or tracker blocker, refused them. The user may still have seen them.",
    );
  });
});

describe("buildReplayPlaybackAssetNotes in the reader's language", () => {
  it("words the failure note and the masked replay's note", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [
          failure("image", "https://cdn.example/1.png"),
          failure("image", "https://cdn.example/2.png"),
        ],
        isTruncated: false,
        maskingMode: "",
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
      MARKING,
    );

    expect(notes.map((note: ReplayPlaybackAssetNote): string => {
      return note.title;
    })).toEqual([
      "⟦2 images didn't load in this replay⟧",
      "⟦Images and web fonts are not loaded⟧",
    ]);
    expect(notes[1]?.description).toBe(
      "⟦This session's masking mode was not reported, so, to be safe, the player does not load the page's images or web fonts.⟧",
    );
  });

  it("words a masking mode it does not know with the mode as written", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [],
        isTruncated: false,
        maskingMode: "SomeFutureMode",
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
      MARKING,
    );

    expect(notes[0]?.description).toBe(
      "⟦This session's masking mode (SomeFutureMode) is not one this dashboard recognises, so, to be safe, the player does not load the page's images or web fonts.⟧",
    );
  });

  it("words the Mask all text note whole", () => {
    const notes: Array<ReplayPlaybackAssetNote> = buildReplayPlaybackAssetNotes(
      {
        failures: [],
        isTruncated: false,
        maskingMode: SessionReplayMaskingMode.MaskAllText,
        recorderKind: WEB_RECORDER,
        docsRoot: DOCS_ROOT,
      },
      MARKING,
    );

    expect(notes[0]?.description).toMatch(
      /^⟦This session was recorded under Mask all text, .*still shows\.⟧$/,
    );
  });
});
