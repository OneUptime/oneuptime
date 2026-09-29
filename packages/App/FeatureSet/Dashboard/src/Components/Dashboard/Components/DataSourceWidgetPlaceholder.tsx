import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface ComponentProps {
  icon?: IconProp | undefined;
  message?: string | undefined;
}

/*
 * What every external Data Source widget renders on a PUBLIC dashboard.
 * The anonymous public API deliberately exposes no data-source surface —
 * project credentials for a customer's Postgres or Prometheus are not
 * something an unauthenticated viewer gets to reach through — so the widget
 * says so plainly instead of failing a request it should never make.
 */
const DataSourceWidgetPlaceholder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-2">
      <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
        <div className="h-5 w-5 text-gray-300">
          <Icon icon={props.icon || IconProp.Database} />
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center max-w-48">
        {props.message ||
          "External data sources are not available on public dashboards."}
      </p>
    </div>
  );
};

export default DataSourceWidgetPlaceholder;
