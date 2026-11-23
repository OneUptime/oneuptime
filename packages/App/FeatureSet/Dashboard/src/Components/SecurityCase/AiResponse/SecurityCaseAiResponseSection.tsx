import AppLink from "../../AppLink/AppLink";
import SecurityCaseApi from "../SecurityCaseApi";
import { readCheckSentence } from "../Response/SecurityCaseResponseChecks";
import {
  SECURITY_CASE_AI_RESPONSE_STAGE_COPY,
  SECURITY_CASE_AI_RESPONSE_TEST_ID,
  SecurityCaseAiResponseCopy,
  getSecurityCaseAiActionTestId,
} from "./SecurityCaseAiResponseCopy";
import {
  SecurityCaseAiActionView,
  SecurityCaseAiResponseStage,
  SecurityCaseAiResponseView,
  canRespondWithAi,
  getActionReasonKey,
  getActionTitleKey,
  getAiHoldEndedSentence,
  getClosingReport,
  getSecurityCaseAiResponseStage,
  isSecurityCaseAiWorking,
} from "./SecurityCaseAiResponseModel";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { SecurityCaseAiActionStatus } from "Common/Types/SecurityCase/SecurityCaseAi";
import { SECURITY_CASE_AI_HOLD_SOMEONE } from "Common/Types/SecurityCase/SecurityCaseAiHold";
import {
  SECURITY_CASE_AI_ACTION_STATUS_LABELS,
  SECURITY_CASE_HAND_OFF_SENTENCES,
} from "Common/Types/SecurityCase/SecurityCaseAiWords";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import {
  FeedClock,
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import API from "Common/UI/Utils/API/API";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * THE CASE'S ONEUPTIME AI CARD, AS THE RESPONDER'S LOG (#10352): under the
 * triage, where OneUptime AI stands on the case - not working it, working
 * it, waiting for a person, handed to people and why, finished - and every
 * step it took, asked about or left, and why, newest first, each with the
 * step of the Response Plan it was for, what OneUptime's check found, how
 * often the same action held on cases like this one, who approved or undid
 * it, and a link to the playbook run that carried it out.
 *
 * A person answers what it asks here: an approval of one of its playbook
 * steps (the same as on the case's Playbooks page, or one tap in Slack or
 * Microsoft Teams), or what only OneUptime AI does - taking the case,
 * marking a step done. Respond with AI asks it to work the case; Take Over
 * stops it. A closing report it wrote is shown whole.
 *
 * Nothing here is a model's text: OneUptime's own sentences by code, its
 * checks' evidence, and the report it wrote from the case's records.
 */

// How often the section asks while OneUptime AI works the case.
export const SECURITY_CASE_AI_RESPONSE_POLL_MS: number = 10000;

export interface ComponentProps {
  securityCase: SecurityCase;
  // Something OneUptime AI did changed the case: the page reads it again.
  onChanged?: (() => void) | undefined;
}

function getStatusTone(status: SecurityCaseAiActionStatus): PillTone {
  switch (status) {
    case SecurityCaseAiActionStatus.Done:
      return PillTone.Success;
    case SecurityCaseAiActionStatus.Asked:
      return PillTone.Warning;
    case SecurityCaseAiActionStatus.Failed:
      return PillTone.Danger;
    case SecurityCaseAiActionStatus.Doing:
      return PillTone.Info;
    case SecurityCaseAiActionStatus.Undone:
    case SecurityCaseAiActionStatus.Declined:
      return PillTone.Paused;
    default:
      return PillTone.Neutral;
  }
}

const SecurityCaseAiResponseSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const caseId: ObjectID | null = props.securityCase.id || null;
  const [view, setView] = useState<SecurityCaseAiResponseView | null>(null);
  const [error, setError] = useState<string>("");
  const [workingOn, setWorkingOn] = useState<string>("");
  const clock: FeedClock = getFeedClock({ language: translator.language });

  /*
   * Read on every render: the permissions arrive after the first paint of a
   * fresh sign-in, and a gate kept from then would leave the buttons out.
   */
  const caseModel: SecurityCase = useMemo((): SecurityCase => {
    return new SecurityCase();
  }, []);
  const canWorkCase: boolean = PermissionGate.check(
    caseModel,
    ModelAction.Update,
  ).isAllowed;

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!caseId) {
      return;
    }

    try {
      setView(await SecurityCaseApi.getAiResponse(caseId));
      setError("");
    } catch (loadError) {
      setError(API.getFriendlyMessage(loadError));
    }
  }, [caseId?.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  // While OneUptime AI works the case, the section follows it.
  useEffect(() => {
    if (!view || !isSecurityCaseAiWorking(view)) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void load();
    }, SECURITY_CASE_AI_RESPONSE_POLL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [view?.state, load]);

  const act: (
    key: string,
    action: () => Promise<void>,
  ) => Promise<void> = async (
    key: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    setWorkingOn(key);
    setError("");

    try {
      await action();
      await load();
      props.onChanged?.();
    } catch (actError) {
      setError(API.getFriendlyMessage(actError));
    } finally {
      setWorkingOn("");
    }
  };

  if (!caseId || !view) {
    return <></>;
  }

  const stage: SecurityCaseAiResponseStage =
    getSecurityCaseAiResponseStage(view);

  // A project that chose not to let OneUptime AI work cases sees nothing of it.
  if (stage === SecurityCaseAiResponseStage.Off && view.actions.length === 0) {
    return <></>;
  }

  const report: SecurityCaseAiActionView | null = getClosingReport(view);
  // How OneUptime AI's hold of the case's alerts ended (#10353), once it has.
  const holdEnded: ReturnType<typeof getAiHoldEndedSentence> =
    getAiHoldEndedSentence(view.hold);
  const stageCopy: { title: string; description: string } =
    SECURITY_CASE_AI_RESPONSE_STAGE_COPY[stage];

  const renderTime: (prefix: string, time: Date | null) => ReactElement = (
    prefix: string,
    time: Date | null,
  ): ReactElement => {
    if (!time) {
      return <></>;
    }

    return (
      <span>
        {translator.translateTemplate(prefix, {
          when: formatFeedTimeAgo(time, clock) || "",
        })}
      </span>
    );
  };

  const renderDecisionButtons: (
    action: SecurityCaseAiActionView,
  ) => ReactElement = (action: SecurityCaseAiActionView): ReactElement => {
    if (action.status !== SecurityCaseAiActionStatus.Asked || !canWorkCase) {
      return <></>;
    }

    const decide: (isApproved: boolean) => Promise<void> = async (
      isApproved: boolean,
    ): Promise<void> => {
      await act(
        `${action.id}-${isApproved ? "approve" : "decline"}`,
        async () => {
          if (action.isDecidedOnCard) {
            await SecurityCaseApi.decideAiAction({
              caseId,
              actionId: action.id,
              isApproved,
            });
            return;
          }

          if (action.securityPlaybookRunId) {
            await SecurityCaseApi.decideApproval({
              runId: new ObjectID(action.securityPlaybookRunId),
              isApproved,
            });
          }
        },
      );
    };

    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          title={SecurityCaseAiResponseCopy.approveButton}
          buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
          buttonSize={ButtonSize.Small}
          isLoading={workingOn === `${action.id}-approve`}
          disabled={Boolean(workingOn)}
          onClick={() => {
            void decide(true);
          }}
          dataTestId={`${getSecurityCaseAiActionTestId(action.id)}-approve`}
        />
        <Button
          title={SecurityCaseAiResponseCopy.declineButton}
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          isLoading={workingOn === `${action.id}-decline`}
          disabled={Boolean(workingOn)}
          onClick={() => {
            void decide(false);
          }}
          dataTestId={`${getSecurityCaseAiActionTestId(action.id)}-decline`}
        />
        {!action.isDecidedOnCard ? (
          <span className="text-xs text-gray-500">
            {translator.translateText(SecurityCaseAiResponseCopy.waitingOnRun)}
          </span>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderAction: (action: SecurityCaseAiActionView) => ReactElement = (
    action: SecurityCaseAiActionView,
  ): ReactElement => {
    const reasonKey: string | null = getActionReasonKey(action);
    const step: SecurityCaseAiActionView["evidence"]["step"] =
      action.evidence.step;
    const stepWords: string = step?.ruleText
      ? step.ruleText
      : step?.template
        ? translator.translateTemplate(step.template, step.values)
        : "";
    const checkLine: string = action.evidence.check
      ? readCheckSentence(action.evidence.check.evidence.sentence, translator)
      : "";
    const trackRecord: SecurityCaseAiActionView["evidence"]["trackRecord"] =
      action.evidence.trackRecord;

    return (
      <li
        key={action.id}
        className="py-2"
        data-testid={getSecurityCaseAiActionTestId(action.id)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            text={SECURITY_CASE_AI_ACTION_STATUS_LABELS[action.status]}
            tone={getStatusTone(action.status)}
          />
          <span className="text-sm font-medium text-gray-900">
            {translator.translateTemplate(getActionTitleKey(action), {
              value: action.target || "",
              verdict: action.evidence.verdict
                ? translator.translateText(action.evidence.verdict) ||
                  action.evidence.verdict
                : "",
            })}
          </span>
        </div>
        {stepWords ? (
          <p className="mt-1 text-sm text-gray-600">{stepWords}</p>
        ) : (
          <></>
        )}
        {reasonKey ? (
          <p className="mt-1 text-sm text-gray-600">
            {translator.translateText(reasonKey)}
          </p>
        ) : (
          <></>
        )}
        {checkLine ? (
          <p className="mt-1 text-xs text-gray-500">{checkLine}</p>
        ) : (
          <></>
        )}
        {trackRecord && trackRecord.similar > 0 ? (
          <p
            className="mt-1 text-xs text-gray-500"
            data-testid={`${getSecurityCaseAiActionTestId(action.id)}-track-record`}
          >
            {translator.translatePlural(
              SecurityCaseAiResponseCopy.trackRecord,
              trackRecord.similar,
              {
                held: translator.formatNumber(trackRecord.held),
                count: translator.formatNumber(trackRecord.similar),
              },
            )}
          </p>
        ) : (
          <></>
        )}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {action.status === SecurityCaseAiActionStatus.Asked
            ? renderTime(SecurityCaseAiResponseCopy.askedWhen, action.askedAt)
            : renderTime(
                SecurityCaseAiResponseCopy.doneWhen,
                action.doneAt || action.createdAt,
              )}
          {action.decidedByName ? (
            <span>
              {translator.translateTemplate(
                action.status === SecurityCaseAiActionStatus.Declined
                  ? SecurityCaseAiResponseCopy.declinedBy
                  : SecurityCaseAiResponseCopy.approvedBy,
                { name: action.decidedByName },
              )}
            </span>
          ) : (
            <></>
          )}
          {action.undoneByName ? (
            <span>
              {translator.translateTemplate(
                SecurityCaseAiResponseCopy.undoneBy,
                {
                  name: action.undoneByName,
                },
              )}
            </span>
          ) : (
            <></>
          )}
          {action.securityPlaybookRunId ? (
            <AppLink
              className="text-indigo-600 hover:underline"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS] as Route,
                { modelId: caseId },
              )}
            >
              <>
                {translator.translateText(SecurityCaseAiResponseCopy.openRun)}
              </>
            </AppLink>
          ) : (
            <></>
          )}
        </div>
        {renderDecisionButtons(action)}
      </li>
    );
  };

  return (
    <div
      className="mt-5 border-t border-gray-200 pt-4"
      data-testid={SECURITY_CASE_AI_RESPONSE_TEST_ID}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText(SecurityCaseAiResponseCopy.sectionTitle)}
          </h3>
          <p
            className="mt-1 text-sm font-medium text-gray-800"
            data-testid={`${SECURITY_CASE_AI_RESPONSE_TEST_ID}-stage`}
          >
            {translator.translateText(stageCopy.title)}
          </p>
          <p className="text-sm text-gray-600">
            {translator.translateText(stageCopy.description)}
          </p>
          {stage === SecurityCaseAiResponseStage.HandedToPeople &&
          view.handOffReason ? (
            <p
              className="mt-1 text-sm text-gray-600"
              data-testid={`${SECURITY_CASE_AI_RESPONSE_TEST_ID}-hand-off`}
            >
              {translator.translateText(
                SECURITY_CASE_HAND_OFF_SENTENCES[view.handOffReason],
              )}
            </p>
          ) : (
            <></>
          )}
          {stage === SecurityCaseAiResponseStage.NotWorking &&
          view.notStartedReason ? (
            <p className="mt-1 text-sm text-gray-500">
              {translator.translateText(view.notStartedReason.message)}
            </p>
          ) : (
            <></>
          )}
          {holdEnded ? (
            <p
              className="mt-1 text-sm text-gray-600"
              data-testid={`${SECURITY_CASE_AI_RESPONSE_TEST_ID}-hold`}
            >
              {translator.translateTemplate(holdEnded.sentence, {
                name:
                  holdEnded.name ||
                  translator.translateText(SECURITY_CASE_AI_HOLD_SOMEONE) ||
                  SECURITY_CASE_AI_HOLD_SOMEONE,
              })}
              {holdEnded.endedAt ? (
                <span className="text-gray-500">
                  {` · ${formatFeedTimeAgo(holdEnded.endedAt, clock) || ""}`}
                </span>
              ) : (
                <></>
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRespondWithAi(view) && canWorkCase ? (
            <Button
              title={SecurityCaseAiResponseCopy.respondButton}
              buttonStyle={ButtonStyleType.NORMAL}
              buttonSize={ButtonSize.Small}
              isLoading={workingOn === "respond"}
              disabled={Boolean(workingOn)}
              onClick={() => {
                void act("respond", async () => {
                  await SecurityCaseApi.startAiResponse(caseId);
                });
              }}
              dataTestId={`${SECURITY_CASE_AI_RESPONSE_TEST_ID}-respond`}
            />
          ) : (
            <></>
          )}
          {isSecurityCaseAiWorking(view) && canWorkCase ? (
            <Button
              title={SecurityCaseAiResponseCopy.takeOverButton}
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              isLoading={workingOn === "take-over"}
              disabled={Boolean(workingOn)}
              onClick={() => {
                void act("take-over", async () => {
                  await SecurityCaseApi.takeOverFromAi(caseId);
                });
              }}
              dataTestId={`${SECURITY_CASE_AI_RESPONSE_TEST_ID}-take-over`}
            />
          ) : (
            <></>
          )}
          <AppLink
            className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.SECURITY_EVENTS_SETTINGS_AI] as Route,
            )}
          >
            <>
              {translator.translateText(
                SecurityCaseAiResponseCopy.settingsLink,
              )}
            </>
          </AppLink>
        </div>
      </div>

      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          <ErrorInSentence message={error} showWhereToLook={true} />
        </p>
      ) : (
        <></>
      )}

      {report?.report ? (
        <details
          className="mt-3 border-t border-gray-100 pt-3"
          open={report.status === SecurityCaseAiActionStatus.Asked}
          data-testid={`${SECURITY_CASE_AI_RESPONSE_TEST_ID}-report`}
        >
          <summary className="cursor-pointer text-sm font-medium text-gray-900">
            {translator.translateText(
              SecurityCaseAiResponseCopy.closingReportTitle,
            )}
          </summary>
          <div className="mt-2 text-sm">
            <MarkdownViewer text={report.report} />
          </div>
        </details>
      ) : (
        <></>
      )}

      {view.actions.length > 0 ? (
        <ol
          className="mt-3 divide-y divide-gray-100 border-y border-gray-100"
          aria-label={translator.translateText(
            SecurityCaseAiResponseCopy.logLabel,
          )}
        >
          {view.actions.map(renderAction)}
        </ol>
      ) : isSecurityCaseAiWorking(view) ? (
        <p className="mt-3 text-sm text-gray-500">
          {translator.translateText(SecurityCaseAiResponseCopy.noActionsYet)}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityCaseAiResponseSection;
