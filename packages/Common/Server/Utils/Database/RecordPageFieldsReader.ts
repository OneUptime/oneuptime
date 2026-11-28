import type DatabaseService from "../../Services/DatabaseService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import {
  RecordPageField,
  RecordPageFields,
  getRecordPageFieldsOfKind,
} from "../../../Types/Database/RecordPageFields";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHAT A RECORD'S PAGE NEEDS BESIDE ITS ID, READ FOR ONE READER (#11020,
 * Types/Database/RecordPageFields).
 *
 * The records GET /unique-names/check and /unique-names/duplicates name
 * are records the reader may read. For a kind whose page opens under
 * another record or page - an OpenStack budget under its cloud, a
 * workspace notification summary under its workspace's page - this reads
 * the columns its address needs, with the reader's own permissions:
 *
 *   - a column the reader may not read is never read (the read is
 *     refused, and nothing is sent);
 *   - a parent's id is sent only when the reader may read that parent: the
 *     page it opens is the parent's, and a link to it would name a record
 *     they may not see;
 *   - a record with any of its fields missing gets none, and is named
 *     without a link.
 *
 * Nothing is read for a kind whose page needs only its id. Never throws:
 * the links only help, and the answer is right without them.
 */

// A column's value as the API writes it: an id, an enum's value, text.
const toText: (value: unknown) => string = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
};

const toIdText: (value: unknown) => string = (value: unknown): string => {
  return toText(value).toLowerCase();
};

export default class RecordPageFieldsReader {
  /*
   * The page fields of records of the service's kind, by the record's id
   * in lower case: none for a kind whose page needs only its id, and none
   * for a record whose fields the reader may not all read.
   */
  public static async read<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    projectId: ObjectID;
    ids: ReadonlyArray<string>;
    props: DatabaseCommonInteractionProps;
    // The service of a parent's kind, by its table.
    getServiceOfTable: (tableName: string) => DatabaseService<BaseModel> | null;
  }): Promise<Map<string, RecordPageFields>> {
    const fieldsOfKind: ReadonlyArray<RecordPageField> =
      getRecordPageFieldsOfKind(data.service.getModel().tableName);
    const found: Map<string, RecordPageFields> = new Map<
      string,
      RecordPageFields
    >();

    const ids: Array<string> = Array.from(
      new Set(data.ids.map(toIdText).filter(Boolean)),
    ).filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    if (fieldsOfKind.length === 0 || ids.length === 0) {
      return found;
    }

    let records: Array<TBaseModel> = [];

    try {
      records = await data.service.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(
            ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        } as unknown as Query<TBaseModel>,
        select: {
          _id: true,
          ...Object.fromEntries(
            fieldsOfKind.map((field: RecordPageField): [string, true] => {
              return [field.column, true];
            }),
          ),
        } as Select<TBaseModel>,
        limit: Math.min(ids.length, LIMIT_PER_PROJECT),
        skip: 0,
        props: data.props,
      });
    } catch {
      // The reader may not read one of the columns: no link, and nothing said.
      return found;
    }

    // The parents the reader may read, by their kind's table.
    const readableParents: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const field of fieldsOfKind) {
      if (!field.parentTableName) {
        continue;
      }

      const parentIds: Array<string> = Array.from(
        new Set(
          records
            .map((record: TBaseModel): string => {
              return toIdText(
                (record as unknown as Record<string, unknown>)[field.column],
              );
            })
            .filter((id: string): boolean => {
              return ObjectID.isValidUUID(id);
            }),
        ),
      );

      readableParents.set(
        field.column,
        await RecordPageFieldsReader.readableIds({
          service: data.getServiceOfTable(field.parentTableName),
          projectId: data.projectId,
          ids: parentIds,
          props: data.props,
        }),
      );
    }

    for (const record of records) {
      const fields: RecordPageFields = {};
      let isComplete: boolean = true;

      for (const field of fieldsOfKind) {
        const value: string = toText(
          (record as unknown as Record<string, unknown>)[field.column],
        );

        const isReadable: boolean = field.parentTableName
          ? Boolean(readableParents.get(field.column)?.has(value.toLowerCase()))
          : true;

        if (!value || !isReadable) {
          isComplete = false;
          break;
        }

        fields[field.column] = field.parentTableName
          ? value.toLowerCase()
          : value;
      }

      if (isComplete) {
        found.set(toIdText(record.id || record._id), fields);
      }
    }

    return found;
  }

  // Which of the records the reader may read: none for a kind they may not.
  private static async readableIds(data: {
    service: DatabaseService<BaseModel> | null;
    projectId: ObjectID;
    ids: ReadonlyArray<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Set<string>> {
    if (!data.service || data.ids.length === 0) {
      return new Set<string>();
    }

    try {
      const readable: Array<BaseModel> = await data.service.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(
            data.ids.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        } as unknown as Query<BaseModel>,
        select: { _id: true } as Select<BaseModel>,
        limit: Math.min(data.ids.length, LIMIT_PER_PROJECT),
        skip: 0,
        props: data.props,
      });

      return new Set<string>(
        readable.map((record: BaseModel): string => {
          return toIdText(record.id || record._id);
        }),
      );
    } catch {
      return new Set<string>();
    }
  }
}
