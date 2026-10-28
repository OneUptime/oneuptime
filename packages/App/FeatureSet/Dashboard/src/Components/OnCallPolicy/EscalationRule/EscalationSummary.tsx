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
  NO_ONE_NEXT_LABEL,
  NO_ONE_NEXT_TOOLTIP,
} from "./EscalationRuleReadiness";
import {
  ReadinessIndex,
  UserReadinessWire,
  buildReadinessIndex,
  findReadinessForResponder,
} from "../Readiness/ReadinessTypes";
import useOnCallReadiness, {
  OnCallReadinessState,
} from "../Readiness/useOnCallReadiness";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import AcknowledgementTimeoutPolicySentence from "../AcknowledgementTimeout/AcknowledgementTimeoutPolicySentence";

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
  /*
   * Schedule responders only: true when the level pages the next person in
   * the schedule's rotation - the backup after whoever is on call - rather
   * than whoever is on call. Drawn with a fast-forward mark and "next in
   * rotation" beside the name.
   */
  isNextInRotation?: boolean | undefined;
  /*
   * Next in rotation responders only: true when somebody is on call but
   * nobody is ever next - each of the schedule's layers has one person in
   * it - so the level pages nobody there. Drawn in amber, as an uncovered
   * schedule is.
   */
  isNobodyNext?: boolean | undefined;
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
   * The policy's acknowledgement timeout, in minutes, while it pages again
   * when what it paged about is acknowledged but not resolved
   * (AcknowledgementTimeout): the summary ends by saying so. Null or
   * absent: it does not page again, and the summary is as it always was.
   */
  acknowledgementTimeoutInMinutes?: number | null | undefined;
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

// Compact human duration, e.g. "5 min", "1 hr", "1 hr 30 min".
const formatDuration: (minutes: number, translator: Translator) => string = (
  minutes: number,
  translator: Translator,
): string => {
  if (!minutes || minutes <= 0) {
    return translator.translateTemplate("{{minutes}} min", { minutes: 0 });
  }
  if (minutes < 60) {
    return translator.translateTemplate("{{minutes}} min", {
      minutes: minutes,
    });
  }
  const hours: number = Math.floor(minutes / 60);
  const remaining: number = minutes % 60;
  if (remaining === 0) {
    return translator.translatePlural(
      { one: "{{count}} hr", other: "{{count}} hrs" },
      hours,
    );
  }
  return translator.translateTemplate("{{hours}} hr {{minutes}} min", {
    hours: hours,
    minutes: remaining,
  });
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

/*
 * A level with no responders pages nobody: a run passes it at once, without
 * waiting out its wait (OnCallEmptyLevel). A level whose schedule has nobody
 * on call right now is not one: somebody may be by the time it is reached.
 */
export const isSkippedLevel: (level: EscalationLevelSummary) => boolean = (
  level: EscalationLevelSummary,
): boolean => {
  return level.responders.length === 0;
};

// What a skipped level shows where the others show when they are paged.
export const SKIPPED_LEVEL_TIMING: string = translationKey("Skipped at once");

const EscalationSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const levels: Array<EscalationLevelSummary> = props.levels;

  /*
   * Cumulative minutes from the moment the incident triggers to each level.
   * Level 1 fires immediately; level i fires after the sum of the wait times of
   * all preceding levels - except a level with no responders, which pages
   * nobody and so is passed at once, its wait never waited
   * (OnCallEmptyLevel).
   */
  const cumulativeOffsets: Array<number> = [];
  let runningTotal: number = 0;
  for (let i: number = 0; i < levels.length; i++) {
    cumulativeOffsets.push(runningTotal);
    runningTotal += isSkippedLevel(levels[i]!)
      ? 0
      : Math.max(0, levels[i]!.escalateAfterInMinutes || 0);
  }
  // Time from trigger until the final level is engaged.
  const timeToFinalLevel: number =
    cumulativeOffsets[cumulativeOffsets.length - 1] || 0;

  const distinctResponders: number = ((): number => {
    const seen: Set<string> = new Set<string>();
    for (const level of levels) {
      for (const responder of level.responders) {
        // A schedule's on-call person and its next person are two people.
        seen.add(
          `${responder.type}:${responder.label}${responder.isNextInRotation ? ":next" : ""}`,
        );
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
          {translator.translateText("No responders")}
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

            // Nobody to page there: nobody on call, or nobody ever next.
            const isWarning: boolean = Boolean(
              responder.isUncovered || responder.isNobodyNext,
            );

            return (
              <span
                key={`r-${i}`}
                data-testid="escalation-summary-responder"
                title={
                  responder.isUncovered
                    ? translator.translateText(
                        "No one is currently on call in this schedule.",
                      )
                    : responder.isNobodyNext
                      ? translator.translateText(NO_ONE_NEXT_TOOLTIP)
                      : undefined
                }
                className={`inline-flex max-w-full items-start gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  isWarning
                    ? "bg-amber-50 text-amber-700 ring-amber-200"
                    : "bg-gray-50 text-gray-700 ring-gray-200"
                }`}
              >
                <span className="flex h-4 flex-shrink-0 items-center">
                  <Icon
                    icon={
                      isWarning
                        ? IconProp.Alert
                        : responder.isNextInRotation
                          ? IconProp.Forward
                          : responderIcon(responder.type)
                    }
                    className={`h-3 w-3 ${
                      isWarning
                        ? "text-amber-500"
                        : responderIconColor(responder.type)
                    }`}
                  />
                </span>
                {/*
                 * The name and what is said about it, as one line of text: a
                 * long name wraps with "next in rotation" after it, each
                 * phrase kept whole, rather than each phrase standing in a
                 * column of its own.
                 */}
                <span className="min-w-0 break-words">
                  {responder.label}
                  {responder.isNextInRotation ? (
                    <>
                      {" "}
                      <span
                        className={`whitespace-nowrap font-normal ${
                          isWarning ? "text-amber-700" : "text-gray-500"
                        }`}
                      >
                        {translator.translateText("next in rotation")}
                      </span>
                    </>
                  ) : (
                    <></>
                  )}
                  {responder.isUncovered ? (
                    <>
                      {" "}
                      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide">
                        {translator.translateText("no one on call")}
                      </span>
                    </>
                  ) : (
                    <></>
                  )}
                  {!responder.isUncovered && responder.isNobodyNext ? (
                    <>
                      {" "}
                      <span
                        data-testid="escalation-summary-no-one-next"
                        className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide"
                      >
                        {translator.translateText(NO_ONE_NEXT_LABEL)}
                      </span>
                    </>
                  ) : (
                    <></>
                  )}
                </span>
                {responderReadiness ? (
                  // Beside the first line of the name, as the icon is.
                  <span className="flex h-4 flex-shrink-0 items-center">
                    <ReadinessDot
                      user={responderReadiness}
                      label={responder.label}
                      isFallbackEnabled={isFallbackEnabled}
                    />
                  </span>
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
                  <span className="flex h-4 flex-shrink-0 items-center">
                    <ReadinessUnknownDot label={responder.label} />
                  </span>
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
          {translator.translateText("Escalation summary")}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
          {translator.translateText(
            "Who is paged, and when, once an incident or alert runs this policy.",
          )}
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
                ? formatDuration(timeToFinalLevel, translator)
                : translator.translateText("Instant") || "Instant"
            }
          />
          <StatTile
            icon={IconProp.Reload}
            label="Repeats"
            value={
              props.repeatEnabled && props.repeatCount > 0
                ? `${props.repeatCount}×`
                : translator.translateText("None") || "None"
            }
          />
        </div>

        {/* Condensed escalation timeline */}
        <div>
          {/* Trigger node */}
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 text-red-400" />
            {translator.translateText("Incident triggered")}
          </div>

          <ol className="mt-2 space-y-0">
            {levels.map((level: EscalationLevelSummary, index: number) => {
              const offset: number = cumulativeOffsets[index] || 0;
              const isSkipped: boolean = isSkippedLevel(level);
              const timingLabel: string = isSkipped
                ? translator.translateText(SKIPPED_LEVEL_TIMING) ||
                  SKIPPED_LEVEL_TIMING
                : offset <= 0
                  ? translator.translateText("Immediately") || "Immediately"
                  : translator.translateTemplate("After {{duration}}", {
                      duration: formatDuration(offset, translator),
                    });

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
                        <span
                          data-testid={
                            isSkipped
                              ? "escalation-summary-level-skipped"
                              : "escalation-summary-level-timing"
                          }
                          className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500 ring-1 ring-inset ring-gray-200"
                        >
                          <Icon
                            icon={isSkipped ? IconProp.Forward : IconProp.Clock}
                            className="h-2.5 w-2.5 text-gray-400"
                          />
                          {timingLabel}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span className="text-xs text-gray-500">
                          {translator.translateText("Notifies")}
                        </span>
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
                  <TranslatedSentence
                    template="If still unacknowledged, the entire policy repeats {{times}}, then stops."
                    slots={{
                      times: (
                        <span className="font-semibold text-gray-900">
                          {translator.translatePlural(
                            {
                              one: "up to {{count}} more time",
                              other: "up to {{count}} more times",
                            },
                            props.repeatCount,
                          )}
                        </span>
                      ),
                    }}
                  />
                ) : (
                  <>
                    {translator.translateText(
                      "If no one acknowledges after the final level, escalation stops here.",
                    )}
                  </>
                )}
              </div>
            </li>

            {/*
             * After an acknowledgement: a branch of its own rather than a
             * step after "stops here", so no connector leads to it - a gap
             * and a rule set it apart instead. (The gap is an element of its
             * own: the list's space-y-0 zeroes a margin on its rows.)
             */}
            {props.acknowledgementTimeoutInMinutes ? (
              <div className="h-3" aria-hidden="true" />
            ) : (
              <></>
            )}
            {props.acknowledgementTimeoutInMinutes ? (
              <li
                className="flex items-start gap-3 border-t border-gray-100 pt-3"
                data-testid="escalation-summary-page-again"
              >
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 ring-1 ring-inset ring-gray-200">
                  <Icon
                    icon={IconProp.Bell}
                    className="h-3.5 w-3.5 text-gray-500"
                  />
                </span>
                <div className="min-w-0 flex-1 pt-0.5 text-sm text-gray-600">
                  <AcknowledgementTimeoutPolicySentence
                    duration={formatDuration(
                      props.acknowledgementTimeoutInMinutes,
                      translator,
                    )}
                  />
                </div>
              </li>
            ) : (
              <></>
            )}
          </ol>
        </div>
      </div>
    </div>
  );
};

export default EscalationSummary;
