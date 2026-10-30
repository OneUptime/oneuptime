import {
  REMEDIATION_DECISION_TONE_MARK,
  RemediationDecisionToneMark,
} from "./RemediationDecisionList";
import { RemediationDecisionTone } from "./RemediationDecisionLines";
import {
  REMEDIATION_CODE_FIX_AUTOMATIC_REASONS,
  REMEDIATION_CODE_FIX_COPY,
  REMEDIATION_CODE_FIX_REASONS_WITH_SETTINGS_LINK,
} from "./RemediationStepCopy";
import ArrowGluedText from "../AI/ArrowGluedText";
import InvestigationNotice, { noticeFailedIcon } from "../AI/InvestigationNotice";
import CodeBlockerNotice from "../Code/CodeBlockerNotice";
import { AUTOMATIC_REMEDIATION_SETTINGS_PAGES } from "../AiAccess/AutomaticRemediationNote";
import { AUTOMATIC_REMEDIATION_SETTINGS_LINKS } from "../AiAccess/AutomaticRemediationLine";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import { RemediationTryAgainSignal } from "Common/Types/AutoRemediation/RemediationTryAgain";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { FinishedFixOutcome } from "Common/Utils/Suggestions/CodeFixSuggestion";
import {
  AutomaticCodeFixBlocker,
  InvestigationCodeFixSuggestion,
} from "Common/Utils/Suggestions/InvestigationCodeFixSuggestion";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  signal: RemediationTryAgainSignal;
  subjectId: string;
  // The investigation whose report the pull request is opened from.
  investigationRunId: string | null;
  suggestion: InvestigationCodeFixSuggestion;
  // Read the suggestion again: a pull request was asked for.
  onChanged: () => void;
}

// The link to the AI rules each reason names, by kind of record.
const AI_RULES_LINK_TEXT: Record<RemediationTryAgainSignal, string> = {
  incident: translationKey("Incident AI rules"),
  alert: translationKey("Alert AI rules"),
};

const LINK_CLASS_NAME: string =
  "min-w-0 break-words rounded text-sm font-medium leading-6 text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

/*
 * THE FIX IN THE CODE, ON THE REMEDIATION STEP (block 43).
 *
 * When the investigation found the cause in the code, OneUptime AI fixes it
 * with a pull request - on its own while fixing is on, or when a person
 * asks. One line, drawn like the decision's lines above it (a tinted mark,
 * a sentence, what to do): the pull request being written or done with a
 * link to it, the one setup step in the way, or "Open fix pull request" -
 * with why OneUptime AI did not open it on its own. "Act on this
 * investigation" was a row of the investigation's own; it is a fix, so it
 * lives with the fixes.
 */
const RemediationCodeFix: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const isCreatingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const suggestion: InvestigationCodeFixSuggestion = props.suggestion;

  if (suggestion.offer === SuggestionOffer.None) {
    return <></>;
  }

  const taskRoute: Route | null = suggestion.aiRunId
    ? RouteUtil.populateRouteParams(RouteMap[PageMap.CODE_TASK_VIEW] as Route, {
        modelId: suggestion.aiRunId,
      })
    : null;

  const openPullRequest: () => Promise<void> = async (): Promise<void> => {
    if (isCreatingRef.current || !props.investigationRunId) {
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    setCreateError(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(
            APP_API_URL.toString() + "/ai-investigation/create-fix-task",
          ),
          data: {
            subjectType: props.signal,
            subjectId: props.subjectId,
            investigationRunId: props.investigationRunId,
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      props.onChanged();
    } catch (error) {
      setCreateError(API.getFriendlyMessage(error));
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
    }
  };

  let tone: RemediationDecisionTone = "acted";
  let sentence: string = "";
  let action: ReactElement | null = null;
  let quieter: ReactElement | null = null;

  const taskLink: (text: string) => ReactElement | null = (
    text: string,
  ): ReactElement | null => {
    return taskRoute ? (
      <Link
        to={taskRoute}
        className={LINK_CLASS_NAME}
        dataTestId="remediation-code-fix-link"
      >
        <ArrowGluedText
          text={translator.translateText(text) || text}
          arrowTestId="remediation-code-fix-link-arrow"
        />
      </Link>
    ) : null;
  };

  if (suggestion.offer === SuggestionOffer.InProgress) {
    tone = "waiting";
    sentence = suggestion.isAutomatic
      ? REMEDIATION_CODE_FIX_COPY.inProgressAutomatic
      : REMEDIATION_CODE_FIX_COPY.inProgress;
    action = taskLink(REMEDIATION_CODE_FIX_COPY.viewProgress);
  } else if (suggestion.offer === SuggestionOffer.Done) {
    if (suggestion.fixOutcome === FinishedFixOutcome.WaitingForYou) {
      tone = "attention";
      sentence = REMEDIATION_CODE_FIX_COPY.waitingForYou;
      action = taskLink(REMEDIATION_CODE_FIX_COPY.answerInCode);
    } else if (suggestion.fixOutcome === FinishedFixOutcome.NothingToChange) {
      tone = "info";
      sentence = REMEDIATION_CODE_FIX_COPY.nothingToChange;
      action = taskLink(REMEDIATION_CODE_FIX_COPY.viewTask);
    } else {
      tone = "acted";
      sentence = REMEDIATION_CODE_FIX_COPY.opened;
      action = taskLink(REMEDIATION_CODE_FIX_COPY.viewPullRequest);
    }
  } else {
    const hasNoRepository: boolean =
      suggestion.offer === SuggestionOffer.SetUp && !suggestion.blocker;

    tone = suggestion.offer === SuggestionOffer.SetUp ? "attention" : "info";
    sentence = hasNoRepository
      ? REMEDIATION_CODE_FIX_COPY.noRepository
      : REMEDIATION_CODE_FIX_COPY.recommended;

    if (hasNoRepository) {
      action = (
        <Link
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.CODE_REPOSITORIES] as Route,
          )}
          className={LINK_CLASS_NAME}
          dataTestId="remediation-code-fix-connect"
        >
          <ArrowGluedText
            text={
              translator.translateText(
                REMEDIATION_CODE_FIX_COPY.connectRepository,
              ) || REMEDIATION_CODE_FIX_COPY.connectRepository
            }
            arrowTestId="remediation-code-fix-link-arrow"
          />
        </Link>
      );
    } else if (suggestion.offer === SuggestionOffer.Act) {
      action = (
        <div className="[&>button]:ml-0 [&>button]:md:ml-0">
          <Button
            title={REMEDIATION_CODE_FIX_COPY.openPullRequest}
            icon={IconProp.Code}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            isLoading={isCreating}
            disabled={!props.investigationRunId}
            dataTestId="remediation-code-fix-open"
            onClick={() => {
              openPullRequest().catch(() => {
                // handled inside openPullRequest
              });
            }}
          />
        </div>
      );
    }

    // Code's gate, in its own words and with its own fix, without a box.
    if (suggestion.blocker) {
      quieter = (
        <CodeBlockerNotice
          blocker={suggestion.blocker}
          repositoryId={suggestion.blocker.repositoryId}
          isInline={true}
        />
      );
    }

    const blocker: AutomaticCodeFixBlocker | null =
      suggestion.automaticBlocker;
    const reasons: Record<RemediationTryAgainSignal, string> | null =
      blocker && !hasNoRepository
        ? REMEDIATION_CODE_FIX_AUTOMATIC_REASONS[blocker]
        : null;

    if (reasons && blocker && !quieter) {
      const settingsLink: ReactElement | null =
        REMEDIATION_CODE_FIX_REASONS_WITH_SETTINGS_LINK.includes(blocker) ? (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[
                AUTOMATIC_REMEDIATION_SETTINGS_PAGES[
                  props.signal === "incident" ? "incidents" : "alerts"
                ]
              ] as Route,
            )}
            className={LINK_CLASS_NAME}
            dataTestId="remediation-code-fix-settings"
          >
            <ArrowGluedText
              text={
                translator.translateText(
                  blocker === AutomaticCodeFixBlocker.FixOff
                    ? AUTOMATIC_REMEDIATION_SETTINGS_LINKS[
                        props.signal === "incident" ? "incidents" : "alerts"
                      ]
                    : AI_RULES_LINK_TEXT[props.signal],
                ) || ""
              }
              arrowTestId="remediation-code-fix-link-arrow"
            />
          </Link>
        ) : null;

      quieter = (
        <div className="space-y-1">
          <p
            data-testid="remediation-code-fix-why"
            data-reason={blocker}
            className="break-words text-sm leading-6 text-gray-600"
          >
            {translator.translateText(reasons[props.signal])}
          </p>
          {settingsLink}
        </div>
      );
    }
  }

  const mark: RemediationDecisionToneMark = REMEDIATION_DECISION_TONE_MARK[tone];

  return (
    <div
      data-testid="remediation-code-fix"
      data-offer={suggestion.offer}
      data-tone={tone}
      className="flex gap-3"
    >
      <div
        aria-hidden="true"
        className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg ${mark.className}`}
      >
        <Icon icon={IconProp.Code} className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <p
          data-testid="remediation-code-fix-text"
          className="break-words text-sm leading-6 text-gray-900"
        >
          {translator.translateText(sentence)}
        </p>
        {quieter ? <div className="mt-1">{quieter}</div> : <></>}
        {action ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
            {action}
          </div>
        ) : (
          <></>
        )}
        {createError ? (
          <div className="mt-3">
            <InvestigationNotice
              role="alert"
              testId="remediation-code-fix-error"
              indicator={noticeFailedIcon}
              title={REMEDIATION_CODE_FIX_COPY.createFailed}
            >
              {translator.translateText(createError)}
            </InvestigationNotice>
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default RemediationCodeFix;
