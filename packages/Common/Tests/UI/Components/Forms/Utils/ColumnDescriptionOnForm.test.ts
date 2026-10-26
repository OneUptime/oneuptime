import {
  isRestatingColumnDescription,
  RESTATING_COLUMN_DESCRIPTIONS,
} from "../../../../../UI/Components/Forms/Utils/ColumnDescriptionOnForm";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../../../Models/DatabaseModels/Index";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Forms/Utils/ColumnDescriptionOnForm: a model column's description that
 * only restates its field - "Any friendly name of this object" under Name,
 * "Name of this alert grouping rule" - is left off forms (BasicModelForm).
 * It was the help under Name and Description on nearly every settings
 * page's create and edit form, an API reader's words in English in every
 * language. A description that goes on to say more is still shown.
 */

describe("isRestatingColumnDescription", () => {
  test("the generic ones every model carries", () => {
    expect(RESTATING_COLUMN_DESCRIPTIONS).toEqual([
      "Any friendly name of this object",
      "Friendly description that will help you remember",
      "Friendly description to help you remember",
    ]);

    for (const description of RESTATING_COLUMN_DESCRIPTIONS) {
      expect(isRestatingColumnDescription(description)).toBe(true);
      expect(isRestatingColumnDescription(`  ${description} `)).toBe(true);
    }
  });

  test.each([
    "Friendly name for this rule.",
    "Friendly name for this network site",
    "Any friendly name of this policy",
    "Any friendly name for this SCIM configuration",
    "Friendly description for this host",
    "Friendly description of this custom field that will help you remember",
  ])("the model-specific forms of them: %p", (description: string) => {
    expect(isRestatingColumnDescription(description)).toBe(true);
  });

  // The rules', templates' and records' own: the title, then the record.
  test.each([
    "Name of this alert grouping rule",
    "Description of this alert grouping rule",
    "Name of this incident on-call rule",
    "Description of this incoming call policy label rule",
    "Description of this network device auto import rule",
    "Name of this rule",
    "Name of this postmortem rule.",
    "Name of the Notification Rule",
    "Description of the Scheduled Maintenance Template",
    "Name of the Incident Template",
    "Name of the WebAuthn credential",
    "Title of this incident",
    "Title of this scheduled event.",
    "Title of the announcement",
    "A description of this code repository",
    "A friendly name for this code repository",
    "A description for this notification template",
    "NAME OF THIS SLA RULE",
  ])("a name, description or title of the record: %p", (description: string) => {
    expect(isRestatingColumnDescription(description)).toBe(true);
  });

  test.each([
    "Friendly name for this connection, shown wherever a call is started, e.g. 'Incident Zoom'.",
    "Friendly name for this feed, e.g. 'Corporate MISP'.",
    "Friendly name for this cloud environment. Ingest names a discovered environment after its platform, region and account.",
    "Friendly name for the device used to sign in.",
    "Friendly name for the device used to access the status page.",
    "Friendly globally unique name for your object",
    "Regular expression pattern to match monitor names. Leave empty to match any monitor name.",
    // A record's name, then what the description adds to it.
    "Name of the Slack workspace for validation and identification",
    "Name of the custom field on the related resource this field copies its value from.",
    "Name of the plan this project is subscribed to.",
    "Name of the Base Plan that the project should created with.",
    "Name of the LLM Provider at time of call",
    "Name of the group/team affected by this operation",
    "Name of the tool for tool-call events.",
    // Or a sentence after it.
    "Description of this alert episode. This is in markdown format.",
    "Name of this database. Discovered databases are named after their engine and endpoint, e.g. PostgreSQL orders-db.internal:5432. Not unique - rename freely.",
    "Title of the incident declared when this burn rate rule fires. Supports template variables such as {{sloName}}. Leave empty to use the default title.",
    "Description of what this log pipeline does.",
    "A name for this export, such as Compliance archive.",
    // More than six words is more than a record's name.
    "Name of this alpha beta gamma delta epsilon zeta eta",
    // The title alone, or another field's.
    "Name",
    "Port of this monitor",
    "",
  ])("one that says more is shown: %p", (description: string) => {
    expect(isRestatingColumnDescription(description)).toBe(false);
  });

  test("six words of a record's name are still its name", () => {
    expect(
      isRestatingColumnDescription(
        "Name of this alpha beta gamma delta epsilon zeta",
      ),
    ).toBe(true);
  });

  test("nothing is nothing", () => {
    expect(isRestatingColumnDescription(undefined)).toBe(false);
    expect(isRestatingColumnDescription(null)).toBe(false);
  });

  test("a long description is read in time that grows with it", () => {
    const long: string = `Friendly name for this ${"a".repeat(400000)}`;

    const run: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return isRestatingColumnDescription(long);
      },
      limitInMs: 2000,
    });

    expect(run.result).toBe(true);
    expect(run.inMs).toBeLessThan(2000);
  });

  test("a long record's name, and one that runs past six words, are read in time that grows with them", () => {
    const longName: string = `Name of this ${"a".repeat(400000)}`;
    const tooManyWords: string = `Name of this ${"a".repeat(400000)} ${"b ".repeat(20000)}c`;

    const runs: Array<FastestRun<boolean>> = [longName, tooManyWords].map(
      (text: string): FastestRun<boolean> => {
        return fastestRun({
          run: (): boolean => {
            return isRestatingColumnDescription(text);
          },
          limitInMs: 2000,
        });
      },
    );

    expect(runs[0]!.result).toBe(true);
    expect(runs[1]!.result).toBe(false);

    for (const run of runs) {
      expect(run.inMs).toBeLessThan(2000);
    }
  });

  /*
   * What the rule leaves off, across every model: only descriptions of a
   * record's name, description or title (and the like), never one that
   * tells a reader how to fill a field in.
   */
  test("across the models, it only ever takes a name's, a description's or a title's restatement", () => {
    const takenOff: Set<string> = new Set<string>();

    for (const ModelType of Models) {
      const model: BaseModel = new ModelType();

      for (const column of model.getTableColumns().columns) {
        const description: string | undefined =
          model.getTableColumnMetadata(column)?.description;

        if (isRestatingColumnDescription(description)) {
          takenOff.add(description as string);
        }
      }
    }

    // The label, owner, on-call, privacy and grouping rules among them.
    expect(takenOff.size).toBeGreaterThan(150);
    expect(takenOff).toContain("Name of this monitor label rule");
    expect(takenOff).toContain("Description of this incident owner rule");

    for (const description of takenOff) {
      expect(description.length).toBeLessThan(90);
      expect(description.toLowerCase()).toMatch(
        /^((a|an|any) )?(friendly )?(name|description|title) (of|for|that|to) /,
      );
      // No second sentence and no aside.
      expect(description.replace(/\.$/, "")).not.toMatch(/[.,;:(]/);
    }
  });
});
