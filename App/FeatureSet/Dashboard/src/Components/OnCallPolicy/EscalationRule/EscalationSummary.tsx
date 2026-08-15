import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import ReadinessDot, { ReadinessUnknownDot } from "../Readiness/ReadinessDot";
import StatTile from "../Readiness/StatTile";
import {
  ReadinessIndex,
  UserReadinessWire,
  buildReadinessIndex,
  findReadinessForResponder,
} from "../Readiness/ReadinessTypes";
import useOnCallReadiness, {
  OnCallReadinessState,
} from "../Readiness/useOnCallReadiness";

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
  /*
   * Only meaningful for `type: "user"`. When present it is what matches this
   * chip to its readiness row; without it the match falls back to the label,
   * which is correct but gives up on duplicate names (see
   * ReadinessTypes.buildReadinessIndex).
   */
  userId?: string | undefined;
  /*
   * Schedule responders only: true when the schedule currently has nobody on
   * call. Such a responder exists on paper but would page no one, so it is
   * drawn in amber rather than identically to a healthy responder.
   */
  isUncovered?: boolean | undefined;
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
  /*
   * Optional, and the summary is complete without it: supplying the policy id
   * turns on the readiness dots by letting this component load the policy's
   * responder readiness. Omitting it leaves the hook idle — no request, no dots,
   * no behaviour change for any caller that has not opted in.
   */
  onCallDutyPolicyId?: ObjectID | undefined;
  /*
   * A readiness answer the caller has already loaded, used verbatim instead of
   * loading a second copy of it.
   *
   * The escalation page needs this exact payload twice over — once for these
   * dots and once for the warning label on each rule card — and two components
   * each calling the hook is two sets of paged requests for one answer, which
   * can also disagree with each other for a second while they settle. When it is
   * supplied the hook below stays idle; when it is not, nothing changes for any
   * other caller.
   */
  readiness?: OnCallReadinessState | undefined;
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

  /*
   * Readiness for the responders on this policy. The hook stays idle unless the
   * caller passed a policy id AND did not hand over an answer of its own, so
   * this costs nothing until the dots are wanted and never costs twice.
   */
  const ownReadiness: OnCallReadinessState = useOnCallReadiness({
    onCallDutyPolicyId: props.readiness ? undefined : props.onCallDutyPolicyId,
  });

  const readiness: OnCallReadinessState = props.readiness || ownReadiness;

  const readinessIndex: ReadinessIndex = useMemo((): ReadinessIndex => {
    return buildReadinessIndex(readiness.summary);
  }, [readiness.summary]);

  /*
   * With no summary loaded there are no readiness rows and therefore no dots, so
   * this value is unused in that state; it defaults to the product's own default
   * (fallback on) rather than to false so that a dot can never appear claiming
   * pages are dropped on the strength of a missing payload.
   */
  const isFallbackEnabled: boolean = readiness.summary
    ? readiness.summary.isFallbackEnabled
    : true;

  /*
   * Only meaningful once something has loaded. An idle or still-loading hook is
   * not a truncated answer, and marking every chip "not checked" while the
   * request is in flight would be a page full of grey dots that resolve to
   * nothing a second later.
   */
  const isTruncated: boolean =
    Boolean(readiness.summary) && readiness.isTruncated;

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
        {level.responders.map(
          (responder: EscalationResponder, i: number): ReactElement => {
            /*
             * Two independent reasons a chip can be amber, and they are not the
             * same claim.
             *
             * `isUncovered` is about the SCHEDULE: it exists on the policy but
             * currently rotates nobody, so it would page no one whatever the
             * people in it have configured.
             *
             * A readiness dot is about a PERSON: they are named on the policy
             * but cannot be reached, or can only be reached by falling back.
             *
             * They compose - an uncovered schedule sits next to user chips that
             * each carry their own dot - so both are rendered, and neither is
             * allowed to mask the other.
             *
             * Teams and schedules are containers, not people: the readiness
             * payload is per-user and does not say which team or which layer a
             * given user was reached through, so a dot on a team chip could only
             * be a guess. Only user chips carry one.
             */
            const responderReadiness: UserReadinessWire | null =
              responder.type === "user"
                ? findReadinessForResponder(readinessIndex, {
                    userId: responder.userId,
                    label: responder.label,
                  })
                : null;

            return (
              <span
                key={`r-${i}`}
                title={
                  responder.isUncovered
                    ? "No one is currently on call in this schedule."
                    : undefined
                }
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  responder.isUncovered
                    ? "bg-amber-50 text-amber-700 ring-amber-200"
                    : "bg-gray-50 text-gray-700 ring-gray-200"
                }`}
              >
                <Icon
                  icon={
                    responder.isUncovered
                      ? IconProp.Alert
                      : responderIcon(responder.type)
                  }
                  className={`h-3 w-3 ${
                    responder.isUncovered
                      ? "text-amber-500"
                      : responderIconColor(responder.type)
                  }`}
                />
                {responder.label}
                {responder.isUncovered ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide">
                    no one on call
                  </span>
                ) : (
                  <></>
                )}
                {responderReadiness ? (
                  <ReadinessDot
                    user={responderReadiness}
                    label={responder.label}
                    isFallbackEnabled={isFallbackEnabled}
                  />
                ) : (
                  <></>
                )}
                {/*
                 * No row, and the answer is known to be incomplete: this person
                 * was not checked. Everywhere else a bare chip means "ready", so
                 * without this the truncated case would quietly promote somebody
                 * nobody looked at into somebody who is fine.
                 */}
                {!responderReadiness &&
                responder.type === "user" &&
                isTruncated ? (
                  <ReadinessUnknownDot label={responder.label} />
                ) : (
                  <></>
                )}
              </span>
            );
          },
        )}
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
          <StatTile
            icon={IconProp.List}
            label={
              levels.length === 1 ? "Escalation level" : "Escalation levels"
            }
            value={`${levels.length}`}
          />
          <StatTile
            icon={IconProp.User}
            label={distinctResponders === 1 ? "Responder" : "Responders"}
            value={`${distinctResponders}`}
          />
          <StatTile
            icon={IconProp.Clock}
            label="To final level"
            value={
              timeToFinalLevel > 0
                ? formatDuration(timeToFinalLevel)
                : "Instant"
            }
          />
          <StatTile
            icon={IconProp.Reload}
            label="Repeats if unacked"
            value={
              props.repeatEnabled && props.repeatCount > 0
                ? `${props.repeatCount}×`
                : "None"
            }
          />
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
