import React, { FunctionComponent, ReactElement } from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Service from "Common/Models/DatabaseModels/Service";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import RowActions from "Common/UI/Components/ActionButton/RowActions";

export interface ExceptionRowProps {
  exception: TelemetryException;
  service?: Service | undefined;
  onClick?: () => void;
  /*
   * The row's ⋯ menu: Resolve or Reopen, Archive or Unarchive
   * (ExceptionRowActions). Beside the row, not inside it - the row is the
   * button that opens the exception.
   */
  actionButtons?: Array<ActionButtonSchema<TelemetryException>> | undefined;
}

// "5m ago", in the reader's language.
function formatRelativeTime(time: Date, translator: Translator): string {
  const now: Date = new Date();
  const diffMs: number = Math.max(0, now.getTime() - time.getTime());
  const sec: number = Math.floor(diffMs / 1000);
  /*
   * The number in the reader's digits, as the row's count of events is
   * ("۴۱۲ رویداد", "۹ روز پیش" on a Persian page).
   */
  if (sec < 60) {
    return translator.translateTemplate("{{count}}s ago", {
      count: translator.formatNumber(sec),
    });
  }
  const min: number = Math.floor(sec / 60);
  if (min < 60) {
    return translator.translateTemplate("{{count}}m ago", {
      count: translator.formatNumber(min),
    });
  }
  const hr: number = Math.floor(min / 60);
  if (hr < 24) {
    return translator.translateTemplate("{{count}}h ago", {
      count: translator.formatNumber(hr),
    });
  }
  const day: number = Math.floor(hr / 24);
  return translator.translateTemplate("{{count}}d ago", {
    count: translator.formatNumber(day),
  });
}

const ExceptionRow: FunctionComponent<ExceptionRowProps> = (
  props: ExceptionRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { exception, service } = props;

  const exceptionType: string =
    exception.exceptionType ||
    (translator.translateText("Exception") as string);
  const message: string = exception.message || "";
  const firstLine: string = message.split("\n")[0] || "";

  const occuranceCount: number = exception.occuranceCount || 0;

  const firstSeen: Date | null = exception.firstSeenAt
    ? new Date(exception.firstSeenAt as unknown as string)
    : null;
  const lastSeen: Date | null = exception.lastSeenAt
    ? new Date(exception.lastSeenAt as unknown as string)
    : null;

  const serviceName: string =
    service?.name || (translator.translateText("unknown service") as string);
  const serviceColor: string | undefined = service?.serviceColor?.toString();

  const isResolved: boolean = Boolean(exception.isResolved);
  const isArchived: boolean = Boolean(exception.isArchived);

  /*
   * Where the exception stands. From sm up it sits at the row's top right,
   * beside the ⋯; on a phone it leads the service line instead, so the
   * exception's type and message keep the row's width rather than wrapping
   * a word to a line between the pill and the menu.
   */
  const statusPill: ReactElement = isResolved ? (
    <span className="whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
      {translator.translateText("Resolved")}
    </span>
  ) : isArchived ? (
    <span className="whitespace-nowrap rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600">
      {translator.translateText("Archived")}
    </span>
  ) : (
    <span className="whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
      {translator.translateText("Unresolved")}
    </span>
  );

  return (
    <div className="group flex items-start transition-colors hover:bg-indigo-50/40 focus-within:bg-indigo-50/60">
      <button
        type="button"
        className="block min-w-0 flex-1 px-4 py-3 text-left focus:outline-none"
        onClick={props.onClick}
      >
        <div className="flex items-start gap-3">
          {/* Level dot */}
          <span
            className={`mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full ${
              isResolved
                ? "bg-emerald-400"
                : isArchived
                  ? "bg-gray-300"
                  : "bg-red-500"
            }`}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* Line 1: type + message */}
            <div className="min-w-0">
              <span className="font-mono text-xs font-semibold text-gray-900">
                {exceptionType}
              </span>
              {firstLine && (
                <span className="text-xs text-gray-700">
                  <span className="text-gray-400">: </span>
                  <span className="font-mono">{firstLine}</span>
                </span>
              )}
            </div>

            {/* Line 2: (on a phone, the status first) service + environment */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span
                className="flex sm:hidden"
                data-testid="exception-row-status-inline"
              >
                {statusPill}
              </span>
              <span
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-medium text-gray-600"
                style={
                  serviceColor
                    ? { borderColor: serviceColor, color: serviceColor }
                    : undefined
                }
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: serviceColor || "#9ca3af" }}
                />
                {serviceName}
              </span>
              {exception.environment && (
                <span className="whitespace-nowrap rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">
                  {exception.environment}
                </span>
              )}
              {exception.fingerprint && (
                <span className="min-w-0 truncate font-mono text-[10px] text-gray-400">
                  {exception.fingerprint.toString().slice(0, 12)}…
                </span>
              )}
            </div>

            {/* Line 3: metadata */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
              {firstSeen && (
                <span>
                  <TranslatedSentence
                    template="first {{time}}"
                    slots={{
                      time: (
                        <span className="font-medium text-gray-700">
                          {formatRelativeTime(firstSeen, translator)}
                        </span>
                      ),
                    }}
                  />
                </span>
              )}
              {lastSeen && (
                <>
                  <span className="text-gray-300">·</span>
                  <span>
                    <TranslatedSentence
                      template="last {{time}}"
                      slots={{
                        time: (
                          <span className="font-medium text-gray-700">
                            {formatRelativeTime(lastSeen, translator)}
                          </span>
                        ),
                      }}
                    />
                  </span>
                </>
              )}
              <span className="text-gray-300">·</span>
              <span>
                <TranslatedSentence
                  template={{
                    one: "{{number}} event",
                    other: "{{number}} events",
                  }}
                  count={occuranceCount}
                  slots={{
                    number: (
                      <span className="font-semibold tabular-nums text-gray-800">
                        {translator.formatNumber(occuranceCount)}
                      </span>
                    ),
                  }}
                />
              </span>
            </div>
          </div>

          {/* Status pill, from sm up */}
          <div
            className="flex flex-shrink-0 items-center max-sm:hidden"
            data-testid="exception-row-status"
          >
            {statusPill}
          </div>
        </div>
      </button>
      {props.actionButtons && props.actionButtons.length > 0 ? (
        <div
          className="shrink-0 py-2.5 pr-2 sm:pr-3"
          data-testid="exception-row-actions"
        >
          <RowActions<TelemetryException>
            item={exception}
            actionButtons={props.actionButtons}
            itemLabel={`${exceptionType}${firstLine ? `: ${firstLine}` : ""}`}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default ExceptionRow;
