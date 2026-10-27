import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiLaneSwitchStates from "../AI/useAiLaneSwitchStates";
import { OnCallRuleRecord } from "./WorkingHoursText";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { getAiHoldTimeInMinutes } from "Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import OnCallRuleWhenToPage from "Common/Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT AN ON-CALL RULE SET TO "AFTER ONEUPTIME AI TRIES" DOES, under the
 * choice on its form: one sentence, then the short list of what OneUptime AI
 * needs to hold a page - with whether automatic fixing is on now, and where
 * to turn it on. A rule whose records AI cannot fix pages right away, and the
 * record's feed says why, so the list never blocks saving.
 */

export const AI_FIRST_RESPONDER_SUMMARY_TEST_ID: string =
  "on-call-rule-ai-first-responder-summary";

// What happens to a match, said for each kind of record AI responds to.
export const AI_FIRST_RESPONDER_SUMMARIES: Record<
  OnCallRuleRecord.Alert | OnCallRuleRecord.Incident,
  string
> = {
  [OnCallRuleRecord.Alert]: translationKey(
    "Alerts that match this rule wait while OneUptime AI investigates and fixes them, for up to {{minutes}} minutes. If it can't fix one, or hasn't resolved it by then, paging starts.",
  ),
  [OnCallRuleRecord.Incident]: translationKey(
    "Incidents that match this rule wait while OneUptime AI investigates and fixes them, for up to {{minutes}} minutes. If it can't fix one, or hasn't resolved it by then, paging starts.",
  ),
};

export const AI_FIRST_RESPONDER_NEEDS: string = translationKey(
  "OneUptime AI holds a page only when it can fix the problem. It needs:",
);

export const AI_FIRST_RESPONDER_FIX_SWITCHES: Record<
  OnCallRuleRecord.Alert | OnCallRuleRecord.Incident,
  string
> = {
  [OnCallRuleRecord.Alert]: translationKey("Fix new alerts automatically"),
  [OnCallRuleRecord.Incident]: translationKey(
    "Fix new incidents automatically",
  ),
};

export const AI_FIRST_RESPONDER_AGENT_NEED: string = translationKey(
  "An AI agent set to Automatic on the cluster or host it is linked to",
);

export const AI_FIRST_RESPONDER_MONITOR_NEED: string = translationKey(
  "A monitor linked to it, to check the fix against",
);

export const AI_FIRST_RESPONDER_OTHERWISE: string = translationKey(
  "Otherwise this rule pages right away, and the feed says why.",
);

export interface ComponentProps {
  rule: {
    whenToPage?: OnCallRuleWhenToPage | string | null | undefined;
    aiHoldTimeInMinutes?: number | string | null | undefined;
  };
  record: OnCallRuleRecord;
}

function readMinutes(value: unknown): number | null {
  const minutes: number =
    typeof value === "string" ? Number(value) : (value as number);

  return typeof minutes === "number" && Number.isFinite(minutes)
    ? minutes
    : null;
}

const AiFirstResponderSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiRule: boolean =
    props.rule.whenToPage === OnCallRuleWhenToPage.AfterOneUptimeAI &&
    (props.record === OnCallRuleRecord.Alert ||
      props.record === OnCallRuleRecord.Incident);
  const isAlert: boolean = props.record === OnCallRuleRecord.Alert;

  const { states } = useAiLaneSwitchStates({
    subjectType: isAlert ? "alert" : "incident",
    isEnabled: isAiRule,
  });

  if (!isAiRule) {
    return <></>;
  }

  const record: OnCallRuleRecord.Alert | OnCallRuleRecord.Incident = isAlert
    ? OnCallRuleRecord.Alert
    : OnCallRuleRecord.Incident;

  const minutes: number = getAiHoldTimeInMinutes(
    readMinutes(props.rule.aiHoldTimeInMinutes),
  );

  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[
      isAlert ? PageMap.ALERTS_SETTINGS_AI : PageMap.INCIDENTS_SETTINGS_AI
    ] as Route,
  );

  return (
    <div
      className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5"
      data-testid={AI_FIRST_RESPONDER_SUMMARY_TEST_ID}
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <Icon
          icon={IconProp.Bolt}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
        />
        <p className="min-w-0 text-sm text-gray-800">
          {translator.translateTemplate(AI_FIRST_RESPONDER_SUMMARIES[record], {
            minutes: minutes,
          })}
        </p>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        {translator.translateText(AI_FIRST_RESPONDER_NEEDS)}
      </p>
      <ul className="mt-1 space-y-1 text-sm text-gray-700">
        <li
          className="flex items-start gap-2"
          data-testid="ai-first-responder-need-fixing"
        >
          <Icon
            icon={states.fix === true ? IconProp.CheckCircle : IconProp.Circle}
            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
              states.fix === true ? "text-green-600" : "text-gray-400"
            }`}
          />
          <Link
            to={settingsRoute}
            className="text-indigo-600 hover:text-indigo-800"
          >
            <span>
              {translator.translateText(
                AI_FIRST_RESPONDER_FIX_SWITCHES[record],
              )}
            </span>
          </Link>
        </li>
        <li className="flex items-start gap-2">
          <Icon
            icon={IconProp.Circle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <span>{translator.translateText(AI_FIRST_RESPONDER_AGENT_NEED)}</span>
        </li>
        <li className="flex items-start gap-2">
          <Icon
            icon={IconProp.Circle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <span>
            {translator.translateText(AI_FIRST_RESPONDER_MONITOR_NEED)}
          </span>
        </li>
      </ul>
      <p className="mt-2 text-sm text-gray-600">
        {translator.translateText(AI_FIRST_RESPONDER_OTHERWISE)}
      </p>
    </div>
  );
};

export default AiFirstResponderSummary;
