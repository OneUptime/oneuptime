import {
  DATA_SECURITY_AI_PROPOSAL_STATUS_LABELS,
  DataSecurityAiPageCopy,
  IssueAiCardCopy,
  getDataSecurityAiSkipSentence,
} from "./DataSecurityAiCopy";
import {
  DATA_SECURITY_AI_PROPOSAL_DIALOG_SELECT,
  DataSecurityAiProposalActions,
  useDataSecurityAiProposalActions,
} from "./DataSecurityAiProposalActions";
import DataSecurityAiDecision from "Common/Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssueFeed, {
  DataSecurityIssueFeedEventType,
} from "Common/Models/DatabaseModels/DataSecurityIssueFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DataSecurityAiProposalStatus,
  isDataSecurityAiProposalUndoable,
} from "Common/Types/DataSecurity/DataSecurityAi";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Pill from "Common/UI/Components/Pill/Pill";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * ONEUPTIME AI ON AN ISSUE (#10364), above How to Fix: its analysis of the
 * issue (the newest one on the timeline), what it proposed for it and what
 * became of each - with Approve, Dismiss and Undo where they apply - and,
 * when it left the issue alone, why.
 *
 * Drawn only when OneUptime AI has something to say about the issue: a
 * project without AI, or an issue it never looked at, sees the page as it
 * was. A read the reader may not make (no Data Security AI permission) is
 * the same as nothing to say.
 */

export const ISSUE_AI_CARD_TEST_ID: string = "data-security-issue-ai-card";

// The most proposals the card lists; the issue's timeline has every one.
const MAX_PROPOSALS: number = 10;

interface IssueAiState {
  analysis: string;
  proposals: Array<DataSecurityAiProposal>;
  decision: DataSecurityAiDecision | null;
}

const NOTHING: IssueAiState = { analysis: "", proposals: [], decision: null };

function statusColor(status: DataSecurityAiProposalStatus | undefined): Color {
  switch (status) {
    case DataSecurityAiProposalStatus.Applied:
    case DataSecurityAiProposalStatus.AppliedWithoutAsking:
      return Green500;
    case DataSecurityAiProposalStatus.Failed:
      return Red500;
    case DataSecurityAiProposalStatus.Proposed:
    case DataSecurityAiProposalStatus.Approved:
      return Yellow500;
    default:
      return Gray500;
  }
}

async function readList<
  T extends
    | DataSecurityAiProposal
    | DataSecurityAiDecision
    | DataSecurityIssueFeed,
>(read: () => Promise<ListResult<T>>): Promise<Array<T>> {
  try {
    return (await read()).data || [];
  } catch {
    // A read the reader may not make is nothing to say.
    return [];
  }
}

export interface ComponentProps {
  issueId: ObjectID;
  /*
   * The page shows an explanation a person just asked for: the card leaves
   * the analysis to it, so the two are never side by side.
   */
  hideAnalysis?: boolean | undefined;
}

const IssueAiCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<IssueAiState>(NOTHING);
  const [readCount, setReadCount] = useState<number>(0);
  const actions: DataSecurityAiProposalActions =
    useDataSecurityAiProposalActions((): void => {
      setReadCount((count: number): number => {
        return count + 1;
      });
    });

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      const [feeds, proposals, decisions]: [
        Array<DataSecurityIssueFeed>,
        Array<DataSecurityAiProposal>,
        Array<DataSecurityAiDecision>,
      ] = await Promise.all([
        readList<DataSecurityIssueFeed>(() => {
          return ModelAPI.getList<DataSecurityIssueFeed>({
            modelType: DataSecurityIssueFeed,
            query: {
              dataSecurityIssueId: props.issueId,
              dataSecurityIssueFeedEventType:
                DataSecurityIssueFeedEventType.AiExplanation,
            },
            select: { moreInformationInMarkdown: true, postedAt: true },
            sort: { postedAt: SortOrder.Descending },
            limit: 1,
            skip: 0,
          });
        }),
        readList<DataSecurityAiProposal>(() => {
          return ModelAPI.getList<DataSecurityAiProposal>({
            modelType: DataSecurityAiProposal,
            query: { dataSecurityIssueId: props.issueId },
            select: {
              ...DATA_SECURITY_AI_PROPOSAL_DIALOG_SELECT,
              status: true,
              createdAt: true,
            },
            sort: { createdAt: SortOrder.Descending },
            limit: MAX_PROPOSALS,
            skip: 0,
          });
        }),
        readList<DataSecurityAiDecision>(() => {
          return ModelAPI.getList<DataSecurityAiDecision>({
            modelType: DataSecurityAiDecision,
            query: { dataSecurityIssueId: props.issueId },
            select: { didAct: true, skipReason: true, createdAt: true },
            sort: { createdAt: SortOrder.Descending },
            limit: 1,
            skip: 0,
          });
        }),
      ]);

      if (isCurrent) {
        setState({
          analysis: feeds[0]?.moreInformationInMarkdown || "",
          proposals,
          decision: decisions[0] || null,
        });
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [props.issueId.toString(), readCount]);

  const analysis: string = props.hideAnalysis ? "" : state.analysis;
  const leftAlone: DataSecurityAiDecision | null =
    state.decision && state.decision.didAct === false ? state.decision : null;

  if (!analysis && state.proposals.length === 0 && !leftAlone) {
    return <>{actions.dialogs}</>;
  }

  return (
    <>
      <Card
        title={IssueAiCardCopy.title}
        description={IssueAiCardCopy.description}
      >
        <div className="space-y-5" data-testid={ISSUE_AI_CARD_TEST_ID}>
          {analysis ? (
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                {translator.translateText(IssueAiCardCopy.analysis)}
              </h3>
              <div className="mt-1 text-sm text-gray-700">
                <MarkdownViewer text={analysis} safeMode={true} />
              </div>
            </div>
          ) : (
            <></>
          )}

          {state.proposals.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-gray-900">
                {translator.translateText(IssueAiCardCopy.proposals)}
              </h3>
              <ul className="mt-2 divide-y divide-gray-100">
                {state.proposals.map(
                  (proposal: DataSecurityAiProposal): ReactElement => {
                    const status: DataSecurityAiProposalStatus | undefined =
                      proposal.status;

                    return (
                      <li
                        key={proposal._id?.toString()}
                        className="flex flex-wrap items-center gap-3 py-2"
                      >
                        <span className="min-w-0 flex-1 text-sm text-gray-900">
                          <IsolatedText text={proposal.title || ""} />
                        </span>
                        <Pill
                          text={
                            status
                              ? DATA_SECURITY_AI_PROPOSAL_STATUS_LABELS[status]
                              : ""
                          }
                          color={statusColor(status)}
                        />
                        {status === DataSecurityAiProposalStatus.Proposed ? (
                          <span className="flex gap-2">
                            <Button
                              title={DataSecurityAiPageCopy.approve}
                              buttonStyle={ButtonStyleType.NORMAL}
                              onClick={() => {
                                actions.approve(proposal);
                              }}
                            />
                            <Button
                              title={DataSecurityAiPageCopy.dismiss}
                              buttonStyle={ButtonStyleType.NORMAL}
                              onClick={() => {
                                actions.dismiss(proposal);
                              }}
                            />
                          </span>
                        ) : isDataSecurityAiProposalUndoable(status) ? (
                          <Button
                            title={DataSecurityAiPageCopy.undo}
                            buttonStyle={ButtonStyleType.NORMAL}
                            onClick={() => {
                              actions.undo(proposal);
                            }}
                          />
                        ) : (
                          <></>
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ) : (
            <></>
          )}

          {leftAlone && state.proposals.length === 0 ? (
            <p className="text-sm text-gray-700">
              {translator.translateTemplate(LABEL_WITH_COLON, {
                label:
                  translator.translateText(IssueAiCardCopy.whyNot) ||
                  IssueAiCardCopy.whyNot,
              })}{" "}
              {translator.translateText(
                getDataSecurityAiSkipSentence(leftAlone.skipReason),
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>
      {actions.dialogs}
    </>
  );
};

export default IssueAiCard;
