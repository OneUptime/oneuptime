import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  DECLARE_INCIDENT_FROM_ALERT_BUTTON_ID,
  getDeclareIncidentFromAlertAction,
  getDeclareIncidentFromAlertsGate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/DeclareIncidentFromAlert";
import { DECLARE_INCIDENT_ACTION_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/BulkIncidentLinkActions";
import { EventPanelAction } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

/*
 * "Declare Incident" in an alert's header. Declaring creates an incident and
 * then links the alert to it, so the button needs Incident create AND
 * IncidentAlert create, checked in that order (the same order as the bulk
 * action and the Linked Incidents page), and the reason names the first one
 * missing. The action follows PermissionGate's three outcomes:
 *
 *   - allowed          -> a working button that opens the create page;
 *   - a known reason   -> a disabled button whose tooltip says which;
 *   - unknown answer   -> no button at all (the snapshot has not loaded).
 *
 * The reason strings are pinned verbatim: they are what a locked-out user
 * reads, and they list the model's real permission sets (Incident.ts and
 * IncidentAlert.ts), so a change to either list shows up here.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ALERT_ID: string = "22222222-2222-4222-8222-000000000001";
const OTHER_ALERT_ID: string = "22222222-2222-4222-8222-000000000002";

const INCIDENT_CREATE_REASON: string =
  "You do not have permission to create this Incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident.";

const INCIDENT_ALERT_CREATE_REASON: string =
  "You do not have permission to create this Incident Alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Alert Admin, Alert Member, Create Incident Alert.";

let permissionsForTest: Array<Permission> = [];
let navigateSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  permissionsForTest = [Permission.ProjectMember];
  PermissionGate.clearPermissionPropsCache();

  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissionsForTest;
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the declare-incident reasons", () => {
  /*
   * Guards the pinned strings above against drifting away from what
   * PermissionGate actually says for these two models.
   */
  test("match PermissionGate's own message for each model", () => {
    expect(
      PermissionGate.getMissingPermissionMessage(
        new Incident(),
        ModelAction.Create,
      ),
    ).toBe(INCIDENT_CREATE_REASON);
    expect(
      PermissionGate.getMissingPermissionMessage(
        new IncidentAlert(),
        ModelAction.Create,
      ),
    ).toBe(INCIDENT_ALERT_CREATE_REASON);
  });
});

describe("getDeclareIncidentFromAlertsGate", () => {
  test.each([
    ["Project Owner", [Permission.ProjectOwner]],
    ["Project Admin", [Permission.ProjectAdmin]],
    ["Project Member", [Permission.ProjectMember]],
    ["Incident Admin", [Permission.IncidentAdmin]],
    ["Incident Member", [Permission.IncidentMember]],
    [
      "Alert Member + Create Incident",
      [Permission.AlertMember, Permission.CreateProjectIncident],
    ],
    [
      "Alert Admin + Create Incident",
      [Permission.AlertAdmin, Permission.CreateProjectIncident],
    ],
    [
      "Create Incident + Create Incident Alert",
      [Permission.CreateProjectIncident, Permission.CreateIncidentAlert],
    ],
    ["Viewer + Project Member", [Permission.Viewer, Permission.ProjectMember]],
    [
      "Create All Operational Resources + Create Incident Alert",
      [
        Permission.CreateAllOperationalResources,
        Permission.CreateIncidentAlert,
      ],
    ],
  ])("allows %s", (_label: string, permissions: Array<Permission>) => {
    permissionsForTest = permissions;

    expect(getDeclareIncidentFromAlertsGate()).toEqual({ isAllowed: true });
  });

  test.each([
    ["Viewer", [Permission.Viewer]],
    ["Alert Member", [Permission.AlertMember]],
    ["Alert Admin", [Permission.AlertAdmin]],
    ["Alert Viewer", [Permission.AlertViewer]],
    ["Incident Viewer", [Permission.IncidentViewer]],
    ["Create Incident Alert only", [Permission.CreateIncidentAlert]],
    [
      "Alert Member + Incident Viewer",
      [Permission.AlertMember, Permission.IncidentViewer],
    ],
  ])(
    "names the Incident permission for %s",
    (_label: string, permissions: Array<Permission>) => {
      permissionsForTest = permissions;

      expect(getDeclareIncidentFromAlertsGate()).toEqual({
        isAllowed: false,
        disabledReason: INCIDENT_CREATE_REASON,
      });
    },
  );

  test.each([
    ["Create Incident only", [Permission.CreateProjectIncident]],
    [
      "Viewer + Create Incident",
      [Permission.Viewer, Permission.CreateProjectIncident],
    ],
    [
      "Incident Viewer + Create Incident",
      [Permission.IncidentViewer, Permission.CreateProjectIncident],
    ],
    /*
     * Incident is an operational resource, so the wildcard covers creating
     * it. IncidentAlert is not, so the wildcard alone cannot link the alert.
     */
    [
      "Create All Operational Resources only",
      [Permission.CreateAllOperationalResources],
    ],
  ])(
    "names the Incident Alert permission for %s",
    (_label: string, permissions: Array<Permission>) => {
      permissionsForTest = permissions;

      expect(getDeclareIncidentFromAlertsGate()).toEqual({
        isAllowed: false,
        disabledReason: INCIDENT_ALERT_CREATE_REASON,
      });
    },
  );

  test("checks Incident create first, then Incident Alert create", () => {
    const checkSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      PermissionGate,
      "check",
    );

    getDeclareIncidentFromAlertsGate();

    expect(checkSpy).toHaveBeenCalledTimes(2);
    expect(checkSpy.mock.calls[0]![0]).toBeInstanceOf(Incident);
    expect(checkSpy.mock.calls[0]![1]).toBe(ModelAction.Create);
    expect(checkSpy.mock.calls[1]![0]).toBeInstanceOf(IncidentAlert);
    expect(checkSpy.mock.calls[1]![1]).toBe(ModelAction.Create);
  });

  test("stops at the first refusal and never asks about the link", () => {
    permissionsForTest = [Permission.Viewer];

    const checkSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      PermissionGate,
      "check",
    );

    const gate: PermissionGateResult = getDeclareIncidentFromAlertsGate();

    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(checkSpy.mock.calls[0]![0]).toBeInstanceOf(Incident);
    // Both are missing for a viewer; the first missing one is the answer.
    expect(gate.disabledReason).toBe(INCIDENT_CREATE_REASON);
    expect(gate.disabledReason).not.toBe(INCIDENT_ALERT_CREATE_REASON);
  });

  test("has no reason to give before the permission snapshot has loaded", () => {
    permissionsForTest = [];

    const gate: PermissionGateResult = getDeclareIncidentFromAlertsGate();

    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toBeUndefined();
  });

  test("allows a master admin even with an empty snapshot", () => {
    permissionsForTest = [];
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

    expect(getDeclareIncidentFromAlertsGate()).toEqual({ isAllowed: true });
  });

  test("allows a master admin who holds only a viewer role", () => {
    permissionsForTest = [Permission.Viewer];
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

    expect(getDeclareIncidentFromAlertsGate()).toEqual({ isAllowed: true });
  });
});

describe("getDeclareIncidentFromAlertAction", () => {
  test("uses the pinned button id", () => {
    expect(DECLARE_INCIDENT_FROM_ALERT_BUTTON_ID).toBe(
      "alert-declare-incident-btn",
    );
    expect(DECLARE_INCIDENT_ACTION_TITLE).toBe("Declare Incident");
  });

  test("is a working button for a project member", () => {
    const action: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );

    expect(action).not.toBeNull();
    expect(action).toEqual({
      id: "alert-declare-incident-btn",
      label: "Declare Incident",
      icon: IconProp.Alert,
      onClick: expect.any(Function),
    });
    expect(action).not.toHaveProperty("isDisabled");
    expect(action).not.toHaveProperty("tooltip");
  });

  test("does not navigate until it is clicked", () => {
    getDeclareIncidentFromAlertAction(new ObjectID(ALERT_ID));

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("opens the create-incident page prefilled from this alert", () => {
    const action: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );

    action!.onClick();

    expect(navigateSpy).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = navigateSpy.mock.calls[0] as Array<unknown>;

    expect(call[0]).toBeInstanceOf(Route);
    expect((call[0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/incidents/create?alertIds=${ALERT_ID}`,
    );
    // Same tab, no forced reload: a plain in-app navigation.
    expect(call[1]).toBeUndefined();
  });

  test("navigates again on every click", () => {
    const action: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );

    action!.onClick();
    action!.onClick();

    expect(navigateSpy).toHaveBeenCalledTimes(2);
    expect((navigateSpy.mock.calls[1]![0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/incidents/create?alertIds=${ALERT_ID}`,
    );
  });

  test("carries only the alert it was built for", () => {
    const first: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );
    const second: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(OTHER_ALERT_ID),
    );

    second!.onClick();
    first!.onClick();

    expect(
      navigateSpy.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as Route).toString();
      }),
    ).toEqual([
      `/dashboard/${PROJECT_ID}/incidents/create?alertIds=${OTHER_ALERT_ID}`,
      `/dashboard/${PROJECT_ID}/incidents/create?alertIds=${ALERT_ID}`,
    ]);
  });

  test("is hidden before the permission snapshot has loaded", () => {
    permissionsForTest = [];

    expect(
      getDeclareIncidentFromAlertAction(new ObjectID(ALERT_ID)),
    ).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("is locked for a viewer, naming the Incident permission, and goes nowhere", () => {
    permissionsForTest = [Permission.Viewer];

    const action: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );

    expect(action).toEqual({
      id: "alert-declare-incident-btn",
      label: "Declare Incident",
      icon: IconProp.Alert,
      isDisabled: true,
      tooltip: INCIDENT_CREATE_REASON,
      onClick: expect.any(Function),
    });

    expect(action!.onClick()).toBeUndefined();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("is locked for an alert member, naming the Incident permission", () => {
    permissionsForTest = [Permission.AlertMember];

    const action: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );

    expect(action!.isDisabled).toBe(true);
    expect(action!.tooltip).toBe(INCIDENT_CREATE_REASON);
  });

  test("is locked for someone who may create incidents but not link them", () => {
    permissionsForTest = [Permission.CreateProjectIncident];

    const action: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );

    expect(action!.isDisabled).toBe(true);
    expect(action!.tooltip).toBe(INCIDENT_ALERT_CREATE_REASON);

    action!.onClick();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("works for an alert member who may also create incidents", () => {
    permissionsForTest = [
      Permission.AlertMember,
      Permission.CreateProjectIncident,
    ];

    const action: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );

    expect(action!.isDisabled).toBeUndefined();
    expect(action!.tooltip).toBeUndefined();

    action!.onClick();

    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  test("works for a master admin even before the snapshot has loaded", () => {
    permissionsForTest = [];
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

    const action: EventPanelAction | null = getDeclareIncidentFromAlertAction(
      new ObjectID(ALERT_ID),
    );

    expect(action).not.toBeNull();
    expect(action!.isDisabled).toBeUndefined();

    action!.onClick();

    expect((navigateSpy.mock.calls[0]![0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/incidents/create?alertIds=${ALERT_ID}`,
    );
  });
});
