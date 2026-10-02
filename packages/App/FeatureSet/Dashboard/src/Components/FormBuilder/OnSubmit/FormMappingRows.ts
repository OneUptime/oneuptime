import FormsCopy from "../FormsCopy";
import {
  FormReferenceData,
  FormReferenceLists,
  nameRecords,
} from "./FormOnSubmitData";
import {
  FormField,
  FormFieldSource,
  findTargetField,
} from "Common/Types/Form/FormField";
import { FormCustomFieldDefinition } from "Common/Types/Form/FormPublic";
import {
  FormTargetSettingReferenceModel,
  IncidentFormTargetSettings,
  ScheduledMaintenanceFormTargetSettings,
} from "Common/Types/Form/FormTargetSettings";
import FormTargetType from "Common/Types/Form/FormTargetType";

/*
 * The On Submit page's table: for each field of what a submission creates,
 * where its value comes from - the answer to a question, a setting of the
 * form, the incident template, or nothing. The rows are worked out here,
 * without React, so what the page promises is tested against the same rules
 * the server follows (Server/Utils/Form/*FormTarget).
 *
 * Every text is English: the page translates each line as it draws it.
 * Names (of questions, severities, monitors) are shown as they are.
 */

export enum FormMappingLineKind {
  // The answer to a question, named in quotes after "Answer to the question:".
  Answer = "Answer",
  // "If it is left empty:" what applies then.
  Fallback = "Fallback",
  // "Always added:" records named in the settings.
  Always = "Always",
  // A value - a name, or one of FormsCopy's sentences.
  Value = "Value",
  // Something that keeps submissions from working.
  Warning = "Warning",
  // A custom field and the question that fills it.
  CustomField = "CustomField",
}

export interface FormMappingLine {
  kind: FormMappingLineKind;
  /*
   * The question's label (Answer, CustomField), the value (Value, Fallback,
   * Warning) or names (Always, joined by the page).
   */
  text: string;
  names?: Array<string> | undefined;
  // For CustomField: the custom field's name.
  customFieldName?: string | undefined;
  // Whether text is one of FormsCopy's sentences, to translate.
  isCopy?: boolean | undefined;
}

export interface FormMappingRow {
  key: string;
  // The field's name, in English.
  title: string;
  lines: Array<FormMappingLine>;
}

type AnswerLinesFunction = (data: {
  fields: Array<FormField>;
  key: string;
}) => Array<FormMappingLine> | null;

// The answer line for a built-in field the form asks, or null.
const answerLines: AnswerLinesFunction = (data: {
  fields: Array<FormField>;
  key: string;
}): Array<FormMappingLine> | null => {
  const question: FormField | undefined = findTargetField(
    data.fields,
    data.key,
  );

  if (!question) {
    return null;
  }

  return [{ kind: FormMappingLineKind.Answer, text: question.label }];
};

type IsRequiredFunction = (fields: Array<FormField>, key: string) => boolean;

const isRequired: IsRequiredFunction = (
  fields: Array<FormField>,
  key: string,
): boolean => {
  return findTargetField(fields, key)?.isRequired === true;
};

const notAsked: FormMappingLine = {
  kind: FormMappingLineKind.Value,
  text: FormsCopy.notAsked,
  isCopy: true,
};

const notSet: FormMappingLine = {
  kind: FormMappingLineKind.Value,
  text: FormsCopy.notSet,
  isCopy: true,
};

type TitleRowFunction = (data: {
  fields: Array<FormField>;
  defaultTitle: string | undefined;
}) => FormMappingRow;

const titleRow: TitleRowFunction = (data: {
  fields: Array<FormField>;
  defaultTitle: string | undefined;
}): FormMappingRow => {
  const fallback: FormMappingLine = data.defaultTitle
    ? { kind: FormMappingLineKind.Value, text: data.defaultTitle }
    : { kind: FormMappingLineKind.Value, text: FormsCopy.formNameAsTitle, isCopy: true };

  const asked: Array<FormMappingLine> | null = answerLines({
    fields: data.fields,
    key: "title",
  });

  if (!asked) {
    return { key: "title", title: "Title", lines: [fallback] };
  }

  return {
    key: "title",
    title: "Title",
    lines: isRequired(data.fields, "title")
      ? asked
      : [
          ...asked,
          {
            kind: FormMappingLineKind.Fallback,
            text: fallback.text,
            isCopy: fallback.isCopy,
          },
        ],
  };
};

type AskedOrNotRowFunction = (data: {
  fields: Array<FormField>;
  key: string;
  title: string;
}) => FormMappingRow;

const askedOrNotRow: AskedOrNotRowFunction = (data: {
  fields: Array<FormField>;
  key: string;
  title: string;
}): FormMappingRow => {
  return {
    key: data.key,
    title: data.title,
    lines: answerLines({ fields: data.fields, key: data.key }) || [notAsked],
  };
};

type RecordsRowFunction = (data: {
  fields: Array<FormField>;
  key: string;
  title: string;
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  ids: Array<string> | undefined;
}) => FormMappingRow;

// A list the submitter may add to (an answer) and the settings always add to.
const recordsRow: RecordsRowFunction = (data: {
  fields: Array<FormField>;
  key: string;
  title: string;
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  ids: Array<string> | undefined;
}): FormMappingRow => {
  const lines: Array<FormMappingLine> =
    answerLines({ fields: data.fields, key: data.key }) || [];

  const names: Array<string> = nameRecords({
    lists: data.lists,
    model: data.model,
    ids: data.ids,
    deletedLabel: FormsCopy.deletedRecord,
  });

  if (names.length > 0) {
    lines.push({
      kind: FormMappingLineKind.Always,
      text: names.join(", "),
      names: names,
    });
  }

  return {
    key: data.key,
    title: data.title,
    lines: lines.length > 0 ? lines : [notSet],
  };
};

type SettingRowFunction = (data: {
  key: string;
  title: string;
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  ids: Array<string> | undefined;
  empty?: FormMappingLine | undefined;
}) => FormMappingRow;

// A setting no question fills: the records it names, or "Not set".
const settingRow: SettingRowFunction = (data: {
  key: string;
  title: string;
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  ids: Array<string> | undefined;
  empty?: FormMappingLine | undefined;
}): FormMappingRow => {
  const names: Array<string> = nameRecords({
    lists: data.lists,
    model: data.model,
    ids: data.ids,
    deletedLabel: FormsCopy.deletedRecord,
  });

  return {
    key: data.key,
    title: data.title,
    lines:
      names.length > 0
        ? [{ kind: FormMappingLineKind.Value, text: names.join(", ") }]
        : [data.empty || notSet],
  };
};

type CustomFieldsRowFunction = (data: {
  fields: Array<FormField>;
  customFields: Array<FormCustomFieldDefinition>;
}) => FormMappingRow;

const customFieldsRow: CustomFieldsRowFunction = (data: {
  fields: Array<FormField>;
  customFields: Array<FormCustomFieldDefinition>;
}): FormMappingRow => {
  const lines: Array<FormMappingLine> = [];

  for (const field of data.fields) {
    if (field.source !== FormFieldSource.TargetCustomField) {
      continue;
    }

    const definition: FormCustomFieldDefinition | undefined =
      data.customFields.find(
        (candidate: FormCustomFieldDefinition): boolean => {
          return (
            candidate.id.toLowerCase() ===
            (field.customFieldId || "").toLowerCase()
          );
        },
      );

    if (!definition) {
      continue;
    }

    lines.push({
      kind: FormMappingLineKind.CustomField,
      text: field.label,
      customFieldName: definition.name,
    });
  }

  return {
    key: "customFields",
    title: FormsCopy.customFieldsRow,
    lines: lines.length > 0 ? lines : [notAsked],
  };
};

type YesNoRowFunction = (data: {
  key: string;
  title: string;
  value: boolean | undefined;
}) => FormMappingRow;

const yesNoRow: YesNoRowFunction = (data: {
  key: string;
  title: string;
  value: boolean | undefined;
}): FormMappingRow => {
  return {
    key: data.key,
    title: data.title,
    lines: [
      {
        kind: FormMappingLineKind.Value,
        text: data.value === true ? FormsCopy.yes : FormsCopy.no,
        isCopy: true,
      },
    ],
  };
};

export type GetFormMappingRowsFunction = (data: {
  targetType: FormTargetType;
  fields: Array<FormField>;
  // Read with readFormTargetSettings for the target.
  settings:
    | IncidentFormTargetSettings
    | ScheduledMaintenanceFormTargetSettings;
  reference: FormReferenceData;
  customFields: Array<FormCustomFieldDefinition>;
}) => Array<FormMappingRow>;

/** The table's rows, in the order the page lists them. */
export const getFormMappingRows: GetFormMappingRowsFunction = (data: {
  targetType: FormTargetType;
  fields: Array<FormField>;
  settings: IncidentFormTargetSettings | ScheduledMaintenanceFormTargetSettings;
  reference: FormReferenceData;
  customFields: Array<FormCustomFieldDefinition>;
}): Array<FormMappingRow> => {
  const lists: FormReferenceLists = data.reference.lists;

  if (data.targetType === FormTargetType.ScheduledMaintenance) {
    const settings: ScheduledMaintenanceFormTargetSettings =
      data.settings as ScheduledMaintenanceFormTargetSettings;

    return [
      titleRow({ fields: data.fields, defaultTitle: settings.defaultTitle }),
      askedOrNotRow({
        fields: data.fields,
        key: "description",
        title: "Description",
      }),
      askedOrNotRow({ fields: data.fields, key: "startsAt", title: "Starts At" }),
      askedOrNotRow({ fields: data.fields, key: "endsAt", title: "Ends At" }),
      recordsRow({
        fields: data.fields,
        key: "monitors",
        title: "Monitors",
        lists,
        model: FormTargetSettingReferenceModel.Monitor,
        ids: settings.monitorIds,
      }),
      recordsRow({
        fields: data.fields,
        key: "statusPages",
        title: "Status Pages",
        lists,
        model: FormTargetSettingReferenceModel.StatusPage,
        ids: settings.statusPageIds,
      }),
      recordsRow({
        fields: data.fields,
        key: "labels",
        title: "Labels",
        lists,
        model: FormTargetSettingReferenceModel.Label,
        ids: settings.labelIds,
      }),
      settingRow({
        key: "ownerUsers",
        title: FormsCopy.ownerUsers,
        lists,
        model: FormTargetSettingReferenceModel.User,
        ids: settings.ownerUserIds,
      }),
      settingRow({
        key: "ownerTeams",
        title: FormsCopy.ownerTeams,
        lists,
        model: FormTargetSettingReferenceModel.Team,
        ids: settings.ownerTeamIds,
      }),
      yesNoRow({
        key: "showOnStatusPages",
        title: FormsCopy.showOnStatusPages,
        value: settings.showOnStatusPages,
      }),
      yesNoRow({
        key: "notifySubscribers",
        title: FormsCopy.notifySubscribers,
        value: settings.notifySubscribers,
      }),
      customFieldsRow({
        fields: data.fields,
        customFields: data.customFields,
      }),
      {
        key: "otherAnswers",
        title: FormsCopy.otherAnswersRow,
        lines: [
          {
            kind: FormMappingLineKind.Value,
            text: FormsCopy.otherAnswersScheduledMaintenance,
            isCopy: true,
          },
        ],
      },
    ];
  }

  const settings: IncidentFormTargetSettings =
    data.settings as IncidentFormTargetSettings;

  const templateName: string | undefined = settings.incidentTemplateId
    ? nameRecords({
        lists,
        model: FormTargetSettingReferenceModel.IncidentTemplate,
        ids: [settings.incidentTemplateId],
        deletedLabel: "",
      })[0] || undefined
    : undefined;

  const severityName: string | undefined = settings.incidentSeverityId
    ? nameRecords({
        lists,
        model: FormTargetSettingReferenceModel.IncidentSeverity,
        ids: [settings.incidentSeverityId],
        deletedLabel: "",
      })[0] || undefined
    : undefined;

  const templateSetsSeverity: boolean = Boolean(
    templateName &&
      settings.incidentTemplateId &&
      data.reference.templateIdsWithSeverity.includes(
        settings.incidentTemplateId.toLowerCase(),
      ),
  );

  // What the severity is when no answer gives one.
  const severityFallback: FormMappingLine = severityName
    ? { kind: FormMappingLineKind.Value, text: severityName }
    : templateSetsSeverity
      ? {
          kind: FormMappingLineKind.Value,
          text: FormsCopy.severityFromTemplate,
          isCopy: true,
        }
      : {
          kind: FormMappingLineKind.Warning,
          text: FormsCopy.noSeverityWarning,
          isCopy: true,
        };

  const severityQuestion: Array<FormMappingLine> | null = answerLines({
    fields: data.fields,
    key: "incidentSeverityId",
  });

  const severityLines: Array<FormMappingLine> = severityQuestion
    ? isRequired(data.fields, "incidentSeverityId")
      ? severityQuestion
      : [
          ...severityQuestion,
          {
            ...severityFallback,
            kind:
              severityFallback.kind === FormMappingLineKind.Warning
                ? FormMappingLineKind.Warning
                : FormMappingLineKind.Fallback,
          },
        ]
    : [severityFallback];

  return [
    titleRow({ fields: data.fields, defaultTitle: settings.defaultTitle }),
    askedOrNotRow({
      fields: data.fields,
      key: "description",
      title: "Description",
    }),
    { key: "severity", title: "Severity", lines: severityLines },
    recordsRow({
      fields: data.fields,
      key: "monitors",
      title: "Monitors",
      lists,
      model: FormTargetSettingReferenceModel.Monitor,
      ids: settings.monitorIds,
    }),
    recordsRow({
      fields: data.fields,
      key: "labels",
      title: "Labels",
      lists,
      model: FormTargetSettingReferenceModel.Label,
      ids: settings.labelIds,
    }),
    askedOrNotRow({
      fields: data.fields,
      key: "impactStartedAt",
      title: "Impact Started At",
    }),
    {
      key: "incidentTemplate",
      title: FormsCopy.incidentTemplate,
      lines: [
        templateName
          ? { kind: FormMappingLineKind.Value, text: templateName }
          : {
              kind: FormMappingLineKind.Value,
              text: FormsCopy.noTemplate,
              isCopy: true,
            },
      ],
    },
    settingRow({
      key: "onCallPolicies",
      title: FormsCopy.onCallPolicies,
      lists,
      model: FormTargetSettingReferenceModel.OnCallDutyPolicy,
      ids: settings.onCallDutyPolicyIds,
    }),
    settingRow({
      key: "ownerUsers",
      title: FormsCopy.ownerUsers,
      lists,
      model: FormTargetSettingReferenceModel.User,
      ids: settings.ownerUserIds,
    }),
    settingRow({
      key: "ownerTeams",
      title: FormsCopy.ownerTeams,
      lists,
      model: FormTargetSettingReferenceModel.Team,
      ids: settings.ownerTeamIds,
    }),
    customFieldsRow({ fields: data.fields, customFields: data.customFields }),
    {
      key: "statusPages",
      title: "Status Pages",
      lines: [
        {
          kind: FormMappingLineKind.Value,
          text: FormsCopy.statusPagesIncident,
          isCopy: true,
        },
      ],
    },
    {
      key: "otherAnswers",
      title: FormsCopy.otherAnswersRow,
      lines: [
        {
          kind: FormMappingLineKind.Value,
          text: FormsCopy.otherAnswersIncident,
          isCopy: true,
        },
      ],
    },
  ];
};
