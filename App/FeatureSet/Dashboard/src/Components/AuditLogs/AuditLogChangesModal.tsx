import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Icon, { SizeProp, ThickProp } from "Common/UI/Components/Icon/Icon";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import React, {
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

interface ChangeRow {
  field: string;
  oldValue: JSONValue | undefined;
  newValue: JSONValue | undefined;
}

const humanizeFieldName: (field: string) => string = (
  field: string,
): string => {
  if (!field) {
    return "";
  }
  const spaced: string = field
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const isISODate: (value: string) => boolean = (value: string): boolean => {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(
    value,
  );
};

const formatScalar: (value: JSONValue | undefined) => string = (
  value: JSONValue | undefined,
): string => {
  if (value === null || value === undefined || value === "") {
    return "—";
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

const renderValue: (value: JSONValue | undefined) => ReactElement = (
  value: JSONValue | undefined,
): ReactElement => {
  if (value === null || value === undefined || value === "") {
    return <span className="italic text-gray-400">empty</span>;
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
      {formatScalar(value)}
    </span>
  );
};

const AuditLogChangesModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const rows: Array<ChangeRow> = useMemo(() => {
    if (!props.changes || !Array.isArray(props.changes)) {
      return [];
    }

    const mapped: Array<ChangeRow> = [];
    for (const raw of props.changes) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const entry: JSONObject = raw as JSONObject;
      const field: unknown = entry["field"];
      if (typeof field !== "string" || field.length === 0) {
        continue;
      }
      mapped.push({
        field,
        oldValue: entry["oldValue"] as JSONValue | undefined,
        newValue: entry["newValue"] as JSONValue | undefined,
      });
    }
    mapped.sort((a: ChangeRow, b: ChangeRow) => {
      return a.field.localeCompare(b.field);
    });
    return mapped;
  }, [props.changes]);

  if (!props.isOpen) {
    return null;
  }

  const isCreate: boolean = props.action === "Create";
  const isDelete: boolean = props.action === "Delete";
  const isUpdate: boolean = props.action === "Update";

  let header: string = "Change details";
  if (isCreate) {
    header = "Created snapshot";
  } else if (isDelete) {
    header = "Deleted snapshot";
  } else if (isUpdate) {
    header = `${rows.length} field${rows.length === 1 ? "" : "s"} changed`;
  }

  return (
    <Modal
      title={
        props.resourceName
          ? `${props.action} · ${props.resourceType || "Resource"} — ${props.resourceName}`
          : `${props.action} · ${props.resourceType || "Resource"}`
      }
      description={header}
      onClose={props.onClose}
      onSubmit={props.onClose}
      submitButtonText="Close"
      submitButtonStyleType={ButtonStyleType.NORMAL}
      modalWidth={ModalWidth.Medium}
    >
      <div className="mt-4">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
            No field-level changes were recorded for this event.
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
                    <span className="text-[10px] font-mono text-gray-400">
                      {row.field}
                    </span>
                  </div>

                  {showBoth ? (
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 md:gap-3 items-start">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-red-600 font-semibold mb-1">
                          Before
                        </div>
                        <div className="rounded-md border border-red-100 bg-red-50/60 px-3 py-2 text-sm">
                          {renderValue(row.oldValue)}
                        </div>
                      </div>
                      <div className="hidden md:flex items-center justify-center pt-5 text-gray-400">
                        <Icon
                          icon={IconProp.ArrowRight}
                          size={SizeProp.Small}
                          thick={ThickProp.Thick}
                        />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold mb-1">
                          After
                        </div>
                        <div className="rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm">
                          {renderValue(row.newValue)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div
                        className={`text-[10px] uppercase tracking-wide font-semibold mb-1 ${
                          isDelete ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {isDelete ? "Value" : "Value"}
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
