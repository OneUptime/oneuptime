import Entities from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  componentInputTypeToFormFieldType,
  getMarkdownRecordTypeOptions,
} from "../../../../UI/Components/Workflow/Utils";
import { getMarkdownFilesRecordTypes } from "../../../../Types/File/MarkdownRecords";
import { ComponentInputType } from "../../../../Types/Workflow/Component";
import MarkdownFilesComponents from "../../../../Types/Workflow/Components/MarkdownFiles";
import { describe, expect, test } from "@jest/globals";

/*
 * Get Files From Markdown's Record Type, as the builder draws it (#11256): a
 * dropdown of the kinds of record whose Markdown can show images, each by
 * its name (which the dropdown words in the reader's language), stored as
 * its table name - the common ones first. The list is the step's own rule
 * (Types/File/MarkdownRecords), so the builder offers exactly what the step
 * reads.
 */

const RECORD_TYPES: Array<BaseModel> = getMarkdownFilesRecordTypes(
  Entities.map((modelType: { new (): BaseModel }): BaseModel => {
    return new modelType();
  }),
);

describe("Get Files From Markdown's Record Type", () => {
  test("is a dropdown of every record type the step reads, by name, stored as the table name", () => {
    const field: {
      fieldType: FormFieldSchemaType;
      dropdownOptions?: Array<DropdownOption>;
    } = componentInputTypeToFormFieldType(
      ComponentInputType.MarkdownRecordType,
      null,
    ) as never;

    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.dropdownOptions).toEqual(
      RECORD_TYPES.map((model: BaseModel): DropdownOption => {
        return { label: model.singularName!, value: model.tableName! };
      }),
    );
  });

  test("leads with an incident, its notes and the other records people paste pictures into", () => {
    expect(
      getMarkdownRecordTypeOptions()
        .slice(0, 5)
        .map((option: DropdownOption): string => {
          return String(option.value);
        }),
    ).toEqual([
      "Incident",
      "IncidentPublicNote",
      "IncidentInternalNote",
      "IncidentStateTimeline",
      "Alert",
    ]);
  });

  test("offers no record that cannot show files, nor one a workflow does not read", () => {
    const values: Array<string> = getMarkdownRecordTypeOptions().map(
      (option: DropdownOption): string => {
        return String(option.value);
      },
    );

    expect(values).not.toContain("File");
    expect(values).not.toContain("User");
    expect(values).not.toContain("Project");
    expect(new Set(values).size).toBe(values.length);
  });

  test("a value from an earlier step is shown as the text it is, not as a choice", () => {
    expect(
      componentInputTypeToFormFieldType(
        ComponentInputType.MarkdownRecordType,
        "{{local.components.manual-1.returnValues.recordType}}",
      ).fieldType,
    ).toBe(FormFieldSchemaType.Text);
  });

  test("each call hands out options of its own, so a page changing one changes no other", () => {
    const first: Array<DropdownOption> = getMarkdownRecordTypeOptions();
    first[0]!.label = "Changed";

    expect(getMarkdownRecordTypeOptions()[0]!.label).toBe("Incident");
  });

  test("is the step's Record Type setting, which a run cannot do without", () => {
    const recordType:
      | { type: ComponentInputType; required: boolean }
      | undefined = MarkdownFilesComponents[0]!.arguments.find(
      (argument: { id: string }): boolean => {
        return argument.id === "recordType";
      },
    );

    expect(recordType?.type).toBe(ComponentInputType.MarkdownRecordType);
    expect(recordType?.required).toBe(true);
  });
});
