import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import WidgetPlaceholder from "./WidgetPlaceholder";

export interface ComponentProps {
  icon?: IconProp | undefined;
  message?: string | undefined;
}

/*
 * What every external Data Source widget renders on a PUBLIC dashboard.
 * The anonymous public API deliberately exposes no data-source surface —
 * project credentials for a customer's Postgres or Prometheus are not
 * something an unauthenticated viewer gets to reach through — so the widget
 * says so plainly instead of failing a request it should never make, the
 * way every widget a public dashboard cannot draw does (WidgetPlaceholder).
 */
const DataSourceWidgetPlaceholder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <WidgetPlaceholder
      icon={props.icon || IconProp.Database}
      message={
        props.message ||
        "External data sources are not available on public dashboards."
      }
    />
  );
};

export default DataSourceWidgetPlaceholder;
