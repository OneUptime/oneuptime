import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DefaultDashboardSize from "../../Types/Dashboard/DashboardSize";
import DashboardVariable from "../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../Types/JSON";
import {
  AlertImportPlan,
  DashboardImportItem,
  DashboardImportPlan,
  DashboardImportVariable,
  ImportItemStatus,
  ImportQueryOverrides,
  ImportSourceKind,
} from "../../Types/ObservabilityImport/ObservabilityImport";
import {
  convertDatadogDashboard,
  listDatadogDashboardMetricNames,
} from "./Datadog/DatadogDashboard";
import { DatadogMetricKind } from "./Datadog/DatadogPromQL";
import {
  convertDatadogMonitors,
  listDatadogMonitorMetricNames,
} from "./Datadog/DatadogMonitors";
import { convertGrafanaAlertRules } from "./Grafana/GrafanaAlertRules";
import { convertGrafanaDashboard } from "./Grafana/GrafanaDashboard";
import { ImportSourceDocument } from "./ImportSource";
import { convertPrometheusRules } from "./Prometheus/PrometheusRules";

/*
 * THE IMPORT, FROM FILE TO WHAT IS CREATED (issue #7697).
 *
 * planDashboardImport and planAlertImport read a file the person pasted
 * (ImportSource) into a plan: every panel, variable or rule, what it
 * becomes and how exactly. The plan is a pure function of the file and of
 * the queries the person had OneUptime AI convert and chose to use
 * (queryOverrides), so using one converts the file again, with it.
 *
 * buildImportedDashboardViewConfig turns a dashboard plan into the board
 * the dashboard is created with; AlertImportMonitorBuilder each rule into
 * a monitor's steps. Both are created through the same create the forms
 * use, with the person's own permissions.
 */

export interface ImportPlanOptions {
  queryOverrides?: ImportQueryOverrides | undefined;
  // A Datadog dashboard's metrics as the project's data says they are.
  knownMetricKinds?: ReadonlyMap<string, DatadogMetricKind> | undefined;
}

export const planDashboardImport: (
  source: ImportSourceDocument,
  options?: ImportPlanOptions,
) => DashboardImportPlan = (
  source: ImportSourceDocument,
  options?: ImportPlanOptions,
): DashboardImportPlan => {
  const document: ImportSourceDocument["documents"][number] =
    source.documents[0] || {};

  if (source.kind === ImportSourceKind.DatadogDashboard) {
    return convertDatadogDashboard(document, options);
  }

  return convertGrafanaDashboard(document, options);
};

export const planAlertImport: (
  source: ImportSourceDocument,
  options?: ImportPlanOptions,
) => AlertImportPlan = (
  source: ImportSourceDocument,
  options?: ImportPlanOptions,
): AlertImportPlan => {
  if (source.kind === ImportSourceKind.GrafanaAlertRules) {
    return convertGrafanaAlertRules(source.documents, options);
  }

  if (source.kind === ImportSourceKind.DatadogMonitors) {
    return convertDatadogMonitors(source.documents, options);
  }

  return convertPrometheusRules(source.documents, options);
};

/*
 * The Datadog metrics a file reads, by their Datadog names, for the
 * preview to ask the project's metrics whether each is a gauge or a count;
 * none for a file that is not Datadog's.
 */
export const listDatadogMetricNames: (
  source: ImportSourceDocument,
) => Array<string> = (source: ImportSourceDocument): Array<string> => {
  if (source.kind === ImportSourceKind.DatadogDashboard) {
    return listDatadogDashboardMetricNames(source.documents[0] || {});
  }

  if (source.kind === ImportSourceKind.DatadogMonitors) {
    return listDatadogMonitorMetricNames(source.documents);
  }

  return [];
};

// The items a dashboard is created with: each converted one's widget.
export const getCreatedDashboardItems: (
  plan: DashboardImportPlan,
) => Array<DashboardImportItem> = (
  plan: DashboardImportPlan,
): Array<DashboardImportItem> => {
  return plan.items.filter((item: DashboardImportItem): boolean => {
    return (
      item.status !== ImportItemStatus.NotConverted && Boolean(item.component)
    );
  });
};

/*
 * The board a dashboard is created with: the converted items' widgets
 * where the plan placed them, its variables - each starting on the value
 * the preview looked up for it, when the source picks its first value
 * itself (startingValues, by the variable's key) - and the source's time
 * range and refresh.
 */
export const buildImportedDashboardViewConfig: (data: {
  plan: DashboardImportPlan;
  startingValues?: ReadonlyMap<string, string> | undefined;
}) => DashboardViewConfig = (data: {
  plan: DashboardImportPlan;
  startingValues?: ReadonlyMap<string, string> | undefined;
}): DashboardViewConfig => {
  const components: Array<DashboardBaseComponent> = getCreatedDashboardItems(
    data.plan,
  ).map((item: DashboardImportItem): DashboardBaseComponent => {
    return item.component as DashboardBaseComponent;
  });

  const height: number = components.reduce(
    (tallest: number, component: DashboardBaseComponent): number => {
      return Math.max(
        tallest,
        component.topInDashboardUnits + component.heightInDashboardUnits,
      );
    },
    DefaultDashboardSize.heightInDashboardUnits,
  );

  const variables: Array<DashboardVariable> = data.plan.variables
    .filter((item: DashboardImportVariable): boolean => {
      return (
        Boolean(item.variable) && item.status !== ImportItemStatus.NotConverted
      );
    })
    .map((item: DashboardImportVariable): DashboardVariable => {
      const variable: DashboardVariable = {
        ...(item.variable as DashboardVariable),
      };
      const starting: string | undefined = data.startingValues?.get(item.key);

      if (
        starting &&
        !variable.isMultiSelect &&
        (variable.defaultValue === undefined || variable.defaultValue === "")
      ) {
        variable.defaultValue = starting;
      }

      return variable;
    });

  const config: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: height,
  };

  if (variables.length > 0) {
    config.variables = variables;
  }

  if (data.plan.viewConfigDefaults.timeRange) {
    config.timeRange = data.plan.viewConfigDefaults.timeRange;
  }

  if (data.plan.viewConfigDefaults.refreshInterval) {
    config.refreshInterval = data.plan.viewConfigDefaults.refreshInterval;
  }

  return config;
};
