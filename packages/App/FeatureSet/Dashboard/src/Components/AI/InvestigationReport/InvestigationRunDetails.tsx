import ChatActivityFeed, {
  countActivitySteps,
  isClusterToolName,
  KubectlActivitySummary,
} from "../../AIChat/ChatActivityFeed";
import InvestigationEvidenceList, {
  EvidenceFocusRequest,
} from "./InvestigationEvidenceList";
import { InvestigationReportSubjectType } from "./InvestigationReportData";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import { InvestigationEvidenceItem } from "Common/Types/AI/InvestigationEvidence";
import IconProp from "Common/Types/Icon/IconProp";
import { InvestigationEvidenceCheckedEntry } from "Common/Utils/AI/InvestigationReport";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  KeyboardEvent,
  ReactElement,
  useId,
  useRef,
  useState,
} from "react";

export interface InvestigationRunUsage {
  toolCallCount: number;
  totalTokens: number;
}

export const INVESTIGATION_READ_ONLY_TEXT: string =
  "Read-only — nothing in your systems was changed";

export interface UsageLineProps {
  usage: InvestigationRunUsage | null;
  /*
   * Telemetry queries to report instead of the run's tool calls, which
   * also count calls that failed and never became evidence. Never includes
   * cluster tool calls.
   */
  queryCount?: number | undefined;
  /*
   * What the run's kubectl calls did on linked clusters. Reported as its
   * own item, and — when the query count falls back to the run's tool
   * calls — taken out of "telemetry queries", so no call is counted twice.
   */
  kubectlActivity?: KubectlActivitySummary | undefined;
  stepCount?: number | undefined;
  modelName?: string | undefined;
  // Queries run and steps taken. Defaults to true.
  showCounts?: boolean | undefined;
  // Tokens spent and the model that spent them. Defaults to true.
  showCost?: boolean | undefined;
  // The read-only guarantee. Defaults to true.
  showReadOnly?: boolean | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

const USAGE_ITEM_CLASS_NAME: string =
  "inline-flex min-w-0 items-center gap-1.5";
const USAGE_ICON_CLASS_NAME: string = "h-3.5 w-3.5 flex-shrink-0 text-gray-400";

/*
 * The usage line's kubectl item, or null when the run never tried kubectl.
 * Only commands that ran on the cluster are counted as commands; those
 * that returned an error, never ran, or were taken by a Runner that never
 * reported back (whether they ran is unknown) are said alongside, never
 * folded in.
 */
export function describeKubectlUsage(
  activity: KubectlActivitySummary | undefined,
): string | null {
  if (!activity) {
    return null;
  }

  const executed: number = Math.max(0, activity.executed);
  const failed: number = Math.max(
    0,
    executed - Math.min(executed, Math.max(0, activity.succeeded)),
  );
  const notRun: number = Math.max(0, activity.notRun);
  const unknown: number = Math.max(0, activity.unknown || 0);

  if (executed === 0 && notRun === 0 && unknown === 0) {
    return null;
  }

  if (executed === 0 && unknown === 0) {
    return `${notRun.toLocaleString()} kubectl ${
      notRun === 1 ? "command" : "commands"
    } did not run`;
  }

  if (executed === 0 && notRun === 0) {
    return `${unknown.toLocaleString()} kubectl ${
      unknown === 1 ? "command" : "commands"
    } returned no result`;
  }

  if (executed === 0) {
    return `${(notRun + unknown).toLocaleString()} kubectl commands without a result (${notRun.toLocaleString()} did not run, ${unknown.toLocaleString()} returned no result)`;
  }

  const notes: Array<string> = [];

  if (failed > 0) {
    notes.push(`${failed.toLocaleString()} failed`);
  }

  if (notRun > 0) {
    notes.push(`${notRun.toLocaleString()} did not run`);
  }

  if (unknown > 0) {
    notes.push(`${unknown.toLocaleString()} returned no result`);
  }

  return `${executed.toLocaleString()} kubectl ${
    executed === 1 ? "command" : "commands"
  }${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
}

/*
 * What a run did and cost, plus the read-only guarantee, as one wrapping
 * list. Responders ask "did this thing touch anything?" before they trust a
 * report, so the guarantee stays visible even while the details are
 * collapsed. Renders nothing when every requested fact is absent.
 */
export const InvestigationUsageLine: FunctionComponent<UsageLineProps> = (
  props: UsageLineProps,
): ReactElement => {
  const usage: InvestigationRunUsage | null = props.usage;
  /*
   * The run's tool calls include every cluster tool call (run_kubectl and
   * list_cluster_access), which are not telemetry queries.
   */
  const queryCount: number | null =
    props.queryCount ??
    (usage
      ? Math.max(
          0,
          usage.toolCallCount - (props.kubectlActivity?.clusterToolCalls || 0),
        )
      : null);
  const stepCount: number = props.stepCount || 0;
  const kubectlUsage: string | null = describeKubectlUsage(
    props.kubectlActivity,
  );
  const items: Array<ReactElement> = [];

  if (props.showCounts !== false && queryCount !== null) {
    items.push(
      <li key="queries" className={USAGE_ITEM_CLASS_NAME}>
        <Icon icon={IconProp.Database} className={USAGE_ICON_CLASS_NAME} />
        {queryCount.toLocaleString()} telemetry{" "}
        {queryCount === 1 ? "query" : "queries"}
      </li>,
    );
  }

  if (props.showCounts !== false && kubectlUsage) {
    items.push(
      <li key="clusterCommands" className={USAGE_ITEM_CLASS_NAME}>
        <Icon icon={IconProp.Terminal} className={USAGE_ICON_CLASS_NAME} />
        {kubectlUsage}
      </li>,
    );
  }

  if (props.showCounts !== false && stepCount > 0) {
    items.push(
      <li key="steps" className={USAGE_ITEM_CLASS_NAME}>
        <Icon icon={IconProp.Activity} className={USAGE_ICON_CLASS_NAME} />
        {stepCount.toLocaleString()} {stepCount === 1 ? "step" : "steps"}
      </li>,
    );
  }

  if (props.showCost !== false && usage && usage.totalTokens > 0) {
    items.push(
      <li key="tokens" className={USAGE_ITEM_CLASS_NAME}>
        <Icon icon={IconProp.Bolt} className={USAGE_ICON_CLASS_NAME} />
        {usage.totalTokens.toLocaleString()} tokens
      </li>,
    );
  }

  if (props.showCost !== false && props.modelName) {
    items.push(
      <li key="model" className={USAGE_ITEM_CLASS_NAME}>
        <Icon icon={IconProp.Sparkles} className={USAGE_ICON_CLASS_NAME} />
        <span className="break-all">Model {props.modelName}</span>
      </li>,
    );
  }

  if (props.showReadOnly !== false) {
    items.push(
      <li key="readOnly" className={USAGE_ITEM_CLASS_NAME}>
        <Icon
          icon={IconProp.ShieldCheck}
          className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500"
        />
        {INVESTIGATION_READ_ONLY_TEXT}
      </li>,
    );
  }

  if (items.length === 0) {
    return <></>;
  }

  return (
    <ul
      role="list"
      aria-label={props.label || "Investigation usage"}
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 ${
        props.className || ""
      }`}
    >
      {items}
    </ul>
  );
};

type DetailsTab = "evidence" | "activity";

export interface ComponentProps {
  // Structured evidence from the API; empty until the report exists.
  evidence: Array<InvestigationEvidenceItem>;
  // The report's own "Evidence checked" block, for runs that predate `evidence`.
  legacyEntries: Array<InvestigationEvidenceCheckedEntry>;
  events: Array<AIRunEvent>;
  usage: InvestigationRunUsage | null;
  // What the run's kubectl calls did (see summarizeKubectlActivity).
  kubectlActivity?: KubectlActivitySummary | undefined;
  modelName?: string | undefined;
  subjectType: InvestigationReportSubjectType;
  subjectId: string;
  runId: string | null;
  /*
   * A citation chip in the report asking for its query. A new request opens
   * the details on the evidence tab before the list reveals the row.
   */
  focusRequest?: EvidenceFocusRequest | null | undefined;
}

/*
 * Everything behind a completed investigation in one quiet, collapsed
 * section: the queries it ran ("Evidence checked"), the steps it took
 * ("Activity") and what the run cost. The report is the primary content;
 * this is where a responder goes to check its working.
 *
 * The body stays mounted while collapsed so expanded queries, their loaded
 * rows and the evidence list's element registry survive a toggle.
 */
const InvestigationRunDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const idPrefix: string = useId();
  const contextKey: string = `${props.subjectType}:${props.subjectId}:${props.runId || ""}`;
  const focusRequestId: number | null = props.focusRequest
    ? props.focusRequest.requestId
    : null;
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedTab, setSelectedTab] = useState<DetailsTab | null>(null);
  const [stateContextKey, setStateContextKey] = useState<string>(contextKey);
  /*
   * A request that already existed when this section mounted belongs to an
   * earlier render of the report, so only later requests open it.
   */
  const [handledFocusRequestId, setHandledFocusRequestId] = useState<
    number | null
  >(focusRequestId);
  const tabElementsRef: React.MutableRefObject<
    Map<DetailsTab, HTMLButtonElement>
  > = useRef<Map<DetailsTab, HTMLButtonElement>>(
    new Map<DetailsTab, HTMLButtonElement>(),
  );

  /*
   * Both adjustments happen during render, not in an effect, so the commit
   * that carries a new focus request already shows the evidence list: the
   * list's own effect can then expand, scroll to and focus a visible row.
   */
  if (stateContextKey !== contextKey) {
    setStateContextKey(contextKey);
    setIsOpen(false);
    setSelectedTab(null);
    setHandledFocusRequestId(focusRequestId);
  } else if (
    focusRequestId !== null &&
    focusRequestId !== handledFocusRequestId
  ) {
    setHandledFocusRequestId(focusRequestId);
    setIsOpen(true);
    setSelectedTab("evidence");
  }

  const evidenceCount: number =
    props.evidence.length > 0
      ? props.evidence.length
      : props.legacyEntries.length;
  /*
   * Every cited call is evidence, cluster calls included, but only the
   * others are telemetry queries: kubectl has its own item in the usage
   * line and a cluster listing is configuration, not data. Legacy entries
   * carry no tool name and predate cluster access.
   */
  const telemetryQueryCount: number =
    props.evidence.length > 0
      ? props.evidence.filter((item: InvestigationEvidenceItem): boolean => {
          return !isClusterToolName(item.toolName);
        }).length
      : props.legacyEntries.length;
  const hasClusterEvidence: boolean = props.evidence.some(
    (item: InvestigationEvidenceItem): boolean => {
      return isClusterToolName(item.toolName);
    },
  );
  const stepCount: number = countActivitySteps(props.events);
  const tabs: Array<DetailsTab> = [];

  if (evidenceCount > 0) {
    tabs.push("evidence");
  }

  if (stepCount > 0) {
    tabs.push("activity");
  }

  if (tabs.length === 0 && !props.usage) {
    return <></>;
  }

  // Nothing to expand: what the run did and cost is all there is to say.
  if (tabs.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3 sm:px-5">
        <InvestigationUsageLine
          usage={props.usage}
          kubectlActivity={props.kubectlActivity}
          stepCount={stepCount}
          modelName={props.modelName}
        />
      </div>
    );
  }

  const activeTab: DetailsTab =
    selectedTab && tabs.includes(selectedTab) ? selectedTab : tabs[0]!;
  const titleId: string = `${idPrefix}-title`;
  const bodyId: string = `${idPrefix}-body`;
  const getTabId: (tab: DetailsTab) => string = (tab: DetailsTab): string => {
    return `${idPrefix}-tab-${tab}`;
  };
  const getPanelId: (tab: DetailsTab) => string = (tab: DetailsTab): string => {
    return `${idPrefix}-panel-${tab}`;
  };
  const hasTabs: boolean = tabs.length > 1;
  // Named for what is inside: evidence only exists next to a report.
  const title: string = hasTabs
    ? "Evidence and activity"
    : activeTab === "evidence"
      ? "Evidence checked"
      : "Investigation activity";

  const onTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void = (
    event: KeyboardEvent<HTMLButtonElement>,
  ): void => {
    const index: number = tabs.indexOf(activeTab);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextTab: DetailsTab = tabs[nextIndex]!;
    setSelectedTab(nextTab);
    tabElementsRef.current.get(nextTab)?.focus();
  };

  const tabCounts: Record<DetailsTab, number> = {
    evidence: evidenceCount,
    activity: stepCount,
  };
  const tabLabels: Record<DetailsTab, ReactElement> = {
    // "Evidence checked" and "Activity" do not share one row on a phone.
    evidence: (
      <span>
        Evidence<span className="hidden sm:inline"> checked</span>
      </span>
    ),
    activity: <span>Activity</span>,
  };

  const renderPanel: (tab: DetailsTab) => ReactElement = (
    tab: DetailsTab,
  ): ReactElement => {
    /*
     * A panel is focusable itself: the activity feed (and a legacy evidence
     * list) has nothing else to take focus, so Tab from the selected tab
     * would otherwise skip straight past it.
     */
    const panelProps: React.HTMLAttributes<HTMLDivElement> = hasTabs
      ? {
          role: "tabpanel",
          id: getPanelId(tab),
          "aria-labelledby": getTabId(tab),
          tabIndex: 0,
        }
      : {};
    const panelFocusClassName: string = hasTabs
      ? "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
      : "";

    if (tab === "evidence") {
      return (
        <div
          key={tab}
          {...panelProps}
          hidden={activeTab !== tab}
          className={panelFocusClassName}
        >
          <p className="px-4 pb-1 pt-3 text-xs leading-5 text-gray-500 sm:px-5">
            {/*
              A kubectl command is not a query and has no rows to load, so
              a list with cluster calls in it promises rows only for the
              telemetry queries.
            */}
            {props.evidence.length === 0
              ? "Every query OneUptime AI ran while investigating."
              : hasClusterEvidence
                ? "Every telemetry query and kubectl call OneUptime AI made. Expand one to see what it asked — and, for a telemetry query, the rows it returned."
                : "Every query OneUptime AI ran. Expand one to see what it asked and the rows it returned."}
          </p>
          <InvestigationEvidenceList
            items={props.evidence}
            legacyEntries={props.legacyEntries}
            subjectType={props.subjectType}
            subjectId={props.subjectId}
            runId={props.runId}
            focusRequest={props.focusRequest}
          />
        </div>
      );
    }

    return (
      <div
        key={tab}
        {...panelProps}
        hidden={activeTab !== tab}
        className={`px-4 py-4 sm:px-5 ${panelFocusClassName}`}
      >
        {/*
          A finished run is short (the engine caps its tool calls), so the
          whole trail is shown rather than the live panel's recent tail.
        */}
        <ChatActivityFeed
          events={props.events}
          hideChrome={true}
          showLiveIndicator={false}
          maxVisibleSteps={Math.max(stepCount, 1)}
        />
      </div>
    );
  };

  return (
    <section
      aria-labelledby={titleId}
      data-testid="investigation-details"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="relative flex items-center gap-2.5 px-4 py-3.5 transition-colors hover:bg-gray-50 sm:px-5">
        {/* Hidden on phones, where the usage line needs the width more. */}
        <span className="hidden h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 sm:flex">
          <Icon icon={IconProp.DocumentMagnifyingGlass} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-gray-900">
            {/*
              The button stretches over the whole header, so the usage line
              is clickable too without becoming part of the button's name.
            */}
            <button
              type="button"
              data-testid="investigation-details-toggle"
              aria-expanded={isOpen}
              aria-controls={bodyId}
              className="text-left after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-500"
              onClick={() => {
                /*
                 * Pin the panel the reader is about to see, so evidence that
                 * arrives while they read the activity adds a tab beside it
                 * instead of switching away.
                 */
                if (!isOpen && selectedTab === null) {
                  setSelectedTab(activeTab);
                }

                setIsOpen(!isOpen);
              }}
            >
              {title}
            </button>
          </h3>
          {/*
            Collapsed, the header says what the run did and that it changed
            nothing; tokens and model wait in the body.
          */}
          {/*
            With evidence, the query count is the Evidence tab's items less
            the cluster calls, which the kubectl item reports instead: the
            tab lists every cited call, the header counts each call once.
          */}
          <InvestigationUsageLine
            usage={props.usage}
            queryCount={evidenceCount > 0 ? telemetryQueryCount : undefined}
            kubectlActivity={props.kubectlActivity}
            stepCount={stepCount}
            showCost={false}
            className="mt-0.5"
          />
        </div>
        <Icon
          icon={IconProp.ChevronDown}
          className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </div>

      <div id={bodyId} hidden={!isOpen} className="border-t border-gray-200">
        {hasTabs ? (
          <div
            role="tablist"
            aria-label="Investigation details"
            className="flex gap-x-5 border-b border-gray-200 px-4 sm:px-5"
          >
            {tabs.map((tab: DetailsTab): ReactElement => {
              const isSelected: boolean = tab === activeTab;

              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  id={getTabId(tab)}
                  aria-selected={isSelected}
                  aria-controls={getPanelId(tab)}
                  tabIndex={isSelected ? 0 : -1}
                  ref={(element: HTMLButtonElement | null) => {
                    if (element) {
                      tabElementsRef.current.set(tab, element);
                    } else {
                      tabElementsRef.current.delete(tab);
                    }
                  }}
                  className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                    isSelected
                      ? "border-indigo-600 text-gray-900"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
                  onClick={() => {
                    setSelectedTab(tab);
                  }}
                  onKeyDown={onTabKeyDown}
                >
                  {tabLabels[tab]}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {tabCounts[tab].toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <></>
        )}
        {tabs.map(renderPanel)}
        <InvestigationUsageLine
          usage={props.usage}
          modelName={props.modelName}
          showCounts={false}
          showReadOnly={false}
          label="Model and tokens"
          className="border-t border-gray-100 bg-gray-50/70 px-4 py-2.5 sm:px-5"
        />
      </div>
    </section>
  );
};

export default InvestigationRunDetails;
