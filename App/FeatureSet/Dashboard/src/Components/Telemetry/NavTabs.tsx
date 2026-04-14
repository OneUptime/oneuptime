import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface TelemetryTab {
  key: string;
  label: string;
  icon: IconProp;
  to: Route;
  badge?: {
    text: string;
    tone?: "default" | "danger" | "warning" | "success";
  };
}

interface Props {
  tabs: Array<TelemetryTab>;
  activeKey: string;
  trailing?: ReactElement | undefined;
}

const BADGE_TONES: Record<string, string> = {
  default: "bg-gray-100 text-gray-700",
  danger: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  success: "bg-emerald-100 text-emerald-700",
};

const TelemetryNavTabs: FunctionComponent<Props> = (
  props: Props,
): ReactElement => {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {props.tabs.map((tab: TelemetryTab): ReactElement => {
          const isActive: boolean = tab.key === props.activeKey;
          const badgeTone: string =
            BADGE_TONES[tab.badge?.tone || "default"] || BADGE_TONES["default"]!;
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
              {tab.badge ? (
                <span
                  className={`ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeTone}`}
                >
                  {tab.badge.text}
                </span>
              ) : (
                <></>
              )}
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

export default TelemetryNavTabs;
