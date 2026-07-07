import { AIChatWidget, AIChatWidgetType } from "Common/Types/AI/AIChatTypes";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  widget: AIChatWidget;
}

const MAX_ITEMS: number = 12;

function toStr(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function timeAgo(value: unknown): string {
  if (!value) {
    return "";
  }
  try {
    return OneUptimeDate.fromNow(OneUptimeDate.fromString(value as string));
  } catch {
    return "";
  }
}

const Badge: FunctionComponent<{ text: string; tone: string }> = ({
  text,
  tone,
}: {
  text: string;
  tone: string;
}): ReactElement => {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {text}
    </span>
  );
};

function stateTone(state: string): string {
  const lower: string = state.toLowerCase();
  if (lower.includes("resolv")) {
    return "bg-emerald-50 text-emerald-700";
  }
  if (lower.includes("acknow")) {
    return "bg-amber-50 text-amber-700";
  }
  return "bg-rose-50 text-rose-700";
}

const EntityListWidget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const items: Array<JSONObject> = props.widget.data.items || [];
  const shown: Array<JSONObject> = items.slice(0, MAX_ITEMS);
  const isException: boolean =
    props.widget.type === AIChatWidgetType.ExceptionList;
  const isAlert: boolean = props.widget.type === AIChatWidgetType.AlertList;

  if (shown.length === 0) {
    return (
      <div className="py-3 text-center text-xs text-gray-400">
        Nothing here.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {shown.map((item: JSONObject, index: number) => {
        if (isException) {
          return (
            <div
              key={index}
              className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-gray-900">
                    {toStr(item["type"]) || "Exception"}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-gray-500">
                    {toStr(item["message"])}
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                    {toStr(item["occurrences"]) || "0"}×
                  </span>
                  {item["isResolved"] ? (
                    <Badge
                      text="Resolved"
                      tone="bg-emerald-50 text-emerald-700"
                    />
                  ) : null}
                </div>
              </div>
              <div className="mt-1.5 text-[10px] text-gray-400">
                Last seen {timeAgo(item["lastSeenAt"])}
              </div>
            </div>
          );
        }

        const numberField: string = isAlert
          ? toStr(item["alertNumber"])
          : toStr(item["incidentNumber"]);

        return (
          <div
            key={index}
            className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-gray-900">
                  {numberField ? `#${numberField} · ` : ""}
                  {toStr(item["title"])}
                </div>
                {item["description"] ? (
                  <div className="mt-0.5 line-clamp-1 text-[11px] text-gray-500">
                    {toStr(item["description"])}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-shrink-0 flex-col items-end gap-1">
                {item["state"] ? (
                  <Badge
                    text={toStr(item["state"])}
                    tone={stateTone(toStr(item["state"]))}
                  />
                ) : null}
                {item["severity"] ? (
                  <span className="text-[10px] text-gray-400">
                    {toStr(item["severity"])}
                  </span>
                ) : null}
              </div>
            </div>
            {item["createdAt"] ? (
              <div className="mt-1.5 text-[10px] text-gray-400">
                Created {timeAgo(item["createdAt"])}
              </div>
            ) : null}
          </div>
        );
      })}
      {items.length > shown.length && (
        <div className="text-[11px] text-gray-400">
          Showing {shown.length} of {items.length}.
        </div>
      )}
    </div>
  );
};

export default EntityListWidget;
