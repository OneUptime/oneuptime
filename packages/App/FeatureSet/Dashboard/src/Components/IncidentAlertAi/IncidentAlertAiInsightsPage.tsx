import PageComponentProps from "../../Pages/PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SettingsAction,
  getSettingsAction,
} from "../AI/InvestigationNotStarted";
import {
  IncidentAlertAiDescriptor,
  getIncidentAlertAiDescriptor,
} from "./IncidentAlertAiDescriptors";
import {
  AI_INSIGHTS_EMPTY_DESCRIPTIONS,
  AI_INSIGHTS_EMPTY_TITLE,
  AI_INSIGHTS_FIXES_HIDDEN_NOTE,
  AI_INSIGHTS_PAGE_SUBTITLES,
  AI_INSIGHTS_PAGE_TITLE,
  AI_INSIGHTS_PARTIAL_NOTE,
  AiInsights,
  AiInsightsAttentionItem,
  AiInsightsAttentionWords,
  AiInsightsFixOutcomes,
  AiInsightsHotspot,
  AiInsightsNamedResource,
  AiInsightsProblem,
  AiInsightsTrendDay,
  SEVERITY_LABELS,
  describeAttentionItem,
  describeNotInvestigatedReason,
  getAppliedFixes,
  getBarHeightPercent,
  getSeverityDotClass,
  getTrendScale,
  hasAiActivity,
  parseAiInsights,
} from "./IncidentAlertAiInsights";
import { AiLogsSubject, getAiLogSubjectLabel } from "./IncidentAlertAiLogs";
import {
  INCIDENT_ALERT_AI_INSIGHTS_PATHS,
  IncidentAlertAiAttentionKind,
} from "Common/Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "Common/Types/AI/IncidentAlertAiLogs";
import { InvestigationNotStartedCode } from "Common/Types/AI/InvestigationNotStartedReason";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { PermissionHelper } from "Common/Types/Permission";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import PermissionUtil from "Common/UI/Utils/Permission";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The AI Insights page of the Incidents and Alerts menus (AI → Insights):
 * what OneUptime AI learned from the project's incidents (or alerts) over
 * the last 30 days, and what deserves attention - the problems that keep
 * coming back and what the investigations found about them, the monitors
 * and services that keep failing, how the fixes AI proposed or applied
 * turned out, how much it investigated and why it skipped the rest, and how
 * all of it moved day by day.
 *
 * Everything comes from POST /ai-activity/{incident|alert}/insights, which
 * computes it on the server from what the system recorded
 * (IncidentAlertAiInsightsReader) - nothing here is invented or estimated.
 * The record behind the numbers is the AI Logs page next to it.
 */

export interface ComponentProps extends PageComponentProps {
  subjectKind: IncidentAlertAiSubjectKind;
}

function subjectRoute(
  descriptor: IncidentAlertAiDescriptor,
  subject: AiLogsSubject,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[descriptor.subjectViewPage] as Route,
    { modelId: subject.id },
  );
}

function resourceRoute(page: PageMap, id: string): Route {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: id,
  });
}

// "Last seen 2 days ago", with the moment itself on hover.
function Ago(props: { at: string | null }): ReactElement {
  const translator: Translator = useTranslator();

  if (!props.at) {
    return <></>;
  }

  const date: Date = OneUptimeDate.fromString(props.at);

  if (Number.isNaN(date.getTime())) {
    return <></>;
  }

  return (
    <time
      dateTime={props.at}
      title={OneUptimeDate.getDateAsFormattedString(date)}
    >
      {translator.translateTemplate("Last seen {{when}}", {
        when: OneUptimeDate.fromNow(date),
      })}
    </time>
  );
}

function SubjectLink(props: {
  descriptor: IncidentAlertAiDescriptor;
  subject: AiLogsSubject;
}): ReactElement {
  const translator: Translator = useTranslator();
  const label: string = getAiLogSubjectLabel(props.subject);

  return (
    <Link
      to={subjectRoute(props.descriptor, props.subject)}
      className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
    >
      {label ||
        translator.translateText(
          props.subject.kind === "incident" ? "Open incident" : "Open alert",
        )}
    </Link>
  );
}

function Tile(props: {
  label: string;
  value: string;
  detail?: string | undefined;
  testId: string;
}): ReactElement {
  return (
    <div
      className="flex flex-col rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
      data-testid={props.testId}
    >
      <span className="text-xs font-medium text-gray-500">{props.label}</span>
      <span className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-gray-900 tabular-nums">
        {props.value}
      </span>
      {props.detail ? (
        <span className="mt-1 text-xs text-gray-500">{props.detail}</span>
      ) : (
        <></>
      )}
    </div>
  );
}

function SummaryTiles(props: {
  insights: AiInsights;
  subjectKind: IncidentAlertAiSubjectKind;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { totals, coverage, fixOutcomes } = props.insights;

  return (
    <div
      className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"
      data-testid="ai-insights-tiles"
    >
      <Tile
        testId="ai-insights-tile-investigations"
        label={translator.translateText("Investigations") as string}
        value={translator.formatNumber(totals.investigations)}
        detail={
          totals.failedInvestigations > 0
            ? translator.translateTemplate("Failed: {{count}}", {
                count: totals.failedInvestigations,
              })
            : undefined
        }
      />
      <Tile
        testId="ai-insights-tile-coverage"
        label={
          translator.translateText(
            props.subjectKind === "incident"
              ? "Incidents investigated"
              : "Alerts investigated",
          ) as string
        }
        value={translator.translateTemplate("{{count}} of {{total}}", {
          count: coverage.investigatedSubjects,
          total: coverage.subjects,
        })}
        detail={translator.translateText("Created in the last 30 days")}
      />
      <Tile
        testId="ai-insights-tile-fixes"
        label={translator.translateText("Fixes applied") as string}
        value={
          fixOutcomes
            ? translator.translateTemplate("{{count}} of {{total}}", {
                count: getAppliedFixes(fixOutcomes),
                total: fixOutcomes.total,
              })
            : "—"
        }
        detail={
          fixOutcomes
            ? translator.translateTemplate("Worked: {{count}}", {
                count: fixOutcomes.verified,
              })
            : translator.translateText("Not shown to your role")
        }
      />
      <Tile
        testId="ai-insights-tile-recurring"
        label={translator.translateText("Recurring problems") as string}
        value={translator.formatNumber(totals.recurringProblems)}
        detail={translator.translatePlural(
          {
            one: "Out of {{count}} problem",
            other: "Out of {{count}} problems",
          },
          totals.problems,
        )}
      />
    </div>
  );
}

function AttentionRow(props: {
  item: AiInsightsAttentionItem;
  descriptor: IncidentAlertAiDescriptor;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { item, descriptor } = props;
  const words: AiInsightsAttentionWords = describeAttentionItem(
    item,
    descriptor.subjectKind,
  );
  const settingsAction: SettingsAction | null =
    item.kind === IncidentAlertAiAttentionKind.InvestigationsNotStarted &&
    item.reason
      ? getSettingsAction(item.reason, descriptor.subjectKind)
      : null;
  /*
   * The way to fix it, to whoever may take it; anyone else is told who can
   * - the same rule as the AI Investigation card's "What you can do".
   */
  const canAct: boolean = Boolean(
    settingsAction &&
      PermissionHelper.doesPermissionsIntersect(
        settingsAction.permissions,
        PermissionUtil.getAllPermissions(),
      ),
  );

  return (
    <li
      className="flex items-start gap-3 py-3"
      data-testid="ai-insights-attention-item"
      data-kind={item.kind}
      data-severity={item.severity}
    >
      <span
        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${getSeverityDotClass(item.severity)}`}
        title={translator.translateText(SEVERITY_LABELS[item.severity])}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">
          {translator.translatePlural(
            words.headline.template,
            words.headline.count,
            words.headline.values,
          )}
        </p>
        {words.detail ? (
          <p className="mt-0.5 text-sm text-gray-600">
            {"text" in words.detail
              ? translator.translateText(words.detail.text)
              : translator.translatePlural(
                  words.detail.template,
                  words.detail.count,
                  words.detail.values,
                )}
          </p>
        ) : (
          <></>
        )}
        <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
          {item.subject ? (
            <SubjectLink descriptor={descriptor} subject={item.subject} />
          ) : (
            <></>
          )}
          {item.monitor ? (
            <Link
              to={resourceRoute(PageMap.MONITOR_VIEW, item.monitor.id)}
              className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              {item.monitor.name}
            </Link>
          ) : (
            <></>
          )}
          {settingsAction && canAct ? (
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[settingsAction.page] as Route,
              )}
              className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
            >
              {translator.translateText(settingsAction.label)}
            </Link>
          ) : settingsAction ? (
            <span
              className="text-xs text-gray-500"
              data-testid="ai-insights-attention-who-can-act"
            >
              {translator.translateText(settingsAction.whoCanAct)}
            </span>
          ) : (
            <></>
          )}
        </p>
      </div>
    </li>
  );
}

function ProblemRow(props: {
  problem: AiInsightsProblem;
  descriptor: IncidentAlertAiDescriptor;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { problem, descriptor } = props;
  const facts: Array<string> = [];

  if (problem.verdicts.confirmed > 0) {
    facts.push(
      translator.translateTemplate("Confirmed by your team: {{count}}", {
        count: problem.verdicts.confirmed,
      }),
    );
  }

  if (problem.verdicts.rejected > 0) {
    facts.push(
      translator.translateTemplate("Rejected by your team: {{count}}", {
        count: problem.verdicts.rejected,
      }),
    );
  }

  if (problem.fixes.proposed > 0) {
    facts.push(
      translator.translateTemplate(
        "Fixes: {{proposed}} proposed, {{applied}} applied, {{verified}} worked",
        {
          proposed: problem.fixes.proposed,
          applied: problem.fixes.applied,
          verified: problem.fixes.verified,
        },
      ),
    );
  }

  return (
    <li className="py-4" data-testid="ai-insights-problem">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm font-semibold text-gray-900">
          {problem.title ||
            translator.translateText(
              descriptor.subjectKind === "incident"
                ? "Untitled incident"
                : "Untitled alert",
            )}
        </p>
        {problem.isRecurring ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
            {translator.translateText("Recurring")}
          </span>
        ) : (
          <></>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {translator.translatePlural(
          {
            one: "Investigated {{count}} time",
            other: "Investigated {{count}} times",
          },
          problem.investigationCount,
        )}
        {" · "}
        {translator.translatePlural(
          descriptor.subjectKind === "incident"
            ? { one: "{{count}} incident", other: "{{count}} incidents" }
            : { one: "{{count}} alert", other: "{{count}} alerts" },
          problem.subjectCount,
        )}
        {problem.lastSeenAt ? (
          <>
            {" · "}
            <Ago at={problem.lastSeenAt} />
          </>
        ) : (
          <></>
        )}
      </p>
      {problem.latestFinding ? (
        <p
          className="mt-2 break-words rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700"
          data-testid="ai-insights-problem-finding"
        >
          <span className="font-medium text-gray-900">
            {translator.translateText("What AI found:")}
          </span>{" "}
          {problem.latestFinding.text}
        </p>
      ) : (
        <p className="mt-2 text-sm text-gray-500">
          {translator.translateText("No finding was recorded yet.")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        {problem.monitors.map(
          (monitor: AiInsightsNamedResource): ReactElement => {
            return (
              <Link
                key={monitor.id}
                to={resourceRoute(PageMap.MONITOR_VIEW, monitor.id)}
                className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-gray-700 hover:bg-gray-200"
              >
                <Icon icon={IconProp.AltGlobe} className="h-3 w-3" />
                {monitor.name}
              </Link>
            );
          },
        )}
        {facts.map((fact: string): ReactElement => {
          return <span key={fact}>{fact}</span>;
        })}
        <span>
          {translator.translateText("Latest:")}{" "}
          <SubjectLink
            descriptor={descriptor}
            subject={problem.latestSubject}
          />
        </span>
      </div>
    </li>
  );
}

function HotspotList(props: {
  title: string;
  description: string;
  hotspots: Array<AiInsightsHotspot>;
  page: PageMap;
  subjectKind: IncidentAlertAiSubjectKind;
  testId: string;
  emptyMessage: string;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <Card title={props.title} description={props.description}>
      {props.hotspots.length === 0 ? (
        <p
          className="text-sm text-gray-500"
          data-testid={`${props.testId}-empty`}
        >
          {translator.translateText(props.emptyMessage)}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100" data-testid={props.testId}>
          {props.hotspots.map((hotspot: AiInsightsHotspot): ReactElement => {
            return (
              <li
                key={hotspot.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <Link
                  to={resourceRoute(props.page, hotspot.id)}
                  className="min-w-0 truncate text-sm font-medium text-gray-900 hover:text-indigo-700 hover:underline"
                >
                  {hotspot.name}
                </Link>
                <span className="flex-shrink-0 text-xs text-gray-500">
                  {translator.translatePlural(
                    props.subjectKind === "incident"
                      ? {
                          one: "{{count}} incident investigated",
                          other: "{{count}} incidents investigated",
                        }
                      : {
                          one: "{{count}} alert investigated",
                          other: "{{count}} alerts investigated",
                        },
                    hotspot.subjectCount,
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function OutcomeRow(props: { label: string; count: number }): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <li className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-gray-600">
        {translator.translateText(props.label)}
      </span>
      <span className="font-medium text-gray-900 tabular-nums">
        {translator.formatNumber(props.count)}
      </span>
    </li>
  );
}

function FixesCard(props: { insights: AiInsights }): ReactElement {
  const translator: Translator = useTranslator();
  const outcomes: AiInsightsFixOutcomes | null = props.insights.fixOutcomes;
  const tasks: AiInsights["fixTaskOutcomes"] = props.insights.fixTaskOutcomes;

  return (
    <Card
      title="How the fixes turned out"
      description="The fixes OneUptime AI proposed or applied in the last 30 days, whether they worked, and the fix pull requests it opened."
    >
      <div
        className="grid gap-6 md:grid-cols-2"
        data-testid="ai-insights-fixes"
      >
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {translator.translateText("Fixes")}
          </h4>
          {outcomes ? (
            <ul className="mt-2" data-testid="ai-insights-fix-outcomes">
              <OutcomeRow label="Proposed" count={outcomes.total} />
              <OutcomeRow
                label="Applied automatically"
                count={outcomes.appliedAutomatically}
              />
              <OutcomeRow
                label="Applied after approval"
                count={outcomes.appliedAfterApproval}
              />
              <OutcomeRow
                label="Waiting for approval"
                count={outcomes.awaitingApproval}
              />
              <OutcomeRow label="Dismissed" count={outcomes.dismissed} />
              <OutcomeRow label="No fix found" count={outcomes.noFixFound} />
              <OutcomeRow label="Worked" count={outcomes.verified} />
              <OutcomeRow label="Did not work" count={outcomes.failed} />
              <OutcomeRow label="Still checking" count={outcomes.verifying} />
            </ul>
          ) : (
            <p
              className="mt-2 text-sm text-gray-500"
              data-testid="ai-insights-fixes-hidden"
            >
              {translator.translateText(AI_INSIGHTS_FIXES_HIDDEN_NOTE)}
            </p>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {translator.translateText("Fix pull requests")}
          </h4>
          <ul className="mt-2" data-testid="ai-insights-fix-task-outcomes">
            <OutcomeRow label="Asked for" count={tasks.total} />
            <OutcomeRow
              label="Pull request opened"
              count={tasks.pullRequestsOpened}
            />
            <OutcomeRow label="No fix found" count={tasks.noFixFound} />
            <OutcomeRow label="In progress" count={tasks.inProgress} />
            <OutcomeRow label="Failed" count={tasks.failed} />
          </ul>
        </div>
      </div>
    </Card>
  );
}

function TrendCard(props: { trend: Array<AiInsightsTrendDay> }): ReactElement {
  const translator: Translator = useTranslator();
  const scale: number = getTrendScale(props.trend);
  const totals: { investigations: number; failed: number; fixes: number } =
    props.trend.reduce(
      (
        sum: { investigations: number; failed: number; fixes: number },
        day: AiInsightsTrendDay,
      ) => {
        return {
          investigations: sum.investigations + day.investigations,
          failed: sum.failed + day.failedInvestigations,
          fixes: sum.fixes + day.fixes,
        };
      },
      { investigations: 0, failed: 0, fixes: 0 },
    );

  return (
    <Card
      title="Day by day"
      description="Investigations and fixes each day of the last 30 days (UTC)."
    >
      <div
        role="img"
        aria-label={translator.translateTemplate(
          "Over the last 30 days: {{investigations}} investigations, {{failed}} of them failed, and {{fixes}} fixes.",
          totals,
        )}
        className="flex h-32 items-end gap-0.5"
        data-testid="ai-insights-trend"
      >
        {props.trend.map((day: AiInsightsTrendDay): ReactElement => {
          return (
            <div
              key={day.date}
              className="flex h-full flex-1 flex-col justify-end gap-px"
              data-testid="ai-insights-trend-day"
              data-date={day.date}
              title={translator.translateTemplate(
                "{{date}}: investigations {{investigations}}, failed {{failed}}, fixes {{fixes}}",
                {
                  date: day.date,
                  investigations: day.investigations,
                  failed: day.failedInvestigations,
                  fixes: day.fixes,
                },
              )}
            >
              <div
                className="w-full rounded-t-sm bg-rose-400"
                style={{
                  height: `${getBarHeightPercent(day.failedInvestigations, scale)}%`,
                }}
              />
              <div
                className="w-full bg-indigo-400"
                style={{
                  height: `${getBarHeightPercent(
                    day.investigations - day.failedInvestigations,
                    scale,
                  )}%`,
                }}
              />
              <div
                className="mt-0.5 w-full rounded-sm bg-emerald-400"
                style={{
                  height: `${Math.min(getBarHeightPercent(day.fixes, scale), 30)}%`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-indigo-400" />
          {translator.translateText("Investigations")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-400" />
          {translator.translateText("Failed")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-emerald-400" />
          {translator.translateText("Fixes")}
        </span>
      </div>
    </Card>
  );
}

function CoverageCard(props: {
  insights: AiInsights;
  descriptor: IncidentAlertAiDescriptor;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { coverage } = props.insights;
  const subjectKind: IncidentAlertAiSubjectKind = props.descriptor.subjectKind;

  return (
    <Card
      title="What OneUptime AI looked at"
      description={
        subjectKind === "incident"
          ? "The incidents created in the last 30 days, how many OneUptime AI investigated, and why it did not investigate the others."
          : "The alerts created in the last 30 days, how many OneUptime AI investigated, and why it did not investigate the others."
      }
    >
      <div data-testid="ai-insights-coverage">
        <p className="text-sm text-gray-700">
          {translator.translatePlural(
            subjectKind === "incident"
              ? {
                  one: "OneUptime AI investigated {{investigated}} of the {{count}} incident created in the last 30 days.",
                  other:
                    "OneUptime AI investigated {{investigated}} of the {{count}} incidents created in the last 30 days.",
                }
              : {
                  one: "OneUptime AI investigated {{investigated}} of the {{count}} alert created in the last 30 days.",
                  other:
                    "OneUptime AI investigated {{investigated}} of the {{count}} alerts created in the last 30 days.",
                },
            coverage.subjects,
            { investigated: coverage.investigatedSubjects },
          )}
        </p>
        {coverage.notInvestigated.length > 0 ? (
          <Fragment>
            <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {translator.translateText("Why the others were not investigated")}
            </h4>
            <ul
              className="mt-2 divide-y divide-gray-100"
              data-testid="ai-insights-not-investigated"
            >
              {coverage.notInvestigated.map(
                (reason: {
                  code: InvestigationNotStartedCode;
                  count: number;
                }): ReactElement => {
                  return (
                    <li
                      key={reason.code}
                      className="flex items-center justify-between gap-3 py-1.5 text-sm"
                      data-code={reason.code}
                    >
                      <span className="text-gray-600">
                        {translator.translateText(
                          describeNotInvestigatedReason(
                            subjectKind,
                            reason.code,
                          ),
                        )}
                      </span>
                      <span className="font-medium text-gray-900 tabular-nums">
                        {translator.formatNumber(reason.count)}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          </Fragment>
        ) : (
          <></>
        )}
        <p className="mt-3 text-sm">
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[props.descriptor.settingsPage] as Route,
            )}
            className="font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            {translator.translateText(
              "Choose what OneUptime AI does on its own in AI → Settings",
            )}
          </Link>
        </p>
      </div>
    </Card>
  );
}

const IncidentAlertAiInsightsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const descriptor: IncidentAlertAiDescriptor = getIncidentAlertAiDescriptor(
    props.subjectKind,
  );

  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);
  /*
   * The latest request: an answer to an older one (a retry, another
   * product) is dropped instead of painting over the newer page.
   */
  const requestRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    const request: number = ++requestRef.current;

    setIsLoading(true);
    setError("");

    const load: () => Promise<AiInsights> = async (): Promise<AiInsights> => {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            INCIDENT_ALERT_AI_INSIGHTS_PATHS[props.subjectKind],
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const parsed: AiInsights | null = parseAiInsights(
        response.data,
        props.subjectKind,
      );

      if (!parsed) {
        throw new Error(
          translator.translateText(
            "The server returned AI insights this page cannot read.",
          ),
        );
      }

      return parsed;
    };

    load()
      .then((parsed: AiInsights) => {
        if (request === requestRef.current) {
          setInsights(parsed);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (request === requestRef.current) {
          setInsights(null);
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      });
  }, [props.subjectKind, refresher]);

  let body: ReactElement;

  if (isLoading) {
    body = (
      <div data-testid="ai-insights-loading">
        <PageLoader isVisible={true} />
      </div>
    );
  } else if (!insights) {
    body = (
      <div data-testid="ai-insights-error">
        <ErrorMessage
          message={error || "Could not load the AI insights."}
          onRefreshClick={() => {
            setRefresher(!refresher);
          }}
        />
      </div>
    );
  } else if (!hasAiActivity(insights)) {
    body = (
      <Fragment>
        <div className="mb-5" data-testid="ai-insights-empty">
          <EmptyState
            id={`${descriptor.testIdPrefix}-insights-empty`}
            icon={IconProp.LightBulb}
            title={AI_INSIGHTS_EMPTY_TITLE}
            description={AI_INSIGHTS_EMPTY_DESCRIPTIONS[props.subjectKind]}
            showSolidBackground={true}
            paddingClassName="py-12"
          />
        </div>
        {/*
         * Nothing investigated is the moment the reasons matter most: AI
         * off, no provider, no credits.
         */}
        <CoverageCard insights={insights} descriptor={descriptor} />
      </Fragment>
    );
  } else {
    body = (
      <Fragment>
        <SummaryTiles insights={insights} subjectKind={props.subjectKind} />

        {insights.attention.length > 0 ? (
          <Card
            title="Needs attention"
            description="What OneUptime AI's work in the last 30 days says deserves a look, most important first."
          >
            <ul
              className="divide-y divide-gray-100"
              data-testid="ai-insights-attention"
            >
              {insights.attention.map(
                (
                  item: AiInsightsAttentionItem,
                  index: number,
                ): ReactElement => {
                  return (
                    <AttentionRow
                      key={`${item.kind}-${index}`}
                      item={item}
                      descriptor={descriptor}
                    />
                  );
                },
              )}
            </ul>
          </Card>
        ) : (
          <></>
        )}

        <Card
          title="What keeps happening"
          description={
            props.subjectKind === "incident"
              ? "The incidents OneUptime AI investigated, grouped by the monitor that raised them, the ones that keep coming back first, with what the latest investigation found."
              : "The alerts OneUptime AI investigated, grouped by the monitor that raised them, the ones that keep coming back first, with what the latest investigation found."
          }
        >
          {insights.problems.length > 0 ? (
            <ul
              className="divide-y divide-gray-100"
              data-testid="ai-insights-problems"
            >
              {insights.problems.map(
                (problem: AiInsightsProblem): ReactElement => {
                  return (
                    <ProblemRow
                      key={problem.key}
                      problem={problem}
                      descriptor={descriptor}
                    />
                  );
                },
              )}
            </ul>
          ) : (
            <p
              className="text-sm text-gray-500"
              data-testid="ai-insights-no-problems"
            >
              {translator.translateText(
                "OneUptime AI has not investigated anything in the last 30 days.",
              )}
            </p>
          )}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <HotspotList
            title="Monitors that keep failing"
            description={
              props.subjectKind === "incident"
                ? "The monitors behind the most incidents OneUptime AI investigated."
                : "The monitors behind the most alerts OneUptime AI investigated."
            }
            hotspots={insights.monitors}
            page={PageMap.MONITOR_VIEW}
            subjectKind={props.subjectKind}
            testId="ai-insights-monitors"
            emptyMessage="No monitor came up more than once."
          />
          <HotspotList
            title="Services that keep failing"
            description={
              props.subjectKind === "incident"
                ? "The services affected by the most incidents OneUptime AI investigated."
                : "The services affected by the most alerts OneUptime AI investigated."
            }
            hotspots={insights.services}
            page={PageMap.SERVICE_VIEW}
            subjectKind={props.subjectKind}
            testId="ai-insights-services"
            emptyMessage="No service came up more than once."
          />
        </div>

        <FixesCard insights={insights} />

        <TrendCard trend={insights.trend} />

        <CoverageCard insights={insights} descriptor={descriptor} />

        {insights.isPartial ? (
          <p
            className="mt-2 text-xs text-gray-500"
            data-testid="ai-insights-partial"
          >
            {translator.translateText(AI_INSIGHTS_PARTIAL_NOTE)}
          </p>
        ) : (
          <></>
        )}
      </Fragment>
    );
  }

  return (
    <Fragment>
      <div
        className="mb-5 flex flex-wrap items-start justify-between gap-3"
        data-testid="ai-insights-page-heading"
      >
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {translator.translateText(AI_INSIGHTS_PAGE_TITLE)}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            {translator.translateText(
              AI_INSIGHTS_PAGE_SUBTITLES[props.subjectKind],
            )}
          </p>
        </div>
        <Link
          to={RouteUtil.populateRouteParams(
            RouteMap[descriptor.logsPage] as Route,
          )}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          {translator.translateText("See everything AI did in AI → Logs")}
        </Link>
      </div>

      {body}
    </Fragment>
  );
};

export default IncidentAlertAiInsightsPage;
