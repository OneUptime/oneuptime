import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ClickhouseCapacitySummary from "./ClickhouseCapacitySummary";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";

export interface HealthTool {
  title: string;
  description: string;
  icon: IconProp;
  page: PageMap;
}

/*
 * The OneUptime Health tools that work on every edition, in the order an
 * operator reaches for them: is the disk filling, what did pruning do, are the
 * probes reporting, did the upgrade migrate, and what to send support.
 */
export const EVERY_EDITION_HEALTH_TOOLS: ReadonlyArray<HealthTool> = [
  {
    title: "ClickHouse",
    description:
      "Disk usage per node, capacity notifications and automatic pruning.",
    icon: IconProp.Database,
    page: PageMap.HEALTH_CLICKHOUSE,
  },
  {
    title: "Instance Logs",
    description:
      "Audit trail of capacity notifications and automatic pruning work.",
    icon: IconProp.Logs,
    page: PageMap.HEALTH_INSTANCE_LOGS,
  },
  {
    title: "Global Probes",
    description: "Connectivity and status of the global monitoring probes.",
    icon: IconProp.Signal,
    page: PageMap.HEALTH_PROBES,
  },
  {
    title: "Migrations",
    description: "Database schema migration status and history.",
    icon: IconProp.Database,
    page: PageMap.HEALTH_MIGRATIONS,
  },
  {
    title: "Support Bundle",
    description: "Download a diagnostic bundle to share with support.",
    icon: IconProp.File,
    page: PageMap.HEALTH_SUPPORT_BUNDLE,
  },
];

/*
 * The part of the Health landing page every edition gets: ClickHouse capacity
 * at a glance and the tools that need no Enterprise license. On the Community
 * Edition it is the landing page (under a short Enterprise note); on the
 * Enterprise Edition it sits under the live cluster-health overview.
 */
const CommunityHealthOverview: FunctionComponent = (): ReactElement => {
  return (
    <div>
      <ClickhouseCapacitySummary />

      <Card
        title="Available on every edition"
        description="Capacity, maintenance and support tools for this OneUptime instance."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EVERY_EDITION_HEALTH_TOOLS.map((tool: HealthTool): ReactElement => {
            return (
              <Link
                key={tool.title}
                to={RouteUtil.populateRouteParams(RouteMap[tool.page] as Route)}
                className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
                  <Icon
                    icon={tool.icon}
                    size={SizeProp.Regular}
                    className="h-5 w-5"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-semibold text-gray-900">
                    {tool.title}
                    <Icon
                      icon={IconProp.ChevronRight}
                      size={SizeProp.Small}
                      className="h-3.5 w-3.5 text-gray-400 transition-transform group-hover:translate-x-0.5"
                    />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {tool.description}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

export default CommunityHealthOverview;
