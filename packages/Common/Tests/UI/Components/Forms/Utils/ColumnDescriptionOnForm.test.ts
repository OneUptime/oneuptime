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
 * only restates its field - "Any friendly name of this object" under Name -
 * is left off forms (BasicModelForm). It was the help under Name and
 * Description on nearly every settings page's create and edit form, an API
 * reader's words in English in every language. A description that goes on
 * to say more is still shown.
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

  test.each([
    "Friendly name for this connection, shown wherever a call is started, e.g. 'Incident Zoom'.",
    "Friendly name for this feed, e.g. 'Corporate MISP'.",
    "Friendly name for this cloud environment. Ingest names a discovered environment after its platform, region and account.",
    "Friendly name for the device used to sign in.",
    "Friendly globally unique name for your object",
    "Regular expression pattern to match monitor names. Leave empty to match any monitor name.",
    "Name of the Incident Template",
    "",
  ])("one that says more is shown: %p", (description: string) => {
    expect(isRestatingColumnDescription(description)).toBe(false);
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

  /*
   * What the rule leaves off, across every model: only descriptions of a
   * record's name or description (and the like), never one that tells a
   * reader how to fill a field in.
   */
  test("across the models, it only ever takes a name's or a description's restatement", () => {
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

    expect(takenOff.size).toBeGreaterThan(10);

    for (const description of takenOff) {
      expect(description.length).toBeLessThan(90);
      expect(description.toLowerCase()).toMatch(
        /^(any )?friendly (name|description)/,
      );
    }
  });
});
