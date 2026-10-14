import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { boldSpans, inlineCode } from "./DocsTranslationChecks";
import { flattened, otherChangesItems } from "./UpgradingDocsNotes";
import Incident from "Common/Models/DatabaseModels/Incident";
import ComponentMetadata, { Argument } from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Components from "Common/Types/Workflow/Components";
import RecordComponents, {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "Common/Types/Workflow/Components/BaseModel";
import {
  RunRecordReferenceKind,
  parseRunRecordReference,
} from "Common/Types/Workflow/RunRecord";
import { getWatchedColumns } from "Common/Types/Workflow/WatchedFields";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note on the workflow builder's field lists
 * (installation/upgrading, "Other changes in 14"), held to the code it
 * describes:
 *
 *   - the two settings are called what it says they are now called, on the
 *     triggers and steps it names, and stored where they always were;
 *   - a trigger that watched a related record is heard through the column
 *     the note names;
 *   - Run Workflow takes a record's number as well as its ID, and sends a
 *     trigger's JSON as JSON;
 *   - every translation carries it in the English note's place, with the
 *     same code, the builder's names in English and Run Workflow as its
 *     Dashboard draws it.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const NOTE_LEAD: string =
  "**A workflow's field lists have plain names, and a watched related record is heard.**";
const PREVIOUS_LEAD: string =
  "**A placeholder `ENCRYPTION_SECRET` no longer signs sign-in tokens.**";
const LAST_ITEM_START: string = "- See [API and endpoint changes]";

// What the two settings were called, which the note names once each.
const OLD_WATCHED_NAME: string = "Listen on";
const OLD_SELECT_NAME: string = "Select Fields";

// The builder's own names, which every language's builder draws in English.
const BUILDER_NAMES: Array<string> = [
  "On Update",
  OLD_WATCHED_NAME,
  WATCHED_FIELDS_NAME,
  OLD_SELECT_NAME,
  SELECT_FIELDS_NAME,
  "Text to JSON",
];

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});

describe("the English upgrade note on workflow field lists", () => {
  const note: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

  const onUpdateIncident: ComponentMetadata = RecordComponents.getComponents(
    new Incident(),
  ).find((component: ComponentMetadata): boolean => {
    return component.id === "incident-on-update";
  }) as ComponentMetadata;

  it("is a note of the 13 → 14 changes, once, after the note on sign-in tokens and before the endpoint pointer", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(ENGLISH_ITEMS[NOTE_INDEX + 1]!.startsWith(LAST_ITEM_START)).toBe(
      true,
    );
  });

  it("gives the settings the names the On Update trigger has now, and says what they were", () => {
    const names: Array<string> = onUpdateIncident.arguments.map(
      (argument: Argument): string => {
        return argument.name;
      },
    );

    expect(names).toContain(WATCHED_FIELDS_NAME);
    expect(names).toContain(SELECT_FIELDS_NAME);
    expect(names).not.toContain(OLD_WATCHED_NAME);
    expect(names).not.toContain(OLD_SELECT_NAME);
    expect(note).toContain(
      `An **On Update** trigger's **${OLD_WATCHED_NAME}** is now **${WATCHED_FIELDS_NAME}**, and **${OLD_SELECT_NAME}** is **${SELECT_FIELDS_NAME}**.`,
    );
  });

  it("says a saved workflow keeps its fields: the settings are stored where they were", () => {
    const ids: Record<string, string> = Object.fromEntries(
      onUpdateIncident.arguments.map((argument: Argument): [string, string] => {
        return [argument.name, argument.id];
      }),
    );

    expect(ids[WATCHED_FIELDS_NAME]).toBe("listen-on");
    expect(ids[SELECT_FIELDS_NAME]).toBe("select");
    expect(note).toContain(
      "Both are picked from a list, and a saved workflow keeps the fields it had.",
    );
  });

  it("names the related record that never ran, and the column it is heard through", () => {
    const code: Array<string> = inlineCode(note);

    expect(code).toContain('{"currentIncidentState": true}');
    expect(code).toContain("currentIncidentStateId");
    // An update changes the relation's ID column, which the trigger hears now.
    expect(
      getWatchedColumns({
        listenOn: { currentIncidentState: true },
        model: new Incident(),
      }),
    ).toEqual(["currentIncidentState", "currentIncidentStateId"]);
    expect(note).toContain(
      "never ran, because an update changes the record's `currentIncidentStateId`: it now runs when that ID changes, so check any workflow that has been quietly idle.",
    );
  });

  it("says Run Workflow finds a record by its number or name as well as its ID", () => {
    expect(parseRunRecordReference("INC-42").kind).toBe(
      RunRecordReferenceKind.Number,
    );
    expect(parseRunRecordReference("42").kind).toBe(
      RunRecordReferenceKind.Number,
    );
    expect(parseRunRecordReference("database").kind).toBe(
      RunRecordReferenceKind.Text,
    );
    expect(
      parseRunRecordReference("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a").kind,
    ).toBe(RunRecordReferenceKind.Id);
    expect(note).toContain(
      "**Run Workflow** finds a record by its number or name as well as its ID",
    );
  });

  it("says a Manual trigger's JSON arrives as an object, as Run Workflow sends it", () => {
    const manual: ComponentMetadata = (
      Components as Array<ComponentMetadata>
    ).find((component: ComponentMetadata): boolean => {
      return component.id === ComponentID.Manual;
    }) as ComponentMetadata;

    expect(
      manual.returnValues.map((value: { name: string }): string => {
        return value.name;
      }),
    ).toEqual(["JSON"]);
    expect(
      fs.readFileSync(
        path.join(PACKAGES_DIR, "Common/UI/Components/Workflow/RunValues.ts"),
        "utf8",
      ),
    ).toContain(
      "values[argument.id] = JSONFunctions.parse(value) as JSONValue;",
    );
    expect(note).toContain(
      "sends the JSON typed for a trigger as JSON: a Manual trigger's **JSON** arrives as an object, so a later step reads a field of it without a **Text to JSON** step.",
    );
  });
});

describe.each(TRANSLATIONS)(
  "the %s upgrade note on workflow field lists",
  (language: string) => {
    const note: string = flattened(
      otherChangesItems(language)[NOTE_INDEX] || "",
    );

    it("is in the English note's place, under a lead of its own", () => {
      expect(note.startsWith("- **")).toBe(true);
      expect(note).not.toContain(NOTE_LEAD);
      expect(
        otherChangesItems(language).filter((item: string): boolean => {
          return item.includes('{"currentIncidentState": true}');
        }),
      ).toHaveLength(1);
    });

    it("carries the English note's code", () => {
      expect(inlineCode(note)).toEqual(
        inlineCode(flattened(ENGLISH_ITEMS[NOTE_INDEX] || "")),
      );
    });

    it("keeps the builder's names in English, the old ones and the new", () => {
      const bold: Array<string> = boldSpans(note);

      for (const name of BUILDER_NAMES) {
        expect({ language, name, named: bold.includes(name) }).toEqual({
          language,
          name,
          named: true,
        });
      }
    });

    it("names Run Workflow as this language's Dashboard draws it", () => {
      const drawn: string = drawnDashboardLabel(language, "Run Workflow");

      expect({
        language,
        drawn,
        named: boldSpans(note).includes(drawn),
      }).toEqual({ language, drawn, named: true });
    });
  },
);
