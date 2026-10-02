import { loadFormRecordOptions } from "../FormBuilderData";
import ProjectUser from "../../../Utils/ProjectUser";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { FormRecordOption } from "Common/Types/Form/FormPublic";
import { FormTargetOptionsSource } from "Common/Types/Form/FormTargetCatalog";
import { FormTargetSettingReferenceModel } from "Common/Types/Form/FormTargetSettings";
import FormTargetType from "Common/Types/Form/FormTargetType";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * The records a form's On Submit settings can name - severities, templates,
 * monitors, labels, on-call policies, users, teams, status pages - read once
 * for the On Submit page: its table names them, and its editor offers them.
 * Only the kinds the form's target has settings for are read.
 */

export type FormReferenceLists = Partial<
  Record<FormTargetSettingReferenceModel, Array<FormRecordOption>>
>;

export interface FormReferenceData {
  lists: FormReferenceLists;
  /*
   * The incident templates that set a severity of their own: a form left
   * without one declares its incidents with the template's.
   */
  templateIdsWithSeverity: Array<string>;
}

interface TemplateData {
  options: Array<FormRecordOption>;
  idsWithSeverity: Array<string>;
}

type LoadTemplatesFunction = () => Promise<TemplateData>;

const loadTemplates: LoadTemplatesFunction =
  async (): Promise<TemplateData> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return { options: [], idsWithSeverity: [] };
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

    const options: Array<FormRecordOption> = [];
    const idsWithSeverity: Array<string> = [];

    for (const template of result.data) {
      if (!template._id) {
        continue;
      }

      const id: string = template._id.toString().toLowerCase();

      options.push({ id: id, name: template.templateName || "" });

      if (template.incidentSeverityId) {
        idsWithSeverity.push(id);
      }
    }

    return { options, idsWithSeverity };
  };

type LoadListFunction = () => Promise<Array<FormRecordOption>>;

const loadPolicies: LoadListFunction = async (): Promise<
  Array<FormRecordOption>
> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const result: ListResult<OnCallDutyPolicy> =
    await ModelAPI.getList<OnCallDutyPolicy>({
      modelType: OnCallDutyPolicy,
      query: { projectId: projectId },
      select: { _id: true, name: true },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

  return result.data
    .filter((policy: OnCallDutyPolicy): boolean => {
      return Boolean(policy._id);
    })
    .map((policy: OnCallDutyPolicy): FormRecordOption => {
      return {
        id: policy._id!.toString().toLowerCase(),
        name: policy.name || "",
      };
    });
};

const loadTeams: LoadListFunction = async (): Promise<
  Array<FormRecordOption>
> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const result: ListResult<Team> = await ModelAPI.getList<Team>({
    modelType: Team,
    query: { projectId: projectId },
    select: { _id: true, name: true },
    sort: { name: SortOrder.Ascending },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
  });

  return result.data
    .filter((team: Team): boolean => {
      return Boolean(team._id);
    })
    .map((team: Team): FormRecordOption => {
      return { id: team._id!.toString().toLowerCase(), name: team.name || "" };
    });
};

const loadUsers: LoadListFunction = async (): Promise<
  Array<FormRecordOption>
> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const options: Array<DropdownOption> =
    await ProjectUser.fetchProjectUsersAsDropdownOptions(projectId);

  return options.map((option: DropdownOption): FormRecordOption => {
    return {
      id: option.value.toString().toLowerCase(),
      name: option.label,
    };
  });
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

type LoadModelFunction = (
  model: FormTargetSettingReferenceModel,
) => Promise<Array<FormRecordOption>>;

const loadModel: LoadModelFunction = async (
  model: FormTargetSettingReferenceModel,
): Promise<Array<FormRecordOption>> => {
  switch (model) {
    case FormTargetSettingReferenceModel.IncidentSeverity:
      return await loadFormRecordOptions(
        FormTargetOptionsSource.IncidentSeverity,
      );
    case FormTargetSettingReferenceModel.Monitor:
      return await loadFormRecordOptions(FormTargetOptionsSource.Monitor);
    case FormTargetSettingReferenceModel.Label:
      return await loadFormRecordOptions(FormTargetOptionsSource.Label);
    case FormTargetSettingReferenceModel.StatusPage:
      return await loadFormRecordOptions(FormTargetOptionsSource.StatusPage);
    case FormTargetSettingReferenceModel.OnCallDutyPolicy:
      return await loadPolicies();
    case FormTargetSettingReferenceModel.Team:
      return await loadTeams();
    case FormTargetSettingReferenceModel.User:
      return await loadUsers();
    default:
      return [];
  }
};

export type LoadFormReferenceDataFunction = (
  targetType: FormTargetType,
) => Promise<FormReferenceData>;

/** Every kind of record the target's settings can name, in the project. */
export const loadFormReferenceData: LoadFormReferenceDataFunction = async (
  targetType: FormTargetType,
): Promise<FormReferenceData> => {
  const models: Array<FormTargetSettingReferenceModel> =
    FORM_REFERENCE_MODELS_BY_TARGET[targetType] || [];

  const withTemplates: boolean = models.includes(
    FormTargetSettingReferenceModel.IncidentTemplate,
  );

  const otherModels: Array<FormTargetSettingReferenceModel> = models.filter(
    (model: FormTargetSettingReferenceModel): boolean => {
      return model !== FormTargetSettingReferenceModel.IncidentTemplate;
    },
  );

  const [templates, lists]: [TemplateData, Array<Array<FormRecordOption>>] =
    await Promise.all([
      withTemplates
        ? loadTemplates()
        : Promise.resolve({ options: [], idsWithSeverity: [] }),
      Promise.all(
        otherModels.map(
          (
            model: FormTargetSettingReferenceModel,
          ): Promise<Array<FormRecordOption>> => {
            return loadModel(model);
          },
        ),
      ),
    ]);

  const result: FormReferenceLists = {};

  otherModels.forEach(
    (model: FormTargetSettingReferenceModel, index: number): void => {
      result[model] = lists[index] || [];
    },
  );

  if (withTemplates) {
    result[FormTargetSettingReferenceModel.IncidentTemplate] =
      templates.options;
  }

  return {
    lists: result,
    templateIdsWithSeverity: templates.idsWithSeverity,
  };
};

export type NameRecordsFunction = (data: {
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  ids: Array<string> | undefined;
  deletedLabel: string;
}) => Array<string>;

/*
 * The names of the records a setting names, in its order. A record deleted
 * since is named as such: the next save leaves it out.
 */
export const nameRecords: NameRecordsFunction = (data: {
  lists: FormReferenceLists;
  model: FormTargetSettingReferenceModel;
  ids: Array<string> | undefined;
  deletedLabel: string;
}): Array<string> => {
  const records: Array<FormRecordOption> = data.lists[data.model] || [];

  return (data.ids || []).map((id: string): string => {
    const record: FormRecordOption | undefined = records.find(
      (candidate: FormRecordOption): boolean => {
        return candidate.id === id.toLowerCase();
      },
    );

    return record ? record.name : data.deletedLabel;
  });
};

export type ToDropdownOptionsFunction = (
  records: Array<FormRecordOption> | undefined,
) => Array<DropdownOption>;

export const toDropdownOptions: ToDropdownOptionsFunction = (
  records: Array<FormRecordOption> | undefined,
): Array<DropdownOption> => {
  return (records || []).map((record: FormRecordOption): DropdownOption => {
    return { value: record.id, label: record.name };
  });
};
