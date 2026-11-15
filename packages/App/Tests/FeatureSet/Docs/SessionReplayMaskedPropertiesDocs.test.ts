import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { PRODUCT_ANALYTICS, SESSION_REPLAY } from "./RumDocsPages";
import { PRODUCT_ANALYTICS_DIMENSIONS } from "Common/Types/Rum/ProductAnalytics";
import { PRODUCT_ANALYTICS_EVENT_FIELDS } from "Common/Types/Rum/ProductAnalyticsEventReads";
import CommonMasking from "Common/Utils/Rum/Masking";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #7500, found while setting up Session Replay for OneUptime's own
 * Dashboard (#6834): under the masking mode Mask all text, the recorder
 * masks the VALUES of track() properties, and so of product analytics
 * event properties and metric attributes, which go through the same mask.
 * A team that picked Mask all text and then split a funnel by a property
 * got one bucket of placeholders and no word why.
 *
 * Both pages now say so, and where to put a value that must be read under
 * that mode: a session tag, which the recorder never masks. These tests
 * tie each sentence to the code it describes, and every translation to
 * the English line it stands beside.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const RECORDER_SRC: string = "packages/App/FeatureSet/BrowserRecorder/src";

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const RECORDER: string = read(`${RECORDER_SRC}/Recorder.ts`);
const MASKING: string = read(`${RECORDER_SRC}/Masking.ts`);
const PRODUCT_ANALYTICS_SOURCE: string = read(
  `${RECORDER_SRC}/ProductAnalytics.ts`,
);
const INDEX: string = read(`${RECORDER_SRC}/Index.ts`);

/*
 * A class member's text, from its signature to the brace that closes it
 * at the class's indentation.
 */
function member(source: string, signature: string): string {
  const start: number = source.indexOf(`\n  ${signature}`);

  expect({ signature, found: start >= 0 }).toEqual({ signature, found: true });

  const end: number = source.indexOf("\n  }\n", start);

  return source.slice(start, end);
}

// Any word of masking in a member: maskStringMap, maskConsoleArgument, ...
const MASK_WORD: RegExp = /mask/i;

const TRACK_ROW: string = "| `track(name, properties?)` |";
const MASKED_BULLET: string = "- **";

// The English page's line that starts with `start`, and its index.
function englishLine(
  page: string,
  matches: (line: string) => boolean,
): { line: string; index: number } {
  const lines: Array<string> = readPage("en", page).split("\n");
  const indexes: Array<number> = lines
    .map((line: string, index: number): number => {
      return matches(line) ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });

  expect({ page, lines: indexes.length }).toEqual({ page, lines: 1 });

  return {
    line: lines[indexes[0] as number] as string,
    index: indexes[0] as number,
  };
}

// The browser recorder's row, under JavaScript API (React Native has its own).
function trackRow(): { line: string; index: number } {
  return englishLine(SESSION_REPLAY, (line: string): boolean => {
    return (
      line.startsWith(TRACK_ROW) && line.includes("Record a business event")
    );
  });
}

function maskedBullet(): { line: string; index: number } {
  return englishLine(PRODUCT_ANALYTICS, (line: string): boolean => {
    return (
      line.startsWith(MASKED_BULLET) &&
      line.includes("**Masked as the recording is.**")
    );
  });
}

describe("what Mask all text does to the values a page hands the recorder", () => {
  it("masks each track() property's value, keeping its key, and sends the event's name as written", () => {
    const track: string = member(RECORDER, "public track(");

    expect(track).toContain(
      "const sanitised: Record<string, string> = this.maskStringMap(",
    );
    expect(track).toContain(
      "name: name.trim().slice(0, SESSION_REPLAY_MAX_CUSTOM_EVENT_NAME_LENGTH),",
    );

    const maskStringMap: string = member(RECORDER, "private maskStringMap(");

    expect(maskStringMap).toContain("for (const key of Object.keys(map)) {");
    expect(maskStringMap).toContain(
      "masked[key] = this.masking.maskConsoleArgument(map[key] as string);",
    );
  });

  it("masks with the text mask under Mask all text, and with nothing in the other modes", () => {
    const maskConsoleArgument: string = member(
      MASKING,
      "public maskConsoleArgument(",
    );

    expect(maskConsoleArgument).toContain(
      "if (!this.isMaskAllText()) {\n      return value;\n    }",
    );
    expect(maskConsoleArgument).toContain(
      "return CommonMasking.maskText(value);",
    );

    // What a breakdown by such a value shows: a placeholder, never the value.
    for (const value of ["website_down", "api_check", "Hartwell Ltd"]) {
      const masked: string = CommonMasking.maskText(value);

      expect(masked).not.toContain(value);
      expect(masked).toMatch(/^•+$/);
    }

    // Two different values look the same, so they fall in one bucket.
    expect(CommonMasking.maskText("website_down")).toBe(
      CommonMasking.maskText("api_check_x"),
    );
  });

  it("masks product analytics event properties and metric attributes with the same mask", () => {
    const track: string = member(PRODUCT_ANALYTICS_SOURCE, "public track(");
    const metric: string = member(PRODUCT_ANALYTICS_SOURCE, "public metric(");

    expect(track).toContain("properties: this.host.maskProperties(");
    expect(track).toContain("name: eventName,");
    expect(metric).toContain("attributes: this.host.maskProperties(");
    expect(metric).toContain("name: name,");
    expect(metric).toContain("value: value,");

    expect(INDEX).toContain("return recorder.maskAnalyticsProperties(map);");
    expect(member(RECORDER, "public maskAnalyticsProperties(")).toContain(
      "return this.maskStringMap(map);",
    );
  });

  it("never masks a tag: setTags(), addTag() and the map they write take no mask", () => {
    for (const signature of [
      "public setTags(",
      "public addTag(",
      "private applyTags(",
    ]) {
      expect({
        signature,
        masks: MASK_WORD.test(member(RECORDER, signature)),
      }).toEqual({
        signature,
        masks: false,
      });
    }
  });

  it("splits no product analytics page by a tag, as the page says", () => {
    for (const field of [
      ...PRODUCT_ANALYTICS_DIMENSIONS,
      ...PRODUCT_ANALYTICS_EVENT_FIELDS,
    ]) {
      expect(String(field).toLowerCase()).not.toContain("tag");
    }
  });
});

describe("the docs say it, on both pages, in every language", () => {
  it("the track() row says its values are masked under Mask all text, and where a value to read goes", () => {
    expect(trackRow().line).toContain(
      "Under _Mask all text_ its property values are masked, like traits, while its name and keys are sent as written; a value you need to read under that mode goes in a tag (`setTags()`), which is never masked, so keep personal data out of it.",
    );

    // The traits it is likened to are masked under the same mode.
    expect(
      englishLine(SESSION_REPLAY, (line: string): boolean => {
        return (
          line.startsWith("| `identify(userRef, traits?)` |") &&
          line.includes("Attach the end user to the session")
        );
      }).line,
    ).toContain("masked under _Mask all text_");
  });

  it("Send events and metrics says the same of event properties and metric attributes", () => {
    const bullet: { line: string; index: number } = maskedBullet();

    expect(bullet.line).toContain(
      "Under _Mask all text_, property and attribute values are masked before they leave the page, so a breakdown by one of them shows placeholders, not your values; event names, property keys and metric values are sent as written. A value you need to read under that mode goes in a session tag (`setTags()`), which is never masked, so keep personal data out of it. Tags show on the session and in a `tag:key=value` search of the session list, not in these pages' breakdowns.",
    );

    // In the section that says how to send them.
    const lines: Array<string> = readPage("en", PRODUCT_ANALYTICS).split("\n");
    const heading: number = lines.indexOf("## Send events and metrics");
    const next: number = lines.findIndex((line: string, index: number) => {
      return index > heading && line.startsWith("## ");
    });

    expect(heading).toBeGreaterThan(0);
    expect(bullet.index).toBeGreaterThan(heading);
    expect(bullet.index).toBeLessThan(next);
  });

  it("every translation says both on the line the English says them", () => {
    const row: number = trackRow().index;
    const bullet: number = maskedBullet().index;

    for (const language of DOCS_LANGUAGES) {
      const replayLine: string =
        readPage(language, SESSION_REPLAY).split("\n")[row] || "";
      const analyticsLine: string =
        readPage(language, PRODUCT_ANALYTICS).split("\n")[bullet] || "";

      expect({
        language,
        row: replayLine.startsWith(TRACK_ROW),
        rowMode: replayLine.includes("_Mask all text_"),
        rowTag: replayLine.includes("`setTags()`"),
        bullet: analyticsLine.startsWith(MASKED_BULLET),
        bulletMode: analyticsLine.includes("_Mask all text_"),
        bulletTag: analyticsLine.includes("`setTags()`"),
        bulletSearch: analyticsLine.includes("`tag:key=value`"),
      }).toEqual({
        language,
        row: true,
        rowMode: true,
        rowTag: true,
        bullet: true,
        bulletMode: true,
        bulletTag: true,
        bulletSearch: true,
      });
    }
  });
});
