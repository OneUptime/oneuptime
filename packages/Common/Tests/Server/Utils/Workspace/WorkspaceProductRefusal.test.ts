import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import MattermostActions from "../../../../Server/Utils/Workspace/Mattermost/MattermostActions";
import {
  MattermostPress,
  MattermostRecordType,
  MattermostSubmit,
  getProductsOfMattermostAction,
} from "../../../../Server/Utils/Workspace/Mattermost/MattermostActionTypes";
import { MicrosoftTeamsAlertActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import { getProductOfMicrosoftTeamsAction } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ProductOfAction";
import MicrosoftTeamsCommands, {
  MicrosoftTeamsListCommand,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCommands";
import { MicrosoftTeamsHomeActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHome";
import MicrosoftTeamsReplies from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackActionAuthorization, {
  SlackActionRequester,
} from "../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import { getProductOfSlackAction } from "../../../../Server/Utils/Workspace/Slack/Actions/ProductOfAction";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { WorkspaceCommandName } from "../../../../Server/Utils/Workspace/WorkspaceCommands";
import WorkspaceProductRefusal from "../../../../Server/Utils/Workspace/WorkspaceProductRefusal";
import Response from "../../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ProductSwitchedOffException from "../../../../Types/Exception/ProductSwitchedOffException";
import ObjectID from "../../../../Types/ObjectID";
import ProductKey from "../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProducts";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE CHAT APPS SAY A PRODUCT IS SWITCHED OFF, INSTEAD OF ACTING (#7479).
 *
 * Slack, Microsoft Teams and Mattermost acted on incidents, alerts, their
 * episodes, on-call, monitors and maintenance events as the member who
 * pressed, whatever the server had switched off. Each press and command
 * names its product now, and while that product is off the app answers
 * where it was made - with what happened and who can switch it on - and
 * nothing is opened, read out or changed. A write that gets past is
 * refused anyway (ProductWriteRefusal), and each app tells it in place.
 */

const INCIDENTS_OFF_MESSAGE: string =
  "Incidents is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.";

let getOff: jest.SpiedFunction<typeof ServerProducts.getOff>;

const switchOff: (products: Array<ProductKey>) => void = (
  products: Array<ProductKey>,
): void => {
  getOff.mockResolvedValue(
    Object.fromEntries(
      products.map((product: ProductKey) => {
        return [product, ServerProductOffReason.SwitchedOff];
      }),
    ),
  );
};

beforeEach(() => {
  getOff = jest.spyOn(ServerProducts, "getOff").mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceProductRefusal", () => {
  test("a command acts in its product", () => {
    expect(
      WorkspaceProductRefusal.getProductOfCommand(WorkspaceCommandName.Incident),
    ).toBe(ProductKey.Incidents);
    expect(
      WorkspaceProductRefusal.getProductOfCommand(
        WorkspaceCommandName.Maintenance,
      ),
    ).toBe(ProductKey.ScheduledMaintenance);
    expect(
      WorkspaceProductRefusal.getProductOfCommand(WorkspaceCommandName.OnCall),
    ).toBe(ProductKey.OnCall);
    expect(
      WorkspaceProductRefusal.getProductOfCommand(WorkspaceCommandName.Page),
    ).toBe(ProductKey.OnCall);
    expect(
      WorkspaceProductRefusal.getProductOfCommand(WorkspaceCommandName.Help),
    ).toBeNull();
    expect(WorkspaceProductRefusal.getProductOfCommand(null)).toBeNull();
  });

  test("answers the press of a product that is off with who can switch it on", async () => {
    switchOff([ProductKey.Incidents]);

    expect(await WorkspaceProductRefusal.getRefusal(ProductKey.Incidents)).toBe(
      INCIDENTS_OFF_MESSAGE,
    );
    expect(
      await WorkspaceProductRefusal.getRefusal(ProductKey.Alerts),
    ).toBeNull();
  });

  test("a press of no product never asks", async () => {
    switchOff([ProductKey.Incidents]);

    expect(await WorkspaceProductRefusal.getRefusal(null)).toBeNull();
    expect(getOff).not.toHaveBeenCalled();
  });

  test("tells a refused write apart from other errors", () => {
    expect(
      WorkspaceProductRefusal.isRefusal(
        new ProductSwitchedOffException({
          product: ProductKey.Incidents,
          reason: ServerProductOffReason.SwitchedOff,
        }),
      ),
    ).toBe(true);
    expect(
      WorkspaceProductRefusal.isRefusal(new NotAuthorizedException("no")),
    ).toBe(false);
    expect(WorkspaceProductRefusal.isRefusal(new Error("no"))).toBe(false);
  });
});

describe("Slack", () => {
  test.each([
    [SlackActionType.AcknowledgeIncident, ProductKey.Incidents],
    [SlackActionType.NewIncident, ProductKey.Incidents],
    [SlackActionType.AcknowledgeIncidentEpisode, ProductKey.Incidents],
    [SlackActionType.AcknowledgeAlert, ProductKey.Alerts],
    [SlackActionType.AcknowledgeAlertEpisode, ProductKey.Alerts],
    [SlackActionType.ShowOnCall, ProductKey.OnCall],
    [SlackActionType.PageSomeone, ProductKey.OnCall],
    [SlackActionType.SubmitPageSomeone, ProductKey.OnCall],
    [SlackActionType.ViewOnCallPolicy, ProductKey.OnCall],
    [SlackActionType.ViewMonitor, ProductKey.Monitors],
    [SlackActionType.NewScheduledMaintenance, ProductKey.ScheduledMaintenance],
    [
      SlackActionType.MarkScheduledMaintenanceAsOngoing,
      ProductKey.ScheduledMaintenance,
    ],
  ])("%s acts in %s", (actionType: SlackActionType, product: ProductKey) => {
    expect(getProductOfSlackAction(actionType)).toBe(product);
  });

  test("a press of no one product - a project's choice - has none", () => {
    expect(getProductOfSlackAction(SlackActionType.ChooseProject)).toBeNull();
    expect(getProductOfSlackAction(undefined)).toBeNull();
  });

  const requester: SlackActionRequester = {
    userId: new ObjectID("c7479000-0000-4000-8000-0000000000a1"),
    projectId: new ObjectID("c7479000-0000-4000-8000-0000000000a2"),
  } as SlackActionRequester;

  test("a press of a product that is off is answered at once and where it was pressed", async () => {
    switchOff([ProductKey.Incidents]);

    const sent: Array<string> = [];
    jest
      .spyOn(Response, "sendTextResponse")
      .mockImplementation((_req: unknown, _res: unknown, text: string) => {
        sent.push(text);
      });
    const sendRefusal: jest.SpiedFunction<
      typeof SlackActionAuthorization.sendRefusal
    > = jest
      .spyOn(SlackActionAuthorization, "sendRefusal")
      .mockResolvedValue(undefined);

    expect(
      await SlackActionAuthorization.refuseWhileProductIsOff({
        requester: requester,
        product: getProductOfSlackAction(SlackActionType.AcknowledgeIncident),
        req: {} as ExpressRequest,
        res: {} as ExpressResponse,
      }),
    ).toBe(true);

    // Slack within its three seconds, then the person.
    expect(sent).toEqual([""]);
    expect(sendRefusal).toHaveBeenCalledWith({
      requester: requester,
      message: INCIDENTS_OFF_MESSAGE,
    });
  });

  test("a press of a product that is on goes on, with nothing sent", async () => {
    switchOff([ProductKey.Alerts]);

    const sendText: jest.SpiedFunction<typeof Response.sendTextResponse> =
      jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
    const sendRefusal: jest.SpiedFunction<
      typeof SlackActionAuthorization.sendRefusal
    > = jest
      .spyOn(SlackActionAuthorization, "sendRefusal")
      .mockResolvedValue(undefined);

    expect(
      await SlackActionAuthorization.refuseWhileProductIsOff({
        requester: requester,
        product: ProductKey.Incidents,
        req: {} as ExpressRequest,
        res: {} as ExpressResponse,
      }),
    ).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendRefusal).not.toHaveBeenCalled();
  });

  test("a write refused for its product is told where it was pressed, not thrown", async () => {
    const sendRefusal: jest.SpiedFunction<
      typeof SlackActionAuthorization.sendRefusal
    > = jest
      .spyOn(SlackActionAuthorization, "sendRefusal")
      .mockResolvedValue(undefined);

    expect(
      await SlackActionAuthorization.runForRequester({
        requester: requester,
        action: "acknowledge the incident",
        run: async (): Promise<void> => {
          throw new ProductSwitchedOffException({
            product: ProductKey.Incidents,
            reason: ServerProductOffReason.SwitchedOff,
          });
        },
      }),
    ).toBeNull();
    expect(sendRefusal).toHaveBeenCalledWith({
      requester: requester,
      message: `Could not acknowledge the incident: ${INCIDENTS_OFF_MESSAGE}`,
    });
  });
});

describe("Microsoft Teams", () => {
  test.each([
    [MicrosoftTeamsHomeActionType.DeclareIncident, ProductKey.Incidents],
    [MicrosoftTeamsHomeActionType.PageSomeone, ProductKey.OnCall],
    [MicrosoftTeamsHomeActionType.WhoIsOnCall, ProductKey.OnCall],
    ["AcknowledgeIncident", ProductKey.Incidents],
    [MicrosoftTeamsAlertActionType.AckAlert, ProductKey.Alerts],
    ["AckAlertEpisode", ProductKey.Alerts],
    ["AckIncidentEpisode", ProductKey.Incidents],
    ["ViewMonitor", ProductKey.Monitors],
    ["MarkAsOngoing", ProductKey.ScheduledMaintenance],
  ])("%s acts in %s", (actionType: string, product: ProductKey) => {
    expect(getProductOfMicrosoftTeamsAction(actionType)).toBe(product);
  });

  test("the Home's Refresh, and a press of no product, have none", () => {
    expect(
      getProductOfMicrosoftTeamsAction(MicrosoftTeamsHomeActionType.Refresh),
    ).toBeNull();
    expect(getProductOfMicrosoftTeamsAction("SomethingElse")).toBeNull();
    expect(getProductOfMicrosoftTeamsAction(undefined)).toBeNull();
  });

  test("a list command reads its product", () => {
    expect(
      MicrosoftTeamsCommands.getProductOfListCommand(
        MicrosoftTeamsListCommand.ActiveIncidents,
      ),
    ).toBe(ProductKey.Incidents);
    expect(
      MicrosoftTeamsCommands.getProductOfListCommand(
        MicrosoftTeamsListCommand.ActiveAlerts,
      ),
    ).toBe(ProductKey.Alerts);
    expect(
      MicrosoftTeamsCommands.getProductOfListCommand(
        MicrosoftTeamsListCommand.OngoingMaintenance,
      ),
    ).toBe(ProductKey.ScheduledMaintenance);
  });

  test("a write refused for its product is said to the person", () => {
    expect(
      MicrosoftTeamsReplies.getUserFacingErrorMessage(
        new ProductSwitchedOffException({
          product: ProductKey.Incidents,
          reason: ServerProductOffReason.SwitchedOff,
        }),
      ),
    ).toBe(INCIDENTS_OFF_MESSAGE);
  });
});

describe("Mattermost", () => {
  test("a press acts in its record's product, and in On-Call to start a policy", () => {
    expect(
      getProductsOfMattermostAction({
        recordType: MattermostRecordType.Incident,
        press: MattermostPress.Acknowledge,
      }),
    ).toEqual([ProductKey.Incidents]);
    expect(
      getProductsOfMattermostAction({
        recordType: MattermostRecordType.AlertEpisode,
        press: MattermostPress.Resolve,
      }),
    ).toEqual([ProductKey.Alerts]);
    expect(
      getProductsOfMattermostAction({
        recordType: MattermostRecordType.ScheduledMaintenance,
        press: MattermostPress.MarkAsOngoing,
      }),
    ).toEqual([ProductKey.ScheduledMaintenance]);
    expect(
      getProductsOfMattermostAction({
        recordType: MattermostRecordType.Alert,
        press: MattermostPress.OpenOnCallPolicyForm,
      }),
    ).toEqual([ProductKey.Alerts, ProductKey.OnCall]);
    expect(
      getProductsOfMattermostAction({
        recordType: MattermostRecordType.Incident,
        submit: MattermostSubmit.OnCallPolicy,
      }),
    ).toEqual([ProductKey.Incidents, ProductKey.OnCall]);
  });

  test("refuses while any product the press needs is off", async () => {
    switchOff([ProductKey.OnCall]);

    expect(
      await MattermostActions.getProductRefusal([
        ProductKey.Incidents,
        ProductKey.OnCall,
      ]),
    ).toBe(
      "On-Call is switched off on this server. A server admin can switch it on in Admin Dashboard > Settings > Products. Nothing was deleted.",
    );
    expect(
      await MattermostActions.getProductRefusal([ProductKey.Incidents]),
    ).toBeNull();
  });

  test("a write refused for its product is said under the form", () => {
    expect(
      MattermostActions.getRefusalText(
        new ProductSwitchedOffException({
          product: ProductKey.Incidents,
          reason: ServerProductOffReason.SwitchedOff,
        }),
      ),
    ).toBe(INCIDENTS_OFF_MESSAGE);
  });
});

describe("WorkspaceActionAuthorization", () => {
  const props: {
    userId: ObjectID;
    tenantId: ObjectID;
  } = {
    userId: new ObjectID("c7479000-0000-4000-8000-0000000000b1"),
    tenantId: new ObjectID("c7479000-0000-4000-8000-0000000000b2"),
  };

  test("a write of a product that is off is refused before anything is read out", async () => {
    switchOff([ProductKey.Incidents]);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: props,
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
      }),
    ).rejects.toThrow(INCIDENTS_OFF_MESSAGE);

    await expect(
      WorkspaceActionAuthorization.assertCanUpdate({
        props: props,
        modelType: IncidentStateTimeline,
        data: {},
        action: "change this incident",
      }),
    ).rejects.toBeInstanceOf(ProductSwitchedOffException);
  });

  test("a write of a product that is on is asked as before", async () => {
    switchOff([ProductKey.Incidents]);

    // Refused for its permission (nobody here may), never for its product.
    const error: unknown = await WorkspaceActionAuthorization.assertCanCreate({
      props: props,
      modelType: ScheduledMaintenanceStateTimeline,
      action: "start this maintenance event",
    }).catch((err: unknown) => {
      return err;
    });

    expect(error).not.toBeInstanceOf(ProductSwitchedOffException);
  });
});

describe("each app asks before it routes a press to its product", () => {
  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(
      path.join(__dirname, "../../../../Server", file),
      "utf8",
    );
  };

  test("Slack's interactive route, before its first product's handler", () => {
    const source: string = read("API/SlackAPI.ts");
    const gate: number = source.indexOf(
      "SlackActionAuthorization.refuseWhileProductIsOff(",
    );

    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(
      source.indexOf("SlackIncidentActions.handleIncidentAction("),
    );
    expect(gate).toBeLessThan(
      source.indexOf("return await SlackCommandActions.showOnCall("),
    );
  });

  test("Slack's commands, before they open a form or read who is on call", () => {
    const source: string = read("Utils/Workspace/Slack/Actions/Command.ts");
    const gate: number = source.indexOf(
      "SlackActionAuthorization.refuseWhileProductIsOff(",
    );

    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(source.indexOf("case SlackActionType.NewIncident:"));
  });

  test("Microsoft Teams' presses and commands, before their handlers", () => {
    const source: string = read(
      "Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
    );
    const pressGate: number = source.indexOf(
      "getProductOfMicrosoftTeamsAction(actionType)",
    );
    const commandGate: number = source.indexOf(
      "WorkspaceProductRefusal.getProductOfCommand(input.command)",
    );

    expect(pressGate).toBeGreaterThan(-1);
    expect(pressGate).toBeLessThan(
      source.indexOf("MicrosoftTeamsIncidentActions.handleBotIncidentAction("),
    );
    expect(commandGate).toBeGreaterThan(-1);
    expect(commandGate).toBeLessThan(
      source.indexOf(
        "await MicrosoftTeamsCreateCommands.handleCreateIncidentCommand({",
      ),
    );
  });

  test("Mattermost's presses and forms, before they act", () => {
    const source: string = read(
      "Utils/Workspace/Mattermost/MattermostActions.ts",
    );

    expect(
      source.split("MattermostActions.getProductRefusal(").length - 1,
    ).toBe(2);
    expect(source.indexOf("MattermostActions.getProductRefusal(")).toBeLessThan(
      source.indexOf("await MattermostActions.changeStanding({"),
    );
  });
});
