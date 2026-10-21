import slugify from "Common/Server/Types/MarkdownSlugify";
import EventFieldChange from "Common/Server/Utils/EventFieldChange";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An incident's or alert's "updated" feed entry records what an edit really
 * changed, and the reminder interval starts over only when the severity or
 * the labels change or Send reminders is flipped (EventFieldChange). The
 * docs say so where a reader looks - what the feed records, the reminder
 * rules, and the 14 upgrade notes - and the upgrade note's link lands on the
 * section it names. Markdown is not compiled, so these tests are what
 * notices when the pages and the server part ways.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function read(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, `${page}.md`), "utf8");
}

// One page's text with its line breaks read as spaces, as Markdown reads them.
function flat(page: string): string {
  return read(page).replace(/\s+/g, " ");
}

// The text of the section under `heading`, up to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const rest: string = markdown.slice(start + heading.length);
  const end: number = rest.search(/\n#{2,3} /);

  return (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, " ");
}

const FEED_PAGE: string = "incidents/notes-owners-and-feed";
const FEED_HEADING: string = "## What the feed records";

describe("what the feed records", () => {
  const text: string = section(read(FEED_PAGE), FEED_HEADING);

  test("an IncidentUpdated entry records what an edit changed, field by field", () => {
    expect(text).toContain(
      "An `IncidentUpdated` entry records what an edit changed: the title, description, root cause, remediation notes, labels, severity,",
    );
    expect(text).toContain(
      "It has a line for each value that changed and none for a value saved as it was",
    );
  });

  test("a save that changed nothing, or a client writing the incident back, adds no entry", () => {
    expect(text).toContain(
      "saving a card with nothing changed, or an API client or a workflow writing the incident back as it is, adds no entry at all",
    );
  });

  test("says how text and labels are compared, as the server compares them", () => {
    expect(text).toContain(
      "Text that reads the same is the same (line endings and the spaces around it aside), and labels are the same set in any order",
    );

    expect(
      EventFieldChange.isTextChanged({
        writtenValue: "Bad deploy\r\n",
        valueBeforeUpdate: " Bad deploy",
      }),
    ).toBe(false);
  });

  test("the cleared-labels line it quotes is the one the server writes", () => {
    expect(text).toContain(
      `taking every label off as "${EventFieldChange.noLabelsLine}"`,
    );
  });

  test("alerts are said to work the same way", () => {
    expect(text).toContain(
      "An alert's **Alert updated** entries work the same way.",
    );
  });
});

describe("the reminder rules", () => {
  const page: string = flat("incidents/settings");

  test("say when an incident's rule is matched again, and that a save of the same values leaves the next reminder alone", () => {
    expect(page).toContain(
      "An incident's rule is matched again, and the wait for its next reminder starts over, when its severity or labels change or its **Send reminders** switch is flipped.",
    );
    expect(page).toContain(
      "Saving the severity and labels it already has — every save of the **Incident Details** card sends them — leaves its next reminder where it was.",
    );
  });
});

describe("the 14 upgrade notes", () => {
  const text: string = section(
    read("installation/upgrading"),
    "### Other changes in 14",
  );

  test("say what changes for existing projects", () => {
    expect(text).toContain(
      "**An incident's or alert's \"updated\" feed entry records only what changed.**",
    );
    expect(text).toContain(
      "each line is written for a value that changed, and nothing for a save that changed nothing",
    );
    expect(text).toContain(
      "the reminder rule is matched again, and the interval starts over, only when the severity or the labels change or **Send reminders** is flipped",
    );
    expect(text).toContain(
      "Alerts now also record a root cause changed on its own page",
    );
  });

  test("link to the section that says what the feed records", () => {
    expect(text).toContain(
      `(/docs/incidents/notes-owners-and-feed#${slugify(FEED_HEADING.replace(/^#+\s*/, ""))})`,
    );
  });
});
