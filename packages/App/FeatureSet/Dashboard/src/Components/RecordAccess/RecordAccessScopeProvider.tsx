import { fetchRecordAccess } from "./RecordAccessApi";
import { getRecordAccessRefusalSentence } from "./RecordAccessReasons";
import ObjectID from "Common/Types/ObjectID";
import {
  RECORD_ACCESS_TABLES,
  RecordAccessKind,
  RecordAccessOperation,
  RecordAccessResult,
  RecordAccessVerdict,
} from "Common/Types/RecordAccess/RecordAccess";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import {
  RecordAccessScope,
  RecordAccessScopeContext,
  RecordGateAccess,
  RecordGateOperation,
} from "Common/UI/Utils/RecordAccessScope";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * WHAT THE READER MAY DO ON A RECORD'S PAGES, AS THE SERVER'S RULE SAYS IT
 * (#10272): the record's view layout asks the server once, as its pages
 * open, what the reader may do on the record and on its parts - one
 * request, whatever the pages draw - and hands every gate on them the
 * answer (RecordAccessScope). A change the server would refuse on this
 * record is locked where it is offered, with why: the reader's permission
 * is limited to labels the record does not carry, to records they do not
 * own, a team of theirs blocks it on the record's labels, or the record is
 * private and its owners' permissions do not allow it.
 *
 * While the answer is read, a reader whose permissions reach some records
 * and not others is offered no change of the record, so no button is
 * offered and then locked under their pointer; anyone else - whose
 * permissions reach every record or none - sees their own permissions'
 * locks at once, as the answer will agree. An answer that cannot be read
 * leaves the locks to the reader's own permissions: the server holds every
 * write to its rule whatever the page offers.
 */

// What the page knows of the answer for the record it is on.
interface AnswerState {
  recordId: string;
  result: RecordAccessResult | null;
  isRead: boolean;
}

/*
 * The scope the gates read, from the answer: each table's refusals in the
 * reader's words, held back while it is read for a reader it may narrow.
 */
export const getRecordAccessScope: (data: {
  kind: RecordAccessKind;
  tableNames: ReadonlyArray<string>;
  result: RecordAccessResult | null;
  isRead: boolean;
  mayReachSomeRecordsOnly: boolean;
  translator: Translator;
}) => RecordAccessScope = (data: {
  kind: RecordAccessKind;
  tableNames: ReadonlyArray<string>;
  result: RecordAccessResult | null;
  isRead: boolean;
  mayReachSomeRecordsOnly: boolean;
  translator: Translator;
}): RecordAccessScope => {
  const tables: Record<string, RecordGateAccess> = {};
  const tableNames: Array<string> = [...data.tableNames];

  for (const [tableName, verdicts] of Object.entries(
    data.result?.tables || {},
  )) {
    const refusals: Partial<Record<RecordGateOperation, string>> = {};

    for (const operation of Object.values(RecordAccessOperation)) {
      const verdict: RecordAccessVerdict | undefined = verdicts[operation];

      if (verdict && !verdict.isAllowed && verdict.refusal) {
        refusals[operation as RecordGateOperation] =
          getRecordAccessRefusalSentence({
            kind: data.kind,
            refusal: verdict.refusal,
            translator: data.translator,
          });
      }
    }

    tables[tableName] = { isHeldBack: false, refusals: refusals };

    if (!tableNames.includes(tableName)) {
      tableNames.push(tableName);
    }
  }

  return {
    tables: tables,
    tableNames: tableNames,
    isHeldBack: !data.isRead && data.mayReachSomeRecordsOnly,
  };
};

export interface ComponentProps {
  kind: RecordAccessKind;
  modelId: ObjectID;
  children: ReactElement;
}

const RecordAccessScopeProvider: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const recordId: string = props.modelId.toString();

  const [answer, setAnswer] = useState<AnswerState | null>(null);

  useEffect(() => {
    if (!ObjectID.isValidUUID(recordId)) {
      return;
    }

    let isCurrent: boolean = true;

    fetchRecordAccess({ kind: props.kind, recordId: recordId })
      .then((result: RecordAccessResult) => {
        if (isCurrent) {
          setAnswer({ recordId: recordId, result: result, isRead: true });
        }
      })
      .catch(() => {
        // The reader's own permissions lock what they lock, as before.
        if (isCurrent) {
          setAnswer({ recordId: recordId, result: null, isRead: true });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [recordId, props.kind]);

  // Only the answer for the record the page is on now: none for the last one.
  const current: AnswerState | null =
    answer && answer.recordId === recordId ? answer : null;

  const mayReachSomeRecordsOnly: boolean =
    PermissionGate.mayReachSomeRecordsOnly();

  const scope: RecordAccessScope = useMemo(() => {
    return getRecordAccessScope({
      kind: props.kind,
      // Known before the answer lands, so their locks wait for it.
      tableNames: RECORD_ACCESS_TABLES[props.kind],
      result: current?.result || null,
      isRead: Boolean(current?.isRead) || !ObjectID.isValidUUID(recordId),
      mayReachSomeRecordsOnly: mayReachSomeRecordsOnly,
      translator: translator,
    });
  }, [
    current,
    props.kind,
    mayReachSomeRecordsOnly,
    translator.language,
    recordId,
  ]);

  return (
    <RecordAccessScopeContext.Provider value={scope}>
      {props.children}
    </RecordAccessScopeContext.Provider>
  );
};

export default RecordAccessScopeProvider;
