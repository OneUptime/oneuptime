import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { AiLaneAdvancedCard } from "../AISettings/ProjectAiSettingsCopy";
import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Route from "Common/Types/API/Route";
import AutoRemediationTriggerEntity from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * On a Runner's own page, in its Runner Details after the code repositories
 * that pick it: the AI rules that pick it - the incident and alert AI rules
 * whose Runner (under More fields) is this one, where OneUptime AI runs the
 * Bash commands of the fixes it works out for them. A Runner said which
 * repositories work on it, but not which rules send their commands to it,
 * so a Runner could not be told apart from an idle one, nor be taken away
 * knowing what it would stop.
 *
 * Each rule is a link to its lane's AI settings, landing on the AI Rules
 * card (More settings opens there), where its Runner is changed. With none,
 * one short line says where a rule picks its Runner.
 *
 * A rule that picks no Runner is not listed: it runs no Bash command on a
 * Runner of the project (it shows the Global Runner, where none runs), and
 * the project's default Runner is only where a new rule starts. The page
 * reads the rules once (loadRunnerAiRules) and draws the row only when it
 * could: not for someone who may not read AI rules - the row would be about
 * rules they cannot see - nor on an in-cluster Runner the Kubernetes agent
 * chart installed, which no rule may pick.
 *
 * A Kubernetes cluster binds no Runner but its own in-cluster one, whose
 * name already names the cluster (kubernetes-agent/<cluster>), so there is
 * no cluster row.
 */

export const RUNNER_AI_RULES_TEST_ID: string = "runner-ai-rules";

// The most rules the row lists; a Runner rarely has this many.
export const MAX_LISTED_AI_RULES: number = 50;

export const RunnerAiRulesCopy: {
  title: string;
  empty: string;
} = {
  title: translationKey("AI Rules"),
  empty: translationKey(
    "None. An AI rule picks its Runner in its More fields, on Incidents › AI › Settings or Alerts › AI › Settings.",
  ),
};

/*
 * The lane a rule belongs to, said beside its name: the same name may be
 * an incident rule's and an alert rule's.
 */
const LANE_TEXT: Partial<Record<AutoRemediationTriggerEntity, string>> = {
  [AutoRemediationTriggerEntity.Incident]: translationKey("Incidents"),
  [AutoRemediationTriggerEntity.Alert]: translationKey("Alerts"),
};

// The page each lane keeps its AI rules on.
const LANE_PAGE: Partial<Record<AutoRemediationTriggerEntity, PageMap>> = {
  [AutoRemediationTriggerEntity.Incident]: PageMap.INCIDENTS_SETTINGS_AI,
  [AutoRemediationTriggerEntity.Alert]: PageMap.ALERTS_SETTINGS_AI,
};

export interface RunnerAiRuleRow {
  id: string;
  name: string;
  triggerEntityType: AutoRemediationTriggerEntity | null;
}

// The lane's word for a rule, or null for a lane that picks no Runner.
export function getRunnerAiRuleLaneText(row: RunnerAiRuleRow): string | null {
  return row.triggerEntityType
    ? LANE_TEXT[row.triggerEntityType] || null
    : null;
}

/*
 * Where a rule's Runner is changed: its lane's AI settings, at the AI Rules
 * card. Null for a lane that picks no Runner.
 */
export function getRunnerAiRuleRoute(row: RunnerAiRuleRow): Route | null {
  const page: PageMap | undefined = row.triggerEntityType
    ? LANE_PAGE[row.triggerEntityType]
    : undefined;

  if (!page) {
    return null;
  }

  return getRouteToPageAnchor(
    RouteUtil.populateRouteParams(RouteMap[page] as Route),
    AiLaneAdvancedCard.AiRules,
  );
}

/*
 * The AI rules that pick the Runner, by name, or null when they cannot be
 * read.
 */
export async function loadRunnerAiRules(
  runnerId: ObjectID,
): Promise<Array<RunnerAiRuleRow> | null> {
  try {
    const result: ListResult<AutoRemediationRule> =
      await ModelAPI.getList<AutoRemediationRule>({
        modelType: AutoRemediationRule,
        query: {
          runnerId: runnerId,
        },
        select: {
          _id: true,
          name: true,
          triggerEntityType: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: MAX_LISTED_AI_RULES,
        skip: 0,
      });

    return result.data.map((rule: AutoRemediationRule): RunnerAiRuleRow => {
      return {
        id: rule._id?.toString() || "",
        name: rule.name || "",
        triggerEntityType: rule.triggerEntityType || null,
      };
    });
  } catch {
    return null;
  }
}

export interface ComponentProps {
  rules: Array<RunnerAiRuleRow>;
}

/*
 * The row's value: each rule a link to where its Runner is changed, its
 * lane beside it, in a line that wraps - or, with none, where a rule picks
 * its Runner.
 */
const RunnerAiRuleList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.rules.length === 0) {
    return (
      <span
        className="text-gray-500"
        data-testid={`${RUNNER_AI_RULES_TEST_ID}-empty`}
      >
        {translator.translateText(RunnerAiRulesCopy.empty)}
      </span>
    );
  }

  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1"
      data-testid={RUNNER_AI_RULES_TEST_ID}
    >
      {props.rules.map((rule: RunnerAiRuleRow) => {
        const route: Route | null = getRunnerAiRuleRoute(rule);
        const lane: string | null = getRunnerAiRuleLaneText(rule);

        return (
          <li key={rule.id} className="min-w-0 max-w-full">
            {route ? (
              <Link
                to={route}
                className="break-words font-medium text-indigo-600 hover:text-indigo-500 hover:underline"
                dataTestId={`${RUNNER_AI_RULES_TEST_ID}-link`}
              >
                <>{rule.name}</>
              </Link>
            ) : (
              <span className="break-words font-medium text-gray-900">
                {rule.name}
              </span>
            )}
            {/*
             * The lane after a dot, so a rule named for its lane ("Fix
             * database alerts · Alerts") does not run into it.
             */}
            {lane ? (
              <>
                <span aria-hidden="true" className="mx-1.5 text-gray-400">
                  ·
                </span>
                <span
                  className="text-gray-500"
                  data-testid={`${RUNNER_AI_RULES_TEST_ID}-lane`}
                >
                  {translator.translateText(lane)}
                </span>
              </>
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default RunnerAiRuleList;
