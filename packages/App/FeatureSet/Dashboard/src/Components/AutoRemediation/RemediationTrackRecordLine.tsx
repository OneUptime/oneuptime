import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  getRemediationTrackRecordTone,
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
  RemediationTrackRecordRun,
  RemediationTrackRecordTone,
} from "Common/Types/AutoRemediation/RemediationTrackRecord";
import { describeRemediationTrackRecord } from "Common/Types/AutoRemediation/RemediationTrackRecordWords";
import Link from "Common/UI/Components/Link/Link";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME,
  REMEDIATION_FIX_FACT_CLASS_NAME,
  REMEDIATION_FIX_FACT_TEXT_CLASS_NAME,
} from "./RemediationFixFact";

/*
 * HOW THE SAME CHANGE WENT BEFORE, UNDER A CHANGE OF A FIX THAT WAITS FOR
 * APPROVAL (Types/AutoRemediation/RemediationTrackRecord).
 *
 * "Worked all 3 times it ran here before" with the incidents and alerts it
 * fixed, each a link to its page: the person approving sees at a glance
 * whether this is the fix that keeps working, one that keeps failing, or
 * something in between. A fact like the change's tier above it - a dot and
 * its words, never a pill or a box (the One AI card's rule) - and said in
 * red when the change never worked here, as a failure is.
 */

// The dot's colour by how it went: the same 500 shades the card's facts use.
const TRACK_RECORD_DOTS: Readonly<Record<RemediationTrackRecordTone, string>> =
  {
    [RemediationTrackRecordTone.Worked]: "bg-emerald-500",
    [RemediationTrackRecordTone.Mixed]: "bg-amber-500",
    [RemediationTrackRecordTone.DidNotWork]: "bg-rose-500",
  };

// What a run's link says when hovered: how that run went.
export const TRACK_RECORD_RUN_TITLES: Readonly<
  Record<RemediationTrackRecordOutcome, string>
> = {
  [RemediationTrackRecordOutcome.Worked]: translationKey("Worked here"),
  [RemediationTrackRecordOutcome.DidNotWork]:
    translationKey("Didn't work here"),
};

export interface ComponentProps {
  record: RemediationTrackRecord;
}

// The page of a run's incident or alert.
export function getTrackRecordRunRoute(run: RemediationTrackRecordRun): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[
      run.subjectKind === "incident"
        ? PageMap.INCIDENT_VIEW
        : PageMap.ALERT_VIEW
    ] as Route,
    { modelId: new ObjectID(run.subjectId) },
  );
}

const RemediationTrackRecordLine: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const tone: RemediationTrackRecordTone = getRemediationTrackRecordTone(
    props.record,
  );
  const namedRuns: Array<RemediationTrackRecordRun> = props.record.runs.filter(
    (run: RemediationTrackRecordRun): boolean => {
      return Boolean(run.subjectNumber);
    },
  );

  return (
    <div
      data-testid="remediation-command-track-record"
      data-tone={tone}
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <span
        className={`${REMEDIATION_FIX_FACT_CLASS_NAME} ${
          tone === RemediationTrackRecordTone.DidNotWork
            ? REMEDIATION_FIX_FACT_ALARMING_TEXT_CLASS_NAME
            : REMEDIATION_FIX_FACT_TEXT_CLASS_NAME
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 flex-none rounded-full ${TRACK_RECORD_DOTS[tone]}`}
        />
        <span
          className="break-words"
          data-testid="remediation-command-track-record-text"
        >
          {describeRemediationTrackRecord(props.record, translator)}
        </span>
      </span>
      {namedRuns.map((run: RemediationTrackRecordRun): ReactElement => {
        return (
          <Link
            key={`${run.subjectKind}-${run.subjectId}-${run.ranAt}`}
            to={getTrackRecordRunRoute(run)}
            dataTestId="remediation-track-record-run"
            className="rounded text-xs font-medium text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <span
              title={translator.translateText(
                TRACK_RECORD_RUN_TITLES[run.outcome],
              )}
            >
              {run.subjectNumber}
            </span>
          </Link>
        );
      })}
    </div>
  );
};

export default RemediationTrackRecordLine;
