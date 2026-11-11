import DashboardComponentType from "./DashboardComponentType";
import DashboardVariable, { DashboardVariableType } from "./DashboardVariable";
import { DASHBOARD_WIDGET_SORT_ARGUMENT } from "./DashboardWidgetSort";

/*
 * What a public dashboard serves its visitors of each widget and of each
 * variable (issue #6338): what its page draws them with, and nothing more.
 *
 * /view-config and /overview are public, and everything they send can be
 * read by anyone with the link. A widget's settings (`arguments`) are
 * written by its editor, the API, Terraform, a workflow or a script, and
 * can hold what the page never draws: a log chart's search text and
 * attribute filters, a trace table's span names, a script that is not
 * allowed to run, a key a script left there - and a legacy Query
 * variable holds a ClickHouse query no toolbar runs. So the server
 * (PublicDashboardViewConfig.sanitize) serves each widget only the
 * settings named here for its type, and each variable only the fields
 * named here for its type, each as stored.
 *
 * Every setting the public page reads is among them, so it draws every
 * widget exactly as before. So is every setting a public route reads:
 * the routes read the same served config (PublicDashboardViewConfig
 * .getDrawnConfig), so what the page draws is what they answer.
 *
 * Every setting a widget type has is decided here, served or withheld,
 * and every field a variable has: PublicDashboardServedSettings.test.ts
 * reads each widget type's declared settings, the settings its editor
 * writes and its sort, and each field of a variable, and fails for one
 * that is decided nowhere - so a widget type, a setting or a field added
 * later is decided the day it is added.
 */

/*
 * The widgets a public dashboard cannot draw: its API reads no logs, no
 * traces, no security events and no product analytics. Each says so in its
 * place, under its title ("Log charts are not available on public
 * dashboards."), and its title is all it is served. The external Data
 * Source widgets are not among them: a public dashboard leaves them out
 * altogether, because their settings are the query itself
 * (PublicDashboardViewConfig.sanitize). The page lays out both kinds as
 * the words they are (PublicDashboardContext.isWidgetDrawnHere).
 */
export const PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES: ReadonlyArray<DashboardComponentType> =
  [
    DashboardComponentType.LogChart,
    DashboardComponentType.TraceChart,
    DashboardComponentType.TraceTable,
    DashboardComponentType.SecurityEventsList,
    DashboardComponentType.SecurityEventsFlow,
    /*
     * A saved funnel's or retention table's people are an application's end
     * users, read only by those who may list its sessions (issue #6630).
     */
    DashboardComponentType.ProductAnalyticsFunnel,
    DashboardComponentType.ProductAnalyticsRetention,
  ];

/*
 * Whether a stored widget type is one a public dashboard cannot draw.
 * Matched exactly, as every board matches a type: " LogChart " is no type
 * any board draws.
 */
export function isPublicDashboardUndrawnWidgetType(
  componentType: unknown,
): boolean {
  return (
    typeof componentType === "string" &&
    (PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES as ReadonlyArray<string>).includes(
      componentType,
    )
  );
}

// What a public dashboard serves of one widget type's settings.
export interface PublicDashboardWidgetSettings {
  /*
   * The settings served as they are stored: those the public page draws
   * the widget with, and those the public routes answer it with.
   */
  served: ReadonlyArray<string>;
  /*
   * Settings served only while the setting named beside each is on - read
   * as the page reads it, by whether it holds anything - because the page
   * draws them only then.
   */
  servedWhileOn?: Readonly<Record<string, string>> | undefined;
  /*
   * The settings never served: the page does not draw the widget with
   * them on a public dashboard, and no public route reads them.
   */
  withheld: ReadonlyArray<string>;
}

/*
 * Every widget type a public dashboard serves: all but the external Data
 * Source widgets, which it leaves out whole.
 */
export type PublicDashboardServedWidgetType = Exclude<
  DashboardComponentType,
  | DashboardComponentType.DataSourceChart
  | DashboardComponentType.DataSourceValue
  | DashboardComponentType.DataSourceGauge
  | DashboardComponentType.DataSourceTable
>;

// A widget's own sort, which its list's headers start on (issue #5082).
const SORT: string = DASHBOARD_WIDGET_SORT_ARGUMENT;

/*
 * What every list widget is drawn with: its title, how many rows it
 * shows, a list or a honeycomb, and its own sort. The server reads the
 * row count and the sort too, to read the list.
 */
const LIST: ReadonlyArray<string> = ["title", "maxRows", "viewMode", SORT];

type DrawnWidgetSettingsFunction = (
  served: ReadonlyArray<string>,
) => PublicDashboardWidgetSettings;

/*
 * A widget the page draws: it is served every setting it has. Each one
 * shapes what the page draws, or what a public route reads the widget's
 * data with: a list's filters scope the rows the server lists, a chart's
 * queries the metrics the server answers.
 */
const drawn: DrawnWidgetSettingsFunction = (
  served: ReadonlyArray<string>,
): PublicDashboardWidgetSettings => {
  return { served: served, withheld: [] };
};

type UndrawnWidgetSettingsFunction = (
  withheld: ReadonlyArray<string>,
) => PublicDashboardWidgetSettings;

/*
 * A widget the page cannot draw is served its title, which the page draws
 * above the note saying it is not available on public dashboards. What it
 * would read its data with - the search text, the filters, the grouping,
 * the colors, the sort - stays on the server: the page reads none of it
 * there, and no public route answers such a widget.
 */
const undrawn: UndrawnWidgetSettingsFunction = (
  withheld: ReadonlyArray<string>,
): PublicDashboardWidgetSettings => {
  return { served: ["title"], withheld: withheld };
};

/*
 * The settings each widget type is served, in the order its type declares
 * them (Types/Dashboard/DashboardComponents). A key a widget type does
 * not have - a misspelt setting, one a script added, one an older version
 * wrote - is never served: no board reads it.
 */
export const PUBLIC_DASHBOARD_WIDGET_SETTINGS: Readonly<
  Record<PublicDashboardServedWidgetType, PublicDashboardWidgetSettings>
> = {
  [DashboardComponentType.Chart]: drawn([
    "metricQueryConfig",
    "metricQueryConfigs",
    "metricFormulaConfigs",
    "chartTitle",
    "chartDescription",
    "chartType",
  ]),
  [DashboardComponentType.Value]: drawn([
    "metricQueryConfig",
    "title",
    "warningThreshold",
    "criticalThreshold",
    "trendDirection",
    "hideUnit",
  ]),
  [DashboardComponentType.Text]: drawn([
    "text",
    "isBold",
    "isItalic",
    "isUnderline",
    "isMarkdown",
  ]),
  [DashboardComponentType.Clock]: drawn([
    "timezone",
    "label",
    "clockFace",
    "hourFormat",
    "showSeconds",
    "showDate",
    "showTimezoneAbbreviation",
  ]),
  [DashboardComponentType.Table]: drawn([
    "columns",
    "groupByAttributes",
    "groupByAttributeKeys",
    "tableTitle",
    "tableDescription",
    "maxRows",
    "reduce",
    "decimals",
    "thresholdStyle",
    "attributeFilters",
    "metricQueryConfig",
    "metricQueryConfigs",
    "metricFormulaConfigs",
    SORT,
  ]),
  [DashboardComponentType.Gauge]: drawn([
    "metricQueryConfig",
    "gaugeTitle",
    "minValue",
    "maxValue",
    "warningThreshold",
    "criticalThreshold",
  ]),
  /*
   * Its filters are the logs the server lists for it (the log resource of
   * /resource-list), so the page and the server read them alike.
   */
  [DashboardComponentType.LogStream]: drawn([
    "title",
    "severityFilter",
    "bodyContains",
    "attributeFilterQuery",
    "maxRows",
  ]),
  [DashboardComponentType.LogChart]: undrawn([
    "chartType",
    "severityFilters",
    "bodyContains",
    "attributeFilters",
    "attributeFilterQuery",
  ]),
  [DashboardComponentType.SecurityEventsList]: undrawn([
    "severityFilters",
    "classNameFilters",
    "messageContains",
    "limit",
    SORT,
  ]),
  [DashboardComponentType.SecurityEventsFlow]: undrawn([
    "severityFilters",
    "maxEvents",
  ]),
  [DashboardComponentType.ProductAnalyticsFunnel]: undrawn(["savedViewId"]),
  [DashboardComponentType.ProductAnalyticsRetention]: undrawn(["savedViewId"]),
  [DashboardComponentType.TraceList]: drawn([
    "title",
    "statusFilter",
    "maxRows",
    "viewMode",
    SORT,
  ]),
  [DashboardComponentType.TraceChart]: undrawn([
    "metric",
    "spanNameContains",
    "attributeFilters",
    "groupByAttribute",
    "topLimit",
    "color",
    "colorsByGroup",
    "includeChildSpans",
  ]),
  [DashboardComponentType.TraceTable]: undrawn([
    "spanNameContains",
    "attributeFilters",
    "groupByAttribute",
    "topLimit",
    "includeChildSpans",
    SORT,
  ]),
  [DashboardComponentType.IncidentList]: drawn([
    ...LIST,
    "stateFilter",
    "severityIds",
    "stateIds",
    "monitorIds",
    "labelIds",
  ]),
  [DashboardComponentType.AlertList]: drawn([
    ...LIST,
    "stateFilter",
    "severityIds",
    "stateIds",
    "monitorIds",
    "labelIds",
  ]),
  [DashboardComponentType.MonitorList]: drawn([
    ...LIST,
    "statusFilter",
    "monitorStatusIds",
    "monitorTypes",
    "labelIds",
    "labelVariableId",
  ]),
  [DashboardComponentType.Slo]: drawn([
    "serviceLevelObjectiveId",
    "serviceLevelObjectiveVariableId",
    "sloMetric",
    "displayType",
    "widgetTitle",
  ]),
  [DashboardComponentType.SloList]: drawn([
    ...LIST,
    "sloStatuses",
    "labelIds",
    "labelVariableId",
  ]),
  [DashboardComponentType.KubernetesPodList]: drawn([
    ...LIST,
    "kubernetesClusterIds",
    "namespaces",
    "podPhases",
  ]),
  [DashboardComponentType.KubernetesNodeList]: drawn([
    ...LIST,
    "kubernetesClusterIds",
    "readinessFilter",
  ]),
  [DashboardComponentType.KubernetesNamespaceList]: drawn([
    ...LIST,
    "kubernetesClusterIds",
  ]),
  [DashboardComponentType.KubernetesDeploymentList]: drawn([
    ...LIST,
    "kubernetesClusterIds",
    "namespaces",
  ]),
  [DashboardComponentType.KubernetesStatefulSetList]: drawn([
    ...LIST,
    "kubernetesClusterIds",
    "namespaces",
  ]),
  [DashboardComponentType.KubernetesDaemonSetList]: drawn([
    ...LIST,
    "kubernetesClusterIds",
    "namespaces",
  ]),
  [DashboardComponentType.KubernetesJobList]: drawn([
    ...LIST,
    "kubernetesClusterIds",
    "namespaces",
  ]),
  [DashboardComponentType.KubernetesCronJobList]: drawn([
    ...LIST,
    "kubernetesClusterIds",
    "namespaces",
  ]),
  [DashboardComponentType.DockerHostList]: drawn([...LIST, "statusFilter"]),
  [DashboardComponentType.DockerContainerList]: drawn([
    ...LIST,
    "dockerHostIds",
    "imageName",
  ]),
  [DashboardComponentType.DockerImageList]: drawn([
    ...LIST,
    "dockerHostIds",
    "nameSearch",
  ]),
  [DashboardComponentType.DockerNetworkList]: drawn([...LIST, "dockerHostIds"]),
  [DashboardComponentType.DockerVolumeList]: drawn([...LIST, "dockerHostIds"]),
  [DashboardComponentType.PodmanHostList]: drawn([...LIST, "statusFilter"]),
  [DashboardComponentType.PodmanContainerList]: drawn([
    ...LIST,
    "podmanHostIds",
    "imageName",
  ]),
  [DashboardComponentType.PodmanImageList]: drawn([
    ...LIST,
    "podmanHostIds",
    "nameSearch",
  ]),
  [DashboardComponentType.PodmanNetworkList]: drawn([...LIST, "podmanHostIds"]),
  [DashboardComponentType.PodmanVolumeList]: drawn([...LIST, "podmanHostIds"]),
  [DashboardComponentType.HostList]: drawn([
    ...LIST,
    "statusFilter",
    "osTypeFilter",
  ]),
  [DashboardComponentType.ProxmoxNodeList]: drawn([
    ...LIST,
    "proxmoxClusterIds",
    "statusFilter",
  ]),
  [DashboardComponentType.ProxmoxGuestList]: drawn([
    ...LIST,
    "proxmoxClusterIds",
    "guestTypeFilter",
    "statusFilter",
  ]),
  [DashboardComponentType.VMwareHostList]: drawn([...LIST, "vmwareVCenterIds"]),
  [DashboardComponentType.VMwareVirtualMachineList]: drawn([
    ...LIST,
    "vmwareVCenterIds",
    "powerStateFilter",
    "templateFilter",
  ]),
  [DashboardComponentType.DockerSwarmNodeList]: drawn([
    ...LIST,
    "dockerSwarmClusterIds",
    "roleFilter",
    "statusFilter",
  ]),
  [DashboardComponentType.DockerSwarmServiceList]: drawn([
    ...LIST,
    "dockerSwarmClusterIds",
    "serviceModeFilter",
    "statusFilter",
  ]),
  [DashboardComponentType.CephOsdList]: drawn([
    ...LIST,
    "cephClusterIds",
    "stateFilter",
  ]),
  [DashboardComponentType.CephPoolList]: drawn([...LIST, "cephClusterIds"]),
  [DashboardComponentType.StorageArrayVolumeList]: drawn([
    ...LIST,
    "storageArrayIds",
  ]),
  [DashboardComponentType.StorageArrayHardwareList]: drawn([
    ...LIST,
    "storageArrayIds",
    "kindFilter",
    "statusFilter",
  ]),
  [DashboardComponentType.NetworkMap]: drawn([
    "title",
    "maxSites",
    "networkSiteTypeIds",
    "statusFilter",
    "viewMode",
    "showLabels",
  ]),
  /*
   * Its script only while scripts may run: with them off, the page builds
   * the widget's document without it (HtmlWidgetDocument.build), so that
   * the author's code is not left in view-source - and so it is not left
   * in what the page is served either.
   */
  [DashboardComponentType.Html]: {
    served: ["html", "css", "allowScripts", "allowForms", "allowPopups"],
    servedWhileOn: { javascript: "allowScripts" },
    withheld: [],
  },
};

/*
 * What a public dashboard serves of one widget type's settings, or
 * nothing for a type it serves none of: a Data Source widget, a type no
 * board draws, no type at all.
 */
export function getPublicDashboardWidgetSettingsDecision(
  componentType: unknown,
): PublicDashboardWidgetSettings | null {
  if (
    typeof componentType !== "string" ||
    !Object.prototype.hasOwnProperty.call(
      PUBLIC_DASHBOARD_WIDGET_SETTINGS,
      componentType,
    )
  ) {
    return null;
  }

  return PUBLIC_DASHBOARD_WIDGET_SETTINGS[
    componentType as PublicDashboardServedWidgetType
  ];
}

/*
 * A widget's settings as a public dashboard serves them: the settings its
 * type is served, each exactly as stored, and nothing else - a new object;
 * the settings handed in are not changed. A type that is served none
 * comes back with none.
 */
export function getPublicDashboardWidgetSettings(
  componentType: unknown,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const decision: PublicDashboardWidgetSettings | null =
    getPublicDashboardWidgetSettingsDecision(componentType);

  const served: Record<string, unknown> = {};

  if (!decision) {
    return served;
  }

  const serve: (key: string) => void = (key: string): void => {
    if (
      Object.prototype.hasOwnProperty.call(settings, key) &&
      settings[key] !== undefined
    ) {
      served[key] = settings[key];
    }
  };

  for (const key of decision.served) {
    serve(key);
  }

  for (const [key, condition] of Object.entries(decision.servedWhileOn || {})) {
    if (settings[condition]) {
      serve(key);
    }
  }

  return served;
}

/*
 * The fields every dashboard variable is served: the id the page and the
 * routes know it by, the name links and placeholders use (?var-<name>=),
 * the label and type its picker is drawn with, and its pick - what the
 * toolbar starts on, and what the widgets and the routes filter by.
 */
export const PUBLIC_DASHBOARD_VARIABLE_FIELDS: ReadonlyArray<
  keyof DashboardVariable
> = [
  "id",
  "name",
  "label",
  "type",
  "selectedValue",
  "selectedValues",
  "isMultiSelect",
  "defaultValue",
];

/*
 * The fields each type of variable is served besides those: what its
 * picker lists, and what its pick filters on.
 */
export const PUBLIC_DASHBOARD_VARIABLE_TYPE_FIELDS: Readonly<
  Record<DashboardVariableType, ReadonlyArray<keyof DashboardVariable>>
> = {
  // Its values, the choices it lists.
  [DashboardVariableType.CustomList]: ["customListValues"],
  // A text box, or, when it holds values, a list of them.
  [DashboardVariableType.TextInput]: ["customListValues"],
  /*
   * The same: the toolbar never runs a legacy Query variable's query
   * ("Query option loading is not supported"), so it is never served.
   */
  [DashboardVariableType.Query]: ["customListValues"],
  /*
   * The attribute its choices are the values of (/attribute-values), and
   * its pick filters every widget on.
   */
  [DashboardVariableType.TelemetryAttribute]: ["attributeKey"],
  // The labels it offers, by their names.
  [DashboardVariableType.ProjectLabel]: ["labelOptions"],
};

/*
 * A variable of a type this version does not know, or of none, is drawn
 * as a text box, or as a list of its values when it holds some.
 */
export const PUBLIC_DASHBOARD_UNKNOWN_VARIABLE_TYPE_FIELDS: ReadonlyArray<
  keyof DashboardVariable
> = ["customListValues"];

/*
 * The fields of a variable that are never served to any type of it: a
 * legacy Query variable's ClickHouse query.
 */
export const PUBLIC_DASHBOARD_WITHHELD_VARIABLE_FIELDS: ReadonlyArray<
  keyof DashboardVariable
> = ["query"];

/*
 * The fields a variable of this type is served: every variable's, and
 * its own type's.
 */
export function getPublicDashboardVariableFields(
  type: unknown,
): ReadonlyArray<keyof DashboardVariable> {
  const typeFields: ReadonlyArray<keyof DashboardVariable> =
    typeof type === "string" &&
    Object.prototype.hasOwnProperty.call(
      PUBLIC_DASHBOARD_VARIABLE_TYPE_FIELDS,
      type,
    )
      ? PUBLIC_DASHBOARD_VARIABLE_TYPE_FIELDS[type as DashboardVariableType]
      : PUBLIC_DASHBOARD_UNKNOWN_VARIABLE_TYPE_FIELDS;

  return [...PUBLIC_DASHBOARD_VARIABLE_FIELDS, ...typeFields];
}

/*
 * A variable as a public dashboard serves it: the fields its type is
 * served, each exactly as handed in - a variable as the toolbar reads it
 * (StoredDashboardViewConfig.readBoardSettings) - and nothing else. A new
 * object; the variable handed in is not changed.
 */
export function getPublicDashboardVariable(
  variable: DashboardVariable,
): DashboardVariable {
  const source: Record<string, unknown> = variable as unknown as Record<
    string,
    unknown
  >;
  const served: Record<string, unknown> = {};

  for (const field of getPublicDashboardVariableFields(source["type"])) {
    if (
      Object.prototype.hasOwnProperty.call(source, field) &&
      source[field] !== undefined
    ) {
      served[field] = source[field];
    }
  }

  return served as unknown as DashboardVariable;
}
