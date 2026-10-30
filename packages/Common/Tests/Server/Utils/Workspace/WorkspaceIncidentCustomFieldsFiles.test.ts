import { describe, expect, test } from "@jest/globals";
import WorkspaceIncidentActions from "../../../../Server/Utils/Workspace/WorkspaceIncidentActions";
import WorkspaceIncidentCustomFields, {
  WorkspaceCustomFieldDefinition,
  WorkspaceCustomFieldInput,
  WorkspaceCustomFieldsForm,
  WorkspaceCustomFieldsSubmission,
} from "../../../../Server/Utils/Workspace/WorkspaceIncidentCustomFields";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../../Types/File/MimeType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Edit Custom Fields from Slack or Microsoft Teams, on a project with File
 * and Multiple files fields. A chat form cannot upload a file, so those
 * fields are left out of it - their files are added, and downloaded, in
 * OneUptime - and the form says so; a form left with nothing to ask says
 * why; and saving the other fields keeps every file the incident holds.
 */

function definition(
  index: number,
  name: string,
  type: CustomFieldType,
): WorkspaceCustomFieldDefinition {
  return {
    id: new ObjectID(
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ),
    name: name,
    customFieldType: type,
  };
}

const TICKET: WorkspaceCustomFieldDefinition = definition(
  1,
  "Ticket",
  CustomFieldType.Text,
);
const CONTRACT: WorkspaceCustomFieldDefinition = definition(
  2,
  "Signed Contract",
  CustomFieldType.File,
);
const SCREENSHOTS: WorkspaceCustomFieldDefinition = definition(
  3,
  "Screenshots",
  CustomFieldType.MultipleFiles,
);

const HELD_FILE: Record<string, unknown> = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "contract.pdf",
  fileType: MimeType.pdf,
  size: 4096,
};

describe("the form leaves file fields out", () => {
  test("asks for the other fields, and names the file fields", () => {
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [TICKET, CONTRACT, SCREENSHOTS],
        stored: { Ticket: "OPS-1", "Signed Contract": HELD_FILE as never },
        monitorCount: 0,
      });

    expect(
      form.inputs.map((input: WorkspaceCustomFieldInput): string => {
        return input.name;
      }),
    ).toEqual(["Ticket"]);
    expect(form.fileFieldNames).toEqual(["Signed Contract", "Screenshots"]);
    expect(form.notShownCount).toBe(0);
  });

  test("a file field never takes a place among the fields a form holds", () => {
    const definitions: Array<WorkspaceCustomFieldDefinition> = [];

    for (let index: number = 0; index < 45; index++) {
      definitions.push(
        definition(
          index + 10,
          `Attachment ${index}`,
          index % 2 === 0 ? CustomFieldType.File : CustomFieldType.Text,
        ),
      );
    }

    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: definitions,
        stored: {},
        monitorCount: 0,
      });

    // 22 text fields, all shown; 23 file fields, none counted as not shown.
    expect(form.inputs).toHaveLength(22);
    expect(form.notShownCount).toBe(0);
    expect(form.fileFieldNames).toHaveLength(23);
  });
});

describe("what the form says about them", () => {
  test("one file field", () => {
    expect(
      WorkspaceIncidentActions.getCustomFieldsNote({
        form: {
          inputs: [],
          notShownCount: 0,
          copiedFieldNames: [],
          fileFieldNames: ["Signed Contract"],
        },
      }).toString(),
    ).toBe(
      "Leave a field empty to clear it. **Signed Contract** holds files: add and download them in OneUptime.",
    );
  });

  test("several, beside fields copied from the monitor and fields that do not fit", () => {
    expect(
      WorkspaceIncidentActions.getCustomFieldsNote({
        form: {
          inputs: [],
          notShownCount: 2,
          copiedFieldNames: ["Region"],
          fileFieldNames: ["Signed Contract", "Screenshots"],
        },
      }).toString(),
    ).toBe(
      "Leave a field empty to clear it. **Region** is copied from the incident's monitor, so it is not here. **Signed Contract** and **Screenshots** hold files: add and download them in OneUptime. 2 more fields don't fit here: edit them in OneUptime.",
    );
  });

  test("a form built before file fields existed says nothing new", () => {
    expect(
      WorkspaceIncidentActions.getCustomFieldsNote({
        form: { inputs: [], notShownCount: 0, copiedFieldNames: [] },
      }).toString(),
    ).toBe("Leave a field empty to clear it.");
  });
});

describe("a form with nothing to ask says why", () => {
  test("its fields hold files", () => {
    expect(
      WorkspaceIncidentActions.getNothingToEditCustomFieldsMessage({
        form: WorkspaceIncidentCustomFields.buildForm({
          definitions: [CONTRACT, SCREENSHOTS],
          stored: {},
          monitorCount: 0,
        }),
      }),
    ).toBe(WorkspaceIncidentActions.getOnlyFileCustomFieldsMessage());
  });

  test("they are copied from the monitor", () => {
    expect(
      WorkspaceIncidentActions.getNothingToEditCustomFieldsMessage({
        form: {
          inputs: [],
          notShownCount: 0,
          copiedFieldNames: ["Region"],
          fileFieldNames: [],
        },
      }),
    ).toBe(WorkspaceIncidentActions.getOnlyCopiedCustomFieldsMessage());
  });

  test("there are none", () => {
    expect(
      WorkspaceIncidentActions.getNothingToEditCustomFieldsMessage({
        form: { inputs: [], notShownCount: 0, copiedFieldNames: [] },
      }),
    ).toBe(WorkspaceIncidentActions.getNoCustomFieldsMessage());
  });

  test("the file message says where the files are", () => {
    expect(WorkspaceIncidentActions.getOnlyFileCustomFieldsMessage()).toBe(
      "Every custom field of this incident you can edit holds files, which are added and downloaded in OneUptime, on the incident's Custom Fields.",
    );
  });
});

describe("saving the form keeps the incident's files", () => {
  test("a submission changes only the fields it asked, never a file field", () => {
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [TICKET, CONTRACT],
        stored: { Ticket: "OPS-1", "Signed Contract": HELD_FILE as never },
        monitorCount: 0,
      });

    const submission: WorkspaceCustomFieldsSubmission =
      WorkspaceIncidentCustomFields.readSubmission({
        inputs: form.inputs,
        definitions: [TICKET, CONTRACT],
        stored: { Ticket: "OPS-1", "Signed Contract": HELD_FILE as never },
        submitted: {
          [WorkspaceIncidentCustomFields.getInputId(TICKET.id)]: "OPS-2",
          // A value a crafted submission names for the file field: not read.
          [WorkspaceIncidentCustomFields.getInputId(CONTRACT.id)]: "",
        },
      });

    expect(submission.changes).toEqual([{ name: "Ticket", value: "OPS-2" }]);
  });
});
