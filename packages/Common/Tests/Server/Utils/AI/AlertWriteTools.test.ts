import {
  AcknowledgeAlertTool,
  ResolveAlertTool,
} from "../../../../Server/Utils/AI/Toolbox/AlertWriteTools";
import {
  ObservabilityTool,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../Server/Services/AlertService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * acknowledge_alert / resolve_alert move an alert's state from the AI copilot.
 * They are mutations, so what matters is not the prose they hand the model but
 * the contract around the write: the alert must be visible to the requesting
 * user under their own RBAC before anything changes, the acting user comes
 * from ctx.props and never from a tool argument, and a missing id or a missing
 * user fails loudly instead of writing.
 */

const USER_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true, userId: USER_ID },
};

function buildAlert(): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.alertNumber = 9;
  alert.title = "High CPU on api-1";
  return alert;
}

afterEach(() => {
  jest.restoreAllMocks();
});

type StateCase = {
  label: string;
  tool: ObservabilityTool;
  serviceMethod: "acknowledgeAlert" | "resolveAlert";
  newStateName: string;
  actionTitlePrefix: string;
};

const cases: Array<StateCase> = [
  {
    label: "acknowledge_alert",
    tool: AcknowledgeAlertTool,
    serviceMethod: "acknowledgeAlert",
    newStateName: "Acknowledged",
    actionTitlePrefix: "Acknowledge alert",
  },
  {
    label: "resolve_alert",
    tool: ResolveAlertTool,
    serviceMethod: "resolveAlert",
    newStateName: "Resolved",
    actionTitlePrefix: "Resolve alert",
  },
];

describe.each(cases)(
  "$label",
  ({ tool, serviceMethod, newStateName, actionTitlePrefix }: StateCase) => {
    test("changes the state as ctx's user and cites the alert", async () => {
      jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(buildAlert() as never);
      const changeSpy: jest.SpyInstance = jest
        .spyOn(AlertService, serviceMethod)
        .mockResolvedValue(undefined as never);

      const result: ToolExecutionResult = await tool.execute(
        { alertId: ALERT_ID.toString() },
        ctx,
      );

      expect(changeSpy).toHaveBeenCalledTimes(1);
      const [calledAlertId, calledUserId] = changeSpy.mock.calls[0] as [
        ObjectID,
        ObjectID,
      ];
      expect(calledAlertId.toString()).toBe(ALERT_ID.toString());
      expect(calledUserId).toBe(USER_ID);

      expect(result.rowCount).toBe(1);
      expect(result.isTruncated).toBe(false);
      expect(result.dataForLlm).toContain("#9");
      expect(result.dataForLlm).toContain("High CPU on api-1");
      expect(result.dataForLlm).toContain(newStateName);
      expect(result.citationLabel).toBe(`${newStateName} alert #9`);
      expect(result.citationTarget).toEqual({
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: ALERT_ID.toString() },
      });
    });

    test("reads the alert under the caller's own props, not as root", async () => {
      const findSpy: jest.SpyInstance = jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(buildAlert() as never);
      jest
        .spyOn(AlertService, serviceMethod)
        .mockResolvedValue(undefined as never);

      await tool.execute({ alertId: ALERT_ID.toString() }, ctx);

      const findArgs: Record<string, unknown> = findSpy.mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArgs["props"]).toBe(ctx.props);
      expect(String(findArgs["id"])).toBe(ALERT_ID.toString());
    });

    test("the acting user comes from ctx.props even when args smuggle a userId", async () => {
      jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(buildAlert() as never);
      const changeSpy: jest.SpyInstance = jest
        .spyOn(AlertService, serviceMethod)
        .mockResolvedValue(undefined as never);

      await tool.execute(
        {
          alertId: ALERT_ID.toString(),
          userId: ObjectID.generate().toString(),
          acknowledgedByUserId: ObjectID.generate().toString(),
          resolvedByUserId: ObjectID.generate().toString(),
        },
        ctx,
      );

      expect(changeSpy.mock.calls[0]?.[1]).toBe(USER_ID);
    });

    test("refuses to write when the alert is not visible to the user", async () => {
      jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);
      const changeSpy: jest.SpyInstance = jest.spyOn(
        AlertService,
        serviceMethod,
      );

      await expect(
        tool.execute({ alertId: ALERT_ID.toString() }, ctx),
      ).rejects.toThrow("Alert not found");
      expect(changeSpy).not.toHaveBeenCalled();
    });

    test("missing alertId is a loud BadData error and reads nothing", async () => {
      const findSpy: jest.SpyInstance = jest.spyOn(AlertService, "findOneById");

      await expect(tool.execute({}, ctx)).rejects.toThrow(
        "alertId is required",
      );
      expect(findSpy).not.toHaveBeenCalled();
    });

    test("refuses to write without an authenticated user in context", async () => {
      const anonymousCtx: ToolContext = {
        projectId: ctx.projectId,
        props: { isRoot: true },
      };
      const findSpy: jest.SpyInstance = jest.spyOn(AlertService, "findOneById");

      await expect(
        tool.execute({ alertId: ALERT_ID.toString() }, anonymousCtx),
      ).rejects.toThrow("No authenticated user");
      // The user check comes before the read, so nothing is touched at all.
      expect(findSpy).not.toHaveBeenCalled();
    });

    test("carries a resource card widget that deep-links to the alert", async () => {
      jest
        .spyOn(AlertService, "findOneById")
        .mockResolvedValue(buildAlert() as never);
      jest
        .spyOn(AlertService, serviceMethod)
        .mockResolvedValue(undefined as never);

      const result: ToolExecutionResult = await tool.execute(
        { alertId: ALERT_ID.toString() },
        ctx,
      );

      const widgetData: Record<string, unknown> = result.widget?.data as Record<
        string,
        unknown
      >;
      expect(widgetData["resourceType"]).toBe("Alert");
      expect(widgetData["heading"]).toBe("#9 · High CPU on api-1");
      expect(widgetData["subheading"]).toBe(`Now ${newStateName}`);
      expect(widgetData["link"]).toEqual({
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: ALERT_ID.toString() },
      });
      expect(widgetData["fields"]).toEqual([
        { label: "Number", value: "#9" },
        { label: "State", value: newStateName },
      ]);
    });

    test("buildActionTitle names the alert, and stays tidy with no id", () => {
      expect(tool.buildActionTitle!({ alertId: ALERT_ID.toString() })).toBe(
        `${actionTitlePrefix} ${ALERT_ID.toString()}`,
      );
      // No trailing space when the model calls it before it has an id.
      expect(tool.buildActionTitle!({})).toBe(actionTitlePrefix);
    });

    test("is a mutation whose permissions derive from the Alert model's update ACL", () => {
      expect(tool.isMutation).toBe(true);
      expect(tool.requiredPermissions).toEqual(
        new Alert().getUpdatePermissions(),
      );
      expect(tool.requiredPermissions.length).toBeGreaterThan(0);
      // Resolved lazily, but the same list every time it is asked for.
      expect(tool.requiredPermissions).toEqual(tool.requiredPermissions);
    });
  },
);

describe("the alert write tools as a pair", () => {
  test("acknowledge and resolve are distinct tools with distinct names", () => {
    expect(AcknowledgeAlertTool.name).toBe("acknowledge_alert");
    expect(ResolveAlertTool.name).toBe("resolve_alert");
  });

  test("resolve does not acknowledge, and acknowledge does not resolve", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert() as never);
    const acknowledgeSpy: jest.SpyInstance = jest
      .spyOn(AlertService, "acknowledgeAlert")
      .mockResolvedValue(undefined as never);
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(AlertService, "resolveAlert")
      .mockResolvedValue(undefined as never);

    await ResolveAlertTool.execute({ alertId: ALERT_ID.toString() }, ctx);

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(acknowledgeSpy).not.toHaveBeenCalled();

    await AcknowledgeAlertTool.execute({ alertId: ALERT_ID.toString() }, ctx);

    expect(acknowledgeSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });
});
