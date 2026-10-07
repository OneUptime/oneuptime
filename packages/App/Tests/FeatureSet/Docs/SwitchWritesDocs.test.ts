import {
  getBooleanColumnValueMessage,
  toStoredBoolean,
} from "Common/Types/Database/BooleanColumnValue";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The API reference says how a switch - a true or false field - may be
 * written: the text and numbers the database reads as true or false are
 * taken as that value, and anything else is refused with the server's own
 * message, quoted here from the code that says it. The workflow triggers
 * page says that a save writing a record's values as they already are does
 * not fire On Update. (English; the translations follow in their own pass.)
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function read(...parts: Array<string>): string {
  return fs.readFileSync(path.join(CONTENT_DIR, "en", ...parts), "utf8");
}

function switchesSection(): string {
  const text: string = read("api-reference", "api-reference.md");
  const start: number = text.indexOf("### Switches\n");

  expect(start).toBeGreaterThan(-1);

  const end: number = text.indexOf("\n### ", start + 1);

  return text.slice(start, end === -1 ? undefined : end);
}

describe("the API reference on switches", () => {
  test("quotes the refusal the server gives, word for word", () => {
    expect(switchesSection()).toContain(
      getBooleanColumnValueMessage("isVisibleOnStatusPage"),
    );
  });

  test("lists the literals the database reads as true, and they are true", () => {
    const section: string = switchesSection();

    for (const literal of ["true", "yes", "on", "1"]) {
      expect(section).toContain(`\`"${literal}"\``);
      expect(toStoredBoolean(literal)).toBe(true);
    }

    expect(section).toContain("`1` are `true`");
    expect(toStoredBoolean(1)).toBe(true);
  });

  test("lists the literals the database reads as false, and they are false", () => {
    const section: string = switchesSection();

    for (const literal of ["false", "no", "off", "0"]) {
      expect(section).toContain(`\`"${literal}"\``);
      expect(toStoredBoolean(literal)).toBe(false);
    }

    expect(section).toContain("`0` are `false`");
    expect(toStoredBoolean(0)).toBe(false);
  });

  test("names values that are refused, and they are not switches", () => {
    const section: string = switchesSection();

    for (const refused of ['"maybe"', '""']) {
      expect(section).toContain(`\`${refused}\``);
      expect(typeof toStoredBoolean(JSON.parse(refused))).not.toBe("boolean");
    }

    expect(section).toContain("`2`");
    expect(typeof toStoredBoolean(2)).not.toBe("boolean");
  });

  test("says a write of the values a record already has fires nothing", () => {
    const section: string = switchesSection();

    expect(section).toContain(
      "does not start the record's **On Update** workflows, send live updates or add an audit log entry",
    );
    expect(section).toContain("`false` written over `false`");
  });
});

describe("the workflow triggers page", () => {
  test("On Update does not fire for a save that changes nothing", () => {
    expect(read("workflows", "triggers.md")).toContain(
      "Saving a record with the values it already has, such as a form saved without edits or a switch sent as it already stands, is not a change and does not fire it.",
    );
  });
});
