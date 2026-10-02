import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import { FormRecordOption } from "../../../Types/Form/FormPublic";
import {
  FormTargetSettingReferenceModel,
  validateFormTargetSettings,
} from "../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../Types/JSON";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import {
  FormReferenceData,
  nameRecords,
  toDropdownOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormOnSubmitData";
import {
  FormMappingLine,
  FormMappingLineKind,
  FormMappingRow,
  getFormMappingRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormMappingRows";
import {
  getFormSettingsFields,
  getFormSettingsInitialValues,
  getFormSettingsSteps,
  packFormSettingsValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormSettingsEditor";
import { describe, expect, test } from "@jest/globals";

/*
 * A form's On Submit page, without drawing it: every field of what the form
 * creates and where its value comes from (getFormMappingRows), and the
 * settings dialog - its steps, its fields, what it starts on and what it
 * saves.
 */

const SEVERITY_ID: string = "a0000000-0000-4000-8000-000000000001";
const TEMPLATE_ID: string = "a0000000-0000-4000-8000-000000000002";
const BARE_TEMPLATE_ID: string = "a0000000-0000-4000-8000-000000000003";
const MONITOR_ID: string = "a0000000-0000-4000-8000-000000000004";
const LABEL_ID: string = "a0000000-0000-4000-8000-000000000005";
const POLICY_ID: string = "a0000000-0000-4000-8000-000000000006";
const USER_ID: string = "a0000000-0000-4000-8000-000000000007";
const TEAM_ID: string = "a0000000-0000-4000-8000-000000000008";
const PAGE_ID: string = "a0000000-0000-4000-8000-000000000009";
const GONE_ID: string = "a0000000-0000-4000-8000-0000000000ff";
const REGION_ID: string = "b0000000-0000-4000-8000-000000000001";

function records(...entries: Array<[string, string]>): Array<FormRecordOption> {
  return entries.map(([id, name]: [string, string]): FormRecordOption => {
    return { id, name };
  });
}

const REFERENCE: FormReferenceData = {
  lists: {
    [FormTargetSettingReferenceModel.IncidentSeverity]: records([SEVERITY_ID, "Major"]),
    [FormTargetSettingReferenceModel.IncidentTemplate]: records(
      [TEMPLATE_ID, "Customer Report"],
      [BARE_TEMPLATE_ID, "Bare"],
    ),
    [FormTargetSettingReferenceModel.Monitor]: records([MONITOR_ID, "API"]),
    [FormTargetSettingReferenceModel.Label]: records([LABEL_ID, "customer-report"]),
    [FormTargetSettingReferenceModel.OnCallDutyPolicy]: records([POLICY_ID, "Primary"]),
    [FormTargetSettingReferenceModel.User]: records([USER_ID, "Ada"]),
    [FormTargetSettingReferenceModel.Team]: records([TEAM_ID, "SRE"]),
    [FormTargetSettingReferenceModel.StatusPage]: records([PAGE_ID, "Main"]),
  },
  templateIdsWithSeverity: [TEMPLATE_ID],
};

function rowsOf(data: {
  targetType?: FormTargetType;
  fields?: Array<FormField>;
  settings?: JSONObject;
}): Record<string, FormMappingRow> {
  const rows: Array<FormMappingRow> = getFormMappingRows({
    targetType: data.targetType || FormTargetType.Incident,
    fields: data.fields || getDefaultFormFields(FormTargetType.Incident),
    settings: (data.settings || {}) as never,
    reference: REFERENCE,
    customFields: [
      {
        id: REGION_ID,
        name: "Region",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "EU",
      },
    ],
  });

  const byKey: Record<string, FormMappingRow> = {};

  for (const row of rows) {
    byKey[row.key] = row;
  }

  return byKey;
}

function linesOf(row: FormMappingRow | undefined): Array<string> {
  return (row?.lines || []).map((line: FormMappingLine): string => {
    return `${line.kind}:${line.text}`;
  });
}

const SEVERITY_QUESTION: FormField = {
  id: "severity",
  source: FormFieldSource.TargetField,
  targetField: "incidentSeverityId",
  label: "How bad?",
  isRequired: false,
};

describe("getFormMappingRows: how a submission becomes an incident", () => {
  test("lists every field of the incident, in order", () => {
    expect(Object.keys(rowsOf({}))).toEqual([
      "title",
      "description",
      "severity",
      "monitors",
      "labels",
      "impactStartedAt",
      "incidentTemplate",
      "onCallPolicies",
      "ownerUsers",
      "ownerTeams",
      "customFields",
      "statusPages",
      "otherAnswers",
    ]);
  });

  test("a required title is the answer; an optional one falls back to the default title, or the form's name", () => {
    expect(linesOf(rowsOf({}).title)).toEqual(["Answer:Title"]);

    const optional: Array<FormField> = getDefaultFormFields(
      FormTargetType.Incident,
    ).map((field: FormField): FormField => {
      return field.targetField === "title" ? { ...field, isRequired: false } : field;
    });

    expect(linesOf(rowsOf({ fields: optional }).title)).toEqual([
      "Answer:Title",
      `Fallback:${FormsCopy.formNameAsTitle}`,
    ]);
    expect(
      linesOf(
        rowsOf({ fields: optional, settings: { defaultTitle: "Customer report" } })
          .title,
      ),
    ).toEqual(["Answer:Title", "Fallback:Customer report"]);
    expect(linesOf(rowsOf({ fields: [] }).title)).toEqual([
      `Value:${FormsCopy.formNameAsTitle}`,
    ]);
  });

  test("a field the form does not ask says so", () => {
    expect(linesOf(rowsOf({}).impactStartedAt)).toEqual([
      `Value:${FormsCopy.notAsked}`,
    ]);
  });

  test("the severity: the settings' one, or the template's, or a warning", () => {
    expect(
      linesOf(rowsOf({ settings: { incidentSeverityId: SEVERITY_ID } }).severity),
    ).toEqual(["Value:Major"]);
    expect(
      linesOf(rowsOf({ settings: { incidentTemplateId: TEMPLATE_ID } }).severity),
    ).toEqual([`Value:${FormsCopy.severityFromTemplate}`]);
    expect(
      linesOf(rowsOf({ settings: { incidentTemplateId: BARE_TEMPLATE_ID } }).severity),
    ).toEqual([`Warning:${FormsCopy.noSeverityWarning}`]);
    // A severity the settings name that was deleted since.
    expect(linesOf(rowsOf({ settings: { incidentSeverityId: GONE_ID } }).severity)).toEqual(
      [`Warning:${FormsCopy.noSeverityWarning}`],
    );
  });

  test("an asked severity: the answer, then what applies when it is left empty", () => {
    const fields: Array<FormField> = [
      ...getDefaultFormFields(FormTargetType.Incident),
      SEVERITY_QUESTION,
    ];

    expect(
      linesOf(
        rowsOf({ fields, settings: { incidentSeverityId: SEVERITY_ID } }).severity,
      ),
    ).toEqual(["Answer:How bad?", "Fallback:Major"]);
    expect(linesOf(rowsOf({ fields }).severity)).toEqual([
      "Answer:How bad?",
      `Warning:${FormsCopy.noSeverityWarning}`,
    ]);
    expect(
      linesOf(
        rowsOf({
          fields: [
            ...getDefaultFormFields(FormTargetType.Incident),
            { ...SEVERITY_QUESTION, isRequired: true },
          ],
        }).severity,
      ),
    ).toEqual(["Answer:How bad?"]);
  });

  test("monitors and labels: the answer and what is always added, by name", () => {
    const fields: Array<FormField> = [
      ...getDefaultFormFields(FormTargetType.Incident),
      {
        id: "monitors",
        source: FormFieldSource.TargetField,
        targetField: "monitors",
        label: "Affected",
        isRequired: false,
        allowedOptionIds: [MONITOR_ID],
      },
    ];

    expect(
      linesOf(
        rowsOf({
          fields,
          settings: { monitorIds: [MONITOR_ID, GONE_ID], labelIds: [LABEL_ID] },
        }).monitors,
      ),
    ).toEqual(["Answer:Affected", `Always:API, ${FormsCopy.deletedRecord}`]);
    expect(linesOf(rowsOf({ settings: { labelIds: [LABEL_ID] } }).labels)).toEqual([
      "Always:customer-report",
    ]);
    expect(linesOf(rowsOf({}).labels)).toEqual([`Value:${FormsCopy.notSet}`]);
  });

  test("the template, on-call policies and owners, by name, or not set", () => {
    const rows: Record<string, FormMappingRow> = rowsOf({
      settings: {
        incidentTemplateId: TEMPLATE_ID,
        onCallDutyPolicyIds: [POLICY_ID],
        ownerUserIds: [USER_ID],
        ownerTeamIds: [TEAM_ID],
      },
    });

    expect(linesOf(rows.incidentTemplate)).toEqual(["Value:Customer Report"]);
    expect(linesOf(rows.onCallPolicies)).toEqual(["Value:Primary"]);
    expect(linesOf(rows.ownerUsers)).toEqual(["Value:Ada"]);
    expect(linesOf(rows.ownerTeams)).toEqual(["Value:SRE"]);
    expect(linesOf(rowsOf({}).incidentTemplate)).toEqual([
      `Value:${FormsCopy.noTemplate}`,
    ]);
    expect(linesOf(rowsOf({}).onCallPolicies)).toEqual([`Value:${FormsCopy.notSet}`]);
  });

  test("custom fields: each one a question fills, a deleted one left out", () => {
    const rows: Record<string, FormMappingRow> = rowsOf({
      fields: [
        {
          id: "region",
          source: FormFieldSource.TargetCustomField,
          customFieldId: REGION_ID.toUpperCase(),
          label: "Where?",
          isRequired: false,
        },
        {
          id: "gone",
          source: FormFieldSource.TargetCustomField,
          customFieldId: GONE_ID,
          label: "Gone",
          isRequired: false,
        },
      ],
    });

    expect(rows.customFields!.lines).toEqual([
      {
        kind: FormMappingLineKind.CustomField,
        text: "Where?",
        customFieldName: "Region",
      },
    ]);
    expect(linesOf(rowsOf({}).customFields)).toEqual([`Value:${FormsCopy.notAsked}`]);
  });

  test("an incident is never put on a status page, and the other answers go on its note", () => {
    const rows: Record<string, FormMappingRow> = rowsOf({});

    expect(linesOf(rows.statusPages)).toEqual([
      `Value:${FormsCopy.statusPagesIncident}`,
    ]);
    expect(linesOf(rows.otherAnswers)).toEqual([
      `Value:${FormsCopy.otherAnswersIncident}`,
    ]);
  });

  test("copy lines are marked for translation; names are not", () => {
    const rows: Record<string, FormMappingRow> = rowsOf({
      settings: { incidentSeverityId: SEVERITY_ID },
    });

    expect(rows.severity!.lines[0]!.isCopy).toBeFalsy();
    expect(rows.statusPages!.lines[0]!.isCopy).toBe(true);
  });
});

describe("getFormMappingRows: how a submission becomes a maintenance event", () => {
  const MAINTENANCE: Array<FormField> = getDefaultFormFields(
    FormTargetType.ScheduledMaintenance,
  );

  test("lists every field of the event, in order", () => {
    expect(
      Object.keys(
        rowsOf({ targetType: FormTargetType.ScheduledMaintenance, fields: MAINTENANCE }),
      ),
    ).toEqual([
      "title",
      "description",
      "startsAt",
      "endsAt",
      "monitors",
      "statusPages",
      "labels",
      "ownerUsers",
      "ownerTeams",
      "showOnStatusPages",
      "notifySubscribers",
      "customFields",
      "otherAnswers",
    ]);
  });

  test("the window is the answers; publishing is No unless the settings say Yes", () => {
    const rows: Record<string, FormMappingRow> = rowsOf({
      targetType: FormTargetType.ScheduledMaintenance,
      fields: MAINTENANCE,
      settings: { statusPageIds: [PAGE_ID], notifySubscribers: true },
    });

    expect(linesOf(rows.startsAt)).toEqual(["Answer:Starts At"]);
    expect(linesOf(rows.endsAt)).toEqual(["Answer:Ends At"]);
    expect(linesOf(rows.statusPages)).toEqual(["Always:Main"]);
    expect(linesOf(rows.showOnStatusPages)).toEqual([`Value:${FormsCopy.no}`]);
    expect(linesOf(rows.notifySubscribers)).toEqual([`Value:${FormsCopy.yes}`]);
    expect(linesOf(rows.otherAnswers)).toEqual([
      `Value:${FormsCopy.otherAnswersScheduledMaintenance}`,
    ]);
  });
});

describe("the On Submit settings dialog", () => {
  test("walks Defaults, Always Attach and Owners - and Publishing for a maintenance form", () => {
    expect(
      getFormSettingsSteps(FormTargetType.Incident).map(
        (step: { title: string }) => {
          return step.title;
        },
      ),
    ).toEqual([FormsCopy.stepDefaults, FormsCopy.stepAlwaysAttach, FormsCopy.stepOwners]);
    expect(getFormSettingsSteps(FormTargetType.ScheduledMaintenance)).toHaveLength(4);
  });

  test("an incident form's fields, each on its step, offering the project's records", () => {
    const fields: Array<Field<JSONObject>> = getFormSettingsFields({
      targetType: FormTargetType.Incident,
      reference: REFERENCE,
    });

    expect(
      fields.map((field: Field<JSONObject>): string => {
        return `${field.stepId}:${Object.keys(field.field || {})[0]}`;
      }),
    ).toEqual([
      "defaults:defaultTitle",
      "defaults:incidentSeverityId",
      "defaults:incidentTemplateId",
      "attach:monitorIds",
      "attach:labelIds",
      "attach:onCallDutyPolicyIds",
      "owners:ownerUserIds",
      "owners:ownerTeamIds",
    ]);
    expect(fields[1]!.dropdownOptions).toEqual([{ value: SEVERITY_ID, label: "Major" }]);
    expect(fields[3]!.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);

    for (const field of fields) {
      expect(field.required).toBe(false);
    }
  });

  test("a maintenance form's fields, its switches on the Publishing step", () => {
    const fields: Array<Field<JSONObject>> = getFormSettingsFields({
      targetType: FormTargetType.ScheduledMaintenance,
      reference: REFERENCE,
    });

    expect(
      fields.map((field: Field<JSONObject>): string => {
        return `${field.stepId}:${Object.keys(field.field || {})[0]}`;
      }),
    ).toEqual([
      "defaults:defaultTitle",
      "attach:monitorIds",
      "attach:statusPageIds",
      "attach:labelIds",
      "owners:ownerUserIds",
      "owners:ownerTeamIds",
      "publishing:showOnStatusPages",
      "publishing:notifySubscribers",
    ]);
    expect(fields[6]!.fieldType).toBe(FormFieldSchemaType.Toggle);
  });

  test("starts on the stored settings, dropping records the dialog cannot offer", () => {
    expect(
      getFormSettingsInitialValues({
        targetType: FormTargetType.Incident,
        settings: {
          defaultTitle: "Report",
          incidentSeverityId: GONE_ID,
          incidentTemplateId: TEMPLATE_ID,
          monitorIds: [MONITOR_ID, GONE_ID],
          onCallDutyPolicyIds: [POLICY_ID],
        },
        reference: REFERENCE,
      }),
    ).toEqual({
      defaultTitle: "Report",
      incidentTemplateId: TEMPLATE_ID,
      monitorIds: [MONITOR_ID],
      labelIds: [],
      onCallDutyPolicyIds: [POLICY_ID],
      ownerUserIds: [],
      ownerTeamIds: [],
    });

    expect(
      getFormSettingsInitialValues({
        targetType: FormTargetType.ScheduledMaintenance,
        settings: { statusPageIds: [PAGE_ID], showOnStatusPages: true },
        reference: REFERENCE,
      }),
    ).toEqual({
      defaultTitle: "",
      monitorIds: [],
      labelIds: [],
      ownerUserIds: [],
      ownerTeamIds: [],
      statusPageIds: [PAGE_ID],
      showOnStatusPages: true,
      notifySubscribers: false,
    });
  });

  test("saves what was chosen - picked options or plain values - and leaves out what was not", () => {
    const packed: JSONObject = packFormSettingsValues({
      targetType: FormTargetType.Incident,
      values: {
        defaultTitle: "  Report  ",
        incidentSeverityId: { value: SEVERITY_ID.toUpperCase(), label: "Major" } as never,
        incidentTemplateId: "",
        monitorIds: [{ value: MONITOR_ID, label: "API" }, MONITOR_ID] as never,
        labelIds: [],
        onCallDutyPolicyIds: POLICY_ID,
        ownerUserIds: null,
        showOnStatusPages: true,
      },
    });

    expect(packed).toEqual({
      defaultTitle: "Report",
      incidentSeverityId: SEVERITY_ID,
      monitorIds: [MONITOR_ID],
      onCallDutyPolicyIds: [POLICY_ID],
    });
    expect(
      validateFormTargetSettings({ targetType: FormTargetType.Incident, value: packed }),
    ).toBeNull();
  });

  test("a maintenance form saves its switches only when on", () => {
    const packed: JSONObject = packFormSettingsValues({
      targetType: FormTargetType.ScheduledMaintenance,
      values: {
        statusPageIds: [PAGE_ID],
        showOnStatusPages: "true",
        notifySubscribers: false,
        incidentSeverityId: SEVERITY_ID,
      },
    });

    expect(packed).toEqual({ statusPageIds: [PAGE_ID], showOnStatusPages: true });
    expect(
      validateFormTargetSettings({
        targetType: FormTargetType.ScheduledMaintenance,
        value: packed,
      }),
    ).toBeNull();
  });

  test("what it starts on saves back unchanged", () => {
    const settings: JSONObject = {
      defaultTitle: "Report",
      incidentSeverityId: SEVERITY_ID,
      incidentTemplateId: TEMPLATE_ID,
      monitorIds: [MONITOR_ID],
      labelIds: [LABEL_ID],
      onCallDutyPolicyIds: [POLICY_ID],
      ownerUserIds: [USER_ID],
      ownerTeamIds: [TEAM_ID],
    };

    expect(
      packFormSettingsValues({
        targetType: FormTargetType.Incident,
        values: getFormSettingsInitialValues({
          targetType: FormTargetType.Incident,
          settings,
          reference: REFERENCE,
        }),
      }),
    ).toEqual(settings);
  });
});

describe("naming records", () => {
  test("by name, a deleted one by the label given", () => {
    expect(
      nameRecords({
        lists: REFERENCE.lists,
        model: FormTargetSettingReferenceModel.Monitor,
        ids: [MONITOR_ID.toUpperCase(), GONE_ID],
        deletedLabel: "Deleted",
      }),
    ).toEqual(["API", "Deleted"]);
    expect(
      nameRecords({
        lists: {},
        model: FormTargetSettingReferenceModel.Team,
        ids: undefined,
        deletedLabel: "",
      }),
    ).toEqual([]);
  });

  test("as dropdown options", () => {
    expect(toDropdownOptions(records([TEAM_ID, "SRE"]))).toEqual([
      { value: TEAM_ID, label: "SRE" },
    ]);
    expect(toDropdownOptions(undefined)).toEqual([]);
  });
});
