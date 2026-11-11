import { JSONObject } from "../../Types/JSON";

/*
 * THE STEPS OF A METRICS MONITOR AN AI WROTE THROUGH THE MCP SERVER.
 *
 * The shape a customer's monitor was stored in (its names and ids made up
 * here): one Azure App Service's HTTP 5xx count, summed, read through two
 * attribute filters, with a Healthy criteria that ignores a window with no
 * data and an alerting one that triggers on it - and a rolling time
 * written "15 minutes", which no rolling time is spelled as. Every check
 * read a window of no length, found no data, and opened the alert; the
 * overview charted nothing, while the edit form charted the metric.
 *
 * Each call gives a fresh copy, with the rolling time asked for.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const MCP_WRITTEN_ROLLING_TIME: string = "15 minutes";

export const MCP_WRITTEN_METRIC_NAME: string = "azure_http5xx_total";

export const MCP_WRITTEN_HEALTHY_STATUS_ID: string =
  "a1000000-0000-4000-8000-000000000001";

export const MCP_WRITTEN_ALERTING_STATUS_ID: string =
  "a1000000-0000-4000-8000-000000000002";

export const MCP_WRITTEN_RESOURCE_ID: string =
  "/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/shop-rg/providers/Microsoft.Web/sites/shop-web";

export const mcpWrittenMetricMonitorSteps: (
  rollingTime?: unknown,
) => JSONObject = (
  rollingTime: unknown = MCP_WRITTEN_ROLLING_TIME,
): JSONObject => {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: "a1000000-0000-4000-8000-000000000003",
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: "a1000000-0000-4000-8000-000000000004",
                      monitorStatusId: MCP_WRITTEN_HEALTHY_STATUS_ID,
                      filterCondition: "Any",
                      filters: [
                        {
                          value: 0,
                          checkOn: "Metric Value",
                          filterType: "LessThanOrEqual",
                          metricMonitorOptions: {
                            metricAlias: "m1",
                            onNoDataPolicy: "Ignore",
                            metricAggregationType: "Any Value",
                          },
                        },
                      ],
                      incidents: [],
                      alerts: [],
                      createAlerts: false,
                      changeMonitorStatus: true,
                      createIncidents: false,
                      isEnabled: true,
                      name: "Healthy",
                      description: "Within threshold.",
                    },
                  },
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: "a1000000-0000-4000-8000-000000000005",
                      monitorStatusId: MCP_WRITTEN_ALERTING_STATUS_ID,
                      filterCondition: "Any",
                      filters: [
                        {
                          value: 0,
                          checkOn: "Metric Value",
                          filterType: "GreaterThan",
                          metricMonitorOptions: {
                            metricAlias: "m1",
                            onNoDataPolicy: "Trigger",
                            metricAggregationType: "Any Value",
                          },
                        },
                      ],
                      incidents: [],
                      alerts: [
                        {
                          id: "a1000000-0000-4000-8000-000000000006",
                          title: "Shop web | HTTP 5xx",
                          services: [
                            {
                              _type: "ObjectID",
                              value: "a1000000-0000-4000-8000-000000000007",
                            },
                          ],
                          description:
                            "Any server errors (5xx) on the App Service in the rolling window.",
                          alertSeverityId: {
                            _type: "ObjectID",
                            value: "a1000000-0000-4000-8000-000000000008",
                          },
                          onCallPolicyIds: [],
                          autoResolveAlert: true,
                        },
                      ],
                      createAlerts: true,
                      changeMonitorStatus: true,
                      createIncidents: false,
                      isEnabled: true,
                      name: "Shop web | HTTP 5xx",
                      description:
                        "Any server errors (5xx) on the App Service in the rolling window.",
                    },
                  },
                ],
              },
            },
            requestType: "GET",
            metricMonitor: {
              rollingTime: rollingTime as string,
              metricViewConfig: {
                queryConfigs: [
                  {
                    metricAliasData: {
                      title: "HTTP 5xx",
                      legend: "HTTP 5xx",
                      description: "HTTP 5xx",
                      metricVariable: "m1",
                    },
                    metricQueryData: {
                      filterData: {
                        attributes: {
                          "resource.cloud.provider": "azure",
                          "azuremonitor.resource_id": MCP_WRITTEN_RESOURCE_ID,
                        },
                        metricName: MCP_WRITTEN_METRIC_NAME,
                        aggregateBy: {},
                        aggegationType: "Sum",
                      },
                    },
                  },
                ],
                formulaConfigs: [],
              },
            },
          },
        },
      ],
      defaultMonitorStatusId: MCP_WRITTEN_HEALTHY_STATUS_ID,
    },
  };
};
