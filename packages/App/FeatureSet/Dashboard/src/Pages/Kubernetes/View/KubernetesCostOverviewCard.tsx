import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import StatTilesSkeleton from "Common/UI/Components/Skeleton/StatTilesSkeleton";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import TableEmptyState, {
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import { KUBERNETES_COST_OVERVIEW_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getKubernetesAgentUpgradeCommand } from "../Utils/DocumentationMarkdown";
import { getKubernetesPartRoute } from "../Utils/KubernetesPartRoutes";
import {
  CostOverviewNamespace,
  CostOverviewWorkload,
  KubernetesCostOverview,
  fetchKubernetesCostOverview,
} from "../Utils/KubernetesCostOverview";
import { formatCost, formatEfficiency } from "../Utils/KubernetesCostUtils";
import {
  getNamespaceElement,
  getTotalCostElement,
} from "../Utils/KubernetesCostTableCells";

/*
 * A CLUSTER OVERVIEW'S COST (#9548).
 *
 * What the cluster costs, how much of it pays for capacity nothing uses, how
 * well the rest is used, and who spends the most - read from the cost agent's
 * hourly allocations (Utils/KubernetesCostOverview), with View Costs to the
 * Costs page for any range and the breakdowns.
 *
 * Cost monitoring is on by default in the Kubernetes agent, so a cluster
 * that sent nothing in a week is the exception the card explains: an older
 * agent, cost turned off, or a gke-autopilot or eks-fargate preset, where it
 * is off by default. It says so where the figures would be, with the one
 * command that turns it on.
 *
 * The figures are "now" snapshots, like the inventory counts: they do not
 * follow the page's range. Cost changes once an hour, so a page that
 * refreshes every few seconds reads it again at most every five minutes.
 */

export const KUBERNETES_COST_OVERVIEW_TEST_ID: string =
  "kubernetes-cost-overview";

// The English page, named outright (see KUBERNETES_AGENT_DOCS_ROUTE).
export const KUBERNETES_COST_DOCS_ROUTE: string =
  "/docs/en/telemetry/kubernetes-cost";

export const KUBERNETES_COST_ENABLE_COMMAND: string =
  getKubernetesAgentUpgradeCommand(["--set cost.enabled=true"]);

// How long a load stands before a page refresh reads the cost again.
export const COST_OVERVIEW_RELOAD_AFTER_MS: number = 5 * 60 * 1000;

const NO_COST_TITLE: string = translationKey(
  "No cost data from this cluster yet",
);
/*
 * Within an empty state's two short lines (ShortDescriptionsGuard): the
 * upgrade command under it, and the Kubernetes Cost docs it links to, say
 * the rest - OpenCost's prices, and an older agent or one with cost off.
 */
const NO_COST_DESCRIPTION: string = translationKey(
  "The Kubernetes agent sends costs by default, except on the {{autopilot}} and {{fargate}} presets. Upgrade with {{flag}}; costs appear within the hour.",
);
// The run-rate's line once a whole week of hours is in it.
const FULL_WEEK_RUN_RATE: string = translationKey(
  "at the last 7 days' hourly rate",
);
const CHECK_AGAIN: string = translationKey("Check again");
const CHECKING: string = translationKey("Checking…");
const VIEW_DOCUMENTATION: string = translationKey("View Documentation");

/*
 * The page each workload kind the cost engine names has, by the name the
 * Kubernetes pages give it. A kind with no page (a ReplicaSet of its own,
 * an Argo Rollout) is shown, not linked.
 */
const WORKLOAD_KINDS: Record<string, string> = {
  deployment: "Deployment",
  statefulset: "StatefulSet",
  daemonset: "DaemonSet",
  job: "Job",
  cronjob: "CronJob",
  replicaset: "ReplicaSet",
  pod: "Pod",
};

export function getWorkloadKindName(controllerKind: string): string {
  return WORKLOAD_KINDS[controllerKind.trim().toLowerCase()] || controllerKind;
}

function getCodeElement(text: string): ReactElement {
  return (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-700">
      {text}
    </code>
  );
}

const NamespaceRow: FunctionComponent<{
  clusterId: ObjectID;
  row: CostOverviewNamespace;
  total: number;
}> = (props: {
  clusterId: ObjectID;
  row: CostOverviewNamespace;
  total: number;
}): ReactElement => {
  const route: Route | undefined = getKubernetesPartRoute(props.clusterId, {
    kind: "Namespace",
    name: props.row.namespace,
  });

  return (
    <li
      className="flex items-center justify-between gap-3 py-2.5"
      data-testid={`${KUBERNETES_COST_OVERVIEW_TEST_ID}-namespace`}
    >
      <div className="min-w-0 flex-1">
        {route ? (
          <Link
            to={route}
            className="block truncate text-sm font-medium text-gray-900 hover:text-indigo-700"
          >
            {props.row.namespace}
          </Link>
        ) : (
          <span className="block truncate text-sm font-medium text-gray-900">
            {props.row.namespace}
          </span>
        )}
      </div>
      {getTotalCostElement(props.row.totalCost, props.total)}
    </li>
  );
};

const WorkloadRow: FunctionComponent<{
  clusterId: ObjectID;
  row: CostOverviewWorkload;
  total: number;
}> = (props: {
  clusterId: ObjectID;
  row: CostOverviewWorkload;
  total: number;
}): ReactElement => {
  const kind: string = getWorkloadKindName(props.row.controllerKind);
  const route: Route | undefined = props.row.controllerName
    ? getKubernetesPartRoute(props.clusterId, {
        kind: kind,
        name: props.row.controllerName,
        namespace: props.row.namespace,
      })
    : undefined;
  const name: string = props.row.controllerName || props.row.namespace;

  return (
    <li
      className="flex items-center justify-between gap-3 py-2.5"
      data-testid={`${KUBERNETES_COST_OVERVIEW_TEST_ID}-workload`}
    >
      <div className="min-w-0 flex-1">
        {route ? (
          <Link
            to={route}
            className="block truncate text-sm font-medium text-gray-900 hover:text-indigo-700"
          >
            {name}
          </Link>
        ) : (
          <span className="block truncate text-sm font-medium text-gray-900">
            {name}
          </span>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {kind ? (
            <span className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {kind}
            </span>
          ) : (
            <></>
          )}
          {props.row.controllerName ? (
            getNamespaceElement(props.row.namespace)
          ) : (
            <></>
          )}
        </div>
      </div>
      {getTotalCostElement(props.row.totalCost, props.total)}
    </li>
  );
};

const TopList: FunctionComponent<{
  title: string;
  icon: IconProp;
  description: string;
  children: Array<ReactElement>;
}> = (props: {
  title: string;
  icon: IconProp;
  description: string;
  children: Array<ReactElement>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <Icon icon={props.icon} className="h-4 w-4 text-gray-500" />
        <h4 className="text-sm font-semibold text-gray-900">
          {translator.translateText(props.title)}
        </h4>
      </div>
      <p className="text-xs text-gray-500">
        {translator.translateText(props.description)}
      </p>
      <ul className="mt-2 divide-y divide-gray-100">{props.children}</ul>
    </div>
  );
};

export interface ComponentProps {
  clusterId: ObjectID;
  /*
   * Bumped by the page's refresh: the card reads the cost again when its
   * figures are older than COST_OVERVIEW_RELOAD_AFTER_MS.
   */
  refreshToken?: number | undefined;
  // Tests: the clock the windows end at.
  getNow?: (() => Date) | undefined;
}

const KubernetesCostOverviewCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [overview, setOverview] = useState<KubernetesCostOverview | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const loadedAtMs: React.MutableRefObject<number> = useRef<number>(0);

  const load: (data: { isCheck: boolean }) => Promise<void> = useCallback(
    async (data: { isCheck: boolean }): Promise<void> => {
      if (data.isCheck) {
        setIsChecking(true);
      }

      try {
        const now: Date = props.getNow ? props.getNow() : new Date();
        const read: KubernetesCostOverview = await fetchKubernetesCostOverview({
          kubernetesClusterId: props.clusterId,
          now: now,
        });
        setOverview(read);
        setError("");
        loadedAtMs.current = now.getTime();
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
      setIsChecking(false);
    },
    [props.clusterId.toString()],
  );

  useEffect(() => {
    void load({ isCheck: false });
  }, [props.clusterId.toString()]);

  useEffect(() => {
    if (props.refreshToken === undefined || !loadedAtMs.current) {
      return;
    }

    const now: number = props.getNow ? props.getNow().getTime() : Date.now();

    if (now - loadedAtMs.current >= COST_OVERVIEW_RELOAD_AFTER_MS) {
      void load({ isCheck: false });
    }
  }, [props.refreshToken]);

  const costsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_COSTS] as Route,
    { modelId: props.clusterId },
  );

  const renderBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="space-y-6">
          <StatTilesSkeleton kind="golden" count={4} />
          <TableSkeleton rows={5} columns={2} hasHeader={false} />
        </div>
      );
    }

    if (error) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            setIsLoading(true);
            void load({ isCheck: false });
          }}
        />
      );
    }

    if (!overview || !overview.hasData) {
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.Billing}
          title={NO_COST_TITLE}
          description={
            <TranslatedSentence
              template={NO_COST_DESCRIPTION}
              slots={{
                autopilot: getCodeElement("gke-autopilot"),
                fargate: getCodeElement("eks-fargate"),
                flag: getCodeElement("cost.enabled=true"),
              }}
            />
          }
          body={
            <div data-testid={`${KUBERNETES_COST_OVERVIEW_TEST_ID}-command`}>
              <CodeBlock
                language="bash"
                code={KUBERNETES_COST_ENABLE_COMMAND}
              />
            </div>
          }
          actions={[
            {
              title: isChecking ? CHECKING : CHECK_AGAIN,
              icon: IconProp.Refresh,
              isLoading: isChecking,
              onClick: () => {
                void load({ isCheck: true });
              },
              dataTestId: `${KUBERNETES_COST_OVERVIEW_TEST_ID}-check-again`,
            },
            {
              title: VIEW_DOCUMENTATION,
              icon: IconProp.Book,
              style: TableEmptyStateActionStyle.Link,
              onClick: () => {
                Navigation.navigate(
                  Route.fromString(KUBERNETES_COST_DOCS_ROUTE),
                  { openInNewTab: true },
                );
              },
              dataTestId: `${KUBERNETES_COST_OVERVIEW_TEST_ID}-docs`,
            },
          ]}
          dataTestId={`${KUBERNETES_COST_OVERVIEW_TEST_ID}-empty`}
        />
      );
    }

    const showsLastDay: boolean = overview.hasRecentData;
    const runRateSublabel: string =
      overview.runRateHours >= 7 * 24
        ? FULL_WEEK_RUN_RATE
        : translator.translatePlural(
            {
              one: "from {{count}} hour of cost data",
              other: "from {{count}} hours of cost data",
            },
            overview.runRateHours,
          );

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <GoldenMetricTile
            title="Last 24 Hours"
            icon={IconProp.CurrencyDollar}
            iconColor="emerald"
            value={showsLastDay ? formatCost(overview.lastDaySpend) : undefined}
            sublabel="spend, idle capacity included"
            description={KUBERNETES_COST_OVERVIEW_DESCRIPTIONS.lastDaySpend}
          />
          <GoldenMetricTile
            title="Monthly Run-Rate"
            icon={IconProp.Calendar}
            iconColor="blue"
            value={
              overview.monthlyRunRate === null
                ? undefined
                : formatCost(overview.monthlyRunRate)
            }
            sublabel={runRateSublabel}
            description={KUBERNETES_COST_OVERVIEW_DESCRIPTIONS.monthlyRunRate}
          />
          <GoldenMetricTile
            title="Idle Spend"
            icon={IconProp.Clock}
            iconColor="amber"
            value={
              showsLastDay ? formatCost(overview.lastDayIdleSpend) : undefined
            }
            sublabel={
              showsLastDay && overview.idlePercent !== null
                ? translator.translateTemplate("{{percent}} of the spend", {
                    percent: formatEfficiency(overview.idlePercent / 100),
                  })
                : "provisioned but unused"
            }
            percent={showsLastDay ? overview.idlePercent : null}
            thresholds={{ warn: 25, danger: 40 }}
            description={KUBERNETES_COST_OVERVIEW_DESCRIPTIONS.idleSpend}
          />
          <GoldenMetricTile
            title="Efficiency"
            icon={IconProp.ChartPie}
            iconColor="violet"
            value={
              showsLastDay && overview.efficiency !== null
                ? formatEfficiency(overview.efficiency)
                : undefined
            }
            sublabel="of requested CPU and memory used"
            percent={
              showsLastDay && overview.efficiency !== null
                ? Math.min(100, overview.efficiency * 100)
                : null
            }
            thresholds={{ warn: 70, danger: 40 }}
            higherIsBetter={true}
            description={KUBERNETES_COST_OVERVIEW_DESCRIPTIONS.efficiency}
          />
        </div>

        {!showsLastDay && overview.newestWindowStart ? (
          <p
            className="text-sm text-amber-700"
            data-testid={`${KUBERNETES_COST_OVERVIEW_TEST_ID}-stale`}
          >
            <TranslatedSentence
              template="No cost has arrived from this cluster in the last 24 hours; the newest is from {{time}}. Check that the agent's cost pods are running: {{docs}}"
              slots={{
                time: (
                  <span>
                    {OneUptimeDate.fromNow(overview.newestWindowStart)}
                  </span>
                ),
                docs: (
                  <Link
                    to={Route.fromString(
                      `${KUBERNETES_COST_DOCS_ROUTE}#troubleshooting`,
                    )}
                    openInNewTab={true}
                    className="font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {translator.translateText("Troubleshooting")}
                  </Link>
                ),
              }}
            />
          </p>
        ) : (
          <></>
        )}

        {showsLastDay ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TopList
              title="Top Namespaces"
              icon={IconProp.Folder}
              description="Highest spend in the last 24 hours, and its share of the cluster's."
            >
              {overview.topNamespaces.map(
                (row: CostOverviewNamespace): ReactElement => {
                  return (
                    <NamespaceRow
                      key={row.namespace}
                      clusterId={props.clusterId}
                      row={row}
                      total={overview.lastDaySpend}
                    />
                  );
                },
              )}
            </TopList>
            <TopList
              title="Top Workloads"
              icon={IconProp.Cube}
              description="Highest spend in the last 24 hours, and its share of what workloads spent."
            >
              {overview.topWorkloads.map(
                (row: CostOverviewWorkload): ReactElement => {
                  return (
                    <WorkloadRow
                      key={JSON.stringify([
                        row.namespace,
                        row.controllerKind,
                        row.controllerName,
                      ])}
                      clusterId={props.clusterId}
                      row={row}
                      total={overview.lastDayWorkloadSpend}
                    />
                  );
                },
              )}
            </TopList>
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div data-testid={KUBERNETES_COST_OVERVIEW_TEST_ID}>
      <Card
        title="Cost"
        description="What this cluster costs, priced by its cost engine from the agent's hourly cost data."
        buttons={[
          {
            title: "View Costs",
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.ArrowRight,
            onClick: () => {
              Navigation.navigate(costsRoute);
            },
          },
        ]}
      >
        {renderBody()}
      </Card>
    </div>
  );
};

export default KubernetesCostOverviewCard;
