import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { DataSecurityRecordFieldResult } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  applyRecordFieldAction,
  readRecordFieldValue,
  readStoreRecordDrafts,
  RecordField,
  RecordFieldAction,
  RecordFieldActionResult,
  RecordFieldValue,
  StoreRecordDrafts,
  toStoreRecordDraftsJson,
} from "../../../Types/DataSecurity/RecordOfProcessing";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import DataStoreService from "../../Services/DataStoreService";
import RecordOfProcessingReader from "./RecordOfProcessingReader";

/*
 * WHAT A PERSON DOES WITH ONE FIELD OF A STORE'S RECORD (#10375): confirm
 * OneUptime AI's draft, write their own words, or take or leave a change
 * proposed for a confirmed value - one press each.
 *
 * The store's record column is written with the person's own props, so
 * whoever may not change the store is refused there, the change is in the
 * store's audit log and its timeline as theirs (DataStoreService), and
 * nothing of OneUptime AI's reaches the record without that press. The
 * drafts beside it (DataStore.recordDrafts) are OneUptime's bookkeeping,
 * written once the column is - a refusal leaves both as they were.
 */

const RECORD_COLUMNS: {
  _id: true;
  kind: true;
  purpose: true;
  retention: true;
  legalBasis: true;
  dataSubjects: true;
  recordDrafts: true;
} = {
  _id: true,
  kind: true,
  purpose: true,
  retention: true,
  legalBasis: true,
  dataSubjects: true,
  recordDrafts: true,
};

function columnOf(store: DataStore, field: RecordField): unknown {
  switch (field) {
    case RecordField.Purpose:
      return store.purpose;
    case RecordField.Retention:
      return store.retention;
    case RecordField.LegalBasis:
      return store.legalBasis;
    default:
      return store.dataSubjects;
  }
}

export default class RecordOfProcessingWriter {
  public static async applyFieldAction(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
    field: RecordField;
    action: RecordFieldAction;
    // A person's own words, for Write.
    written?: unknown;
    // The draft the person was shown, by when it was drafted.
    shownDraftedAt?: string | undefined;
    now?: Date | undefined;
  }): Promise<DataSecurityRecordFieldResult> {
    // The caller's own read first: a store they may not read is not found.
    const visible: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId, projectId: data.projectId },
      select: { _id: true },
      props: data.props,
    });

    if (!visible) {
      throw new NotFoundException("This data store could not be found.");
    }

    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId, projectId: data.projectId },
      select: RECORD_COLUMNS,
      props: { isRoot: true },
    });

    if (!store) {
      throw new NotFoundException("This data store could not be found.");
    }

    const drafts: StoreRecordDrafts = readStoreRecordDrafts(store.recordDrafts);
    const value: RecordFieldValue = readRecordFieldValue(
      data.field,
      columnOf(store, data.field),
    );
    const result: RecordFieldActionResult = applyRecordFieldAction({
      field: data.field,
      action: data.action,
      value,
      drafts,
      facts: drafts.facts,
      shownDraftedAt:
        typeof data.shownDraftedAt === "string"
          ? data.shownDraftedAt
          : undefined,
      written: data.written,
      userId: data.props.userId?.toString(),
      now: data.now || OneUptimeDate.getCurrentDate(),
    });

    if (!result.isDone) {
      throw new BadDataException(result.refusal);
    }

    // The record itself, as the person: their permission, their audit log entry.
    if (result.value !== undefined) {
      await DataStoreService.updateOneById({
        id: data.dataStoreId,
        data: { [data.field]: result.value } as never,
        props: data.props,
      });
    }

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: data.dataStoreId,
      data: { recordDrafts: toStoreRecordDraftsJson(result.drafts) } as never,
    });

    return {
      row: await RecordOfProcessingReader.readRow({
        projectId: data.projectId,
        props: data.props,
        dataStoreId: data.dataStoreId,
      }),
    };
  }
}
