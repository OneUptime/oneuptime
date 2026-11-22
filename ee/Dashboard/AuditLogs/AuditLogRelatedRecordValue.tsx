import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  AuditLogRelatedRecord,
  AuditLogRelatedRecordState,
  AuditLogRelatedRecords,
  readAuditLogRecordIds,
  readAuditLogRecordedName,
  readAuditLogRelatedRecords,
} from "Common/Utils/AuditLog/AuditLogRelatedRecords";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A CHANGED REFERENCE, BY THE RECORD'S NAME (#10470).
 *
 * The changes dialog drew a monitor's status as two UUIDs, Before and
 * After, and an incident's labels as a JSON array. When it opens it now
 * asks, once, for the names of every record its changes name
 * (GET /audit-log/:id/related-record-names): the server reads the entry as
 * its reader may read it (#10642) and each related table once, with the
 * reader's own permissions, and nothing is stored. A reference then reads
 * "Degraded", then "Operational", each with its id under it for whoever
 * needs it; a record the reader may not read reads "Name hidden", and one
 * deleted since "Deleted" - by the name the entry recorded where it has
 * one, its id otherwise. While the names load, a reference keeps its id
 * and a bar where its name will be; if they cannot be read, it reads as it
 * always did.
 */

// The words a reference is drawn with, as keys of the Dashboard's locales.
export const AUDIT_LOG_RELATED_WORDS: Readonly<{
  deleted: string;
  nameHidden: string;
}> = {
  deleted: translationKey("Deleted"),
  nameHidden: translationKey("Name hidden"),
};

export const getAuditLogRelatedRecordsRoute: (auditLogId: string) => Route = (
  auditLogId: string,
): Route => {
  return new Route(`/audit-log/${auditLogId}/related-record-names`);
};

// Reads an entry's related records' names; null when they cannot be read.
export type AuditLogRelatedRecordsLoader = (
  auditLogId: string,
) => Promise<AuditLogRelatedRecords | null>;

export const loadAuditLogRelatedRecords: AuditLogRelatedRecordsLoader = async (
  auditLogId: string,
): Promise<AuditLogRelatedRecords | null> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromURL(APP_API_URL).addRoute(
          getAuditLogRelatedRecordsRoute(auditLogId),
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      return null;
    }

    return readAuditLogRelatedRecords(response.data);
  } catch {
    return null;
  }
};

// The values of a change: what is read for the records it names.
export interface AuditLogChangeValues {
  oldValue: unknown;
  newValue: unknown;
}

// Whether a change's values name any record: only then is anything asked.
export const namesAnyRecord: (
  changes: Array<AuditLogChangeValues>,
) => boolean = (changes: Array<AuditLogChangeValues>): boolean => {
  return changes.some((change: AuditLogChangeValues): boolean => {
    return (
      readAuditLogRecordIds(change.oldValue).length > 0 ||
      readAuditLogRecordIds(change.newValue).length > 0
    );
  });
};

export interface AuditLogRelatedRecordsState {
  isLoading: boolean;
  records: AuditLogRelatedRecords;
}

/*
 * The names of an open dialog's related records: asked once when it opens
 * for an entry whose changes name a record, and again only for another
 * entry. A read that fails leaves none, and the dialog reads as before.
 */
export const useAuditLogRelatedRecords: (data: {
  isOpen: boolean;
  auditLogId?: string | undefined;
  changes: Array<AuditLogChangeValues>;
  load?: AuditLogRelatedRecordsLoader | undefined;
}) => AuditLogRelatedRecordsState = (data: {
  isOpen: boolean;
  auditLogId?: string | undefined;
  changes: Array<AuditLogChangeValues>;
  load?: AuditLogRelatedRecordsLoader | undefined;
}): AuditLogRelatedRecordsState => {
  const [state, setState] = useState<AuditLogRelatedRecordsState>({
    isLoading: false,
    records: new Map(),
  });
  const shouldLoad: boolean = Boolean(
    data.isOpen && data.auditLogId && namesAnyRecord(data.changes),
  );

  useEffect(() => {
    if (!shouldLoad || !data.auditLogId) {
      setState({ isLoading: false, records: new Map() });
      return;
    }

    let isCurrent: boolean = true;
    const load: AuditLogRelatedRecordsLoader =
      data.load || loadAuditLogRelatedRecords;

    setState({ isLoading: true, records: new Map() });

    load(data.auditLogId)
      .then((records: AuditLogRelatedRecords | null) => {
        if (isCurrent) {
          setState({ isLoading: false, records: records || new Map() });
        }
      })
      .catch(() => {
        if (isCurrent) {
          setState({ isLoading: false, records: new Map() });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [shouldLoad, data.auditLogId]);

  return state;
};

// One record a value names, as the dialog draws it.
export interface AuditLogReferenceItem {
  id: string;
  // Unread: no answer for it (still loading, or not to be had); it keeps its id.
  state: AuditLogRelatedRecordState | "Unread";
  name?: string | undefined;
}

/*
 * The records a value names, in its order, each as the answer says it is.
 * One without an answer keeps the name the entry recorded, where it has one.
 */
export const getAuditLogReferenceItems: (data: {
  value: unknown;
  records?: Map<string, AuditLogRelatedRecord> | undefined;
}) => Array<AuditLogReferenceItem> = (data: {
  value: unknown;
  records?: Map<string, AuditLogRelatedRecord> | undefined;
}): Array<AuditLogReferenceItem> => {
  return readAuditLogRecordIds(data.value).map(
    (id: string): AuditLogReferenceItem => {
      const record: AuditLogRelatedRecord | undefined = data.records?.get(id);

      if (record) {
        return { id, state: record.state, name: record.name };
      }

      return {
        id,
        state: "Unread",
        name: readAuditLogRecordedName(data.value, id) || undefined,
      };
    },
  );
};

// A related record's value as the entry recorded it: `{ _id, name }`, or a list of them.
const isRecordedRelation: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  const values: Array<unknown> = Array.isArray(value) ? value : [value];

  return (
    values.length > 0 &&
    values.every((item: unknown): boolean => {
      return (
        Boolean(item) &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as JSONObject)["_id"] === "string"
      );
    })
  );
};

/*
 * Whether a change's value is drawn as the records it names: the field's
 * records were answered for, or the entry recorded them as related records,
 * or - while the answer loads - its value names one. Anything else is
 * drawn as it always was.
 */
export const isAuditLogReferenceValue: (data: {
  field: string;
  value: unknown;
  related: AuditLogRelatedRecordsState;
}) => boolean = (data: {
  field: string;
  value: unknown;
  related: AuditLogRelatedRecordsState;
}): boolean => {
  if (readAuditLogRecordIds(data.value).length === 0) {
    return false;
  }

  return (
    data.related.records.has(data.field) ||
    isRecordedRelation(data.value) ||
    data.related.isLoading
  );
};

const ReferenceItem: FunctionComponent<{
  item: AuditLogReferenceItem;
  isLoading: boolean;
  translator: Translator;
}> = (props: {
  item: AuditLogReferenceItem;
  isLoading: boolean;
  translator: Translator;
}): ReactElement => {
  const { item, translator } = props;
  const words: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  let primary: ReactElement = <></>;

  if (item.state === AuditLogRelatedRecordState.Named && item.name) {
    primary = (
      <span
        data-testid="audit-log-related-record-name"
        className="text-sm font-medium text-gray-900 break-words"
      >
        {item.name}
      </span>
    );
  } else if (item.state === AuditLogRelatedRecordState.Hidden) {
    primary = (
      <span
        data-testid="audit-log-related-record-hidden"
        className="inline-flex items-center gap-1.5 text-sm italic text-gray-500"
      >
        <Icon
          icon={IconProp.EyeSlash}
          size={SizeProp.Small}
          thick={ThickProp.Thick}
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        />
        {words(AUDIT_LOG_RELATED_WORDS.nameHidden)}
      </span>
    );
  } else if (item.state === AuditLogRelatedRecordState.Deleted) {
    primary = (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {item.name ? (
          <span className="text-sm text-gray-700 break-words">{item.name}</span>
        ) : (
          <></>
        )}
        <span
          data-testid="audit-log-related-record-deleted"
          className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
        >
          {words(AUDIT_LOG_RELATED_WORDS.deleted)}
        </span>
      </span>
    );
  } else if (props.isLoading) {
    primary = <InlineValueSkeleton widthClassName="w-24" />;
  } else if (item.name) {
    // No answer, but the name the entry recorded: it was the reader's to read.
    primary = (
      <span
        data-testid="audit-log-related-record-name"
        className="text-sm font-medium text-gray-900 break-words"
      >
        {item.name}
      </span>
    );
  }

  return (
    <div
      data-testid="audit-log-related-record"
      data-record-id={item.id}
      data-state={item.state}
      className="flex min-w-0 flex-col gap-0.5"
    >
      {primary}
      <span
        data-testid="audit-log-related-record-id"
        className="font-mono text-xs text-gray-500 break-all"
      >
        {item.id}
      </span>
    </div>
  );
};

/*
 * A change's value drawn as the records it names: one, or a list of them,
 * each by its name with its id under it.
 */
const AuditLogRelatedRecordValue: FunctionComponent<{
  value: unknown;
  records?: Map<string, AuditLogRelatedRecord> | undefined;
  isLoading: boolean;
  translator: Translator;
}> = (props: {
  value: unknown;
  records?: Map<string, AuditLogRelatedRecord> | undefined;
  isLoading: boolean;
  translator: Translator;
}): ReactElement => {
  const items: Array<AuditLogReferenceItem> = getAuditLogReferenceItems({
    value: props.value,
    records: props.records,
  });

  return (
    <div
      data-testid="audit-log-related-records"
      className={items.length > 1 ? "flex flex-col gap-2" : "flex flex-col"}
    >
      {items.map((item: AuditLogReferenceItem) => {
        return (
          <ReferenceItem
            key={item.id}
            item={item}
            isLoading={props.isLoading}
            translator={props.translator}
          />
        );
      })}
    </div>
  );
};

export default AuditLogRelatedRecordValue;
