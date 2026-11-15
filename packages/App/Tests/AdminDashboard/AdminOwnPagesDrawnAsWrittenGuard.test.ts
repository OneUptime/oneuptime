// UX rule: Docs/ux/README.md#in-every-language
import {
  ADMIN_DASHBOARD_SOURCE,
  isSourceFile,
  readAdminOwnStrings,
  readDrawnAsWritten,
  readDrawnAsWrittenIn,
} from "./AdminOwnPagesStrings";
import { HardcodedString } from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE ADMIN DASHBOARD'S OWN PAGES DRAW NO TEXT AS WRITTEN (#8555).
 *
 * AdminOwnPagesStringsLocales holds every text the Admin's pages hand a
 * lookup to its 18 locales. It leaves out what a page draws as written,
 * since no lookup reads it and an entry would change nothing: an element's
 * own text (<span>Shard</span>), a text attribute of a plain HTML element,
 * a sentence glued from pieces ("ClickHouse is " + "not reachable" + " from
 * this instance."). The extractor lists those as `hardcoded`
 * (scanSourceText). There were 56, in 12 files, each English in every
 * language: the migration status, the ClickHouse capacity card and its
 * summary, the OneUptime Health log, the milestones card, the default-teams
 * picker, the support bundle, the Enterprise upsell.
 *
 * Each goes through the page's translator now: a whole sentence is one key
 * with its {{placeholders}} (translateTemplate), a count a
 * translatePlural, facts on one line are set apart as the reader's language
 * does (formatInline). This keeps the list at none. A text the extractor
 * cannot tell from code - a name, a unit - goes through translation as a
 * key the locales hold as written (READ_AS_WRITTEN there), so the list
 * needs no exceptions.
 *
 * The Enterprise pages (ee/AdminDashboard) still draw theirs as written:
 * #8599.
 */

const SOURCE_PREFIX: string = "packages/App/FeatureSet/AdminDashboard/src/";

const describeDrawn: (entry: HardcodedString) => string = (
  entry: HardcodedString,
): string => {
  return `${entry.file.replace(SOURCE_PREFIX, "")}:${entry.line} [${entry.reason}] ${entry.text}`;
};

const FIXTURE_FILE: string = `${SOURCE_PREFIX}Pages/Health/Fixture.tsx`;

const page: (body: Array<string>) => string = (body: Array<string>): string => {
  return [
    'import React from "react";',
    "const Page = (props: { count: number; host: string; connected: boolean }) => {",
    "  return (",
    "    <div>",
    ...body.map((line: string): string => {
      return `      ${line}`;
    }),
    "    </div>",
    "  );",
    "};",
  ].join("\n");
};

describe("the Admin Dashboard's own pages", () => {
  test("draw no text as written: each goes through translation", () => {
    expect(readDrawnAsWritten().map(describeDrawn)).toEqual([]);
  });

  test("are all read, and hand over hundreds of texts instead", () => {
    const sourceFiles: number = fs
      .readdirSync(ADMIN_DASHBOARD_SOURCE, { recursive: true })
      .filter((file: string | Buffer): boolean => {
        return isSourceFile(path.basename(String(file)));
      }).length;

    expect(readAdminOwnStrings().files).toBe(sourceFiles);
    expect(readAdminOwnStrings().texts.length).toBeGreaterThan(500);
  });
});

/*
 * What the guard names, on fixtures: a passing run is not a scan that
 * reads nothing.
 */
describe("what the guard names", () => {
  test("an element's own text, by its place: a table's column head", () => {
    expect(
      readDrawnAsWrittenIn(
        FIXTURE_FILE,
        page(["<table><thead><tr><th>Hello</th></tr></thead></table>"]),
      ).map(describeDrawn),
    ).toEqual(["Pages/Health/Fixture.tsx:5 [jsx-text] Hello"]);
  });

  test("a paragraph added to a page", () => {
    expect(
      readDrawnAsWrittenIn(FIXTURE_FILE, page(["<p>Hello</p>"])).map(
        (entry: HardcodedString): string => {
          return entry.text;
        },
      ),
    ).toEqual(["Hello"]);
  });

  test("a sentence glued from pieces, as ClickHouse's reachability was", () => {
    const drawn: Array<string> = readDrawnAsWrittenIn(
      FIXTURE_FILE,
      page([
        "<p>",
        '  ClickHouse is {props.connected ? "reachable" : "not reachable"} from',
        "  this instance.",
        "</p>",
      ]),
    ).map((entry: HardcodedString): string => {
      return entry.text;
    });

    expect(drawn).toEqual(
      expect.arrayContaining(["reachable", "not reachable"]),
    );
  });

  test("a count glued into its words, as the pending list's tail was", () => {
    expect(
      readDrawnAsWrittenIn(
        FIXTURE_FILE,
        page(["<p>and {props.count} more…</p>"]),
      ).length,
    ).toBeGreaterThan(0);
  });

  test("a template literal drawn on the page, as the Enterprise upsell's pitch was", () => {
    expect(
      readDrawnAsWrittenIn(
        FIXTURE_FILE,
        page([
          "<p>{`${props.host} is a OneUptime Enterprise Edition feature.`}</p>",
        ]),
      ).map((entry: HardcodedString): string => {
        return entry.reason;
      }),
    ).toEqual(["composed"]);
  });

  test("nothing, once the text goes through translation", () => {
    expect(
      readDrawnAsWrittenIn(
        FIXTURE_FILE,
        page([
          '<th>{translator.translateText("Shard")}</th>',
          "<p>",
          "  {translator.translatePlural(",
          '    { one: "and {{count}} more…", other: "and {{count}} more…" },',
          "    props.count,",
          "  )}",
          "</p>",
          '<p>{translator.translateTemplate("on {{host}}", { host: props.host })}</p>',
        ]),
      ),
    ).toEqual([]);
  });
});
