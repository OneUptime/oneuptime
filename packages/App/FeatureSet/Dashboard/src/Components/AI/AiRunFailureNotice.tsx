import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import LlmProvider from "Common/Models/DatabaseModels/LlmProvider";
import Project from "Common/Models/DatabaseModels/Project";
import { AIRunFailureKind } from "Common/Types/AI/AIRunAttempt";
import { PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN } from "Common/Types/AI/ProjectAiDailyLimits";
import {
  AI_LANE_ADVANCED_COLUMNS,
  AiLane,
  AiLaneAdvancedCard,
} from "../AISettings/ProjectAiSettingsCopy";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { ProjectBalanceType } from "Common/Utils/Project/ProjectBalance";
import React, { FunctionComponent, ReactElement, useId, useState } from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getProjectBalanceAccess,
  ProjectBalanceAccess,
} from "../ProjectBalance/ProjectBalanceAccess";
import AiRunTryAgainButton from "./AiRunTryAgainButton";
import {
  AiRunFailure,
  AiRunFailureWords,
  describeAiRunFailure,
  readAiRunFailure,
} from "./AiRunFailureWords";
import ArrowGluedText from "./ArrowGluedText";
import InvestigationNotice, {
  NOTICE_LINK_CLASS_NAME,
  noticeFailedIcon,
} from "./InvestigationNotice";

/*
 * An AI run that did not finish, said so a person can act on it (issues
 * #6437, #6438): what happened and how many times OneUptime tried, what to
 * do about it, Try again for whoever may start the run again, the settings
 * page the fix is made on for whoever may make it, and - under Details -
 * the error itself, for whoever wants it (open from the start when the
 * words cannot say more than "something went wrong"). Every AI card that
 * shows a run that did not finish shows it with this.
 *
 * It is the card's notice - a red mark, a sentence and a quieter line -
 * never a box: the error is a quoted line under it, not a panel.
 */

export interface ComponentProps {
  // English, translated here: "Triage did not finish".
  title: string;
  // The run's events: its RunFailed says why, and how many times it tried.
  events: Array<AIRunEvent>;
  // The run's error message: read when its events do not say, and shown under Details.
  errorMessage?: string | null | undefined;
  // Offered only to who may start the run again; omitted, there is no button.
  onTryAgain?: (() => Promise<void>) | undefined;
  testId?: string | undefined;
}

/*
 * The settings page a failure's fix is made on - the page its "what to
 * do" sentence names - and whether the reader may make it there. Who may
 * not reads, in that sentence, where it is made (and, for the limits and
 * the credits, who makes it); they are not sent to a page that refuses
 * them.
 */
export interface AiRunFailureSettingsLink {
  // A translation key: the page's name, as the product's other links to it say it.
  label: string;
  page: PageMap;
  /*
   * The card on the page the link lands on, when the fix is under the
   * page's More settings: the page opens them at that card.
   */
  card?: AiLaneAdvancedCard | undefined;
  isAllowed: boolean;
}

/*
 * The incident's (alert's) own daily AI token limit is on the record's AI
 * settings page, in the Daily limits card under More settings: the link
 * the AI card's other reasons give the page by, and only to who may change
 * the field there.
 */
function getRecordTokenLimitLink(lane: AiLane): AiRunFailureSettingsLink {
  return {
    label:
      lane === AiLane.Alert
        ? translationKey("Review alert AI settings")
        : translationKey("Review incident AI settings"),
    page:
      lane === AiLane.Alert
        ? PageMap.ALERTS_SETTINGS_AI
        : PageMap.INCIDENTS_SETTINGS_AI,
    card: AiLaneAdvancedCard.DailyLimits,
    isAllowed: PermissionGate.checkColumnUpdate(
      new Project(),
      AI_LANE_ADVANCED_COLUMNS[lane].dailyTokens,
    ).isAllowed,
  };
}

// Where a settings link goes: the page, at its card when it names one.
export function getAiRunFailureSettingsRoute(
  link: AiRunFailureSettingsLink,
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[link.page] as Route,
  );

  return link.card ? new Route(`${route.toString()}#${link.card}`) : route;
}

export function getAiRunFailureSettingsLink(
  failureKind: AIRunFailureKind,
): AiRunFailureSettingsLink | null {
  switch (failureKind) {
    /*
     * Fixed on the provider: its Response Timeout, its API key and model,
     * its context window, or its address - with Test there to check it.
     */
    case AIRunFailureKind.ProviderTimeout:
    case AIRunFailureKind.ProviderRejected:
    case AIRunFailureKind.ProviderUnavailable:
    case AIRunFailureKind.ContextWindow:
      return {
        label: translationKey("Open LLM Providers"),
        page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
        isAllowed: PermissionGate.check(new LlmProvider(), ModelAction.Update)
          .isAllowed,
      };
    // No provider at all: one is added there.
    case AIRunFailureKind.NotConfigured:
      return {
        label: translationKey("Open LLM Providers"),
        page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
        isAllowed: PermissionGate.check(new LlmProvider(), ModelAction.Create)
          .isAllowed,
      };
    // The project's daily AI limits, under More settings on AI Features.
    case AIRunFailureKind.LimitReached:
      return {
        label: translationKey("Open AI Features"),
        page: PageMap.SETTINGS_AI_FEATURES,
        isAllowed: PermissionGate.checkColumnUpdate(
          new Project(),
          PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
        ).isAllowed,
      };
    // The incident's or alert's own daily AI token limit, paused or used up.
    case AIRunFailureKind.IncidentTokenLimitPaused:
    case AIRunFailureKind.IncidentTokenLimitUsedUp:
      return getRecordTokenLimitLink(AiLane.Incident);
    case AIRunFailureKind.AlertTokenLimitPaused:
    case AIRunFailureKind.AlertTokenLimitUsedUp:
      return getRecordTokenLimitLink(AiLane.Alert);
    // Credits are used up only where billing is on: AI Credits is listed then.
    case AIRunFailureKind.CreditsUsedUp:
      return {
        label: translationKey("Open AI Credits"),
        page: PageMap.SETTINGS_AI_CREDITS,
        isAllowed:
          getProjectBalanceAccess(ProjectBalanceType.AI) ===
          ProjectBalanceAccess.Yes,
      };
    // Nothing to change: the server stopped, or the words cannot say what broke.
    default:
      return null;
  }
}

const AiRunFailureNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const failure: AiRunFailure = readAiRunFailure({
    events: props.events,
    errorMessage: props.errorMessage || undefined,
  });
  /*
   * A failure the words can name (the provider timed out) keeps the error
   * under Details; one they cannot ("Something went wrong") shows it, as
   * it is all there is to go on.
   */
  const [isDetailsOpen, setIsDetailsOpen] = useState<boolean>(
    failure.failureKind === AIRunFailureKind.Other,
  );
  const detailsId: string = `ai-run-failure-details-${useId()}`;
  const testId: string = props.testId || "ai-run-failure";

  const words: AiRunFailureWords = describeAiRunFailure(failure, translator);
  const errorMessage: string = (props.errorMessage || "").trim();
  const settingsLink: AiRunFailureSettingsLink | null =
    getAiRunFailureSettingsLink(failure.failureKind);
  const isSettingsLinkShown: boolean = Boolean(settingsLink?.isAllowed);
  const hasActions: boolean =
    Boolean(props.onTryAgain) || isSettingsLinkShown || Boolean(errorMessage);

  return (
    <InvestigationNotice
      testId={testId}
      indicator={noticeFailedIcon}
      title={props.title}
      actionsTestId={`${testId}-actions`}
      actions={
        hasActions ? (
          <>
            {props.onTryAgain ? (
              <AiRunTryAgainButton
                onTryAgain={props.onTryAgain}
                testId={`${testId}-try-again`}
              />
            ) : (
              <></>
            )}
            {settingsLink && isSettingsLinkShown ? (
              <Link
                to={getAiRunFailureSettingsRoute(settingsLink)}
                className={NOTICE_LINK_CLASS_NAME}
                dataTestId={`${testId}-settings`}
              >
                <ArrowGluedText
                  text={translator.translateText(settingsLink.label) as string}
                />
              </Link>
            ) : (
              <></>
            )}
            {errorMessage ? (
              <button
                type="button"
                data-testid={`${testId}-details-toggle`}
                aria-expanded={isDetailsOpen}
                aria-controls={detailsId}
                className="inline-flex items-center gap-1 rounded-md text-sm leading-6 text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                onClick={() => {
                  setIsDetailsOpen((isOpen: boolean): boolean => {
                    return !isOpen;
                  });
                }}
              >
                <Icon
                  icon={
                    isDetailsOpen ? IconProp.ChevronDown : IconProp.ChevronRight
                  }
                  className="h-3.5 w-3.5 flex-shrink-0"
                />
                {translator.translateText("Details")}
              </button>
            ) : (
              <></>
            )}
          </>
        ) : undefined
      }
      details={
        /*
         * The error is the provider's or the server's own words - English,
         * whatever the reader's language - so dir="auto" lays it out by its
         * own first letter: on a page that reads right to left its full
         * stop stays at the end of the line, not the start.
         */
        errorMessage ? (
          <p
            id={detailsId}
            hidden={!isDetailsOpen}
            dir="auto"
            data-testid={`${testId}-details`}
            className="mt-2 whitespace-pre-wrap break-words border-s-2 border-gray-200 ps-3 font-mono text-xs leading-5 text-gray-500"
          >
            {errorMessage}
          </p>
        ) : undefined
      }
    >
      <span data-testid={`${testId}-cause`}>{words.whatHappened}</span>
      {words.triedTimes ? (
        <>
          {" "}
          <span data-testid={`${testId}-tries`}>{words.triedTimes}</span>
        </>
      ) : (
        <></>
      )}{" "}
      <span data-testid={`${testId}-fix`}>{words.whatToDo}</span>
    </InvestigationNotice>
  );
};

export default AiRunFailureNotice;
