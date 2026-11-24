import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import DataSourceType from "Common/Types/DataSource/DataSourceType";
import { ProjectMetricsDataSourceUtil } from "Common/Types/DataSource/ProjectMetricsDataSource";
import DataSourceQueryText from "Common/Utils/DataSource/DataSourceQueryText";
import DataSourceTypes from "./DataSourceTypes";

/*
 * A Data Source widget's query with the dashboard's variables filled in the
 * way its source reads them (DataSourceQueryText.applyVariablesForSource):
 * PromQL over the project's own metrics or over an outside Prometheus as
 * Grafana's Prometheus data source fills them - several values match any
 * one, a variable on All matches every value (issue #10326) - and any other
 * source as text.
 *
 * An outside source's type is read once a page (DataSourceTypes), and only
 * for a query that names a variable: then the answer is a promise. Any
 * other query is answered at once, as a string, so a widget sends it in
 * the same tick it was asked to, as it always did.
 */
export const fillDataSourceVariables: (data: {
  queryConfig: DataSourceQueryConfig;
  variables: Array<DashboardVariable> | undefined;
}) => string | Promise<string> = (data: {
  queryConfig: DataSourceQueryConfig;
  variables: Array<DashboardVariable> | undefined;
}): string | Promise<string> => {
  const query: string = data.queryConfig.query;
  const dataSourceId: string = data.queryConfig.dataSourceId;

  if (
    !query ||
    !query.includes("{{") ||
    !data.variables ||
    data.variables.length === 0 ||
    ProjectMetricsDataSourceUtil.isProjectMetrics(dataSourceId)
  ) {
    return DataSourceQueryText.applyVariablesForSource({
      dataSourceId,
      queryText: query,
      variables: data.variables,
    });
  }

  return DataSourceTypes.getType(dataSourceId).then(
    (dataSourceType: DataSourceType | undefined): string => {
      return DataSourceQueryText.applyVariablesForSource({
        dataSourceId,
        dataSourceType,
        queryText: query,
        variables: data.variables,
      });
    },
  );
};
