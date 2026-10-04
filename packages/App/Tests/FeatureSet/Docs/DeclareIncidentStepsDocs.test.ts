import IncidentStatusPageScopeCopy from "../../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Declaring one by hand" walks the Declare Incident wizard step by step,
 * naming every field. The wizard went from six steps (Incident Details,
 * Resources Affected, Incident Roles, On-Call, More and the summary) to
 * three and the summary, with what most incidents never need folded under
 * a More fields section. Markdown is not compiled, so nothing else notices
 * when the docs keep describing steps the form no longer has.
 *
 * The English page and its Persian translation (the one translated corpus
 * kept in step with it; the older short translations fall back to their own
 * wording) must:
 *
 *   - give the form's steps, in the form's order, by their on-screen titles;
 *   - have a section per step, and none for a step that is gone;
 *   - list, under each step's More fields, exactly the fields the form folds
 *     there - and those fields nowhere else on the step;
 *   - name the step with the on-call policies as the form does, wherever
 *     another incident page points the reader at it.
 *
 * The form is read from source: it is a React component, which an App test
 * must not import.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(PACKAGES, "App/FeatureSet/Docs/Content");
const CREATE_PAGE: string = path.join(
  PACKAGES,
  "App/FeatureSet/Dashboard/src/Pages/Incidents/Create.tsx",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const DECLARING_PAGE: string = "incidents/declaring-incidents";

// How each language writes a step's heading: "### Step 1 — Incident Details".
const STEP_HEADING: Record<string, (index: number, title: string) => string> = {
  en: (index: number, title: string): string => {
    return `### Step ${index} — ${title}`;
  },
  fa: (index: number, title: string): string => {
    const digits: string = String(index).replace(
      /[0-9]/g,
      (digit: string): string => {
        return "۰۱۲۳۴۵۶۷۸۹"[Number(digit)] as string;
      },
    );
    return `### گام ${digits} — ${title}`;
  },
};

// "Under **More fields**:" in each language: the line before a step's folded fields.
const UNDER_MORE_FIELDS: Record<string, string> = {
  en: "Under **More fields**:",
  fa: "زیر **More fields**:",
};

// The declare wizard's old On-Call step, named in English or Persian.
const OLD_ON_CALL_STEP: RegExp =
  /\*\*On-Call\*\* step of the declare wizard|گام \*\*On-Call\*\* جادوگر اعلام/;

// The section "Declaring one by hand" by its heading in each language.
const BY_HAND_HEADING: Record<string, string> = {
  en: "## Declaring one by hand",
  fa: "## اعلام دستی",
};

function readPage(relative: string, language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${relative}.md`),
    "utf8",
  );
}

const CREATE_SOURCE: string = fs
  .readFileSync(CREATE_PAGE, "utf8")
  .replace(/\s+/g, " ");

/*
 * The wizard's steps with a written title, in order: the Details step of
 * custom fields is spread in only when a field is asked, and has a section
 * of its own in the docs.
 */
function formStepTitles(): Array<string> {
  const start: number = CREATE_SOURCE.indexOf("steps={[");
  const end: number = CREATE_SOURCE.indexOf("]}", start);

  expect(start).toBeGreaterThan(-1);

  return Array.from(
    CREATE_SOURCE.slice(start, end).matchAll(/title: "([^"]+)", id: "/g),
  ).map((match: RegExpMatchArray): string => {
    return (match[1] as string).trim();
  });
}

interface FormField {
  title: string;
  stepId: string;
  isFolded: boolean;
}

/*
 * The Labels field is the shared one (getLabelsFormField), titled "Labels"
 * by the helper: the form writes only its step, section and summary.
 */
const LABELS_FIELD_CALL: string = "getLabelsFormField<Incident>(";

interface FieldObject {
  text: string;
  // The object is the options of the shared Labels field.
  isLabelsField: boolean;
}

/*
 * The objects of the form's fields array, each from its "{" to its "}",
 * read by matching braces (the array also spreads in the custom fields,
 * which are built at run time and have no object here).
 */
function fieldObjects(): Array<FieldObject> {
  const start: number = CREATE_SOURCE.indexOf("fields={[");

  expect(start).toBeGreaterThan(-1);

  const objects: Array<FieldObject> = [];
  let depth: number = 0;
  let objectStart: number = -1;

  for (
    let index: number = start + "fields={[".length;
    index < CREATE_SOURCE.length;
    index++
  ) {
    const character: string = CREATE_SOURCE[index] as string;

    if (character === "{") {
      if (depth === 0) {
        objectStart = index;
      }
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0) {
        objects.push({
          text: CREATE_SOURCE.slice(objectStart, index + 1),
          isLabelsField: CREATE_SOURCE.slice(0, objectStart).endsWith(
            LABELS_FIELD_CALL,
          ),
        });
      }
    } else if (character === "]" && depth === 0) {
      break;
    }
  }

  return objects;
}

/*
 * Every field of the form with a written title: its title (the trailing
 * space some titles carry dropped), its step, and whether it is folded
 * under the More fields section. Hidden registrations have an empty title.
 */
function formFields(): Array<FormField> {
  const fields: Array<FormField> = [];

  for (const { text: object, isLabelsField } of fieldObjects()) {
    // A title written as a literal, or taken from the shared scope copy.
    const copyKey: string | undefined = object.match(
      / title: IncidentStatusPageScopeCopy\.(\w+),/,
    )?.[1];
    const title: string | undefined = isLabelsField
      ? "Labels"
      : copyKey
        ? (IncidentStatusPageScopeCopy as unknown as Record<string, string>)[
            copyKey
          ]
        : object.match(/ title: "([^"]+)",/)?.[1];
    const stepId: string | undefined = object.match(/ stepId: "([^"]+)",/)?.[1];

    if (!title || !stepId) {
      continue;
    }

    fields.push({
      title: title.trim(),
      stepId: stepId,
      isFolded: object.includes("collapsibleSection: advancedSection,"),
    });
  }

  return fields;
}

function stepIdOf(title: string): string {
  const match: RegExpMatchArray | null = CREATE_SOURCE.match(
    new RegExp(
      `title: "${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}", id: "([^"]+)"`,
    ),
  );

  expect(match).not.toBeNull();

  return match![1] as string;
}

// The lines of a markdown section: from its heading to the next of its level or higher.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading: heading, found: start >= 0 }).toEqual({
    heading: heading,
    found: true,
  });

  const level: number = (heading.match(/^#+/)?.[0] || "").length;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const hashes: string = lines[index]!.match(/^#+ /)?.[0].trim() || "";

    if (hashes.length > 0 && hashes.length <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n");
}

// The **bold** names that lead the list items of a piece of markdown.
function listedFields(markdown: string): Array<string> {
  return Array.from(markdown.matchAll(/^- \*\*([^*]+)\*\* — /gm)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

describe("the Declare Incident docs follow the form's steps", () => {
  it("the form has the three steps the docs describe", () => {
    expect(formStepTitles()).toEqual([
      "Incident Details",
      "Resources Affected",
      "On-Call & Roles",
    ]);
  });

  it.each(LANGUAGES)(
    "%s: the opening names the steps in the form's order",
    (language: string) => {
      const byHand: string = sectionOf(
        readPage(DECLARING_PAGE, language),
        BY_HAND_HEADING[language] as string,
      );
      const opening: string = byHand.trim().split("\n")[0] as string;
      const named: Array<string> = Array.from(
        opening.matchAll(/\*\*([^*]+)\*\*/g),
      )
        .map((match: RegExpMatchArray): string => {
          return match[1] as string;
        })
        .filter((name: string, index: number, all: Array<string>): boolean => {
          // Each step once, where the opening first names it.
          return formStepTitles().includes(name) && all.indexOf(name) === index;
        });

      expect(named).toEqual(formStepTitles());

      // The steps that are gone are named nowhere in the section.
      for (const gone of ["**More**", "### Step 4", "### Step 5"]) {
        expect(byHand).not.toContain(gone);
      }
    },
  );

  it.each(LANGUAGES)(
    "%s: a section per step, and the fields each one lists are the form's, the folded ones under More fields",
    (language: string) => {
      const markdown: string = readPage(DECLARING_PAGE, language);
      const fields: Array<FormField> = formFields();

      formStepTitles().forEach((title: string, index: number) => {
        const section: string = sectionOf(
          markdown,
          STEP_HEADING[language]!(index + 1, title),
        );
        const stepFields: Array<FormField> = fields.filter(
          (field: FormField): boolean => {
            return field.stepId === stepIdOf(title);
          },
        );
        const underMoreFields: number = section.indexOf(
          UNDER_MORE_FIELDS[language] as string,
        );
        const open: string =
          underMoreFields < 0 ? section : section.slice(0, underMoreFields);
        const folded: string =
          underMoreFields < 0 ? "" : section.slice(underMoreFields);

        const foldedTitles: Array<string> = stepFields
          .filter((field: FormField): boolean => {
            return field.isFolded;
          })
          .map((field: FormField): string => {
            return field.title;
          });

        expect({ step: title, folded: listedFields(folded) }).toEqual({
          step: title,
          folded: foldedTitles,
        });

        // Every open field listed is on this step and not folded.
        for (const name of listedFields(open)) {
          const field: FormField | undefined = stepFields.find(
            (candidate: FormField): boolean => {
              return candidate.title === name;
            },
          );

          expect({ step: title, name: name, open: field?.isFolded }).toEqual({
            step: title,
            name: name,
            open: false,
          });
        }
      });
    },
  );

  it("the form folds Declared At, Initial State, Labels and Private Incident on its first step, and Change Monitor Status to on the next", () => {
    const folded: Array<string> = formFields()
      .filter((field: FormField): boolean => {
        return field.isFolded;
      })
      .map((field: FormField): string => {
        return `${field.stepId}: ${field.title}`;
      });

    expect(folded).toEqual([
      "incident-details: Declared At",
      "incident-details: Initial State",
      "incident-details: Labels",
      "incident-details: Private Incident",
      "resources-affected: Change Monitor Status to",
    ]);
  });

  it.each(LANGUAGES)(
    "%s: the other incident pages call the on-call step by its title",
    (language: string) => {
      for (const page of [
        "incidents/index",
        "incidents/linked-alerts",
        "incidents/settings",
      ]) {
        const markdown: string = readPage(page, language);

        expect({
          page: page,
          says: markdown.includes("**On-Call & Roles**"),
        }).toEqual({ page: page, says: true });
        // The template wizard still has its own On-Call step; the declare one does not.
        expect({
          page: page,
          stale: OLD_ON_CALL_STEP.test(markdown),
        }).toEqual({ page: page, stale: false });
      }
    },
  );

  it("the link to Private Incident's description goes to the step that has it", () => {
    const jira: string = readPage("integrations/jira", "en");

    expect(jira).toContain(
      "[**Private Incident**](/docs/incidents/declaring-incidents#step-1-incident-details)",
    );
    expect(jira).not.toContain("declaring-incidents#step-5-more");
  });
});
