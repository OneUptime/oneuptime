/*
 * The records a setting that names one of them lists, read through the API as
 * the person editing the workflow: a record they may not read is not offered,
 * and where they may read none - or their plan includes none - the read is
 * refused and the setting goes back to a box to type an ID into
 * (LinkedRecordInput).
 *
 * A value a project keeps few of - a severity, a state, a label - is listed
 * whole, in the project's own order where it has one. Records there can be
 * thousands of - incidents, monitors - are listed a page at a time, and a
 * search goes to the server. What each is called comes from the model
 * (ModelExamples.getDisplayColumn), its number first where it has one, as the
 * product names a numbered record everywhere: INC-8 · Database is down.
 */

import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getModelTypeByName } from "../../../../Models/DatabaseModels/Index";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import Select from "../../../../Types/BaseDatabase/Select";
import Sort from "../../../../Types/BaseDatabase/Sort";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
import { getDisplayColumn } from "../../../../Types/Workflow/Documentation/ModelExamples";
import { LINKED_USER_TABLE_NAME } from "../../../../Types/Workflow/LinkedRecord";
import {
  RecordNumberColumns,
  getRecordNumberColumns,
} from "../../../../Utils/Project/RecordNumber";
import ArchivedValuePicker from "../../../Utils/ArchivedValuePicker";
import ModelAPI, { ListResult } from "../../../Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../Utils/Project";
import { DropdownOption } from "../../Dropdown/Dropdown";
import { getPeoplePickerKindDefinition } from "../../PeoplePicker/PeoplePickerKinds";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "../../PeoplePicker/PeoplePickerTypes";

/*
 * How many records one read lists. A list of this many may have more behind
 * it, so what is typed then asks the server rather than only filtering these.
 */
export const LINKED_RECORD_LIST_LIMIT: number = 100;

// A value's place in a list the project orders itself: a severity, a state.
const ORDER_COLUMN: string = "order";

// A value's own colour, drawn beside its name in the list.
const COLOR_COLUMN: string = "color";

const CREATED_AT_COLUMN: string = "createdAt";

export interface LinkedRecordList {
  options: Array<DropdownOption>;
  // Whether that is every record, or a page of them.
  isComplete: boolean;
}

type ModelType = { new (): BaseModel };

interface ListableModel {
  modelType: ModelType;
  labelColumn: string;
  numberColumns: RecordNumberColumns | null;
  hasOrder: boolean;
  hasColor: boolean;
}

type GetListableModelFunction = (tableName: string) => ListableModel | null;

const getListableModel: GetListableModelFunction = (
  tableName: string,
): ListableModel | null => {
  const modelType: ModelType | null = getModelTypeByName(tableName);

  if (!modelType) {
    return null;
  }

  const model: BaseModel = new modelType();

  return {
    modelType: modelType,
    labelColumn: getDisplayColumn(model).id,
    numberColumns: getRecordNumberColumns(model),
    hasOrder: model.hasColumn(ORDER_COLUMN),
    hasColor: model.hasColumn(COLOR_COLUMN),
  };
};

type SelectOfFunction = (listable: ListableModel) => Select<BaseModel>;

const selectOf: SelectOfFunction = (
  listable: ListableModel,
): Select<BaseModel> => {
  return {
    _id: true,
    [listable.labelColumn]: true,
    ...(listable.numberColumns
      ? {
          [listable.numberColumns.numberColumn]: true,
          [listable.numberColumns.numberWithPrefixColumn]: true,
        }
      : {}),
    ...(listable.hasColor ? { [COLOR_COLUMN]: true } : {}),
    // An archived value a step already names is shown, never offered.
    ...ArchivedValuePicker.getSelectedValueSelect(listable.modelType),
  } as Select<BaseModel>;
};

type SortOfFunction = (listable: ListableModel) => Sort<BaseModel>;

/*
 * The project's own order where it has one, the newest first for numbered
 * records - the incident someone just made is the one they want - and otherwise
 * by name.
 */
const sortOf: SortOfFunction = (listable: ListableModel): Sort<BaseModel> => {
  if (listable.hasOrder) {
    return { [ORDER_COLUMN]: SortOrder.Ascending } as Sort<BaseModel>;
  }

  if (listable.numberColumns) {
    return { [CREATED_AT_COLUMN]: SortOrder.Descending } as Sort<BaseModel>;
  }

  return { [listable.labelColumn]: SortOrder.Ascending } as Sort<BaseModel>;
};

type TextOfFunction = (value: unknown) => string;

const textOf: TextOfFunction = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return value.toString().trim();
};

type ToOptionFunction = (
  record: BaseModel,
  listable: ListableModel,
) => DropdownOption;

const toOption: ToOptionFunction = (
  record: BaseModel,
  listable: ListableModel,
): DropdownOption => {
  const row: Record<string, unknown> = record as unknown as Record<
    string,
    unknown
  >;
  const id: string = textOf(row["_id"]);
  const name: string = textOf(row[listable.labelColumn]);
  const number: string = listable.numberColumns
    ? textOf(row[listable.numberColumns.numberWithPrefixColumn])
    : "";

  const option: DropdownOption = {
    value: id,
    // Something a person named, drawn as it is rather than looked up.
    label: number && name ? `${number} · ${name}` : number || name || id,
    isUserContent: true,
  };

  const color: unknown = row[COLOR_COLUMN];

  if (listable.hasColor && color) {
    option.color = color instanceof Color ? color : new Color(String(color));
  }

  return option;
};

type ToPersonOptionFunction = (person: PeoplePickerOption) => DropdownOption;

const toPersonOption: ToPersonOptionFunction = (
  person: PeoplePickerOption,
): DropdownOption => {
  return {
    value: person.id,
    label: person.name,
    ...(person.description ? { description: person.description } : {}),
    isUserContent: true,
  };
};

type LoadLinkedRecordsFunction = (data: {
  tableName: string;
  // What was typed. Left out: the first page.
  search?: string | undefined;
}) => Promise<LinkedRecordList>;

type ReadRecordsFunction = (
  listable: ListableModel,
  query: Record<string, unknown>,
) => Promise<Array<BaseModel>>;

const readRecords: ReadRecordsFunction = async (
  listable: ListableModel,
  query: Record<string, unknown>,
): Promise<Array<BaseModel>> => {
  const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
    modelType: listable.modelType,
    query: ArchivedValuePicker.getPickerQuery(listable.modelType, query),
    limit: LINKED_RECORD_LIST_LIMIT,
    skip: 0,
    select: selectOf(listable),
    sort: sortOf(listable),
  });

  return result.data;
};

type UniqueRecordsFunction = (records: Array<BaseModel>) => Array<BaseModel>;

const uniqueRecords: UniqueRecordsFunction = (
  records: Array<BaseModel>,
): Array<BaseModel> => {
  const seen: Set<string> = new Set<string>();

  return records.filter((record: BaseModel): boolean => {
    const id: string = textOf(record._id);

    if (seen.has(id)) {
      return false;
    }

    seen.add(id);

    return true;
  });
};

/**
 * The records to offer: the first page, or what matches what was typed - by
 * name, and by number for a numbered record, so INC-8 finds that incident.
 * Rejects when the person may not list them.
 */
export const loadLinkedRecords: LoadLinkedRecordsFunction = async (data: {
  tableName: string;
  search?: string | undefined;
}): Promise<LinkedRecordList> => {
  const search: string = (data.search || "").trim();

  if (data.tableName === LINKED_USER_TABLE_NAME) {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return { options: [], isComplete: true };
    }

    const people: Array<PeoplePickerOption> =
      await getPeoplePickerKindDefinition(PeoplePickerKind.User).search({
        projectId: projectId,
        searchText: search,
        limit: LINKED_RECORD_LIST_LIMIT,
      });

    return {
      options: people.map(toPersonOption),
      isComplete: search === "" && people.length < LINKED_RECORD_LIST_LIMIT,
    };
  }

  const listable: ListableModel | null = getListableModel(data.tableName);

  if (!listable) {
    return { options: [], isComplete: true };
  }

  if (search === "") {
    const records: Array<BaseModel> = await readRecords(listable, {});

    return {
      options: records.map((record: BaseModel): DropdownOption => {
        return toOption(record, listable);
      }),
      isComplete: records.length < LINKED_RECORD_LIST_LIMIT,
    };
  }

  const byName: Array<BaseModel> = await readRecords(listable, {
    [listable.labelColumn]: new Search(search),
  });

  const byNumber: Array<BaseModel> = listable.numberColumns
    ? await readRecords(listable, {
        [listable.numberColumns.numberWithPrefixColumn]: new Search(search),
      })
    : [];

  return {
    options: uniqueRecords([...byNumber, ...byName]).map(
      (record: BaseModel): DropdownOption => {
        return toOption(record, listable);
      },
    ),
    isComplete: false,
  };
};

type LoadLinkedRecordsByIdFunction = (data: {
  tableName: string;
  ids: Array<string>;
}) => Promise<Array<DropdownOption>>;

/**
 * The records a step already names, whatever the list shows: one further down
 * a long list, or an archived value, which is shown marked Archived and never
 * offered again. An ID nothing answers to is simply not in the result.
 */
export const loadLinkedRecordsById: LoadLinkedRecordsByIdFunction =
  async (data: {
    tableName: string;
    ids: Array<string>;
  }): Promise<Array<DropdownOption>> => {
    if (data.ids.length === 0) {
      return [];
    }

    if (data.tableName === LINKED_USER_TABLE_NAME) {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return [];
      }

      const people: Array<PeoplePickerOption> =
        await getPeoplePickerKindDefinition(PeoplePickerKind.User).getByIds({
          projectId: projectId,
          ids: data.ids,
        });

      return people.map(toPersonOption);
    }

    const listable: ListableModel | null = getListableModel(data.tableName);

    if (!listable) {
      return [];
    }

    const result: ListResult<BaseModel> = await ModelAPI.getList<BaseModel>({
      modelType: listable.modelType,
      query: { _id: new Includes(data.ids) },
      limit: data.ids.length,
      skip: 0,
      select: selectOf(listable),
      sort: sortOf(listable),
    });

    return result.data.map((record: BaseModel): DropdownOption => {
      const option: DropdownOption = toOption(record, listable);

      // The dropdown draws the Archived tag beside it (ArchivedTag).
      if (ArchivedValuePicker.isArchived(record)) {
        option.isArchived = true;
        option.isDisabled = true;
      }

      return option;
    });
  };
