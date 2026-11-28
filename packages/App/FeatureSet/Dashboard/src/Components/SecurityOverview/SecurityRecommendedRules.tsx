import AppLink from "../AppLink/AppLink";
import SecurityEventSeverityPill from "../SecurityEvents/SecurityEventSeverityPill";
import { getLibraryRuleSeverity } from "../SecurityEvents/RuleLibraryUtil";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  DISMISS,
  MORE_RECOMMENDED_RULES,
  RECOMMENDED_RULES_LIST_LABEL,
  RECOMMENDED_RULES_NOT_ADDED,
  RULES_NOT_ADDED,
  RULE_ADDED_BY_ONEUPTIME,
  RULE_ADDED_BY_ONEUPTIME_WHY,
  RULE_NOT_TURNED_OFF,
  RULE_TURNED_OFF,
  RULE_TURNED_ON,
  RecommendedRulesNotAddedView,
  RuleAddedByOneUptimeView,
  SecurityRecommendedRulesDismissal,
  TURN_OFF_RULE,
  TURN_ON_RULE,
  getDismissalKey,
  getRecommendedRulesNotAddedQuery,
  getRecommendedRulesNotAddedView,
  getRulesAddedByOneUptimeViews,
  mergeDismissedIds,
  readDismissedIdsFrom,
} from "./SecurityRecommendedRulesModel";
import {
  SecuritySetupStatus,
  TurnOnRecommendedProblem,
  describeAddFailure,
  describeSetupCallFailure,
} from "./SecuritySetupModel";
import SecurityTurnOnProblems from "./SecurityTurnOnProblems";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { DetectionRuleLibraryEntry } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import {
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { buildDetectionRuleFromLibrary } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";
import React, { FunctionComponent, ReactElement, useState } from "react";

export const SECURITY_RECOMMENDED_RULES_TEST_ID: string =
  "security-recommended-rules";
export const SECURITY_RULE_ADDED_BY_ONEUPTIME_TEST_ID: string =
  "security-rule-added-by-oneuptime";

function getCurrentDismissalKey(
  dismissal: SecurityRecommendedRulesDismissal,
): string | null {
  return getDismissalKey(
    dismissal,
    ProjectUtil.getCurrentProjectId()?.toString(),
  );
}

/*
 * What this reader dismissed in this project, as Get started's Dismiss is
 * remembered: in the browser, and nothing when it cannot be read.
 */
export function readDismissedIds(
  dismissal: SecurityRecommendedRulesDismissal,
): Array<string> {
  try {
    const key: string | null = getCurrentDismissalKey(dismissal);

    return key ? readDismissedIdsFrom(LocalStorage.getItem(key)) : [];
  } catch {
    return [];
  }
}

/*
 * These dismissed too, beside what was before; what cannot be written is
 * shown again on the next visit.
 */
export function rememberDismissedIds(
  dismissal: SecurityRecommendedRulesDismissal,
  ids: ReadonlyArray<string>,
): Array<string> {
  const all: Array<string> = mergeDismissedIds(
    readDismissedIds(dismissal),
    ids,
  );

  try {
    const key: string | null = getCurrentDismissalKey(dismissal);

    if (key) {
      LocalStorage.setItem(key, all);
    }
  } catch {
    // Not remembered: the line comes back on the next visit.
  }

  return all;
}

// Padded as the card's other lines at its foot are.
const LINE_CLASS_NAME: string = "border-t border-gray-200 px-4 py-4 sm:px-5";

/*
 * A rule OneUptime turned on itself, on upgrade (#11037): what, when and
 * why, what it catches, and Turn Off for a team that does not want it -
 * said for a month, or until it is dismissed. Turned off, the card reads
 * its figures again and the line goes: it was answered.
 */
const RuleAddedByOneUptimeLine: FunctionComponent<{
  view: RuleAddedByOneUptimeView;
  onDismiss: () => void;
  onChanged: () => void;
}> = (props: {
  view: RuleAddedByOneUptimeView;
  onDismiss: () => void;
  onChanged: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isTurningOff, setIsTurningOff] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const gate: PermissionGateResult = PermissionGate.check(
    new DetectionRule(),
    ModelAction.Update,
  );
  const { rule, entry } = props.view;
  const testId: string = `${SECURITY_RULE_ADDED_BY_ONEUPTIME_TEST_ID}-${rule.ruleId}`;

  const turnOff: () => Promise<void> = async (): Promise<void> => {
    setIsTurningOff(true);
    setError("");

    try {
      await ModelAPI.updateById<DetectionRule>({
        modelType: DetectionRule,
        id: new ObjectID(rule.ruleId),
        data: { isEnabled: false },
      });
      Toast.success(
        translator.translateTemplate(RULE_TURNED_OFF, { rule: rule.name }),
      );
      props.onChanged();
    } catch (err) {
      setError(describeSetupCallFailure(err));
    }

    setIsTurningOff(false);
  };

  return (
    <div
      data-testid={testId}
      className={`flex flex-col gap-3 md:flex-row md:items-start md:justify-between ${LINE_CLASS_NAME}`}
    >
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <Icon
          icon={IconProp.ShieldCheck}
          className="mt-0.5 h-4 w-4 flex-none text-indigo-600"
        />
        <div className="min-w-0">
          <p
            className="text-pretty font-medium text-gray-900"
            data-testid={`${testId}-title`}
          >
            <TranslatedSentence
              template={RULE_ADDED_BY_ONEUPTIME}
              slots={{
                rule: (
                  <span className="font-semibold [overflow-wrap:anywhere]">
                    {rule.name}
                  </span>
                ),
              }}
              values={{
                date: OneUptimeDate.getDateAsLocalFormattedString(
                  rule.addedAt,
                  true,
                ),
              }}
            />
          </p>
          <p className="mt-0.5 text-pretty text-gray-600">
            {translator.translateText(RULE_ADDED_BY_ONEUPTIME_WHY)}
          </p>
          {/* What it catches, as the Rule Library says it. */}
          <p
            className="mt-1 text-pretty text-gray-500"
            data-testid={`${testId}-description`}
          >
            {entry.description}
          </p>
          {error ? (
            <div className="mt-3">
              <SecurityTurnOnProblems
                problems={[]}
                error={error}
                title={translator.translateTemplate(RULE_NOT_TURNED_OFF, {
                  rule: rule.name,
                })}
                dataTestId={`${testId}-error`}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 self-end md:self-auto">
        <Button
          title={TURN_OFF_RULE}
          icon={IconProp.Close}
          buttonStyle={ButtonStyleType.NORMAL}
          isLoading={isTurningOff}
          disabled={!gate.isAllowed || isTurningOff}
          tooltip={gate.isAllowed ? undefined : gate.disabledReason}
          dataTestId={`${testId}-turn-off`}
          onClick={() => {
            void turnOff();
          }}
        />
        <Button
          title={DISMISS}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          dataTestId={`${testId}-dismiss`}
          onClick={props.onDismiss}
        />
      </div>
    </div>
  );
};

/*
 * The recommended rules the project has no rule of yet (#11037): how many,
 * and the first few by name - how severe their findings are, what each
 * catches - each with Turn On, which adds it as the Rule Library's Add
 * does: on, and opening cases. A rule that cannot be added says why on its
 * line. The rest are one link away, in the Rule Library opened on them.
 */
const RecommendedRulesNotAddedLine: FunctionComponent<{
  view: RecommendedRulesNotAddedView;
  onDismiss: () => void;
  onChanged: () => void;
}> = (props: {
  view: RecommendedRulesNotAddedView;
  onDismiss: () => void;
  onChanged: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [addingId, setAddingId] = useState<string | null>(null);
  const [problems, setProblems] = useState<
    Record<string, TurnOnRecommendedProblem>
  >({});
  const gate: PermissionGateResult = PermissionGate.check(
    new DetectionRule(),
    ModelAction.Create,
  );

  const turnOn: (entry: DetectionRuleLibraryEntry) => Promise<void> = async (
    entry: DetectionRuleLibraryEntry,
  ): Promise<void> => {
    setAddingId(entry.id);
    setProblems((current: Record<string, TurnOnRecommendedProblem>) => {
      const next: Record<string, TurnOnRecommendedProblem> = { ...current };
      delete next[entry.id];
      return next;
    });

    try {
      await ModelAPI.create<DetectionRule>({
        model: buildDetectionRuleFromLibrary({
          projectId: ProjectUtil.getCurrentProjectId()!,
          entry,
        }),
        modelType: DetectionRule,
      });
      Toast.success(
        translator.translateTemplate(RULE_TURNED_ON, { rule: entry.title }),
      );
      props.onChanged();
    } catch (err) {
      setProblems((current: Record<string, TurnOnRecommendedProblem>) => {
        return {
          ...current,
          [entry.id]: {
            part: TurnOnRecommendedPart.Rule,
            action: TurnOnRecommendedAction.Add,
            name: entry.title,
            ...describeAddFailure(err),
          },
        };
      });
    }

    setAddingId(null);
  };

  const ruleLibrary: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_RULE_LIBRARY] as Route,
  ).addQueryParams(getRecommendedRulesNotAddedQuery());

  return (
    <div
      data-testid={SECURITY_RECOMMENDED_RULES_TEST_ID}
      className={LINE_CLASS_NAME}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2 text-sm">
          {/* The Detections cell's bulb: a suggestion, not a fault. */}
          <Icon
            icon={IconProp.LightBulb}
            className="mt-0.5 h-4 w-4 flex-none text-amber-600"
          />
          <p
            className="text-pretty font-medium text-gray-900"
            data-testid={`${SECURITY_RECOMMENDED_RULES_TEST_ID}-title`}
          >
            {translator.translatePlural(
              RECOMMENDED_RULES_NOT_ADDED,
              props.view.total,
            )}
          </p>
        </div>
        <div className="flex-shrink-0">
          <Button
            title={DISMISS}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            dataTestId={`${SECURITY_RECOMMENDED_RULES_TEST_ID}-dismiss`}
            onClick={props.onDismiss}
          />
        </div>
      </div>
      <ul
        className="mt-3 space-y-4 ps-6"
        aria-label={translator.translateText(RECOMMENDED_RULES_LIST_LABEL)}
      >
        {props.view.shown.map(
          (entry: DetectionRuleLibraryEntry): ReactElement => {
            const problem: TurnOnRecommendedProblem | undefined =
              problems[entry.id];

            return (
              <li
                key={entry.id}
                data-testid={`${SECURITY_RECOMMENDED_RULES_TEST_ID}-${entry.id}`}
                className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4"
              >
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* The library's name, as the Rule Library draws it. */}
                    <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">
                      {entry.title}
                    </span>
                    <SecurityEventSeverityPill
                      severityName={getLibraryRuleSeverity(entry)}
                    />
                  </div>
                  <p className="mt-0.5 max-w-3xl text-pretty text-gray-600">
                    {entry.description}
                  </p>
                  {problem ? (
                    <div className="mt-3">
                      <SecurityTurnOnProblems
                        problems={[problem]}
                        title={translator.translatePlural(RULES_NOT_ADDED, 1)}
                        dataTestId={`${SECURITY_RECOMMENDED_RULES_TEST_ID}-${entry.id}-problem`}
                      />
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
                <div className="flex-shrink-0 self-end md:self-auto">
                  <Button
                    title={TURN_ON_RULE}
                    icon={IconProp.Add}
                    buttonStyle={ButtonStyleType.NORMAL}
                    isLoading={addingId === entry.id}
                    disabled={!gate.isAllowed || addingId !== null}
                    tooltip={gate.isAllowed ? undefined : gate.disabledReason}
                    dataTestId={`${SECURITY_RECOMMENDED_RULES_TEST_ID}-${entry.id}-turn-on`}
                    onClick={() => {
                      void turnOn(entry);
                    }}
                  />
                </div>
              </li>
            );
          },
        )}
      </ul>
      {props.view.more > 0 ? (
        <div className="mt-3 ps-6">
          <AppLink
            to={ruleLibrary}
            className="group inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            dataTestId={`${SECURITY_RECOMMENDED_RULES_TEST_ID}-more`}
          >
            <>
              <span className="group-hover:underline">
                {translator.translatePlural(
                  MORE_RECOMMENDED_RULES,
                  props.view.more,
                )}
              </span>
              {/* Forward in the reading direction: Icon mirrors a chevron. */}
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </>
          </AppLink>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface ComponentProps {
  status: SecuritySetupStatus;
  // After a rule was turned on or off: the page reads its figures again.
  onChanged: () => void;
}

/*
 * THE CARD'S LINES ABOUT RECOMMENDED RULES (#11037), at its foot under the
 * pipeline: each rule OneUptime turned on itself, then the recommended rules
 * the project does not have. What the reader dismissed is remembered in
 * this browser, per project; a recommended rule they were not shown brings
 * the line back.
 */
const SecurityRecommendedRules: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [dismissedNotAdded, setDismissedNotAdded] = useState<Array<string>>(
    (): Array<string> => {
      return readDismissedIds(SecurityRecommendedRulesDismissal.NotAdded);
    },
  );
  const [dismissedAdded, setDismissedAdded] = useState<Array<string>>(
    (): Array<string> => {
      return readDismissedIds(
        SecurityRecommendedRulesDismissal.AddedByOneUptime,
      );
    },
  );

  const addedViews: Array<RuleAddedByOneUptimeView> =
    getRulesAddedByOneUptimeViews({
      status: props.status,
      dismissedIds: dismissedAdded,
    });
  const notAdded: RecommendedRulesNotAddedView | null =
    getRecommendedRulesNotAddedView({
      status: props.status,
      dismissedIds: dismissedNotAdded,
    });

  return (
    <>
      {addedViews.map((view: RuleAddedByOneUptimeView): ReactElement => {
        return (
          <RuleAddedByOneUptimeLine
            key={view.rule.ruleId}
            view={view}
            onChanged={props.onChanged}
            onDismiss={() => {
              setDismissedAdded(
                rememberDismissedIds(
                  SecurityRecommendedRulesDismissal.AddedByOneUptime,
                  [view.rule.ruleId],
                ),
              );
            }}
          />
        );
      })}
      {notAdded ? (
        <RecommendedRulesNotAddedLine
          view={notAdded}
          onChanged={props.onChanged}
          onDismiss={() => {
            setDismissedNotAdded(
              rememberDismissedIds(
                SecurityRecommendedRulesDismissal.NotAdded,
                notAdded.ids,
              ),
            );
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default SecurityRecommendedRules;
