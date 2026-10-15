import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../../Server/Services/IncidentService";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import WorkspaceIncidentCustomFields, {
  WORKSPACE_CUSTOM_FIELDS_MAX_INPUTS,
  WorkspaceCustomFieldDefinition,
  WorkspaceCustomFieldInput,
  WorkspaceCustomFieldInputKind,
  WorkspaceCustomFieldsForm,
  WorkspaceCustomFieldsSubmission,
  WorkspaceCustomFieldSubmittedValue,
} from "../../../../Server/Utils/Workspace/WorkspaceIncidentCustomFields";
import CustomFieldMappingSourceResource from "../../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * AN INCIDENT'S CUSTOM FIELDS, FILLED IN FROM SLACK OR MICROSOFT TEAMS.
 *
 * Customer feedback: "incident actions (set a custom fields, ...) cannot be
 * triggered directly from Slack". Edit Custom Fields on an incident's
 * message opens one form with every custom field of the project's incidents,
 * each as the input its type asks for, filled in with what the incident
 * holds. What comes back is compared with what it holds: only what changed
 * is written, an emptied field is cleared, and a value that does not fit its
 * field is answered under it.
 */

function definition(
  index: number,
  name: string,
  type: CustomFieldType,
  more?: Partial<WorkspaceCustomFieldDefinition>,
): WorkspaceCustomFieldDefinition {
  return {
    id: new ObjectID(
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ),
    name: name,
    customFieldType: type,
    ...(more || {}),
  };
}

const IMPACT: WorkspaceCustomFieldDefinition = definition(
  1,
  "Customer Impact",
  CustomFieldType.Dropdown,
  {
    dropdownOptions: JSON.stringify([
      { value: "High", color: "#ff0000" },
      { value: "Medium", color: "#ffaa00" },
      { value: "Low", color: "#00aa00" },
    ]),
    description: "How many customers notice.",
  },
);
const TICKET: WorkspaceCustomFieldDefinition = definition(
  2,
  "Ticket",
  CustomFieldType.Text,
);
const AFFECTED: WorkspaceCustomFieldDefinition = definition(
  3,
  "Affected Users",
  CustomFieldType.Number,
);
const PUBLIC: WorkspaceCustomFieldDefinition = definition(
  4,
  "Public",
  CustomFieldType.Boolean,
);
const REGIONS: WorkspaceCustomFieldDefinition = definition(
  5,
  "Regions",
  CustomFieldType.MultiSelectDropdown,
  { dropdownOptions: "eu-west\nus-east\nap-south" },
);
const DUE: WorkspaceCustomFieldDefinition = definition(
  6,
  "Due",
  CustomFieldType.Date,
);
const STARTED: WorkspaceCustomFieldDefinition = definition(
  7,
  "Started",
  CustomFieldType.DateTime,
);
const NOTES: WorkspaceCustomFieldDefinition = definition(
  8,
  "Notes",
  CustomFieldType.LongText,
);
const SUMMARY: WorkspaceCustomFieldDefinition = definition(
  9,
  "Summary",
  CustomFieldType.Markdown,
);

const ALL: Array<WorkspaceCustomFieldDefinition> = [
  IMPACT,
  TICKET,
  AFFECTED,
  PUBLIC,
  REGIONS,
  DUE,
  STARTED,
  NOTES,
  SUMMARY,
];

function inputOf(
  form: WorkspaceCustomFieldsForm,
  field: WorkspaceCustomFieldDefinition,
): WorkspaceCustomFieldInput {
  const input: WorkspaceCustomFieldInput | undefined = form.inputs.find(
    (candidate: WorkspaceCustomFieldInput): boolean => {
      return candidate.name === field.name;
    },
  );

  expect(input).toBeDefined();
  return input!;
}

function token(input: WorkspaceCustomFieldInput, label: string): string {
  const option: { value: string; label: string } | undefined =
    input.options.find((candidate: { value: string; label: string }) => {
      return candidate.label === label;
    });

  expect(option).toBeDefined();
  return option!.value;
}

function submit(data: {
  stored: JSONObject;
  submitted: Record<string, WorkspaceCustomFieldSubmittedValue>;
  definitions?: Array<WorkspaceCustomFieldDefinition> | undefined;
}): WorkspaceCustomFieldsSubmission {
  const definitions: Array<WorkspaceCustomFieldDefinition> =
    data.definitions || ALL;
  const form: WorkspaceCustomFieldsForm =
    WorkspaceIncidentCustomFields.buildForm({
      definitions: definitions,
      stored: data.stored,
      monitorCount: 0,
    });

  return WorkspaceIncidentCustomFields.readSubmission({
    inputs: form.inputs,
    definitions: definitions,
    stored: data.stored,
    submitted: data.submitted,
  });
}

describe("WorkspaceIncidentCustomFields.getKind: the input each type asks for", () => {
  test.each([
    [CustomFieldType.Text, WorkspaceCustomFieldInputKind.Text],
    [CustomFieldType.LongText, WorkspaceCustomFieldInputKind.LongText],
    [CustomFieldType.Markdown, WorkspaceCustomFieldInputKind.LongText],
    [CustomFieldType.Number, WorkspaceCustomFieldInputKind.Number],
    [CustomFieldType.Boolean, WorkspaceCustomFieldInputKind.YesNo],
    [CustomFieldType.Dropdown, WorkspaceCustomFieldInputKind.Dropdown],
    [
      CustomFieldType.MultiSelectDropdown,
      WorkspaceCustomFieldInputKind.MultiSelect,
    ],
    [CustomFieldType.Date, WorkspaceCustomFieldInputKind.Date],
    [CustomFieldType.DateTime, WorkspaceCustomFieldInputKind.DateTime],
  ])("%s: %s", (type: CustomFieldType, kind: WorkspaceCustomFieldInputKind) => {
    expect(WorkspaceIncidentCustomFields.getKind(type)).toBe(kind);
  });

  test("a type this version does not know is asked for as text", () => {
    expect(
      WorkspaceIncidentCustomFields.getKind(
        "Hologram" as unknown as CustomFieldType,
      ),
    ).toBe(WorkspaceCustomFieldInputKind.Text);
  });
});

describe("WorkspaceIncidentCustomFields.buildForm: every field, as it is now", () => {
  test("each field's input, named by its definition, filled in with what the incident holds", () => {
    const stored: JSONObject = {
      "Customer Impact": "High",
      Ticket: "OPS-118",
      "Affected Users": "1200",
      Public: true,
      Regions: ["us-east", "eu-west"],
      Due: "2026-10-20",
      Started: "2026-10-15T09:30:00.000Z",
      Notes: "Line one\nLine two",
      Summary: "**Bold** start",
    };

    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: ALL,
        stored: stored,
        monitorCount: 0,
      });

    expect(form.notShownCount).toBe(0);
    expect(form.copiedFieldNames).toEqual([]);
    expect(
      form.inputs.map((input: WorkspaceCustomFieldInput) => {
        return [input.name, input.kind, input.inputId];
      }),
    ).toEqual([
      ["Customer Impact", "Dropdown", `customField_${IMPACT.id.toString()}`],
      ["Ticket", "Text", `customField_${TICKET.id.toString()}`],
      ["Affected Users", "Number", `customField_${AFFECTED.id.toString()}`],
      ["Public", "YesNo", `customField_${PUBLIC.id.toString()}`],
      ["Regions", "MultiSelect", `customField_${REGIONS.id.toString()}`],
      ["Due", "Date", `customField_${DUE.id.toString()}`],
      ["Started", "DateTime", `customField_${STARTED.id.toString()}`],
      ["Notes", "LongText", `customField_${NOTES.id.toString()}`],
      ["Summary", "LongText", `customField_${SUMMARY.id.toString()}`],
    ]);

    const impact: WorkspaceCustomFieldInput = inputOf(form, IMPACT);
    expect(impact.description).toBe("How many customers notice.");
    expect(
      impact.options.map((option: { label: string }) => {
        return option.label;
      }),
    ).toEqual(["High", "Medium", "Low"]);
    expect(impact.initialOption).toBe(token(impact, "High"));

    expect(inputOf(form, TICKET).initialText).toBe("OPS-118");
    expect(inputOf(form, AFFECTED).initialText).toBe("1200");

    const yesNo: WorkspaceCustomFieldInput = inputOf(form, PUBLIC);
    expect(yesNo.options).toEqual([
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ]);
    expect(yesNo.initialOption).toBe("true");

    const regions: WorkspaceCustomFieldInput = inputOf(form, REGIONS);
    expect(regions.initialOptions).toEqual([
      token(regions, "us-east"),
      token(regions, "eu-west"),
    ]);

    expect(inputOf(form, DUE).initialDate).toBe("2026-10-20");
    expect(inputOf(form, STARTED).initialDateTime?.toISOString()).toBe(
      "2026-10-15T09:30:00.000Z",
    );
    expect(inputOf(form, NOTES).initialText).toBe("Line one\nLine two");
    expect(inputOf(form, SUMMARY).initialText).toBe("**Bold** start");
  });

  test("a field the incident holds nothing for opens empty", () => {
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: ALL,
        stored: {},
        monitorCount: 0,
      });

    for (const input of form.inputs) {
      expect({
        name: input.name,
        initialText: input.initialText,
        initialOption: input.initialOption,
        initialOptions: input.initialOptions,
        initialDate: input.initialDate,
        initialDateTime: input.initialDateTime,
      }).toEqual({
        name: input.name,
        initialText: null,
        initialOption: null,
        initialOptions: [],
        initialDate: null,
        initialDateTime: null,
      });
    }
  });

  test("in the Custom Fields card's order: by each field's order, those with none last, in the order they came", () => {
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [
          { ...TICKET, sortOrder: null },
          { ...IMPACT, sortOrder: 2 },
          { ...PUBLIC, sortOrder: 1 },
          { ...DUE, sortOrder: null },
        ],
        stored: {},
        monitorCount: 0,
      });

    expect(
      form.inputs.map((input: WorkspaceCustomFieldInput) => {
        return input.name;
      }),
    ).toEqual(["Public", "Customer Impact", "Ticket", "Due"]);
  });

  test("a held value the dropdown no longer offers is offered, marked, and picked - so a save keeps it", () => {
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [IMPACT],
        stored: { "Customer Impact": "Critical" },
        monitorCount: 0,
      });

    const impact: WorkspaceCustomFieldInput = inputOf(form, IMPACT);

    expect(
      impact.options.map((option: { label: string }) => {
        return option.label;
      }),
    ).toEqual(["High", "Medium", "Low", "Critical (no longer an option)"]);
    expect(impact.initialOption).toBe(
      token(impact, "Critical (no longer an option)"),
    );
  });

  test("a field copied from the incident's monitor is not asked for when the incident has a monitor", () => {
    const copied: WorkspaceCustomFieldDefinition = {
      ...TICKET,
      mapFromResourceType: "Monitor",
      mapFromCustomFieldName: "Ticket",
    };

    const withMonitor: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [copied, IMPACT],
        stored: {},
        monitorCount: 1,
      });

    expect(withMonitor.copiedFieldNames).toEqual(["Ticket"]);
    expect(
      withMonitor.inputs.map((input: WorkspaceCustomFieldInput) => {
        return input.name;
      }),
    ).toEqual(["Customer Impact"]);

    // With nothing to copy it from, it stays the person's to fill in.
    const withoutMonitor: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [copied, IMPACT],
        stored: {},
        monitorCount: 0,
      });

    expect(withoutMonitor.copiedFieldNames).toEqual([]);
    expect(withoutMonitor.inputs).toHaveLength(2);
  });

  test("at most a form's worth of fields: the rest are counted, to be edited in OneUptime", () => {
    const many: Array<WorkspaceCustomFieldDefinition> = Array.from(
      { length: WORKSPACE_CUSTOM_FIELDS_MAX_INPUTS + 3 },
      (_value: unknown, index: number) => {
        return definition(100 + index, `Field ${index}`, CustomFieldType.Text, {
          sortOrder: index,
        });
      },
    );

    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: many,
        stored: {},
        monitorCount: 0,
      });

    expect(form.inputs).toHaveLength(WORKSPACE_CUSTOM_FIELDS_MAX_INPUTS);
    expect(form.notShownCount).toBe(3);
    expect(form.inputs[0]!.name).toBe("Field 0");
  });

  test.each([
    ["a Number field holding text", AFFECTED, "lots"],
    ["a Date field holding text", DUE, "next week"],
    ["a Date and time field holding text", STARTED, "soon"],
  ])(
    "%s is asked for as text, so a save for another field does not clear it",
    (_name: string, field: WorkspaceCustomFieldDefinition, held: string) => {
      const form: WorkspaceCustomFieldsForm =
        WorkspaceIncidentCustomFields.buildForm({
          definitions: [field],
          stored: { [field.name]: held },
          monitorCount: 0,
        });

      const input: WorkspaceCustomFieldInput = inputOf(form, field);
      expect(input.kind).toBe(WorkspaceCustomFieldInputKind.Text);
      expect(input.initialText).toBe(held);

      // Saved as it opened: nothing changes.
      expect(
        WorkspaceIncidentCustomFields.readSubmission({
          inputs: form.inputs,
          definitions: [field],
          stored: { [field.name]: held },
          submitted: { [input.inputId]: held },
        }),
      ).toEqual({ changes: [], problems: {} });
    },
  );

  test("a Date field stored as the instant the dashboard writes opens on the day that was picked", () => {
    // 27 Sep picked in Berlin: midnight there, as a UTC instant.
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [DUE],
        stored: { Due: "2026-09-26T22:00:00.000Z" },
        monitorCount: 0,
      });

    expect(inputOf(form, DUE).initialDate).toBe("2026-09-27");
  });
});

describe("WorkspaceIncidentCustomFields.toToken: what a chat submits for an option", () => {
  test("its place and a fingerprint of its value: no commas, short, the same each time", () => {
    const first: string = WorkspaceIncidentCustomFields.toToken(
      0,
      "eu-west, the big one",
    );

    expect(first).toMatch(/^o0_[0-9a-f]{8}$/);
    expect(first).toBe(
      WorkspaceIncidentCustomFields.toToken(0, "eu-west, the big one"),
    );
    expect(first).not.toBe(WorkspaceIncidentCustomFields.toToken(0, "eu-west"));
    expect(first).not.toBe(
      WorkspaceIncidentCustomFields.toToken(1, "eu-west, the big one"),
    );
  });
});

describe("WorkspaceIncidentCustomFields.readSubmission: what a form changes", () => {
  test("a form saved as it opened changes nothing", () => {
    const stored: JSONObject = {
      "Customer Impact": "High",
      Ticket: "OPS-118",
      "Affected Users": "1200",
      Public: false,
      Regions: ["eu-west", "us-east"],
      Due: "2026-10-20",
      Started: "2026-10-15T09:30:45.000Z",
      Notes: "Line one\r\nLine two",
    };
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: ALL,
        stored: stored,
        monitorCount: 0,
      });

    const submitted: Record<string, WorkspaceCustomFieldSubmittedValue> = {
      [inputOf(form, IMPACT).inputId]: inputOf(form, IMPACT).initialOption,
      [inputOf(form, TICKET).inputId]: "OPS-118",
      // The number input gives back text; the stored number is the same.
      [inputOf(form, AFFECTED).inputId]: "1200",
      [inputOf(form, PUBLIC).inputId]: "false",
      // The same options in another order are the same selection.
      [inputOf(form, REGIONS).inputId]: [
        token(inputOf(form, REGIONS), "us-east"),
        token(inputOf(form, REGIONS), "eu-west"),
      ],
      [inputOf(form, DUE).inputId]: "2026-10-20",
      // A picker that shows minutes gives back the minute it showed.
      [inputOf(form, STARTED).inputId]: new Date("2026-10-15T09:30:00.000Z"),
      [inputOf(form, NOTES).inputId]: "Line one\nLine two",
      [inputOf(form, SUMMARY).inputId]: null,
    };

    expect(
      WorkspaceIncidentCustomFields.readSubmission({
        inputs: form.inputs,
        definitions: ALL,
        stored: stored,
        submitted: submitted,
      }),
    ).toEqual({ changes: [], problems: {} });
  });

  test("each field changed is written as its type stores it, in the form's order", () => {
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: ALL,
        stored: {},
        monitorCount: 0,
      });

    const result: WorkspaceCustomFieldsSubmission = submit({
      stored: {},
      submitted: {
        [inputOf(form, IMPACT).inputId]: token(inputOf(form, IMPACT), "Low"),
        [inputOf(form, TICKET).inputId]: "  OPS-200  ",
        [inputOf(form, AFFECTED).inputId]: "12.5",
        [inputOf(form, PUBLIC).inputId]: "true",
        [inputOf(form, REGIONS).inputId]: `${token(
          inputOf(form, REGIONS),
          "ap-south",
        )},${token(inputOf(form, REGIONS), "eu-west")}`,
        [inputOf(form, DUE).inputId]: "2026-11-01",
        [inputOf(form, STARTED).inputId]: "2026-10-15T10:00:00.000Z",
        [inputOf(form, NOTES).inputId]: "  kept as typed  ",
      },
    });

    expect(result.problems).toEqual({});
    expect(result.changes).toEqual([
      { name: "Customer Impact", value: "Low" },
      { name: "Ticket", value: "OPS-200" },
      { name: "Affected Users", value: 12.5 },
      { name: "Public", value: true },
      { name: "Regions", value: ["ap-south", "eu-west"] },
      { name: "Due", value: "2026-11-01" },
      { name: "Started", value: "2026-10-15T10:00:00.000Z" },
      { name: "Notes", value: "  kept as typed  " },
    ]);
  });

  test("a field emptied is cleared; one left empty stays empty", () => {
    const stored: JSONObject = { Ticket: "OPS-118", Notes: "" };
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [TICKET, NOTES, AFFECTED],
        stored: stored,
        monitorCount: 0,
      });

    expect(
      WorkspaceIncidentCustomFields.readSubmission({
        inputs: form.inputs,
        definitions: [TICKET, NOTES, AFFECTED],
        stored: stored,
        submitted: {
          [inputOf(form, TICKET).inputId]: "   ",
          [inputOf(form, NOTES).inputId]: null,
          [inputOf(form, AFFECTED).inputId]: undefined,
        },
      }),
    ).toEqual({
      changes: [{ name: "Ticket", value: null }],
      problems: {},
    });
  });

  test("an input the chat did not send is left as it is", () => {
    expect(
      submit({
        stored: { Ticket: "OPS-118" },
        submitted: {},
      }),
    ).toEqual({ changes: [], problems: {} });
  });

  test("a value that does not fit its field is answered under it, and nothing of that field is written", () => {
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: ALL,
        stored: {},
        monitorCount: 0,
      });

    const result: WorkspaceCustomFieldsSubmission = submit({
      stored: {},
      submitted: {
        [inputOf(form, AFFECTED).inputId]: "twelve",
        [inputOf(form, PUBLIC).inputId]: "maybe",
        [inputOf(form, DUE).inputId]: "15/10/2026",
        [inputOf(form, STARTED).inputId]: "not a time",
        [inputOf(form, TICKET).inputId]: "OPS-1",
      },
    });

    expect(result.problems).toEqual({
      [inputOf(form, AFFECTED).inputId]: "Enter a number.",
      [inputOf(form, PUBLIC).inputId]: "Pick Yes or No.",
      [inputOf(form, DUE).inputId]: "Pick a date.",
      [inputOf(form, STARTED).inputId]: "Pick a date and a time.",
    });
    // The field that fits is read; the caller writes nothing while any is wrong.
    expect(result.changes).toEqual([{ name: "Ticket", value: "OPS-1" }]);
  });

  test("an option token from a form opened before the options changed is asked again, never written as another option", () => {
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [IMPACT],
        stored: {},
        monitorCount: 0,
      });
    const lowToken: string = token(inputOf(form, IMPACT), "Low");

    // An admin took "Medium" out: "Low" moved up a place.
    const changed: WorkspaceCustomFieldDefinition = {
      ...IMPACT,
      dropdownOptions: JSON.stringify([
        { value: "High", color: "#ff0000" },
        { value: "Low", color: "#00aa00" },
      ]),
    };

    const result: WorkspaceCustomFieldsSubmission =
      WorkspaceIncidentCustomFields.readSubmission({
        inputs: WorkspaceIncidentCustomFields.buildForm({
          definitions: [changed],
          stored: {},
          monitorCount: 0,
        }).inputs,
        definitions: [changed],
        stored: {},
        submitted: { [inputOf(form, IMPACT).inputId]: lowToken },
      });

    expect(result.changes).toEqual([]);
    expect(result.problems).toEqual({
      [inputOf(form, IMPACT).inputId]:
        "The options of this field changed since the form was opened. Pick again.",
    });
  });

  test.each([
    ["not a token", "Low"],
    ["a place past the list", "o9_00000000"],
    ["a tampered fingerprint", "o0_ffffffff"],
    ["no separator", "o0"],
  ])(
    "a dropdown value that is %s is asked again",
    (_name: string, value: string) => {
      const form: WorkspaceCustomFieldsForm =
        WorkspaceIncidentCustomFields.buildForm({
          definitions: [IMPACT],
          stored: {},
          monitorCount: 0,
        });

      expect(
        submit({
          definitions: [IMPACT],
          stored: {},
          submitted: { [inputOf(form, IMPACT).inputId]: value },
        }).problems[inputOf(form, IMPACT).inputId],
      ).toBe(
        "The options of this field changed since the form was opened. Pick again.",
      );
    },
  );

  test("a value the field no longer offers, saved as it opened, is kept", () => {
    const stored: JSONObject = { "Customer Impact": "Critical" };
    const form: WorkspaceCustomFieldsForm =
      WorkspaceIncidentCustomFields.buildForm({
        definitions: [IMPACT],
        stored: stored,
        monitorCount: 0,
      });

    expect(
      WorkspaceIncidentCustomFields.readSubmission({
        inputs: form.inputs,
        definitions: [IMPACT],
        stored: stored,
        submitted: {
          [inputOf(form, IMPACT).inputId]: inputOf(form, IMPACT).initialOption,
        },
      }),
    ).toEqual({ changes: [], problems: {} });
  });

  test("a number field's held number and the same number typed are one value", () => {
    const stored: JSONObject = { "Affected Users": 1200 };

    expect(
      submit({
        definitions: [AFFECTED],
        stored: stored,
        submitted: {
          [WorkspaceIncidentCustomFields.getInputId(AFFECTED.id)]: "1200.0",
        },
      }),
    ).toEqual({ changes: [], problems: {} });
  });

  test("a Date and time moved to another minute is a change", () => {
    const stored: JSONObject = { Started: "2026-10-15T09:30:00.000Z" };

    expect(
      submit({
        definitions: [STARTED],
        stored: stored,
        submitted: {
          [WorkspaceIncidentCustomFields.getInputId(STARTED.id)]: new Date(
            "2026-10-15T09:31:00.000Z",
          ),
        },
      }).changes,
    ).toEqual([{ name: "Started", value: "2026-10-15T09:31:00.000Z" }]);
  });
});

describe("WorkspaceIncidentCustomFields.applyChanges: the bag the save writes", () => {
  test("what the incident holds, each change made, a field cleared taken out - keys no field has kept", () => {
    expect(
      WorkspaceIncidentCustomFields.applyChanges({
        stored: {
          Ticket: "OPS-1",
          "Customer Impact": "High",
          "A deleted field": "kept as it was",
        },
        changes: [
          { name: "Ticket", value: null },
          { name: "Customer Impact", value: "Low" },
          { name: "Affected Users", value: 3 },
        ],
      }),
    ).toEqual({
      "Customer Impact": "Low",
      "A deleted field": "kept as it was",
      "Affected Users": 3,
    });
  });

  test("the stored bag itself is not changed", () => {
    const stored: JSONObject = { Ticket: "OPS-1" };

    WorkspaceIncidentCustomFields.applyChanges({
      stored: stored,
      changes: [{ name: "Ticket", value: "OPS-2" }],
    });

    expect(stored).toEqual({ Ticket: "OPS-1" });
  });
});

describe("WorkspaceIncidentCustomFields.canShowValue", () => {
  test.each([
    [WorkspaceCustomFieldInputKind.Number, 42, true],
    [WorkspaceCustomFieldInputKind.Number, "42.5", true],
    [WorkspaceCustomFieldInputKind.Number, "lots", false],
    [WorkspaceCustomFieldInputKind.Date, "2026-10-15", true],
    [WorkspaceCustomFieldInputKind.Date, "2026-10-14T22:00:00.000Z", true],
    [WorkspaceCustomFieldInputKind.Date, "soon", false],
    [WorkspaceCustomFieldInputKind.DateTime, "2026-10-15T09:00:00Z", true],
    [WorkspaceCustomFieldInputKind.DateTime, "soon", false],
    [WorkspaceCustomFieldInputKind.Text, "anything", true],
    [WorkspaceCustomFieldInputKind.Number, null, true],
    [WorkspaceCustomFieldInputKind.Number, "", true],
  ])(
    "%s holding %p: %p",
    (kind: WorkspaceCustomFieldInputKind, value: unknown, can: boolean) => {
      expect(
        WorkspaceIncidentCustomFields.canShowValue({
          kind: kind,
          value: value,
        }),
      ).toBe(can);
    },
  );
});

/*
 * What the form reads and writes, as the member: the project's fields, the
 * values the incident holds, and the incident's update. Only the database
 * is stubbed.
 */
describe("WorkspaceIncidentCustomFields: the reads and the write, as the member", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "4cf3a4b5-c6d7-4e8f-9a01-a2b3c4d5e6f7",
  );
  const INCIDENT_ID: ObjectID = new ObjectID(
    "5d04b5c6-d7e8-4f90-8b12-b3c4d5e6f708",
  );
  const PROPS: DatabaseCommonInteractionProps = {
    userId: new ObjectID("6e15c6d7-e8f9-4a01-9c23-c4d5e6f70819"),
    tenantId: PROJECT_ID,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function field(
    more: (row: IncidentCustomField) => void,
  ): IncidentCustomField {
    const row: IncidentCustomField = new IncidentCustomField();
    more(row);
    return row;
  }

  test("readDefinitions: the project's fields the member may read, in the card's order, as the form reads them", async () => {
    const read: SpyInstance<typeof IncidentCustomFieldService.findBy> = jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockResolvedValue([
        field((row: IncidentCustomField): void => {
          row.id = IMPACT.id;
          row.name = "Customer Impact";
          row.description = "How many customers notice.";
          row.customFieldType = CustomFieldType.Dropdown;
          row.dropdownOptions = "High\nLow";
          row.sortOrder = 2;
        }),
        field((row: IncidentCustomField): void => {
          row.id = TICKET.id;
          row.name = "Ticket";
          row.customFieldType = CustomFieldType.Text;
          row.mapFromResourceType = CustomFieldMappingSourceResource.Monitor;
          row.mapFromCustomFieldName = "Ticket";
        }),
        // A row with no name is no field.
        field((row: IncidentCustomField): void => {
          row.id = AFFECTED.id;
        }),
      ]);

    expect(
      await WorkspaceIncidentCustomFields.readDefinitions({
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    ).toEqual([
      {
        id: IMPACT.id,
        name: "Customer Impact",
        description: "How many customers notice.",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "High\nLow",
        sortOrder: 2,
        mapFromResourceType: undefined,
        mapFromCustomFieldName: undefined,
      },
      {
        id: TICKET.id,
        name: "Ticket",
        description: undefined,
        customFieldType: CustomFieldType.Text,
        dropdownOptions: undefined,
        sortOrder: null,
        mapFromResourceType: "Monitor",
        mapFromCustomFieldName: "Ticket",
      },
    ]);

    expect(read.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { projectId: PROJECT_ID },
        props: PROPS,
      }),
    );
  });

  test("readDefinitions: fields the member may not read are refused in the chat's words", async () => {
    jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockRejectedValue(
        new NotAuthorizedException("You need Read Incident Custom Field."),
      );

    await expect(
      WorkspaceIncidentCustomFields.readDefinitions({
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "You do not have permission to see this project's incident custom fields. You need Read Incident Custom Field.",
      ),
    );
  });

  test("readIncidentValues: the bag the incident holds and how many monitors it has, read as the member", async () => {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident.customFields = { Ticket: "OPS-118" };
    incident.monitors = [new Monitor(), new Monitor()];
    const read: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);

    expect(
      await WorkspaceIncidentCustomFields.readIncidentValues({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    ).toEqual({ stored: { Ticket: "OPS-118" }, monitorCount: 2 });

    expect(read.mock.calls[0]![0].query).toEqual({
      _id: INCIDENT_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(read.mock.calls[0]![0].props).toBe(PROPS);
  });

  test("readIncidentValues: no bag is an empty one; an incident they may not read is none", async () => {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    const read: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident);

    expect(
      await WorkspaceIncidentCustomFields.readIncidentValues({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    ).toEqual({ stored: {}, monitorCount: 0 });

    read.mockRejectedValue(new NotAuthorizedException("no read"));

    expect(
      await WorkspaceIncidentCustomFields.readIncidentValues({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    ).toBeNull();
  });

  test("save: reads the bag again and writes it with the changes, as the member - a value set by somebody else meanwhile stays", async () => {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    // Somebody set Public since the form was opened.
    incident.customFields = { Ticket: "OPS-118", Public: true };
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    const update: SpyInstance<typeof IncidentService.updateOneById> = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(1);

    await WorkspaceIncidentCustomFields.save({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      changes: [
        { name: "Ticket", value: null },
        { name: "Customer Impact", value: "High" },
      ],
      props: PROPS,
    });

    expect(update).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { customFields: { Public: true, "Customer Impact": "High" } },
      props: PROPS,
    });
  });

  test("save: an incident they may read but not change is refused with the update's reason, never said saved", async () => {
    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(0);
    const reason: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permission to update this Incident.",
    );
    jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(reason);

    await expect(
      WorkspaceIncidentCustomFields.save({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        changes: [{ name: "Ticket", value: "OPS-2" }],
        props: PROPS,
      }),
    ).rejects.toBe(reason);
  });

  test("save: an incident gone since the form opened is refused, and nothing is written", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
    const update: SpyInstance<typeof IncidentService.updateOneById> =
      jest.spyOn(IncidentService, "updateOneById");

    await expect(
      WorkspaceIncidentCustomFields.save({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        changes: [{ name: "Ticket", value: "OPS-2" }],
        props: PROPS,
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        "The incident was not found in this project, or you do not have access to it.",
      ),
    );
    expect(update).not.toHaveBeenCalled();
  });
});
