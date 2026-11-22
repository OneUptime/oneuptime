import { loadFormRecordOptions } from "../FormBuilderData";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { FormRecordOption } from "Common/Types/Form/FormPublic";
import { FormTargetOptionsSource } from "Common/Types/Form/FormTargetCatalog";
import {
  FormTargetSettingReference,
  FormTargetSettingReferenceModel,
  getFormTargetSettingReferences,
  readFormTargetSettings,
} from "Common/Types/Form/FormTargetSettings";
import FormTargetType from "Common/Types/Form/FormTargetType";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Color from "Common/Types/Color";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import RecordsById from "Common/UI/Utils/RecordsById";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";

/*
 * The records a form's On Submit settings name - severities, templates,
 * monitors, labels, on-call policies, users, teams, status pages - read for
 * the On Submit page: its table names them, and its editor starts from
 * them. Only the kinds the form's target has settings for are read.
 *
 * What the settings hold is read by its ids, never looked for in a read of
 * the whole project (#10646). The page read every monitor of the project -
 * the first 10,000 by name - so a saved monitor past them read "Deleted",
 * and the next save of the dialog left it out of the form. A record that a
 * read by its id does not find is the one that is gone.
 *
 * The editor's pickers of the kinds a project can have any number of -
 * monitors, labels, on-call policies, status pages, people and teams -
 * search the server as they are typed in, so nothing else of those is read
 * here. Severities and incident templates are picked from short lists, read
 * whole as before; a saved one missing from them (archived since, say) is
 * read by its id too, so it is named.
 */

/*
 * A record a setting can name, as the page shows it. An archived value a
 * setting still names (a label or a severity archived since) is marked: it
 * is shown, Archived, and never offered for a new pick.
 */
export interface FormReferenceRecord extends FormRecordOption {
  isArchived?: boolean | undefined;
}

export type FormReferenceLists = Partial<
  Record<FormTargetSettingReferenceModel, Array<FormReferenceRecord>>
>;

export interface FormReferenceData {
  lists: FormReferenceLists;
  /*
   * The incident templates that set a severity of their own: a form left
   * without one declares its incidents with the template's.
   */
  templateIdsWithSeverity: Array<string>;
}

// The kinds whose picker is a short list, read whole (FormSettingsEditor).
export const FORM_REFERENCE_LISTED_MODELS: Array<FormTargetSettingReferenceModel> =
  [
    FormTargetSettingReferenceModel.IncidentSeverity,
    FormTargetSettingReferenceModel.IncidentTemplate,
  ];

interface ReferenceRecords {
  records: Array<FormReferenceRecord>;
  // Of templates: the ones that set a severity of their own.
  idsWithSeverity: Array<string>;
}

const NO_RECORDS: ReferenceRecords = { records: [], idsWithSeverity: [] };

type ToTemplateRecordsFunction = (
  templates: Array<IncidentTemplate>,
) => ReferenceRecords;

const toTemplateRecords: ToTemplateRecordsFunction = (
  templates: Array<IncidentTemplate>,
): ReferenceRecords => {
  const records: Array<FormReferenceRecord> = [];
  const idsWithSeverity: Array<string> = [];

  for (const template of templates) {
    if (!template._id) {
      continue;
    }

    const id: string = template._id.toString().toLowerCase();

    records.push({ id: id, name: template.templateName || "" });

    if (template.incidentSeverityId) {
      idsWithSeverity.push(id);
    }
  }

  return { records, idsWithSeverity };
};

type LoadTemplatesFunction = () => Promise<ReferenceRecords>;

const loadTemplates: LoadTemplatesFunction =
  async (): Promise<ReferenceRecords> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return NO_RECORDS;
    }

    const result: ListResult<IncidentTemplate> =
      await ModelAPI.getList<IncidentTemplate>({
        modelType: IncidentTemplate,
        query: { projectId: projectId },
        select: { _id: true, templateName: true, incidentSeverityId: true },
        sort: { templateName: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    return toTemplateRecords(result.data);
  };

// The kinds of record each target's settings can name.
export const FORM_REFERENCE_MODELS_BY_TARGET: Record<
  FormTargetType,
  Array<FormTargetSettingReferenceModel>
> = {
  [FormTargetType.Incident]: [
    FormTargetSettingReferenceModel.IncidentSeverity,
    FormTargetSettingReferenceModel.IncidentTemplate,
    FormTargetSettingReferenceModel.Monitor,
    FormTargetSettingReferenceModel.Label,
    FormTargetSettingReferenceModel.OnCallDutyPolicy,
    FormTargetSettingReferenceModel.User,
    FormTargetSettingReferenceModel.Team,
  ],
  [FormTargetType.ScheduledMaintenance]: [
    FormTargetSettingReferenceModel.Monitor,
    FormTargetSettingReferenceModel.StatusPage,
    FormTargetSettingReferenceModel.Label,
    FormTargetSettingReferenceModel.User,
    FormTargetSettingReferenceModel.Team,
  ],
};

/*
 * How the records of each kind a setting names are read by their ids: the
 * model, what to read of it, and how a row is named. People are read
 * through their membership of the project (TeamMember, by userId): it is
 * the only link to them the dashboard can list.
 */
interface HeldRecordRead {
  modelType: { new (): BaseModel };
  select: Select<BaseModel>;
  // The column the ids are in, when it is not the record's own id.
  column?: string | undefined;
  toRecord: (row: BaseModel) => FormReferenceRecord | null;
}

type ToNamedRecordFunction = (row: BaseModel) => FormReferenceRecord | null;

// A record by its id and name, with its colour and whether it is archived.
const toNamedRecord: ToNamedRecordFunction = (
  row: BaseModel,
): FormReferenceRecord | null => {
  const values: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  const id: string | undefined = row._id?.toString();

  if (!id) {
    return null;
  }

  const record: FormReferenceRecord = {
    id: id.toLowerCase(),
    name: typeof values["name"] === "string" ? (values["name"] as string) : "",
  };

  const color: unknown = values["color"];

  if (color) {
    record.color = (color as { toString: () => string }).toString();
  }

  if (values["isArchived"] === true) {
    record.isArchived = true;
  }

  return record;
};

const HELD_RECORD_READS: Record<
  FormTargetSettingReferenceModel,
  HeldRecordRead
> = {
  [FormTargetSettingReferenceModel.IncidentSeverity]: {
    modelType: IncidentSeverity,
    select: { _id: true, name: true, color: true, isArchived: true } as never,
    toRecord: toNamedRecord,
  },
  [FormTargetSettingReferenceModel.IncidentTemplate]: {
    modelType: IncidentTemplate,
    select: {
      _id: true,
      templateName: true,
      incidentSeverityId: true,
    } as never,
    // Templates are named by toTemplateRecords, with their severities.
    toRecord: (): FormReferenceRecord | null => {
      return null;
    },
  },
  [FormTargetSettingReferenceModel.Monitor]: {
    modelType: Monitor,
    select: { _id: true, name: true } as never,
    toRecord: toNamedRecord,
  },
  [FormTargetSettingReferenceModel.Label]: {
    modelType: Label,
    select: { _id: true, name: true, color: true, isArchived: true } as never,
    toRecord: toNamedRecord,
  },
  [FormTargetSettingReferenceModel.OnCallDutyPolicy]: {
    modelType: OnCallDutyPolicy,
    select: { _id: true, name: true } as never,
    toRecord: toNamedRecord,
  },
  [FormTargetSettingReferenceModel.StatusPage]: {
    modelType: StatusPage,
    select: { _id: true, name: true } as never,
    toRecord: toNamedRecord,
  },
  [FormTargetSettingReferenceModel.Team]: {
    modelType: Team,
    select: { _id: true, name: true } as never,
    toRecord: toNamedRecord,
  },
  [FormTargetSettingReferenceModel.User]: {
    modelType: TeamMember,
    column: "userId",
    select: {
      userId: true,
      user: { _id: true, name: true, email: true },
    } as never,
    toRecord: (row: BaseModel): FormReferenceRecord | null => {
      const member: TeamMember = row as TeamMember;
      const userId: string | undefined = member.userId?.toString();

      if (!userId) {
        return null;
      }

      return {
        id: userId.toLowerCase(),
        // A person's name or email, as they gave it.
        name:
          member.user?.name?.toString() || member.user?.email?.toString() || "",
      };
    },
  },
};

type LoadHeldRecordsFunction = (data: {
  model: FormTargetSettingReferenceModel;
  ids: Array<string>;
}) => Promise<ReferenceRecords>;

/*
 * The records of one kind the settings name, read by their ids: each once.
 * One the read does not answer is gone, or out of the reader's reach.
 */
export const loadHeldFormReferenceRecords: LoadHeldRecordsFunction =
  async (data: {
    model: FormTargetSettingReferenceModel;
    ids: Array<string>;
  }): Promise<ReferenceRecords> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const read: HeldRecordRead | undefined = HELD_RECORD_READS[data.model];

    if (!projectId || !read || data.ids.length === 0) {
      return NO_RECORDS;
    }

    const rows: Array<BaseModel> = await RecordsById.read<BaseModel>({
      modelType: read.modelType,
      ids: data.ids,
      column: read.column,
      query: { projectId: projectId } as Query<BaseModel>,
      select: read.select,
    });

    if (data.model === FormTargetSettingReferenceModel.IncidentTemplate) {
      return toTemplateRecords(rows as Array<IncidentTemplate>);
    }

    const records: Array<FormReferenceRecord> = [];
    const seen: Set<string> = new Set<string>();

    for (const row of rows) {
      const record: FormReferenceRecord | null = read.toRecord(row);

      if (!record || seen.has(record.id)) {
        continue;
      }

      seen.add(record.id);
      records.push(record);
    }

    return { records, idsWithSeverity: [] };
  };

type LoadListedRecordsFunction = (
  model: FormTargetSettingReferenceModel,
) => Promise<ReferenceRecords>;

// The short lists a picker offers whole: severities and templates.
const loadListedRecords: LoadListedRecordsFunction = async (
  model: FormTargetSettingReferenceModel,
): Promise<ReferenceRecords> => {
  switch (model) {
    case FormTargetSettingReferenceModel.IncidentSeverity:
      return {
        records: await loadFormRecordOptions(
          FormTargetOptionsSource.IncidentSeverity,
        ),
        idsWithSeverity: [],
      };
    case FormTargetSettingReferenceModel.IncidentTemplate:
      return await loadTemplates();
    default:
      return NO_RECORDS;
  }
};

type GetHeldIdsFunction = (data: {
  targetType: FormTargetType;
  settings: unknown;
}) => Map<FormTargetSettingReferenceModel, Array<string>>;

// The ids the stored settings hold, by the kind of record they name.
export const getHeldFormReferenceIds: GetHeldIdsFunction = (data: {
  targetType: FormTargetType;
  settings: unknown;
}): Map<FormTargetSettingReferenceModel, Array<string>> => {
  const held: Map<FormTargetSettingReferenceModel, Array<string>> = new Map();

  const references: Array<FormTargetSettingReference> =
    getFormTargetSettingReferences({
      targetType: data.targetType,
      settings: readFormTargetSettings({
        targetType: data.targetType,
        value: data.settings,
      }),
    });

  for (const reference of references) {
    const ids: Array<string> = held.get(reference.model) || [];

    for (const id of reference.ids) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }

    held.set(reference.model, ids);
  }

  return held;
};

export type LoadFormReferenceDataFunction = (
  targetType: FormTargetType,
  // The form's stored settings: the records they hold are read by their ids.
  settings?: unknown,
) => Promise<FormReferenceData>;

/*
 * The records the target's settings name, and the short lists the severity
 * and template pickers offer.
 */
export const loadFormReferenceData: LoadFormReferenceDataFunction = async (
  targetType: FormTargetType,
  settings?: unknown,
): Promise<FormReferenceData> => {
  const models: Array<FormTargetSettingReferenceModel> =
    FORM_REFERENCE_MODELS_BY_TARGET[targetType] || [];
  const heldIds: Map<
    FormTargetSettingReferenceModel,
    Array<string>
  > = getHeldFormReferenceIds({ targetType, settings });

  const loaded: Array<ReferenceRecords> = await Promise.all(
    models.map(
      async (
        model: FormTargetSettingReferenceModel,
      ): Promise<ReferenceRecords> => {
        const listed: ReferenceRecords = FORM_REFERENCE_LISTED_MODELS.includes(
          model,
        )
          ? await loadListedRecords(model)
          : NO_RECORDS;

        const listedIds: Set<string> = new Set<string>(
          listed.records.map((record: FormReferenceRecord): string => {
            return record.id;
          }),
        );

        // What the settings hold that the list did not have, by its id.
        const held: ReferenceRecords = await loadHeldFormReferenceRecords({
          model,
          ids: (heldIds.get(model) || []).filter((id: string): boolean => {
            return !listedIds.has(id.toLowerCase());
          }),
        });

        return {
          records: [...listed.records, ...held.records],
          idsWithSeverity: [...listed.idsWithSeverity, ...held.idsWithSeverity],
        };
      },
    ),
  );

  const lists: FormReferenceLists = {};
  const templateIdsWithSeverity: Array<string> = [];

  models.forEach(
    (model: FormTargetSettingReferenceModel, index: number): void => {
      lists[model] = loaded[index]?.records || [];

      if (model === FormTargetSettingReferenceModel.IncidentTemplate) {
        templateIdsWithSeverity.push(...(loaded[index]?.idsWithSeverity || []));
      }
    },
  );

  return { lists, templateIdsWithSeverity };
};

/*
 * A record a setting names: its name, or, for one deleted since, none. The
 * page says "Deleted" in the reader's language in its place
 * (FormsCopy.deletedRecord), and the dialog shows it so, to keep or take out.
 */
export interface NamedRecord {
  name: string;
  isDeleted: boolean;
}

export type NameRecordsFunction = (data: {
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  ids: Array<string> | undefined;
}) => Array<NamedRecord>;

/*
 * The records a setting names, in its order. A record deleted since is
 * marked, not named: a name is drawn as written, so a word put in its place
 * here reached every page in English (#7857), and a record really called
 * "Deleted" could not be told from one that is gone.
 */
export const nameRecords: NameRecordsFunction = (data: {
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  ids: Array<string> | undefined;
}): Array<NamedRecord> => {
  const records: Array<FormReferenceRecord> = data.lists[data.model] || [];

  return (data.ids || []).map((id: string): NamedRecord => {
    const record: FormReferenceRecord | undefined = records.find(
      (candidate: FormReferenceRecord): boolean => {
        return candidate.id === id.toLowerCase();
      },
    );

    return record
      ? { name: record.name, isDeleted: false }
      : { name: "", isDeleted: true };
  });
};

export type NameRecordFunction = (data: {
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  id: string | undefined;
}) => string | undefined;

/*
 * The name of the one record a setting names (the incident template, the
 * severity), or undefined when it names none or one deleted since: the page
 * then says what applies without it.
 */
export const nameRecord: NameRecordFunction = (data: {
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  id: string | undefined;
}): string | undefined => {
  if (!data.id) {
    return undefined;
  }

  const named: NamedRecord | undefined = nameRecords({
    lists: data.lists,
    model: data.model,
    ids: [data.id],
  })[0];

  return named && !named.isDeleted ? named.name || undefined : undefined;
};

export type ToDropdownOptionsFunction = (
  records: Array<FormReferenceRecord> | undefined,
  model?: FormTargetSettingReferenceModel,
) => Array<DropdownOption>;

/*
 * A record with a colour - a severity, a label - keeps it: the Severity
 * setting shows each severity's dot, as every other severity picker does.
 * An archived one a setting still names is shown marked Archived, and is
 * never offered for a new pick (ArchivedValuePicker's rule).
 */
export const toDropdownOptions: ToDropdownOptionsFunction = (
  records: Array<FormReferenceRecord> | undefined,
  model?: FormTargetSettingReferenceModel,
): Array<DropdownOption> => {
  return (records || []).map((record: FormReferenceRecord): DropdownOption => {
    const option: DropdownOption = {
      value: record.id,
      label: record.name,
      /*
       * A record's name reads by its list - the model, named as its table
       * (Utils/DefaultRecordNames): a severity a new project starts with
       * is OneUptime's word, looked up ("Critical Incident" reads
       * "Incidente crítico"); a template's, a monitor's, a team's name -
       * and a severity the project named itself - is drawn as written.
       */
      isUserContent: isRecordNameAsWritten(model, record.name),
    };
    const color: Color | undefined = DropdownUtil.toOptionColor(record.color);

    if (color) {
      option.color = color;
    }

    if (record.isArchived) {
      option.isArchived = true;
      option.isDisabled = true;
    }

    return option;
  });
};
