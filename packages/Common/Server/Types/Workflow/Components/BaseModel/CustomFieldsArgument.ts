import DatabaseService from "../../../../Services/DatabaseService";
import Query from "../../../Database/Query";
import Select from "../../../Database/Select";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import QueryDeepPartialEntity from "../../../../../Types/Database/PartialEntity";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * https://github.com/OneUptime/oneuptime/issues/4469 - Update One Incident
 * with a Data argument of {"customFields": {"Notification Count": "1"}} left
 * the incident with that one custom field. Every other value was gone, and
 * the step reported success.
 *
 * customFields is one JSON column holding every custom field's value, keyed
 * by the field's name, and an update writes a column whole - so the bag a
 * step sent replaced the bag the record held. Nobody building a workflow
 * means that. To them each custom field is a field of the record, and the
 * step's own help says the fields Data leaves out keep their values. Making a
 * step read every other field and send it back is also a race with whatever
 * else writes one.
 *
 * So the Update steps merge: the custom fields a step names are set, and
 * every other custom field keeps its value. A field set to null is cleared -
 * null is the explicit "no value" the incident template merge reads it as -
 * and customFields itself set to null clears them all.
 *
 * Only the workflow steps merge. The dashboard's Custom Fields card sends the
 * whole bag, and so does any API client that manages it as one value, as the
 * Terraform provider does: leaving a field out of the bag is how they remove
 * it, so merging there would keep values they meant to drop.
 */
export const CUSTOM_FIELDS_COLUMN: string = "customFields";

/*
 * How many times a merged write is made again, on top of a fresh read, when
 * something else changed the record between the read and the write. Beyond
 * that the last read is written on without the guard (see writeMerged).
 */
export const MAX_GUARDED_MERGE_WRITES: number = 5;

type IsCustomFieldBagFunction = (value: unknown) => value is JSONObject;

const isCustomFieldBag: IsCustomFieldBagFunction = (
  value: unknown,
): value is JSONObject => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

type GetCustomFieldsToMergeFunction = (
  data: JSONObject,
  model: BaseModel,
) => JSONObject | null;

/**
 * The custom field values a step's Data writes, when they are to be merged:
 * the model keeps its custom fields in a JSON customFields column, and Data
 * sends an object for it. Otherwise null, and Data is written as it is - a
 * customFields of null clears every value, and one that is not an object
 * meets whatever the write would have done with it before.
 */
export const getCustomFieldsToMerge: GetCustomFieldsToMergeFunction = (
  data: JSONObject,
  model: BaseModel,
): JSONObject | null => {
  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(CUSTOM_FIELDS_COLUMN);

  if (!metadata || metadata.type !== TableColumnType.JSON) {
    return null;
  }

  const customFields: unknown = data[CUSTOM_FIELDS_COLUMN];

  return isCustomFieldBag(customFields) ? customFields : null;
};

type MergeCustomFieldValuesFunction = (data: {
  // What the record holds now.
  stored: unknown;
  // What the step writes.
  written: JSONObject;
}) => JSONObject;

/**
 * A record's custom fields with the ones a step writes set over them. Always
 * a new object: it is written straight into the column.
 */
export const mergeCustomFieldValues: MergeCustomFieldValuesFunction = (data: {
  stored: unknown;
  written: JSONObject;
}): JSONObject => {
  return {
    ...(isCustomFieldBag(data.stored) ? data.stored : {}),
    ...data.written,
  };
};

export interface MergedUpdate<TBaseModel extends BaseModel> {
  modelService: DatabaseService<TBaseModel>;
  // The step's query, scoped to the project the workflow runs in.
  query: Query<TBaseModel>;
  // The step's Data, customFields included.
  data: JSONObject;
  // The custom field values to merge (getCustomFieldsToMerge).
  customFields: JSONObject;
  props: DatabaseCommonInteractionProps;
  log: (message: string) => void;
}

interface RecordToMergeInto {
  _id?: string | undefined;
  version?: number | undefined;
  customFields?: unknown;
}

type ReadRecordsFunction = <TBaseModel extends BaseModel>(data: {
  update: MergedUpdate<TBaseModel>;
  query: Query<TBaseModel>;
  limit: number;
  skip: number;
}) => Promise<Array<RecordToMergeInto>>;

/*
 * The records a write would reach, each with what it holds. Read the way the
 * write reads them - as root, without a service's find hooks - so the same
 * query picks the same records, in the same order.
 */
const readRecords: ReadRecordsFunction = async <
  TBaseModel extends BaseModel,
>(data: {
  update: MergedUpdate<TBaseModel>;
  query: Query<TBaseModel>;
  limit: number;
  skip: number;
}): Promise<Array<RecordToMergeInto>> => {
  const records: Array<TBaseModel> = await data.update.modelService.findBy({
    query: { ...data.query },
    select: {
      _id: true,
      version: true,
      [CUSTOM_FIELDS_COLUMN]: true,
    } as Select<TBaseModel>,
    limit: data.limit,
    skip: data.skip,
    props: { ...data.update.props, ignoreHooks: true },
  });

  return records as unknown as Array<RecordToMergeInto>;
};

type QueryForRecordFunction = <TBaseModel extends BaseModel>(data: {
  update: MergedUpdate<TBaseModel>;
  record: RecordToMergeInto;
  isGuarded: boolean;
}) => Query<TBaseModel>;

/*
 * The step's own query, narrowed to one record. It keeps the step's
 * conditions, so a record that stopped matching them is left alone, and the
 * guarded form also asks for the version that was read: a record something
 * else wrote since then is not overwritten with a bag merged from what it
 * used to hold.
 */
const queryForRecord: QueryForRecordFunction = <
  TBaseModel extends BaseModel,
>(data: {
  update: MergedUpdate<TBaseModel>;
  record: RecordToMergeInto;
  isGuarded: boolean;
}): Query<TBaseModel> => {
  const query: JSONObject = {
    ...(data.update.query as JSONObject),
    _id: data.record._id as string,
  };

  if (
    data.isGuarded &&
    data.record.version !== undefined &&
    data.record.version !== null
  ) {
    query["version"] = data.record.version;
  }

  return query as Query<TBaseModel>;
};

type WriteRecordFunction = <TBaseModel extends BaseModel>(data: {
  update: MergedUpdate<TBaseModel>;
  record: RecordToMergeInto;
  isGuarded: boolean;
}) => Promise<number>;

// One record's write: the step's Data, with the record's custom fields merged.
const writeRecord: WriteRecordFunction = async <
  TBaseModel extends BaseModel,
>(data: {
  update: MergedUpdate<TBaseModel>;
  record: RecordToMergeInto;
  isGuarded: boolean;
}): Promise<number> => {
  return await data.update.modelService.updateOneBy({
    query: queryForRecord(data),
    data: {
      ...data.update.data,
      [CUSTOM_FIELDS_COLUMN]: mergeCustomFieldValues({
        stored: data.record.customFields,
        written: data.update.customFields,
      }),
    } as QueryDeepPartialEntity<TBaseModel>,
    props: data.update.props,
  });
};

type WriteMergedFunction = <TBaseModel extends BaseModel>(
  update: MergedUpdate<TBaseModel>,
  record: RecordToMergeInto,
) => Promise<number>;

/*
 * Merge into one record and write it, guarded by the version that was read.
 *
 * Two workflows started by the same incident change - one counting
 * notifications, one stamping an owner - each read the incident's custom
 * fields, and the second write would put back the bag it read, dropping the
 * first one's field: the very loss this merge is for. So the write only lands
 * on the version it was merged from. When it does not land, the record is
 * read again: gone, or no longer matching the query, it is not updated (as
 * the write would not have updated it); written by something else, the merge
 * is made again over what it holds now.
 *
 * A record that keeps changing under every attempt is still written, on top
 * of the last read, rather than failing the step.
 */
const writeMerged: WriteMergedFunction = async <TBaseModel extends BaseModel>(
  update: MergedUpdate<TBaseModel>,
  record: RecordToMergeInto,
): Promise<number> => {
  let current: RecordToMergeInto = record;

  for (
    let attempt: number = 1;
    attempt <= MAX_GUARDED_MERGE_WRITES;
    attempt++
  ) {
    const updated: number = await writeRecord({
      update: update,
      record: current,
      isGuarded: true,
    });

    if (updated > 0) {
      return updated;
    }

    const latest: RecordToMergeInto | undefined = (
      await readRecords({
        update: update,
        query: queryForRecord({
          update: update,
          record: current,
          isGuarded: false,
        }),
        limit: 1,
        skip: 0,
      })
    )[0];

    // Gone, or no longer what the query asks for.
    if (!latest) {
      return 0;
    }

    /*
     * Nothing else wrote it, so the version did not stop the write; the
     * write was refused for its own reasons and would be again.
     */
    if (latest.version === current.version) {
      return 0;
    }

    current = latest;
  }

  update.log(
    `${update.modelService.getModel().singularName || "Record"} ${
      current._id
    } kept changing while this step merged its custom fields, so they were merged into what it held a moment ago.`,
  );

  return await writeRecord({
    update: update,
    record: current,
    isGuarded: false,
  });
};

type UpdateOneMergingCustomFieldsFunction = <TBaseModel extends BaseModel>(
  update: MergedUpdate<TBaseModel>,
) => Promise<number>;

/**
 * Update One, with the custom fields merged into what the record holds.
 * The record it updates is the one updateOneBy would have picked.
 */
export const updateOneMergingCustomFields: UpdateOneMergingCustomFieldsFunction =
  async <TBaseModel extends BaseModel>(
    update: MergedUpdate<TBaseModel>,
  ): Promise<number> => {
    const record: RecordToMergeInto | undefined = (
      await readRecords({
        update: update,
        query: update.query,
        limit: 1,
        skip: 0,
      })
    )[0];

    if (!record) {
      return 0;
    }

    return await writeMerged(update, record);
  };

type UpdateManyMergingCustomFieldsFunction = <TBaseModel extends BaseModel>(
  update: MergedUpdate<TBaseModel> & {
    limit: number;
    skip: number;
  },
) => Promise<number>;

/**
 * Update Many, with the custom fields merged into what each record holds.
 * The records are the ones updateBy would have reached with the same limit
 * and skip. Each holds a bag of its own, so each is written on its own.
 */
export const updateManyMergingCustomFields: UpdateManyMergingCustomFieldsFunction =
  async <TBaseModel extends BaseModel>(
    update: MergedUpdate<TBaseModel> & {
      limit: number;
      skip: number;
    },
  ): Promise<number> => {
    const records: Array<RecordToMergeInto> = await readRecords({
      update: update,
      query: update.query,
      limit: update.limit,
      skip: update.skip,
    });

    let updated: number = 0;

    for (const record of records) {
      updated += await writeMerged(update, record);
    }

    return updated;
  };
