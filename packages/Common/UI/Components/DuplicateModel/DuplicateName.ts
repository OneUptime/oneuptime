import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import Select from "../../../Types/BaseDatabase/Select";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { getDisplayNameColumn } from "../../Utils/ModelDisplayName";
import { ModelField } from "../Forms/ModelForm";
import {
  getCopyName,
  getCopyNameSearchText,
} from "../Forms/Utils/UniqueName";

/*
 * THE NAME A COPY STARTS WITH.
 *
 * Duplicate (DuplicateModel, on the Settings page of a dashboard, a
 * monitor, an on-call schedule and a workflow) asks for the copy's name.
 * It used to ask with an empty field, so the copy was named from scratch -
 * or, as often, after its original, which a dashboard's or a workflow's
 * name cannot be (unique in the project, @UniqueColumnBy("projectId")): the
 * server refused it only after the user had pressed Duplicate. And where a
 * name may repeat, two monitors of one name cannot be told apart in a list
 * or a picker.
 *
 * Now the field starts filled in with the original's name, numbered past
 * the names the project has (Forms/Utils/UniqueName getCopyName): a copy of
 * "API Monitor" is "API Monitor 2", a copy of that one "API Monitor 3".
 * The names compared are those of every record of the project the user
 * can read whose name contains the series' first name - one getList with a
 * Search, archived records included, as the server's unique check counts
 * those too. Looked up when Duplicate is pressed, never when the page
 * opens: a page someone only reads makes no request for it.
 *
 * The server's check still decides. A name taken by a record the user
 * cannot read, or taken between the lookup and the save, is refused in the
 * dialog, where the name can be changed (DuplicateModel keeps it open).
 * A lookup that fails costs only the numbering: the original's name, read
 * on its own, still gives "<name> 2"; an original whose name cannot be read
 * leaves the field empty, as it always was.
 *
 * React-free, so tests can read the rule without rendering the component.
 */

/**
 * The column the copy is named by: the model's name column
 * (getDisplayNameColumn - "name" for a dashboard, monitor, schedule or
 * workflow), when the Duplicate dialog asks for it. Null when it does not:
 * nothing is filled in then.
 */
export const getDuplicateNameColumn: <TBaseModel extends BaseModel>(data: {
  model: TBaseModel;
  fieldsToChange: Array<ModelField<TBaseModel>>;
}) => string | null = <TBaseModel extends BaseModel>(data: {
  model: TBaseModel;
  fieldsToChange: Array<ModelField<TBaseModel>>;
}): string | null => {
  const nameColumn: string | null = getDisplayNameColumn(data.model);

  if (!nameColumn) {
    return null;
  }

  const isAsked: boolean = data.fieldsToChange.some(
    (field: ModelField<TBaseModel>): boolean => {
      return Object.keys(field.field || {})[0] === nameColumn;
    },
  );

  return isAsked ? nameColumn : null;
};

// A record's name, as the API hands it back; "" when it has none.
const readName: (
  record: BaseModel | null | undefined,
  nameColumn: string,
) => string = (
  record: BaseModel | null | undefined,
  nameColumn: string,
): string => {
  if (!record) {
    return "";
  }

  const value: unknown = (record as unknown as Record<string, unknown>)[
    nameColumn
  ];

  return typeof value === "string" ? value : "";
};

export type FetchDuplicateNameFunction = <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  // The record being copied.
  modelId: ObjectID;
  // From getDuplicateNameColumn.
  nameColumn: string;
}) => Promise<string>;

/**
 * The name the copy of this record starts with ("API Monitor 2"), looked up
 * now: the original's name, then the project's names that could clash with
 * a numbered one. "" when the original's name cannot be read.
 */
export const fetchDuplicateName: FetchDuplicateNameFunction = async <
  TBaseModel extends BaseModel,
>(data: {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  nameColumn: string;
}): Promise<string> => {
  const select: Select<TBaseModel> = {
    [data.nameColumn]: true,
  } as Select<TBaseModel>;

  let name: string = "";

  try {
    const original: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
      modelType: data.modelType,
      id: data.modelId,
      select,
    });

    name = readName(original, data.nameColumn).trim();
  } catch {
    return "";
  }

  if (!name) {
    return "";
  }

  let existingNames: Array<string> = [];

  try {
    const result: ListResult<TBaseModel> = await ModelAPI.getList<TBaseModel>({
      modelType: data.modelType,
      query: {
        [data.nameColumn]: new Search<string>(getCopyNameSearchText(name)),
      } as Query<TBaseModel>,
      select,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {},
    });

    existingNames = (result.data || []).map((record: TBaseModel): string => {
      return readName(record, data.nameColumn);
    });
  } catch {
    existingNames = [];
  }

  return getCopyName({ name, existingNames });
};
