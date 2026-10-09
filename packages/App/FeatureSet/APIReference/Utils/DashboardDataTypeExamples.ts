import { JSONObject } from "Common/Types/JSON";

/*
 * The examples on the DashboardComponent and DashboardViewConfig reference
 * pages, kept apart so a test can read them without loading the reference's
 * model registry.
 *
 * They used to wrap the widgets in a `{"_type": ..., "value": {...}}`
 * envelope. A dashboard config is stored as it is sent and never unwrapped,
 * so a config written from the example had its widgets under `value`, and the
 * dashboard did not open: "Cannot read properties of undefined (reading
 * 'length')" (issue #4571). These are the shape the dashboard itself saves;
 * App/Tests/FeatureSet/APIReference/DashboardDataTypeExamples reads each one
 * back through the dashboard's own reader to keep them so.
 */

export const DASHBOARD_COMPONENT_EXAMPLE: JSONObject = {
  _type: "DashboardComponent",
  componentId: "550e8400-e29b-41d4-a716-446655440000",
  componentType: "Text",
  topInDashboardUnits: 0,
  leftInDashboardUnits: 0,
  widthInDashboardUnits: 6,
  heightInDashboardUnits: 1,
  minWidthInDashboardUnits: 3,
  minHeightInDashboardUnits: 1,
  arguments: {
    text: "Checkout service",
    isBold: true,
  },
};

export const DASHBOARD_VIEW_CONFIG_EXAMPLE: JSONObject = {
  _type: "DashboardViewConfig",
  components: [DASHBOARD_COMPONENT_EXAMPLE],
  heightInDashboardUnits: 60,
  refreshInterval: "1m",
};
