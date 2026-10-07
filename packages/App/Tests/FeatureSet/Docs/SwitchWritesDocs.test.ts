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
    expect(section).toContain('`"false"` written over `false`');
  });

  test("says an update that changes some values is heard for those only", () => {
    expect(switchesSection()).toContain(
      "its audit log entry lists only the values that changed, and a workflow's **Listen on** hears only those.",
    );
  });
});

describe("the workflow triggers page", () => {
  test("On Update does not fire for a save that changes nothing", () => {
    expect(read("workflows", "triggers.md")).toContain(
      "Saving a record with the values it already has, such as a form saved without edits or a switch sent as it already stands, is not a change and does not fire it.",
    );
  });

  test("Listen on hears every change to its fields, a switch turned off included", () => {
    expect(read("workflows", "triggers.md")).toContain(
      "**On Update** can be narrowed to some fields with **Listen on**: it then fires only when an update changes one of them, to any value — turning a switch off or clearing a field counts.",
    );
  });

  /*
   * Every translation of the page says both, in its own language: its On
   * Update line grows a second sentence, and a paragraph names Listen on.
   */
  test("says the same in every docs language", () => {
    const languages: Array<string> = fs
      .readdirSync(CONTENT_DIR)
      .filter((entry: string): boolean => {
        return (
          entry !== "en" &&
          fs.existsSync(
            path.join(CONTENT_DIR, entry, "workflows", "triggers.md"),
          )
        );
      });

    expect(languages.length).toBeGreaterThanOrEqual(16);

    for (const language of languages) {
      const text: string = fs.readFileSync(
        path.join(CONTENT_DIR, language, "workflows", "triggers.md"),
        "utf8",
      );

      const onUpdate: string | undefined = text
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith("- **On Update**");
        });

      expect([language, Boolean(onUpdate)]).toEqual([language, true]);

      // Two sentences: when it fires, and that a save changing nothing is no change.
      const sentenceEnds: number = (onUpdate!.match(/[.。।]/g) || []).length;
      expect([language, sentenceEnds >= 2]).toEqual([language, true]);

      expect([language, text.includes("**Listen on**")]).toEqual([
        language,
        true,
      ]);
    }
  });
});

describe("the incident settings page on Listen on", () => {
  test("narrows On Update to changes, a field saved as it was not being one", () => {
    const text: string = read("incidents", "settings.md");

    expect(text).toContain(
      "**On Update X** takes an optional **Listen on** argument that narrows the trigger to updates that change specific fields, whatever they change to: a switch turned off or a field cleared counts too.",
    );
    expect(text).toContain(
      "A field saved with the value it already has is not a change, so an edit form that sends it back with every save does not wake the workflow.",
    );
    expect(text).not.toContain("updates touching specific fields");
  });
});

describe("the upgrade notes", () => {
  test("say what changes for existing installs, and link the switches section", () => {
    const text: string = read("installation", "upgrading.md").replace(
      /\s+/g,
      " ",
    );

    expect(text).toContain(
      "**A switch written as text is the switch that is stored, and a save that changes nothing starts nothing.**",
    );
    expect(text).toContain(
      "is refused with `400` and a message naming the field (`isEnabled must be true or false.`)",
    );
    expect(text).toContain(
      getBooleanColumnValueMessage("isEnabled").replace(/\s+/g, " "),
    );
    expect(text).toContain(
      "one listening on a switch also runs when the switch is turned off",
    );
    expect(text).toContain(
      "[Switches](/docs/api-reference/api-reference#switches)",
    );
  });
});
