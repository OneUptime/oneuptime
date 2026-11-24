import React, { FunctionComponent, ReactElement } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import WidgetPlaceholder from "./WidgetPlaceholder";

export interface ComponentProps {
  icon?: IconProp | undefined;
  message?: string | undefined;
}

/*
 * What a Data Source widget renders on a PUBLIC dashboard when it has no
 * query it may run there. The anonymous public API reaches no outside
 * system — project credentials for a customer's Postgres or Prometheus are
 * not something an unauthenticated viewer gets to reach through — so the
 * server leaves such a widget out, and serves only those of this project's
 * metrics, whose stored queries its PromQL route runs (issue #10226). A
 * widget that still arrives with nothing to run says so plainly instead of
 * failing a request it should never make, the way every widget a public
 * dashboard cannot draw does (WidgetPlaceholder).
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
