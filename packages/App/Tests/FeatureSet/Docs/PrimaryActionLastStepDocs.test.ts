import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "In multi-step form. Please dont have the primary save button on any step
 * except the last. For example, do not show Declare Incident on the first
 * step, it should always be on the last step." - the maintainer, 2026-10-04.
 *
 * Every stepped form walks with a plain Next and offers its action on the
 * last step only (Common/UI/Components/Forms/Utils/SteppedFormFooter.ts). The
 * docs used to promise the opposite in a few places - Declare Incident and
 * Create Scheduled Maintenance Event "from the first step", Subscribe right
 * under the address, Save Changes "on every step" of an edit dialog - and
 * Markdown is not compiled, so nothing else notices when such a promise
 * comes back. This reads every page, in every language.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

// What the docs said while a stepped form could be finished early.
const RETIRED_PHRASES: ReadonlyArray<string> = [
  "saves from any of them",
  "**Save Changes** is on every step",
  "works from the first step",
  "so you can declare from it",
  "is the main button",
  "can still be created from",
  "so you can create it right away",
  "from the first step on, with **Next** beside it",
  "with **Subscribe** right under it",
  "**Next**, under **Subscribe**",
];

function listMarkdown(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listMarkdown(fullPath));
    } else if (entry.name.endsWith(".md")) {
      found.push(fullPath);
    }
  }

  return found;
}

function readEnglish(relative: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, "en", relative), "utf8");
}

describe("the docs on stepped forms", () => {
  const pages: Array<string> = listMarkdown(CONTENT_DIR);

  test("are really read", () => {
    expect(pages.length).toBeGreaterThan(500);
  });

  test("never promise a stepped form's action before its last step", () => {
    const problems: Array<string> = [];

    for (const page of pages) {
      const text: string = fs.readFileSync(page, "utf8");

      for (const phrase of RETIRED_PHRASES) {
        if (text.includes(phrase)) {
          problems.push(
            `${path.relative(CONTENT_DIR, page)}: "${phrase}" - the action is on the last step only`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test.each([
    [
      "incidents/declaring-incidents.md",
      "**Declare Incident** is on the summary, the last step",
    ],
    [
      "incidents/index.md",
      "**Declare Incident** is on the summary at the end",
    ],
    [
      "incidents/settings.md",
      "**Create Incident Template** is on the last step",
    ],
    [
      "status-pages/subscribers.md",
      "**Create Scheduled Maintenance Event** is on the review at the end",
    ],
    [
      "status-pages/subscribers.md",
      "**Next** opens **Preferences**, where every resource and every kind of event are already chosen",
    ],
    ["workflows/variables.md", "**Save Changes** is on the last step"],
    ["forms/on-submit.md", "**Save Changes** is on the last step"],
  ])("%s says where the action is: %s", (page: string, sentence: string) => {
    expect(readEnglish(page)).toContain(sentence);
  });
});
