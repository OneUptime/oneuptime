import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * A concise, plain-english overview of how an on-call policy escalates — the
 * "read it in five seconds" companion to the detailed, editable rule cards
 * below it. It answers: who is paged first, how the alert climbs the ladder over
 * time, and what happens if nobody ever acknowledges.
 */

export type ResponderType = "schedule" | "team" | "user";

export interface EscalationResponder {
  label: string;
  type: ResponderType;
}

export interface EscalationLevelSummary {
  name: string;
  escalateAfterInMinutes: number;
  responders: Array<EscalationResponder>;
}

export interface ComponentProps {
  levels: Array<EscalationLevelSummary>;
  repeatEnabled: boolean;
  repeatCount: number;
}

// Compact human duration, e.g. "immediately", "5 min", "1 hr 30 min".
const formatDuration: (minutes: number) => string = (
  minutes: number,
): string => {
  if (!minutes || minutes <= 0) {
    return "0 min";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours: number = Math.floor(minutes / 60);
  const remaining: number = minutes % 60;
  if (remaining === 0) {
    return hours === 1 ? "1 hr" : `${hours} hrs`;
  }
  return `${hours} hr ${remaining} min`;
};

const responderIcon: (type: ResponderType) => IconProp = (
  type: ResponderType,
): IconProp => {
  if (type === "schedule") {
    return IconProp.Calendar;
  }
  if (type === "team") {
    return IconProp.Team;
  }
  return IconProp.User;
};

const responderIconColor: (type: ResponderType) => string = (
  type: ResponderType,
): string => {
  if (type === "schedule") {
    return "text-indigo-500";
  }
  if (type === "team") {
    return "text-violet-500";
  }
  return "text-gray-500";
};

const EscalationSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const levels: Array<EscalationLevelSummary> = props.levels;

  /*
   * Cumulative minutes from the moment the incident triggers to each level.
   * Level 1 fires immediately; level i fires after the sum of the wait times of
   * all preceding levels.
   */
  const cumulativeOffsets: Array<number> = [];
  let runningTotal: number = 0;
  for (let i: number = 0; i < levels.length; i++) {
    cumulativeOffsets.push(runningTotal);
    runningTotal += Math.max(0, levels[i]!.escalateAfterInMinutes || 0);
  }
  // Time from trigger until the final level is engaged.
  const timeToFinalLevel: number =
    cumulativeOffsets[cumulativeOffsets.length - 1] || 0;

  const distinctResponders: number = ((): number => {
    const seen: Set<string> = new Set<string>();
    for (const level of levels) {
      for (const responder of level.responders) {
        seen.add(`${responder.type}:${responder.label}`);
      }
    }
    return seen.size;
  })();

  const getStatTile: (params: {
    icon: IconProp;
    label: string;
    value: string;
  }) => ReactElement = (params: {
    icon: IconProp;
    label: string;
    value: string;
  }): ReactElement => {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50">
          <Icon icon={params.icon} className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold leading-tight text-gray-900">
            {params.value}
          </div>
          <div className="truncate text-xs text-gray-500">{params.label}</div>
        </div>
      </div>
    );
  };

  const getResponderChips: (level: EscalationLevelSummary) => ReactElement = (
    level: EscalationLevelSummary,
  ): ReactElement => {
    if (level.responders.length === 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
          <Icon icon={IconProp.Alert} className="h-3 w-3 text-amber-500" />
          No responders
        </span>
      );
    }

    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {level.responders.map((responder: EscalationResponder, i: number) => {
          return (
            <span
              key={`r-${i}`}
              className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
            >
              <Icon
                icon={responderIcon(responder.type)}
                className={`h-3 w-3 ${responderIconColor(responder.type)}`}
              />
              {responder.label}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-gray-900">
          Escalation summary
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
          A plain-english walkthrough of who gets paged, and when, after an
          incident is triggered.
        </p>
      </div>

      <div className="p-6">
        {/* Stat tiles */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {getStatTile({
            icon: IconProp.List,
            label:
              levels.length === 1 ? "Escalation level" : "Escalation levels",
            value: `${levels.length}`,
          })}
          {getStatTile({
            icon: IconProp.User,
            label: distinctResponders === 1 ? "Responder" : "Responders",
            value: `${distinctResponders}`,
          })}
          {getStatTile({
            icon: IconProp.Clock,
            label: "To final level",
            value:
              timeToFinalLevel > 0
                ? formatDuration(timeToFinalLevel)
                : "Instant",
          })}
          {getStatTile({
            icon: IconProp.Reload,
            label: "Repeats if unacked",
            value:
              props.repeatEnabled && props.repeatCount > 0
                ? `${props.repeatCount}×`
                : "None",
          })}
        </div>

        {/* Condensed escalation timeline */}
        <div>
          {/* Trigger node */}
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 text-red-400" />
            Incident triggered
          </div>

          <ol className="mt-2 space-y-0">
            {levels.map((level: EscalationLevelSummary, index: number) => {
              const offset: number = cumulativeOffsets[index] || 0;
              const timingLabel: string =
                offset <= 0 ? "Immediately" : `After ${formatDuration(offset)}`;

              return (
                <Fragment key={`level-${index}`}>
                  {/* Connector line from the previous node */}
                  <div className="ml-3 h-4 w-px bg-gray-200" />

                  <li className="flex items-start gap-3">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-gray-900">
                          {level.name}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
                          <Icon
                            icon={IconProp.Clock}
                            className="h-2.5 w-2.5 text-gray-400"
                          />
                          {timingLabel}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span className="text-xs text-gray-500">Notifies</span>
                        {getResponderChips(level)}
                      </div>
                    </div>
                  </li>
                </Fragment>
              );
            })}

            {/* Terminator node */}
            <div className="ml-3 h-4 w-px bg-gray-200" />
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 ring-1 ring-inset ring-gray-200">
                <Icon
                  icon={
                    props.repeatEnabled && props.repeatCount > 0
                      ? IconProp.Reload
                      : IconProp.CheckCircle
                  }
                  className="h-3.5 w-3.5 text-gray-500"
                />
              </span>
              <div className="min-w-0 flex-1 pt-0.5 text-sm text-gray-600">
                {props.repeatEnabled && props.repeatCount > 0 ? (
                  <>
                    If still unacknowledged, the entire policy repeats{" "}
                    <span className="font-semibold text-gray-900">
                      up to {props.repeatCount} more{" "}
                      {props.repeatCount === 1 ? "time" : "times"}
                    </span>
                    , then stops.
                  </>
                ) : (
                  <>
                    If no one acknowledges after the final level, escalation
                    stops here.
                  </>
                )}
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default EscalationSummary;
