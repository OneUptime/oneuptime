import Metric from "../../../../../Models/AnalyticsModels/Metric";
import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  BaselineAnomalyTool,
  QueryMetricsTool,
} from "../../../../../Server/Utils/AI/Toolbox/MetricTools";
import {
  ObservabilityTool,
  ToolContext,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The AI's metric tools read metric data points through aggregation SQL of
 * their own, so the toolbox gate is their authorization, and it asks for
 * what the Metric model's read list asks for: the Telemetry Service Metrics
 * permission or a role that reads telemetry - not the trace permission it
 * used to mirror.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);

function context(
  allowed: Array<Permission>,
  blocked: Array<Permission> = [],
): ToolContext {
  const toUserPermission: (
    isBlock: boolean,
  ) => (permission: Permission) => JSONObject = (
    isBlock: boolean,
  ): ((permission: Permission) => JSONObject) => {
    return (permission: Permission): JSONObject => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: isBlock,
        _type: "UserPermission",
      };
    };
  };

  return {
    projectId: projectId,
    props: {
      tenantId: projectId,
      userId: ObjectID.generate(),
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [projectId],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          projectId: projectId,
          permissions: [
            ...allowed.map(toUserPermission(false)),
            ...blocked.map(toUserPermission(true)),
          ],
          _type: "UserTenantAccessPermission",
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

const METRIC_TOOLS: Array<[string, ObservabilityTool]> = [
  ["query_metrics", QueryMetricsTool],
  ["baseline_anomaly", BaselineAnomalyTool],
];

describe("metric tools through the AI toolbox gate", () => {
  test.each(METRIC_TOOLS)(
    "%s is registered, read-only, and asks for the Metric model's read list",
    (name: string, tool: ObservabilityTool) => {
      expect(AIToolbox.getToolByName(name)).toBe(tool);
      expect(AIToolbox.isMutationTool(name)).toBe(false);
      expect([...tool.requiredPermissions].sort()).toEqual(
        [...new Metric().getReadPermissions()].sort(),
      );
    },
  );

  test.each([
    Permission.ReadTelemetryServiceMetrics,
    Permission.TelemetryViewer,
    Permission.Viewer,
    Permission.ProjectMember,
  ])("grants the metric tools to %s", (permission: Permission) => {
    for (const [, tool] of METRIC_TOOLS) {
      expect(AIToolbox.hasPermissionForTool(tool, context([permission]))).toBe(
        true,
      );
    }
  });

  test.each([
    [[Permission.ReadTelemetryServiceTraces]],
    [[Permission.ReadTelemetryServiceLog]],
    [
      [
        Permission.ReadTelemetryServiceTraces,
        Permission.ReadTelemetryServiceLog,
      ],
    ],
  ])("denies the metric tools to %j", (permissions: Array<Permission>) => {
    for (const [, tool] of METRIC_TOOLS) {
      expect(AIToolbox.hasPermissionForTool(tool, context(permissions))).toBe(
        false,
      );
    }
  });

  test("a blocked metric permission denies them despite a broad grant", () => {
    for (const [, tool] of METRIC_TOOLS) {
      expect(
        AIToolbox.hasPermissionForTool(
          tool,
          context(
            [Permission.ProjectMember],
            [Permission.ReadTelemetryServiceMetrics],
          ),
        ),
      ).toBe(false);
    }
  });
});
