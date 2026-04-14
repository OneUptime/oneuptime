import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export type MetricsTabKey = "viewer" | "insights" | "setup";

interface Props {
  active: MetricsTabKey;
  /** Optional content rendered to the right of the tabs (e.g. action buttons). */
  trailing?: ReactElement | undefined;
}

interface TabSpec {
  key: MetricsTabKey;
  label: string;
  icon: IconProp;
  to: Route;
}

const MetricsNavTabs: FunctionComponent<Props> = (props: Props): ReactElement => {
  const tabs: Array<TabSpec> = [
    {
      key: "viewer",
      label: "Viewer",
      icon: IconProp.List,
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.METRICS] as Route),
    },
    {
      key: "insights",
      label: "Insights",
      icon: IconProp.ChartBar,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.METRICS_LIST] as Route,
      ),
    },
    {
      key: "setup",
      label: "Setup Guide",
      icon: IconProp.Book,
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.METRICS_DOCUMENTATION] as Route,
      ),
    },
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {tabs.map((tab: TabSpec) => {
          const isActive: boolean = tab.key === props.active;
          return (
            <AppLink
              key={tab.key}
              to={tab.to}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon icon={tab.icon} className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </AppLink>
          );
        })}
      </nav>
      {props.trailing ? (
        <div className="flex items-center gap-2">{props.trailing}</div>
      ) : null}
    </div>
  );
};

export default MetricsNavTabs;
