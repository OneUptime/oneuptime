import ModelAPI from "./ModelAPI";
import API from "../API/API";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * A RECORD'S PAGE SHOWS WHAT IT CAN (#10238).
 *
 * A page reads its record and the records it names in one select:
 * `{ title: true, dataStore: { name: true } }`. The server answers it whole
 * or not at all: one column of a related record that it will not read
 * through the relation (canReadOnRelationQuery), or that the reader may not
 * read, refuses the read of everything. A page that put the refusal in
 * place of itself said one raw sentence and nothing else - a data security
 * issue's page said "Column dataTypeIds on Data Store does not support read
 * on relation query." in place of every issue, from 14.0.99 to 17.0.0.
 *
 * getItemInParts reads it the same way, in one request. Only when that read
 * fails does it read again, in parts: the record's own columns, then each
 * record it names, on its own. The record is there when its own columns
 * are, with every related record that could be read; each one that could
 * not is named, with why, for the page to say. When the record's own
 * columns cannot be read either, there is nothing to show, and that read's
 * error is thrown, for the page to say in place of itself.
 */

export interface UnloadedPart {
  // The relation of the select that could not be read: "dataStore".
  relation: string;
  // Why, as API.getFriendlyMessage says it.
  error: string;
}

export interface ItemInParts<TBaseModel extends BaseModel> {
  // Null when there is no such record, or none the reader may reach.
  item: TBaseModel | null;
  // In the order the select names them; none when the read was whole.
  unloadedParts: Array<UnloadedPart>;
}

export interface SplitSelect<TBaseModel extends BaseModel> {
  // The record's own columns, and its id.
  own: Select<TBaseModel>;
  // Each related record's select, by its relation, in the select's order.
  relations: Array<[string, JSONObject]>;
}

// A select's own columns, and the select of each record it names, apart.
export function splitSelect<TBaseModel extends BaseModel>(
  select: Select<TBaseModel>,
): SplitSelect<TBaseModel> {
  const own: JSONObject = { _id: true };
  const relations: Array<[string, JSONObject]> = [];

  for (const [key, value] of Object.entries(select as JSONObject)) {
    // A nested select is a relation's, as the server reads it (QueryPermission).
    if (value && typeof value === "object" && !Array.isArray(value)) {
      relations.push([key, value as JSONObject]);
    } else {
      own[key] = value;
    }
  }

  return { own: own as Select<TBaseModel>, relations: relations };
}

interface PartRead {
  relation: string;
  value: unknown;
  error: string;
}

export async function getItemInParts<TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  id: ObjectID;
  select: Select<TBaseModel>;
}): Promise<ItemInParts<TBaseModel>> {
  let wholeReadError: unknown = null;

  try {
    const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
      modelType: data.modelType,
      id: data.id,
      select: data.select,
    });

    return { item: item, unloadedParts: [] };
  } catch (err) {
    wholeReadError = err;
  }

  const split: SplitSelect<TBaseModel> = splitSelect(data.select);

  // Nothing to read apart: the record itself could not be read.
  if (split.relations.length === 0) {
    throw wholeReadError;
  }

  // Its own columns: when these cannot be read, nothing can (thrown).
  const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
    modelType: data.modelType,
    id: data.id,
    select: split.own,
  });

  if (!item) {
    return { item: null, unloadedParts: [] };
  }

  const reads: Array<PartRead> = await Promise.all(
    split.relations.map(
      async ([relation, relationSelect]: [
        string,
        JSONObject,
      ]): Promise<PartRead> => {
        try {
          const part: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
            modelType: data.modelType,
            id: data.id,
            select: {
              _id: true,
              [relation]: relationSelect,
            } as Select<TBaseModel>,
          });

          return {
            relation: relation,
            value: part
              ? (part as unknown as Record<string, unknown>)[relation]
              : undefined,
            error: "",
          };
        } catch (err) {
          return {
            relation: relation,
            value: undefined,
            error: API.getFriendlyMessage(err),
          };
        }
      },
    ),
  );

  const unloadedParts: Array<UnloadedPart> = [];

  for (const read of reads) {
    if (read.error) {
      unloadedParts.push({ relation: read.relation, error: read.error });
      continue;
    }

    if (read.value !== undefined) {
      (item as unknown as Record<string, unknown>)[read.relation] = read.value;
    }
  }

  return { item: item, unloadedParts: unloadedParts };
}
