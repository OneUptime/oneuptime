import Entities from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  componentInputTypeToFormFieldType,
  getAttachmentRecordTypeOptions,
  getMarkdownRecordTypeOptions,
} from "../../../../UI/Components/Workflow/Utils";
import { getAttachmentRecordTypes } from "../../../../Types/File/RecordAttachments";
import { ComponentInputType } from "../../../../Types/Workflow/Component";
import RecordAttachmentsComponents from "../../../../Types/Workflow/Components/RecordAttachments";
import { describe, expect, test } from "@jest/globals";

/*
 * Get Attachments From Record's Record Type, as the builder draws it
 * (#11477): a dropdown of the kinds of record that hold files, each by its
 * name (which the dropdown words in the reader's language), stored as its
 * table name - the common ones first. The list is the step's own rule
 * (Types/File/RecordAttachments), so the builder offers exactly what the
 * step reads.
 */

const RECORD_TYPES: Array<BaseModel> = getAttachmentRecordTypes(
  Entities.map((modelType: { new (): BaseModel }): BaseModel => {
    return new modelType();
  }),
);

describe("Get Attachments From Record's Record Type", () => {
  test("is a dropdown of every record type the step reads, by name, stored as the table name", () => {
    const field: {
      fieldType: FormFieldSchemaType;
      dropdownOptions?: Array<DropdownOption>;
    } = componentInputTypeToFormFieldType(
      ComponentInputType.AttachmentRecordType,
      null,
    ) as never;

    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.dropdownOptions).toEqual(
      RECORD_TYPES.map((model: BaseModel): DropdownOption => {
        return { label: model.singularName!, value: model.tableName! };
      }),
    );
  });

  test("leads with an incident and its notes, then alerts", () => {
    expect(
      getAttachmentRecordTypeOptions()
        .slice(0, 5)
        .map((option: DropdownOption): string => {
          return String(option.value);
        }),
    ).toEqual([
      "Incident",
      "IncidentInternalNote",
      "IncidentPublicNote",
      "Alert",
      "AlertInternalNote",
    ]);
  });

  test("offers no record that holds no files, nor one a workflow does not read", () => {
    const values: Array<string> = getAttachmentRecordTypeOptions().map(
      (option: DropdownOption): string => {
        return String(option.value);
      },
    );

    for (const tableName of [
      "File",
      "User",
      "Project",
      "IncidentFeed",
      "IncidentStateTimeline",
      // Custom fields, but no workflow reads them.
      "InventoryItem",
      "ProjectUserProfile",
    ]) {
      expect(values).not.toContain(tableName);
    }

    expect(new Set(values).size).toBe(values.length);
  });

  test("is its own list, not Get Files From Markdown's: a feed shows images but holds no files", () => {
    const markdown: Array<string> = getMarkdownRecordTypeOptions().map(
      (option: DropdownOption): string => {
        return String(option.value);
      },
    );
    const attachments: Array<string> = getAttachmentRecordTypeOptions().map(
      (option: DropdownOption): string => {
        return String(option.value);
      },
    );

    expect(markdown).toContain("IncidentFeed");
    expect(attachments).not.toContain("IncidentFeed");
    expect(attachments).toContain("StatusPageAnnouncement");
  });

  test("a value from an earlier step is shown as the text it is, not as a choice", () => {
    expect(
      componentInputTypeToFormFieldType(
        ComponentInputType.AttachmentRecordType,
        "{{local.components.manual-1.returnValues.recordType}}",
      ).fieldType,
    ).toBe(FormFieldSchemaType.Text);
  });

  test("each call hands out options of its own, so a page changing one changes no other", () => {
    const first: Array<DropdownOption> = getAttachmentRecordTypeOptions();
    first[0]!.label = "Changed";

    expect(getAttachmentRecordTypeOptions()[0]!.label).toBe("Incident");
  });

  test("is the step's Record Type setting, which a run cannot do without", () => {
    const recordType:
      | { type: ComponentInputType; required: boolean }
      | undefined = RecordAttachmentsComponents[0]!.arguments.find(
      (argument: { id: string }): boolean => {
        return argument.id === "recordType";
      },
    );

    expect(recordType?.type).toBe(ComponentInputType.AttachmentRecordType);
    expect(recordType?.required).toBe(true);
  });
});
