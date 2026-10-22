import { DropdownOption } from "../Dropdown/Dropdown";
import ModelAPI, { ListResult } from "../../Utils/ModelAPI/ModelAPI";
import ArchivedValuePicker from "../../Utils/ArchivedValuePicker";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Select from "../../../Types/BaseDatabase/Select";
import Sort from "../../../Types/BaseDatabase/Sort";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  Argument,
  ComponentInputType,
} from "../../../Types/Workflow/Component";

/*
 * THE SETTINGS WHOSE VALUE IS ONE OF THE PROJECT'S RECORDS, PICKED FROM A LIST.
 *
 * Execute Workflow's Workflow, Create One Incident's Incident Template, a
 * Page step's Severity and the Huntress trigger's incident severities are
 * dropdowns of the project's records, listed
 * through the API as the person editing the workflow: a record they may not
 * read is not offered, and where they may read none - or their plan includes
 * none - the list is empty. Each type names the model it lists, the column a
 * record is called by in the list, the column the list is in order of when
 * that is not its name (severities run from the most severe down), and
 * whether the workflow being edited is left out (a workflow cannot run
 * itself).
 */

export interface RecordChoiceSource {
  modelType: { new (): BaseModel };
  labelColumn: string;
  // The column the list is sorted by, ascending. Default: labelColumn.
  sortColumn?: string | undefined;
  excludesCurrentWorkflow: boolean;
}

const SOURCES: Partial<Record<ComponentInputType, RecordChoiceSource>> = {
  [ComponentInputType.WorkflowSelect]: {
    modelType: Workflow,
    labelColumn: "name",
    excludesCurrentWorkflow: true,
  },
  [ComponentInputType.IncidentTemplateSelect]: {
    modelType: IncidentTemplate,
    labelColumn: "templateName",
    excludesCurrentWorkflow: false,
  },
  [ComponentInputType.AlertSeveritySelect]: {
    modelType: AlertSeverity,
    labelColumn: "name",
    // The project's own order: the most severe first.
    sortColumn: "order",
    excludesCurrentWorkflow: false,
  },
  [ComponentInputType.IncidentSeveritySelect]: {
    modelType: IncidentSeverity,
    labelColumn: "name",
    // The project's own order: the most severe first.
    sortColumn: "order",
    excludesCurrentWorkflow: false,
  },
};

type GetRecordChoiceSourceFunction = (
  type: ComponentInputType,
) => RecordChoiceSource | null;

export const getRecordChoiceSource: GetRecordChoiceSourceFunction = (
  type: ComponentInputType,
): RecordChoiceSource | null => {
  return SOURCES[type] || null;
};

type GetRecordChoiceTypesFunction = (
  args: Array<Argument> | undefined,
) => Array<ComponentInputType>;

// The record-choice types a step's settings use, each once, in their order.
export const getRecordChoiceTypes: GetRecordChoiceTypesFunction = (
  args: Array<Argument> | undefined,
): Array<ComponentInputType> => {
  const types: Array<ComponentInputType> = [];

  for (const arg of args || []) {
    if (getRecordChoiceSource(arg.type) && !types.includes(arg.type)) {
      types.push(arg.type);
    }
  }

  return types;
};

type LoadRecordChoicesFunction = (data: {
  type: ComponentInputType;
  // The workflow being edited.
  workflowId: ObjectID;
}) => Promise<Array<DropdownOption>>;

/*
 * The options of one record-choice setting: the records by name, in the
 * source's order (their names', unless it says otherwise), each one's value
 * its ID. A record with no name is listed by its ID rather than left out.
 */
export const loadRecordChoices: LoadRecordChoicesFunction = async (data: {
  type: ComponentInputType;
  workflowId: ObjectID;
}): Promise<Array<DropdownOption>> => {
  const source: RecordChoiceSource | null = getRecordChoiceSource(data.type);

  if (!source) {
    return [];
  }

  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: source.modelType,
    query: {},
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: {
      _id: true,
      [source.labelColumn]: true,
      // An archived severity a step already names is shown, never offered.
      ...ArchivedValuePicker.getSelectedValueSelect(source.modelType),
    } as Select<BaseModel>,
    sort: {
      [source.sortColumn || source.labelColumn]: SortOrder.Ascending,
    } as Sort<BaseModel>,
  });

  const currentWorkflowId: string = data.workflowId.toString();

  const records: Array<BaseModel> = result.data.filter(
    (record: BaseModel): boolean => {
      return !(
        source.excludesCurrentWorkflow &&
        record._id?.toString() === currentWorkflowId
      );
    },
  );

  /*
   * An archived value (Common/Utils/ArchivableValues) comes last, marked
   * Archived and never picked: a step that already names one still shows
   * it - a workflow keeps running as it was built - and nobody picks it
   * for a step again.
   */
  return [
    ...ArchivedValuePicker.getLiveValues(records),
    ...records.filter((record: BaseModel): boolean => {
      return ArchivedValuePicker.isArchived(record);
    }),
  ].map((record: BaseModel): DropdownOption => {
    const id: string = record._id?.toString() ?? "";
    const label: unknown = (record as unknown as Record<string, unknown>)[
      source.labelColumn
    ];

    const option: DropdownOption = {
      label: typeof label === "string" && label ? label : id,
      value: id,
    };

    // The dropdown draws the Archived tag beside it (ArchivedTag).
    if (ArchivedValuePicker.isArchived(record)) {
      option.isArchived = true;
      option.isDisabled = true;
    }

    return option;
  });
};
