import CustomSignalDetector from "../../../FeatureSet/BrowserRecorder/src/CustomSignalDetector";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnActionLabel } from "./DocsDashboardLabels";
import {
  PRODUCT_ANALYTICS,
  SESSION_REPLAY,
  SESSION_REPLAY_TROUBLESHOOTING,
} from "./RumDocsPages";
import {
  SessionReplayPageRules,
  isSessionReplayPageRecorded,
} from "Common/Types/Rum/SessionReplayPageRules";
import {
  SESSION_REPLAY_READABLE_VALUE_PATTERN,
  isSessionReplayReadableValue,
  maskSessionReplayProperties,
} from "Common/Types/Rum/SessionReplayReadableProperties";
import {
  SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE,
  SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE,
  SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE,
} from "Common/Utils/Rum/SessionReplayPolicyValidation";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE REPLAY POLICY'S PAGE RULES AND READABLE EVENT PROPERTIES, AS THE
 * DOCS SAY THEM (#7502, #7501).
 *
 * Session Replay's Privacy section says which pages Record only these
 * pages and Never record these pages keep out of a recording, and which
 * value a key listed in Readable event properties keeps as written under
 * Mask all text. Both are privacy settings a reader relies on, so each
 * sentence that states a rule is held here to the code that applies it,
 * and every translation to the English line it stands beside.
 */

const RECORDER: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/BrowserRecorder/src/Recorder.ts",
  ),
  "utf8",
);

const KEEP_HEADING: string = "### Keep pages out of recordings";
const READ_HEADING: string = "### Readable event properties";
// The readable value's characters, as the docs write them.
const READABLE_CHARACTERS: string = "`A-Z a-z 0-9 _ . : / -`";

function englishLines(page: string): Array<string> {
  return readPage("en", page).split("\n");
}

// The English page's one line that starts with `start`, and its index.
function englishLine(page: string, start: string): number {
  const indexes: Array<number> = englishLines(page)
    .map((line: string, index: number): number => {
      return line.startsWith(start) ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  expect({ start, lines: indexes.length }).toEqual({ start, lines: 1 });

  return indexes[0] as number;
}

// A section of the English page: from its heading to the next one.
function englishSection(heading: string): string {
  const lines: Array<string> = englishLines(SESSION_REPLAY);
  const start: number = lines.indexOf(heading);
  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && line.startsWith("#");
  });

  expect(start).toBeGreaterThan(0);

  return lines.slice(start, end).join("\n");
}

// Is a page whose address is this recorded under these rules, as the recorder reads it?
function recorded(rules: SessionReplayPageRules, address: string): boolean {
  const url: URL = new URL(address, "https://shop.example.com");

  return isSessionReplayPageRecorded(
    rules,
    CustomSignalDetector.pagePathsOf({
      pathname: url.pathname,
      hash: url.hash,
    }),
  );
}

const NO_RULES: SessionReplayPageRules = { recordOnly: [], neverRecord: [] };

describe("Keep pages out of recordings", () => {
  const section: string = englishSection(KEEP_HEADING);

  it("names the two settings as the Replay Policy page and the server's refusals do", () => {
    for (const title of [
      SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE,
      SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE,
    ]) {
      expect(section).toContain(`**${title}**`);
    }

    expect(section).toContain(
      "under **More fields** on the **Masking** step of **Edit Policy**",
    );
  });

  it("matches a pattern as it says: a star across slashes, case and the slashes at the end ignored, no query", () => {
    expect(section).toContain(
      "`*` stands for any characters, slashes included. Case and the slashes at the end do not matter, and a path never includes its query or fragment.",
    );

    const checkout: SessionReplayPageRules = {
      recordOnly: [],
      neverRecord: ["/checkout*"],
    };

    expect(recorded(checkout, "/checkout")).toBe(false);
    expect(recorded(checkout, "/checkout/payment/card")).toBe(false);
    expect(recorded(checkout, "/Checkout/?step=2#top")).toBe(false);
    expect(recorded(checkout, "/cart")).toBe(true);

    const exact: SessionReplayPageRules = {
      recordOnly: [],
      neverRecord: ["/account/"],
    };

    expect(recorded(exact, "/ACCOUNT")).toBe(false);
    expect(recorded(exact, "/account?tab=billing")).toBe(false);
    expect(recorded(exact, "/account/settings")).toBe(true);
  });

  it("matches a hash-routed app's page by its route, as its example says", () => {
    expect(section).toContain(
      "A hash-routed app's page is also matched by its route: `/admin*` names `/#/admin/users`.",
    );

    const admin: SessionReplayPageRules = {
      recordOnly: [],
      neverRecord: ["/admin*"],
    };

    expect(recorded(admin, "/#/admin/users")).toBe(false);
    expect(recorded(admin, "/#/orders")).toBe(true);
  });

  it("lets Never record these pages win, and records every other page when Record only these pages is empty", () => {
    expect(section).toContain(
      "**Never record these pages** wins: a page it names is not recorded even when **Record only these pages** names it too. With **Record only these pages** empty, every other page is recorded.",
    );

    const both: SessionReplayPageRules = {
      recordOnly: ["/checkout*"],
      neverRecord: ["/checkout/card*"],
    };

    expect(recorded(both, "/checkout/card")).toBe(false);
    expect(recorded(both, "/checkout/review")).toBe(true);
    expect(recorded(both, "/pricing")).toBe(false);

    expect(
      recorded({ recordOnly: [], neverRecord: ["/admin*"] }, "/pricing"),
    ).toBe(true);
    // No rules, as every policy had before them: every page.
    expect(recorded(NO_RULES, "/admin/users")).toBe(true);
  });

  it("pauses in the address change itself, and goes on when a page the policy records has drawn", () => {
    expect(section).toContain(
      "The recorder pauses the moment the address changes to such a page, before your router draws it",
    );
    // The route recorder asks before it records a route: the history call or popstate itself.
    expect(RECORDER).toContain(
      'allowsPage: (kind: RecordedRoute["kind"]): boolean => {',
    );
    expect(RECORDER).toContain("return this.allowsPage(kind);");
    // Back on a recorded page: after the next frame has drawn, on a fresh snapshot.
    expect(RECORDER).toContain(
      "this.windowRef.requestAnimationFrame(releaseNow);",
    );
    expect(RECORDER).toContain(
      "this.routeRecorder.handle(kind, this.windowRef, true);",
    );
  });

  it("says the caveat a router that draws first leaves, and the setting that closes it", () => {
    expect(section).toContain(
      "can let a moment of that page into a recording around the change. Mark what must never be recorded on such a page with **Block selectors** as well.",
    );
  });

  it("is in the privacy settings table, which links to it", () => {
    const lines: Array<string> = englishLines(SESSION_REPLAY);

    expect(
      lines[
        englishLine(
          SESSION_REPLAY,
          `| **${SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE}** |`,
        )
      ],
    ).toContain("(#keep-pages-out-of-recordings)");
    englishLine(
      SESSION_REPLAY,
      `| **${SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE}** |`,
    );
    expect(lines[englishLine(SESSION_REPLAY, "| `pause()` |")]).toContain(
      "(#keep-pages-out-of-recordings)",
    );
  });
});

describe("Readable event properties", () => {
  const section: string = englishSection(READ_HEADING);

  it("names the setting as the Replay Policy page and the server's refusals do", () => {
    expect(section).toContain(
      `**${SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE}**`,
    );
  });

  it("says which value a listed key keeps: the recorders' own token", () => {
    expect(section).toContain(
      `but only while the value is a short code: at most 32 characters from ${READABLE_CHARACTERS}.`,
    );
    expect(SESSION_REPLAY_READABLE_VALUE_PATTERN.source).toBe(
      "^[A-Za-z0-9_.:/-]{0,32}$",
    );

    for (const value of [
      "pro",
      "checkout_step_2",
      "v1.4:beta/a-b",
      "a".repeat(32),
    ]) {
      expect({ value, readable: isSessionReplayReadableValue(value) }).toEqual({
        value,
        readable: true,
      });
    }

    for (const value of [
      "a".repeat(33),
      "Jane Doe",
      "jane@example.com",
      "café",
      "4111 1111 1111 1111",
    ]) {
      expect({ value, readable: isSessionReplayReadableValue(value) }).toEqual({
        value,
        readable: false,
      });
    }
  });

  it("masks every other value, every key not listed, and every trait", () => {
    expect(section).toContain(
      "Any other value under it stays masked, and so does every key you do not list and every `identify()` trait.",
    );

    const mask: (value: string) => string = (): string => {
      return "•••";
    };
    const values: Record<string, string> = {
      plan: "pro",
      step: "Jane Doe",
      email: "jane",
    };

    // Nothing listed - the default - masks every value.
    expect(maskSessionReplayProperties(values, [], mask)).toEqual({
      plan: "•••",
      step: "•••",
      email: "•••",
    });
    expect(maskSessionReplayProperties(values, ["plan", "step"], mask)).toEqual(
      { plan: "pro", step: "•••", email: "•••" },
    );

    // identify() masks its traits with no readable key at all.
    const identify: string = RECORDER.slice(
      RECORDER.indexOf("\n  public identify("),
      RECORDER.indexOf("\n  }\n", RECORDER.indexOf("\n  public identify(")),
    );

    expect(identify).toContain(
      "? this.maskStringMap(\n            sanitizeSessionReplayStringMap(traits, TRAIT_LIMITS),\n          )",
    );
  });

  it("is in the privacy settings table and the track() row, which link to it", () => {
    const lines: Array<string> = englishLines(SESSION_REPLAY);

    expect(
      lines[
        englishLine(
          SESSION_REPLAY,
          `| **${SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE}** |`,
        )
      ],
    ).toContain("(#readable-event-properties)");
    expect(
      lines[
        englishLine(SESSION_REPLAY, "| `track(name, properties?)` | Record")
      ],
    ).toContain(
      "A key listed in **Readable event properties** keeps a value that is a short code as written instead: see [Readable event properties](#readable-event-properties).",
    );
  });

  it("is said on Product Analytics too, for a breakdown and a React Native app", () => {
    const bullet: string = englishLines(PRODUCT_ANALYTICS)[
      englishLine(PRODUCT_ANALYTICS, "- **Masked as the recording is.**")
    ] as string;

    expect(bullet).toContain(
      `list its key under **${SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE}** on the application's **Replay Policy** page: a value under it that is a short code, at most 32 characters from ${READABLE_CHARACTERS}, is sent as written, and any other value stays masked.`,
    );
    expect(bullet).toContain(
      "A React Native app's values are masked the same way, as its SDK masks all text: only a short code under one of those keys is sent as written.",
    );
  });
});

describe("every docs language", () => {
  const replay: Array<string> = englishLines(SESSION_REPLAY);
  const keep: number = replay.indexOf(KEEP_HEADING);
  const read: number = replay.indexOf(READ_HEADING);
  const readLine: number = replay.findIndex((line: string): boolean => {
    return line.startsWith("Under _Mask all text_ the values of `track()`");
  });
  const troubleshootingRow: number = englishLine(
    SESSION_REPLAY_TROUBLESHOOTING,
    "| `recording-paused-page-rule` |",
  );
  const bullet: number = englishLine(
    PRODUCT_ANALYTICS,
    "- **Masked as the recording is.**",
  );

  it.each(DOCS_LANGUAGES)(
    "%s says both on the English lines, naming the settings as its Dashboard draws them",
    (language: string) => {
      const page: string = readPage(language, SESSION_REPLAY);
      const lines: Array<string> = page.split("\n");
      const analytics: string =
        readPage(language, PRODUCT_ANALYTICS).split("\n")[bullet] || "";

      expect({
        language,
        keepHeading: (lines[keep] || "").startsWith("### "),
        readHeading: (lines[read] || "").startsWith("### "),
        readableCharacters: (lines[readLine] || "").includes(
          READABLE_CHARACTERS,
        ),
        troubleshootingRow: (
          readPage(language, SESSION_REPLAY_TROUBLESHOOTING).split("\n")[
            troubleshootingRow
          ] || ""
        ).startsWith("| `recording-paused-page-rule` |"),
        analytics:
          analytics.includes(READABLE_CHARACTERS) &&
          analytics.includes(
            `**${drawnActionLabel(language, SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE)}**`,
          ),
      }).toEqual({
        language,
        keepHeading: true,
        readHeading: true,
        readableCharacters: true,
        troubleshootingRow: true,
        analytics: true,
      });

      for (const title of [
        SESSION_REPLAY_RECORD_ONLY_PAGES_TITLE,
        SESSION_REPLAY_NEVER_RECORD_PAGES_TITLE,
        SESSION_REPLAY_READABLE_EVENT_PROPERTIES_TITLE,
      ]) {
        expect({
          language,
          title,
          named: page.includes(`**${drawnActionLabel(language, title)}**`),
        }).toEqual({
          language,
          title,
          named: true,
        });
      }
    },
  );
});
