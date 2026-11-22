import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DataSecurityApi from "./DataSecurityApi";
import {
  ANALYSIS_CARD_DESCRIPTION,
  ANALYSIS_CARD_TITLE,
  ANALYSIS_NOT_LOADED,
  ANALYSIS_NOT_WRITTEN,
  ANALYSIS_UNCHANGED,
  ANALYZE_AGAIN,
  ANALYZE_ISSUE,
  ANALYZED_AT,
  ANALYZED_NOW,
  AnalysisPathActions,
  AnalysisVerdictActions,
  FIX_WITH_AI,
  HIDE_FACTS,
  LINE_HIDDEN,
  NOT_ANALYZED_YET,
  PART_MISSING,
  PERSON_DECIDES,
  PUBLIC_BY_DESIGN,
  PUBLIC_BY_DESIGN_DONE,
  PUBLIC_BY_DESIGN_QUESTION,
  PUBLIC_BY_DESIGN_SENTENCE,
  REVIEW_PROPOSAL,
  SET_OWNERS,
  SHOW_FACTS,
  VERDICT_TONES,
  getAnalysisPathActions,
  getAnalysisVerdictActions,
} from "./IssueAiAnalysisCopy";
import { AnalysisFactList } from "./IssueAiAnalysisFacts";
import {
  ISSUE_MOVES_LOCKED,
  ISSUE_MOVE_ICONS,
  ISSUE_MOVE_TITLES,
  IssueMove,
} from "./IssueChanges";
import { DataTypeNamer } from "./IssueDataTypes";
import IssueResponseAction from "./IssueResponseAction";
import DataSecurityIssue from "Common/Models/DatabaseModels/DataSecurityIssue";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  DataSecurityExplainResult,
  DataSecurityIssueAnalysisResult,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  DATA_SECURITY_AI_VERDICT_TITLES,
  DATA_SECURITY_ANALYSIS_HIDDEN_SOURCE_TITLES,
  DATA_SECURITY_ANALYSIS_PART_TITLES,
  DATA_SECURITY_ANALYSIS_QUESTIONS,
  DataSecurityAiVerdict,
  DataSecurityAnalysisFactSource,
  DataSecurityAnalysisLine,
  DataSecurityAnalysisPart,
  DataSecurityIssueAnalysisView,
  getLineFacts,
} from "Common/Types/DataSecurity/DataSecurityIssueAnalysis";
import { isTelemetryFindingCheck } from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ErrorLine from "Common/UI/Components/ErrorMessage/ErrorLine";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Pill from "Common/UI/Components/Pill/Pill";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Toast from "Common/UI/Utils/Toast";
import {
  Translator,
  composedValue,
  formatList,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * ONEUPTIME AI'S ANALYSIS OF AN ISSUE, AT THE TOP OF ITS OVERVIEW (#10369).
 *
 * What a person needs to decide quickly, written before anyone opens the
 * issue: the verdict - Real, Likely by design, Likely a wrong finding,
 * Cannot tell - with why, then one line each on what it puts at risk, what
 * the fix would break and the shortest path to fixed. Each line folds out
 * to the facts it rests on, drawn from what Data Security read, never from
 * the model's words. The buttons are the ones the verdict and the path
 * name:
 *
 *   - Likely by design: Accept Risk with the reason drafted, or Public By
 *     Design on the store; Likely a wrong finding: Not an Issue with the
 *     reason drafted. Nothing is pressed for the person: the issue stays as
 *     it is until they choose;
 *   - the shortest path: the response action that runs from this page, Fix
 *     with AI in the code that declares the store, the proposal waiting in
 *     Data Security > AI, Set Owners for a store nobody owns.
 *
 * It replaces Explain with AI. Opening the page reads the analysis the
 * issue keeps, with no model call; Analyze Again writes a new one. Every
 * fact and line the reader may not read is left out by the server, and
 * said here by what it rests on. With the project's AI off it is not drawn
 * (the page asks useAiOffered).
 */

export const ISSUE_AI_ANALYSIS_TEST_ID: string =
  "data-security-issue-ai-analysis";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  | { kind: "read"; view: DataSecurityIssueAnalysisView | null };

export interface ComponentProps {
  issue: DataSecurityIssue;
  issueId: ObjectID;
  namer: DataTypeNamer;
  // Changes when the page reads the issue again: the analysis is read again too.
  refreshToggle?: string | boolean | undefined;
  // Accept Risk's dialog, starting from OneUptime AI's draft.
  onAcceptRisk: (draftReason: string) => void;
  // Not an Issue's dialog, starting from OneUptime AI's draft.
  onNotAnIssue: (draftReason: string) => void;
  // Fix with AI, as the page asks for it.
  onFixWithAi: () => void;
  isFixing?: boolean | undefined;
  // Called once something here changed the store or the issue.
  onChanged: () => void;
}

// The sentence a hidden line is said by: what the reader may not read.
function getHiddenSentence(
  sources: Array<DataSecurityAnalysisFactSource>,
  translator: Translator,
): string {
  return translator.translateTemplate(LINE_HIDDEN, {
    what: composedValue((sentence: Translator): string => {
      return formatList(
        sources.map((source: DataSecurityAnalysisFactSource): string => {
          return (
            sentence.translateText(
              DATA_SECURITY_ANALYSIS_HIDDEN_SOURCE_TITLES[source],
            ) || DATA_SECURITY_ANALYSIS_HIDDEN_SOURCE_TITLES[source]
          );
        }),
        sentence,
      );
    }),
  });
}

interface PartProps {
  part: DataSecurityAnalysisPart;
  view: DataSecurityIssueAnalysisView;
  namer: DataTypeNamer;
  dataStoreId?: string | undefined;
}

// One question: its line, and the facts it rests on, folded.
const AnalysisPart: FunctionComponent<PartProps> = (
  props: PartProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const line: DataSecurityAnalysisLine | undefined =
    props.view.lines[props.part];
  const hidden: Array<DataSecurityAnalysisFactSource> | undefined =
    props.view.hiddenLines[props.part];
  const facts: ReturnType<typeof getLineFacts> = line
    ? getLineFacts(props.view, line)
    : [];

  return (
    <div
      className="py-3"
      data-testid={`${ISSUE_AI_ANALYSIS_TEST_ID}-${props.part}`}
    >
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(
          DATA_SECURITY_ANALYSIS_PART_TITLES[props.part],
        )}
      </dt>
      <dd className="mt-1 space-y-1 text-sm text-gray-800">
        {line ? (
          <p className="[overflow-wrap:anywhere]">
            <IsolatedText text={line.text} />
          </p>
        ) : hidden && hidden.length > 0 ? (
          <p
            className="text-gray-600"
            data-testid={`${ISSUE_AI_ANALYSIS_TEST_ID}-${props.part}-hidden`}
          >
            {getHiddenSentence(hidden, translator)}
          </p>
        ) : (
          <p className="text-gray-500">
            {translator.translateText(PART_MISSING)}
          </p>
        )}
        {facts.length > 0 ? (
          <>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
              aria-expanded={isOpen}
              onClick={() => {
                setIsOpen(!isOpen);
              }}
            >
              <Icon
                icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
                className="h-4 w-4"
              />
              <span>
                {isOpen
                  ? translator.translateText(HIDE_FACTS)
                  : translator.translatePlural(SHOW_FACTS, facts.length)}
              </span>
            </button>
            {isOpen ? (
              <AnalysisFactList
                facts={facts}
                namer={props.namer}
                dataStoreId={props.dataStoreId}
              />
            ) : (
              <></>
            )}
          </>
        ) : (
          <></>
        )}
      </dd>
    </div>
  );
};

const IssueAiAnalysisCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [readCount, setReadCount] = useState<number>(0);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzeError, setAnalyzeError] = useState<string>("");
  const [isMarkingPublic, setIsMarkingPublic] = useState<boolean>(false);
  const [isConfirmingPublic, setIsConfirmingPublic] = useState<boolean>(false);
  const [publicError, setPublicError] = useState<string>("");

  const issueId: string = props.issueId.toString();
  const dataStoreId: string =
    props.issue.dataStoreId?.toString() ||
    props.issue.dataStore?._id?.toString() ||
    "";
  const storeName: string = props.issue.dataStore?.name || dataStoreId;

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: DataSecurityIssueAnalysisResult =
          await DataSecurityApi.getIssueAnalysis(props.issueId);

        if (isCurrent) {
          setState({ kind: "read", view: result.analysis });
        }
      } catch (err) {
        if (isCurrent) {
          setState({ kind: "failed", error: API.getFriendlyMessage(err) });
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [issueId, props.refreshToggle, readCount]);

  const analyze: (force: boolean) => Promise<void> = async (
    force: boolean,
  ): Promise<void> => {
    setIsAnalyzing(true);
    setAnalyzeError("");

    try {
      const result: DataSecurityExplainResult =
        await DataSecurityApi.explainIssue(props.issueId, { force });

      setState({ kind: "read", view: result.analysis || null });

      if (force) {
        Toast.success(
          translator.translateText(
            result.isNew ? ANALYZED_NOW : ANALYSIS_UNCHANGED,
          ) || "",
        );
      }
    } catch (err) {
      setAnalyzeError(API.getFriendlyMessage(err));
    }

    setIsAnalyzing(false);
  };

  const markPublicByDesign: () => Promise<void> = async (): Promise<void> => {
    setIsMarkingPublic(true);
    setPublicError("");

    try {
      await ModelAPI.updateById<DataStore>({
        modelType: DataStore,
        id: new ObjectID(dataStoreId),
        data: { isPublicByDesign: true },
      });
      // Checks decide: the store is checked again, and the issue resolves once its check passes.
      await DataSecurityApi.checkNow(new ObjectID(dataStoreId));
      setIsConfirmingPublic(false);
      Toast.success(
        translator.translateTemplate(PUBLIC_BY_DESIGN_DONE, {
          store: storeName,
        }),
      );
      props.onChanged();
    } catch (err) {
      setPublicError(API.getFriendlyMessage(err));
    }

    setIsMarkingPublic(false);
  };

  const view: DataSecurityIssueAnalysisView | null =
    state.kind === "read" ? state.view : null;
  const headerButtons: Array<CardButtonSchema> =
    state.kind === "read"
      ? [
          {
            title: view ? ANALYZE_AGAIN : ANALYZE_ISSUE,
            icon: IconProp.Sparkles,
            buttonStyle: ButtonStyleType.OUTLINE,
            isLoading: isAnalyzing,
            disabled: isAnalyzing,
            onClick: () => {
              void analyze(Boolean(view));
            },
          },
        ]
      : [];

  const card: (children: ReactElement) => ReactElement = (
    children: ReactElement,
  ): ReactElement => {
    return (
      <Card
        title={ANALYSIS_CARD_TITLE}
        description={ANALYSIS_CARD_DESCRIPTION}
        buttons={headerButtons}
      >
        <div className="space-y-3" data-testid={ISSUE_AI_ANALYSIS_TEST_ID}>
          {analyzeError ? (
            <ErrorLine
              message={analyzeError}
              whatFailed={translator.translateText(ANALYSIS_NOT_WRITTEN)}
              dataTestId={`${ISSUE_AI_ANALYSIS_TEST_ID}-analyze-error`}
            />
          ) : (
            <></>
          )}
          {children}
        </div>
      </Card>
    );
  };

  if (state.kind === "loading") {
    return card(<DetailListSkeleton fields={4} />);
  }

  if (state.kind === "failed") {
    return card(
      <div className="space-y-2">
        <ErrorLine
          message={state.error}
          whatFailed={translator.translateText(ANALYSIS_NOT_LOADED)}
          dataTestId={`${ISSUE_AI_ANALYSIS_TEST_ID}-not-loaded`}
        />
        <Button
          title="Try Again"
          buttonStyle={ButtonStyleType.NORMAL}
          onClick={() => {
            setState({ kind: "loading" });
            setReadCount(readCount + 1);
          }}
        />
      </div>,
    );
  }

  if (!view) {
    return card(
      <p
        className="text-sm text-gray-600"
        data-testid={`${ISSUE_AI_ANALYSIS_TEST_ID}-none`}
      >
        {translator.translateText(NOT_ANALYZED_YET)}
      </p>,
    );
  }

  const verdictActions: AnalysisVerdictActions = getAnalysisVerdictActions({
    view,
    status: props.issue.status,
  });
  const pathActions: AnalysisPathActions = getAnalysisPathActions({
    view,
    status: props.issue.status,
  });
  const draft: string = view.lines.draft?.text || "";
  const reason: DataSecurityAnalysisLine | undefined = view.lines.reason;
  const reasonHidden: Array<DataSecurityAnalysisFactSource> | undefined =
    view.hiddenLines.reason;
  const issueGate: PermissionGateResult = PermissionGate.check(
    new DataSecurityIssue(),
    ModelAction.Update,
    { sentence: ISSUE_MOVES_LOCKED },
  );
  const storeGate: PermissionGateResult = PermissionGate.check(
    new DataStore(),
    ModelAction.Update,
  );
  const isPersonsChoice: boolean =
    view.verdict === DataSecurityAiVerdict.LikelyByDesign ||
    view.verdict === DataSecurityAiVerdict.LikelyWrongFinding;
  const fixesInCode: boolean =
    pathActions.fixInCode ||
    (isTelemetryFindingCheck(props.issue.checkId) &&
      view.verdict === DataSecurityAiVerdict.Real);

  const actionButtons: Array<ReactElement> = [];

  if (verdictActions.acceptRisk && issueGate.isAllowed) {
    actionButtons.push(
      <Button
        key="accept"
        title={ISSUE_MOVE_TITLES[IssueMove.Accept]}
        icon={ISSUE_MOVE_ICONS[IssueMove.Accept]}
        buttonStyle={ButtonStyleType.OUTLINE}
        dataTestId={`${ISSUE_AI_ANALYSIS_TEST_ID}-accept`}
        onClick={() => {
          props.onAcceptRisk(draft);
        }}
      />,
    );
  }

  if (verdictActions.publicByDesign && storeGate.isAllowed && dataStoreId) {
    actionButtons.push(
      <Button
        key="public"
        title={PUBLIC_BY_DESIGN}
        icon={IconProp.Globe}
        buttonStyle={ButtonStyleType.OUTLINE}
        dataTestId={`${ISSUE_AI_ANALYSIS_TEST_ID}-public-by-design`}
        onClick={() => {
          setPublicError("");
          setIsConfirmingPublic(true);
        }}
      />,
    );
  }

  if (verdictActions.notAnIssue && issueGate.isAllowed) {
    actionButtons.push(
      <Button
        key="not-an-issue"
        title={ISSUE_MOVE_TITLES[IssueMove.NotAnIssue]}
        icon={ISSUE_MOVE_ICONS[IssueMove.NotAnIssue]}
        buttonStyle={ButtonStyleType.OUTLINE}
        dataTestId={`${ISSUE_AI_ANALYSIS_TEST_ID}-not-an-issue`}
        onClick={() => {
          props.onNotAnIssue(draft);
        }}
      />,
    );
  }

  if (pathActions.response && dataStoreId) {
    actionButtons.push(
      <IssueResponseAction
        key="respond"
        isCompact={true}
        issueId={props.issueId}
        checkId={props.issue.checkId}
        dataStoreId={dataStoreId}
        storeKind={props.issue.dataStore?.kind}
        storeName={storeName}
        onChanged={props.onChanged}
      />,
    );
  }

  if (fixesInCode && !isPersonsChoice && issueGate.isAllowed) {
    actionButtons.push(
      <Button
        key="fix"
        title={FIX_WITH_AI}
        icon={IconProp.Bolt}
        buttonStyle={ButtonStyleType.OUTLINE}
        isLoading={props.isFixing}
        disabled={props.isFixing}
        dataTestId={`${ISSUE_AI_ANALYSIS_TEST_ID}-fix`}
        onClick={props.onFixWithAi}
      />,
    );
  }

  if (pathActions.reviewProposal) {
    actionButtons.push(
      <Button
        key="proposal"
        title={REVIEW_PROPOSAL}
        icon={IconProp.Sparkles}
        buttonStyle={ButtonStyleType.OUTLINE}
        dataTestId={`${ISSUE_AI_ANALYSIS_TEST_ID}-proposal`}
        onClick={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DATA_SECURITY_AI] as Route,
            ),
          );
        }}
      />,
    );
  }

  if (pathActions.setOwners && dataStoreId) {
    actionButtons.push(
      <Button
        key="owners"
        title={SET_OWNERS}
        icon={IconProp.UserGroup}
        buttonStyle={ButtonStyleType.OUTLINE}
        dataTestId={`${ISSUE_AI_ANALYSIS_TEST_ID}-owners`}
        onClick={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.DATA_SECURITY_STORE_VIEW_OWNERS] as Route,
              { modelId: new ObjectID(dataStoreId) },
            ),
          );
        }}
      />,
    );
  }

  return card(
    <>
      <div
        className="flex flex-wrap items-start gap-x-3 gap-y-1"
        data-testid={`${ISSUE_AI_ANALYSIS_TEST_ID}-verdict`}
      >
        <Pill
          text={DATA_SECURITY_AI_VERDICT_TITLES[view.verdict]}
          tone={VERDICT_TONES[view.verdict]}
          isDotHidden={true}
        />
        <div className="min-w-0 flex-1 text-sm text-gray-800">
          {reason ? (
            <p className="[overflow-wrap:anywhere]">
              <IsolatedText text={reason.text} />
            </p>
          ) : reasonHidden && reasonHidden.length > 0 ? (
            <p
              className="text-gray-600"
              data-testid={`${ISSUE_AI_ANALYSIS_TEST_ID}-reason-hidden`}
            >
              {getHiddenSentence(reasonHidden, translator)}
            </p>
          ) : (
            <></>
          )}
          {isPersonsChoice ? (
            <p className="mt-1 text-xs text-gray-500">
              {translator.translateText(PERSON_DECIDES)}
            </p>
          ) : (
            <></>
          )}
        </div>
      </div>

      <dl className="divide-y divide-gray-100">
        {DATA_SECURITY_ANALYSIS_QUESTIONS.map(
          (part: DataSecurityAnalysisPart): ReactElement => {
            return (
              <AnalysisPart
                key={part}
                part={part}
                view={view}
                namer={props.namer}
                dataStoreId={dataStoreId}
              />
            );
          },
        )}
      </dl>

      {actionButtons.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid={`${ISSUE_AI_ANALYSIS_TEST_ID}-actions`}
        >
          {actionButtons}
        </div>
      ) : (
        <></>
      )}

      {view.analyzedAt ? (
        <p
          className="text-xs text-gray-500"
          title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            OneUptimeDate.fromString(view.analyzedAt),
          )}
        >
          {translator.translateTemplate(ANALYZED_AT, {
            time: OneUptimeDate.fromNow(
              OneUptimeDate.fromString(view.analyzedAt),
            ),
          })}
        </p>
      ) : (
        <></>
      )}

      {isConfirmingPublic ? (
        <ConfirmModal
          title={translator.translateTemplate(PUBLIC_BY_DESIGN_QUESTION, {
            store: storeName,
          })}
          isTitleTranslated={true}
          description={
            translator.translateText(PUBLIC_BY_DESIGN_SENTENCE) || ""
          }
          submitButtonText={PUBLIC_BY_DESIGN}
          isLoading={isMarkingPublic}
          error={publicError || undefined}
          onClose={() => {
            setIsConfirmingPublic(false);
            setPublicError("");
          }}
          onSubmit={() => {
            void markPublicByDesign();
          }}
        />
      ) : (
        <></>
      )}
    </>,
  );
};

export default IssueAiAnalysisCard;
