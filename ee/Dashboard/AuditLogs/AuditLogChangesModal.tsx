import { splitCapitalRunsBeforeWords } from "Common/Utils/CapitalRuns";
import { getValueOrQuietDash } from "Common/UI/Components/Table/TableEmptyValue";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import { readAuditLogChange } from "Common/Utils/AuditLog/AuditLogTypedValues";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { getAuditLogActionLabel } from "Common/Types/AuditLog/AuditLogActionLabel";
import {
  AUDIT_LOG_SESSION_FIELDS,
  AUDIT_LOG_SESSION_TIME_FIELDS,
  AuditLogSessionField,
  getSessionEntryValueInLanguage,
  getSessionFieldLabel,
  isSessionAuditLogAction,
  readSessionEntryFields,
} from "Common/Types/AuditLog/AuditLogSessionEvent";
import {
  PluralTemplate,
  translatableTerm,
  TranslatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";

export type AuditLogModalAction = "Create" | "Update" | "Delete" | string;

export interface ComponentProps {
  isOpen: boolean;
  onClose: () => void;
  action: AuditLogModalAction;
  resourceType?: string | undefined;
  resourceName?: string | undefined;
  changes: JSONArray | undefined;
}

export interface ChangeRow {
  field: string;
  oldValue: JSONValue | undefined;
  newValue: JSONValue | undefined;
  /*
   * What changed, in plain lines, for a field the entry describes rather
   * than copies (a workflow's steps) and for JSON (the paths that changed).
   */
  summary: Array<string>;
}

// The lines of a change's summary: text only, anything else left out.
export const readChangeSummary: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((line: unknown): line is string => {
    return typeof line === "string" && line.trim().length > 0;
  });
};

/*
 * The fields of an entry as the dialog lists them, by name. Each change is
 * read as the recorder writes one now (readAuditLogChange): a phone number,
 * an email address or a URL an older entry recorded as its JSON
 * ({ "_type": "Phone", "value": "+14155550100" }) - and which the API client
 * hands over as a Phone again - reads as the number, without the "Changed
 * the value" its JSON was described by; a hash as "[REDACTED]".
 */
export const readChangeRows: (changes: unknown) => Array<ChangeRow> = (
  changes: unknown,
): Array<ChangeRow> => {
  if (!Array.isArray(changes)) {
    return [];
  }

  const rows: Array<ChangeRow> = [];

  for (const raw of changes) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }

    const entry: JSONObject = readAuditLogChange(raw as JSONObject);
    const field: unknown = entry["field"];

    if (typeof field !== "string" || field.length === 0) {
      continue;
    }

    rows.push({
      field,
      oldValue: entry["oldValue"] as JSONValue | undefined,
      newValue: entry["newValue"] as JSONValue | undefined,
      summary: readChangeSummary(entry["summary"]),
    });
  }

  rows.sort((a: ChangeRow, b: ChangeRow) => {
    return a.field.localeCompare(b.field);
  });

  return rows;
};

const humanizeFieldName: (field: string) => string = (
  field: string,
): string => {
  if (!field) {
    return "";
  }
  const spaced: string = splitCapitalRunsBeforeWords(
    field.replace(/([a-z\d])([A-Z])/g, "$1 $2"),
    " ",
  )
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const ISO_DATE_REGEX: RegExp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

const isISODate: (value: string) => boolean = (value: string): boolean => {
  return ISO_DATE_REGEX.test(value);
};

const formatScalar: (value: JSONValue | undefined) => string = (
  value: JSONValue | undefined,
): string => {
  if (value === null || value === undefined || value === "") {
    return EMPTY_VALUE_MARK;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    if (isISODate(value)) {
      try {
        return OneUptimeDate.getDateAsLocalFormattedString(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  return "";
};

export interface SessionDetailRow {
  field: AuditLogSessionField;
  label: string;
  value: string;
}

/*
 * A session entry's details as the dialog lists them (issue #6762): each
 * field it recorded, in the order the audit log names them, by its words -
 * in the reader's language when handed their translator (#8291), and so is
 * a value that is one of OneUptime's own words, why it ended or how they
 * signed in (#8459) - and a time in the reader's own zone.
 */
export const readSessionDetailRows: (
  changes: unknown,
  translator?: Translator | undefined,
  // The entry's action: a failed sign-in calls some fields its own way.
  action?: string | undefined,
) => Array<SessionDetailRow> = (
  changes: unknown,
  translator?: Translator | undefined,
  action?: string | undefined,
): Array<SessionDetailRow> => {
  const fields: Map<AuditLogSessionField, string> =
    readSessionEntryFields(changes);
  const rows: Array<SessionDetailRow> = [];

  for (const field of AUDIT_LOG_SESSION_FIELDS) {
    const value: string | undefined = fields.get(field);

    if (!value) {
      continue;
    }

    const label: string = getSessionFieldLabel({ field, action });

    rows.push({
      field: field,
      label: translator?.translateText(label) || label,
      value: AUDIT_LOG_SESSION_TIME_FIELDS.includes(field)
        ? formatScalar(value)
        : getSessionEntryValueInLanguage({ field, value, translator }),
    });
  }

  return rows;
};

/*
 * The dialog's title (issue #8076): the entry's action, then what it was
 * done to - a resource's type and name, or the session a sign-in made - as
 * one line in the reader's language. It was joined from English pieces, so
 * every language read "Sign In · User Session", its fallbacks never
 * translated. The action and the type are the reader's words; a name is
 * drawn as written; the separator is the language's own (" • " in Persian).
 */
export const getAuditLogChangesTitle: (data: {
  action: string;
  resourceType?: string | undefined;
  resourceName?: string | undefined;
  translator: Translator;
}) => string = (data: {
  action: string;
  resourceType?: string | undefined;
  resourceName?: string | undefined;
  translator: Translator;
}): string => {
  const action: TranslatableTerm = translatableTerm(
    getAuditLogActionLabel(data.action),
  );

  if (isSessionAuditLogAction(data.action)) {
    return data.translator.translateTemplate("{{action}} · {{subject}}", {
      action: action,
      subject:
        data.resourceName ||
        translatableTerm(data.resourceType || "User Session"),
    });
  }

  const resourceType: TranslatableTerm = translatableTerm(
    data.resourceType || "Resource",
  );

  return data.resourceName
    ? data.translator.translateTemplate(
        "{{action}} · {{resourceType}} — {{resourceName}}",
        {
          action: action,
          resourceType: resourceType,
          resourceName: data.resourceName,
        },
      )
    : data.translator.translateTemplate("{{action}} · {{resourceType}}", {
        action: action,
        resourceType: resourceType,
      });
};

/*
 * The words the dialog writes under its title and in its empty states, as
 * keys of the Dashboard's locales (#8291): they read in the reader's
 * language. They were English literals no locale had, so everything under a
 * translated title read English.
 */
export const AUDIT_LOG_CHANGES_DESCRIPTIONS: Readonly<{
  details: string;
  created: string;
  deleted: string;
  downloaded: string;
  signIn: string;
  signInFailed: string;
  sessionEnd: string;
}> = {
  details: translationKey("Change details"),
  created: translationKey("Created snapshot"),
  deleted: translationKey("Deleted snapshot"),
  downloaded: translationKey("What was downloaded"),
  signIn: translationKey("How and where they signed in"),
  signInFailed: translationKey("Why and where the sign-in failed"),
  sessionEnd: translationKey("How the session ended"),
};

/*
 * How many fields an update changed, in the plural forms of the reader's
 * language and in their digits: English built "3 fields changed" with its
 * own plural, glued by hand, in every language.
 */
export const AUDIT_LOG_FIELDS_CHANGED: PluralTemplate = {
  one: "{{count}} field changed",
  other: "{{count}} fields changed",
};

export const AUDIT_LOG_NO_SESSION_DETAILS: string = translationKey(
  "No details were recorded for this session.",
);

export const AUDIT_LOG_NO_FIELD_CHANGES: string = translationKey(
  "No field-level changes were recorded for this event.",
);

// What a session entry's dialog says it shows, in English: a key of the locales.
export const getSessionDetailsDescription: (action: string) => string = (
  action: string,
): string => {
  if (action === AuditLogAction.SignIn) {
    return AUDIT_LOG_CHANGES_DESCRIPTIONS.signIn;
  }

  if (action === AuditLogAction.SignInFailed) {
    return AUDIT_LOG_CHANGES_DESCRIPTIONS.signInFailed;
  }

  return AUDIT_LOG_CHANGES_DESCRIPTIONS.sessionEnd;
};

/*
 * What the dialog of a change entry says it shows, in the reader's
 * language: an update's count of changed fields, or what kind of entry it
 * is.
 */
export const getAuditLogChangesDescription: (data: {
  action: string;
  fieldCount: number;
  translator: Translator;
}) => string = (data: {
  action: string;
  fieldCount: number;
  translator: Translator;
}): string => {
  if (data.action === "Update") {
    return data.translator.translatePlural(
      AUDIT_LOG_FIELDS_CHANGED,
      data.fieldCount,
    );
  }

  let description: string = AUDIT_LOG_CHANGES_DESCRIPTIONS.details;

  if (data.action === "Create") {
    description = AUDIT_LOG_CHANGES_DESCRIPTIONS.created;
  } else if (data.action === "Delete") {
    description = AUDIT_LOG_CHANGES_DESCRIPTIONS.deleted;
  } else if (data.action === "Download") {
    description = AUDIT_LOG_CHANGES_DESCRIPTIONS.downloaded;
  }

  return data.translator.translateText(description) || description;
};

const renderValue: (
  value: JSONValue | undefined,
  translator: Translator,
) => ReactElement = (
  value: JSONValue | undefined,
  translator: Translator,
): ReactElement => {
  if (value === null || value === undefined || value === "") {
    return (
      <span className="italic text-gray-500">
        {translator.translateText("empty")}
      </span>
    );
  }

  if (typeof value === "object") {
    return (
      <pre className="whitespace-pre-wrap break-words text-xs bg-gray-50 text-gray-700 rounded-md px-2 py-1 border border-gray-200 font-mono max-h-48 overflow-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return (
    <span className="text-gray-900 whitespace-pre-wrap break-words">
      {getValueOrQuietDash(formatScalar(value))}
    </span>
  );
};

const AuditLogChangesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const rows: Array<ChangeRow> = useMemo(() => {
    return readChangeRows(props.changes);
  }, [props.changes]);

  if (!props.isOpen) {
    return null;
  }

  const title: string = getAuditLogChangesTitle({
    action: props.action,
    resourceType: props.resourceType,
    resourceName: props.resourceName,
    translator: translator,
  });

  if (isSessionAuditLogAction(props.action)) {
    const sessionRows: Array<SessionDetailRow> = readSessionDetailRows(
      props.changes,
      translator,
      props.action,
    );

    return (
      <Modal
        title={title}
        description={getSessionDetailsDescription(props.action)}
        onClose={props.onClose}
        closeButtonText="Close"
        modalWidth={ModalWidth.Medium}
      >
        <div className="mt-4">
          {sessionRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              {translator.translateText(AUDIT_LOG_NO_SESSION_DETAILS) ||
                AUDIT_LOG_NO_SESSION_DETAILS}
            </div>
          ) : (
            <dl
              className="divide-y divide-gray-200 rounded-md border border-gray-200 overflow-hidden"
              data-testid="audit-log-session-details"
            >
              {sessionRows.map((row: SessionDetailRow) => {
                return (
                  <div
                    key={row.field}
                    className="grid grid-cols-1 gap-1 bg-white px-4 py-3 sm:grid-cols-3 sm:gap-4"
                  >
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {row.label}
                    </dt>
                    <dd className="text-sm text-gray-900 break-words sm:col-span-2">
                      {getValueOrQuietDash(row.value)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </Modal>
    );
  }

  const isDelete: boolean = props.action === "Delete";
  const isUpdate: boolean = props.action === "Update";

  /*
   * Already in the reader's language, so handed over as drawn: Modal looks a
   * string description up again, and a translation can itself be a key.
   */
  const description: ReactElement = (
    <Fragment>
      {getAuditLogChangesDescription({
        action: props.action,
        fieldCount: rows.length,
        translator: translator,
      })}
    </Fragment>
  );

  const valueLabel: string = translator.translateText("Value") || "Value";

  return (
    <Modal
      title={title}
      description={description}
      onClose={props.onClose}
      closeButtonText="Close"
      modalWidth={ModalWidth.Medium}
    >
      <div className="mt-4">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
            {translator.translateText(AUDIT_LOG_NO_FIELD_CHANGES) ||
              AUDIT_LOG_NO_FIELD_CHANGES}
          </div>
        ) : (
          <div className="divide-y divide-gray-200 rounded-md border border-gray-200 overflow-hidden">
            {rows.map((row: ChangeRow) => {
              const showBoth: boolean =
                isUpdate &&
                row.oldValue !== undefined &&
                row.newValue !== undefined;

              return (
                <div
                  key={row.field}
                  className="bg-white px-4 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {humanizeFieldName(row.field)}
                    </span>
                    <span className="text-xs font-mono text-gray-500">
                      {row.field}
                    </span>
                  </div>

                  {row.summary.length > 0 ? (
                    <ul
                      className="mb-2 list-disc space-y-1 pl-5 text-sm text-gray-800"
                      data-testid="audit-log-change-summary"
                    >
                      {row.summary.map((line: string, index: number) => {
                        return (
                          <li
                            key={`${row.field}-${index}`}
                            className="break-words"
                          >
                            {line}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <></>
                  )}

                  {showBoth ? (
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 md:gap-3 items-start">
                      <div>
                        <div className="text-xs uppercase tracking-wide text-red-600 font-semibold mb-1">
                          {translator.translateText("Before")}
                        </div>
                        <div className="rounded-md border border-red-100 bg-red-50/60 px-3 py-2 text-sm">
                          {renderValue(row.oldValue, translator)}
                        </div>
                      </div>
                      <div className="max-md:hidden md:flex items-center justify-center pt-5 text-gray-400">
                        <Icon
                          icon={IconProp.ArrowRight}
                          size={SizeProp.Small}
                          thick={ThickProp.Thick}
                        />
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-wide text-emerald-600 font-semibold mb-1">
                          {translator.translateText("After")}
                        </div>
                        <div className="rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm">
                          {renderValue(row.newValue, translator)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div
                        className={`text-xs uppercase tracking-wide font-semibold mb-1 ${
                          isDelete ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {valueLabel}
                      </div>
                      <div
                        className={`rounded-md border px-3 py-2 text-sm ${
                          isDelete
                            ? "border-red-100 bg-red-50/60"
                            : "border-emerald-100 bg-emerald-50/60"
                        }`}
                      >
                        {renderValue(
                          isDelete ? row.oldValue : row.newValue,
                          translator,
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AuditLogChangesModal;
