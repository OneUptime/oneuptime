import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE,
  getAcknowledgeAlertsDescription,
  getAcknowledgeAlertsGate,
  getAcknowledgeAlertsTitle,
  getAlertsKeepEscalatingNote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/AcknowledgeAlertsOnDeclare";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import UserUtil from "../../../UI/Utils/User";
import { AlertsToAcknowledge } from "../../../Utils/Incident/IncidentFromAlerts";

/*
 * The wording and the permission gate of the "acknowledge the alerts" box on
 * the create-incident page. The box's label and description say exactly
 * which alerts are acknowledged, the note says which alerts keep escalating
 * when the box is not ticked, and the gate asks for the same two permissions
 * the server checks before it acknowledges an alert: create a state timeline
 * row, then update the alert.
 */

const TIMELINE_CREATE_REASON: string =
  "You do not have permission to acknowledge this alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin, Alert Member, Create Alert State Timeline.";

const ALERT_UPDATE_REASON: string =
  "You do not have permission to acknowledge this alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin, Alert Member, Edit Alert.";

const SINGULAR_DESCRIPTION: string =
  "It is acknowledged as you when the incident is declared, and its own on-call escalation stops within a minute. Pages that already went out are not recalled.";

const PLURAL_DESCRIPTION: string =
  "They are acknowledged as you when the incident is declared, and their own on-call escalation stops within a minute. Pages that already went out are not recalled.";

type ToAcknowledgeFunction = (
  count: number,
  alreadyAcknowledgedCount?: number,
) => AlertsToAcknowledge;

const toAcknowledge: ToAcknowledgeFunction = (
  count: number,
  alreadyAcknowledgedCount?: number,
): AlertsToAcknowledge => {
  return {
    alertIds: Array.from(
      { length: count },
      (_value: unknown, index: number): string => {
        return `alert-${index + 1}`;
      },
    ),
    alreadyAcknowledgedCount: alreadyAcknowledgedCount || 0,
  };
};

describe("AcknowledgeAlertsOnDeclare", () => {
  describe("getAcknowledgeAlertsTitle", () => {
    test("names the one alert when it is the only alert", () => {
      expect(getAcknowledgeAlertsTitle(toAcknowledge(1), 1)).toBe(
        "Acknowledge this alert to stop its escalation",
      );
    });

    test("says 'the 1 alert that is not acknowledged yet' when others are acknowledged", () => {
      expect(getAcknowledgeAlertsTitle(toAcknowledge(1, 2), 3)).toBe(
        "Acknowledge the 1 alert that is not acknowledged yet, to stop its escalation",
      );
    });

    test("names every alert when none is acknowledged yet", () => {
      expect(getAcknowledgeAlertsTitle(toAcknowledge(3), 3)).toBe(
        "Acknowledge these 3 alerts to stop their escalation",
      );
    });

    test("names only the alerts not acknowledged yet when some are", () => {
      expect(getAcknowledgeAlertsTitle(toAcknowledge(2, 3), 5)).toBe(
        "Acknowledge the 2 alerts that are not acknowledged yet, to stop their escalation",
      );
    });

    test("treats more alerts to acknowledge than alerts listed as every alert", () => {
      expect(getAcknowledgeAlertsTitle(toAcknowledge(2), 1)).toBe(
        "Acknowledge these 2 alerts to stop their escalation",
      );
      expect(getAcknowledgeAlertsTitle(toAcknowledge(1), 0)).toBe(
        "Acknowledge this alert to stop its escalation",
      );
    });
  });

  describe("getAcknowledgeAlertsDescription", () => {
    test("uses the singular wording for one alert", () => {
      expect(getAcknowledgeAlertsDescription(toAcknowledge(1), undefined)).toBe(
        SINGULAR_DESCRIPTION,
      );
    });

    test("uses the plural wording for several alerts", () => {
      expect(getAcknowledgeAlertsDescription(toAcknowledge(4), undefined)).toBe(
        PLURAL_DESCRIPTION,
      );
    });

    test("says one alert is left as it is", () => {
      expect(
        getAcknowledgeAlertsDescription(toAcknowledge(2, 1), undefined),
      ).toBe(
        `${PLURAL_DESCRIPTION} 1 alert is already acknowledged or resolved and is left as it is.`,
      );
    });

    test("says how many alerts are left as they are", () => {
      expect(
        getAcknowledgeAlertsDescription(toAcknowledge(1, 3), undefined),
      ).toBe(
        `${SINGULAR_DESCRIPTION} 3 alerts are already acknowledged or resolved and are left as they are.`,
      );
    });

    test("says nothing about acknowledged alerts when there are none", () => {
      const description: string = getAcknowledgeAlertsDescription(
        toAcknowledge(2, 0),
        undefined,
      );

      expect(description).toBe(PLURAL_DESCRIPTION);
      expect(description).not.toContain("already acknowledged");
    });

    test("appends why the box is locked, last", () => {
      expect(
        getAcknowledgeAlertsDescription(
          toAcknowledge(1, 2),
          TIMELINE_CREATE_REASON,
        ),
      ).toBe(
        `${SINGULAR_DESCRIPTION} 2 alerts are already acknowledged or resolved and are left as they are. ${TIMELINE_CREATE_REASON}`,
      );
      expect(
        getAcknowledgeAlertsDescription(toAcknowledge(1), ALERT_UPDATE_REASON),
      ).toBe(`${SINGULAR_DESCRIPTION} ${ALERT_UPDATE_REASON}`);
    });

    test("ignores an empty reason", () => {
      expect(getAcknowledgeAlertsDescription(toAcknowledge(3), "")).toBe(
        PLURAL_DESCRIPTION,
      );
    });
  });

  describe("getAlertsKeepEscalatingNote", () => {
    test("the only alert", () => {
      expect(getAlertsKeepEscalatingNote(toAcknowledge(1), 1)).toBe(
        "Declaring the incident does not acknowledge the alert: it keeps escalating until it is acknowledged.",
      );
    });

    test("every one of several alerts", () => {
      expect(getAlertsKeepEscalatingNote(toAcknowledge(3), 3)).toBe(
        "Declaring the incident does not acknowledge these alerts: they keep escalating until they are acknowledged.",
      );
    });

    test("the one alert of several that is not acknowledged yet", () => {
      expect(getAlertsKeepEscalatingNote(toAcknowledge(1, 2), 3)).toBe(
        "Declaring the incident does not acknowledge the alert that is not acknowledged yet: it keeps escalating until it is acknowledged.",
      );
    });

    test("the alerts of several that are not acknowledged yet", () => {
      expect(getAlertsKeepEscalatingNote(toAcknowledge(2, 2), 4)).toBe(
        "Declaring the incident does not acknowledge the 2 alerts that are not acknowledged yet: they keep escalating until they are acknowledged.",
      );
    });
  });

  describe("ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE", () => {
    test("says the alerts' own escalation stops, and what may still page", () => {
      expect(ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE).toBe(
        "The alerts it is declared from are acknowledged too, so their own escalation stops. An alert episode they belong to keeps escalating until the episode is acknowledged, and an incident on-call rule, if any, may still page.",
      );
    });

    /*
     * Acknowledging an alert stops only that alert's escalation: an alert
     * episode escalates on its own, so the note must not promise that
     * nothing pages any more.
     */
    test("carries the alert episode caveat", () => {
      expect(ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE).toContain(
        "An alert episode they belong to keeps escalating until the episode is acknowledged",
      );
    });

    test("claims only the alerts' own escalation stops, and that an incident on-call rule may still page", () => {
      expect(ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE).toContain(
        "so their own escalation stops.",
      );
      expect(ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE).toContain(
        "an incident on-call rule, if any, may still page.",
      );
      expect(ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE).not.toContain("stop paging");
      expect(ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE).not.toContain("only an");
    });
  });

  describe("getAcknowledgeAlertsGate", () => {
    let permissionsForTest: Array<Permission> = [];

    beforeEach(() => {
      permissionsForTest = [Permission.ProjectMember];
      PermissionGate.clearPermissionPropsCache();

      jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
        return permissionsForTest;
      });
      jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test.each([
      ["a project owner", [Permission.ProjectOwner]],
      ["a project admin", [Permission.ProjectAdmin]],
      ["a project member", [Permission.ProjectMember]],
      ["an alert admin", [Permission.AlertAdmin]],
      ["an alert member", [Permission.AlertMember]],
      [
        "somebody with both fine-grained permissions",
        [Permission.CreateAlertStateTimeline, Permission.EditAlert],
      ],
      [
        "somebody who may edit all operational resources and create timelines",
        [
          Permission.CreateAlertStateTimeline,
          Permission.EditAllOperationalResources,
        ],
      ],
    ])("allows %s", (_who: string, permissions: Array<Permission>) => {
      permissionsForTest = permissions;

      expect(getAcknowledgeAlertsGate()).toEqual({ isAllowed: true });
    });

    test("checks the state timeline create first, then the alert update, both as 'acknowledge this alert'", () => {
      const checkSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        PermissionGate,
        "check",
      );

      expect(getAcknowledgeAlertsGate()).toEqual({ isAllowed: true });

      expect(checkSpy).toHaveBeenCalledTimes(2);

      const calls: Array<Array<unknown>> = checkSpy.mock.calls as Array<
        Array<unknown>
      >;

      expect(calls[0]![0]).toBeInstanceOf(AlertStateTimeline);
      expect(calls[0]![1]).toBe(ModelAction.Create);
      expect(calls[0]![2]).toEqual({
        verb: "acknowledge",
        singularName: "alert",
      });
      expect(calls[1]![0]).toBeInstanceOf(Alert);
      expect(calls[1]![1]).toBe(ModelAction.Update);
      expect(calls[1]![2]).toEqual({
        verb: "acknowledge",
        singularName: "alert",
      });
    });

    test("stops at the state timeline when that is missing, and names its permissions", () => {
      permissionsForTest = [Permission.Viewer];
      const checkSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        PermissionGate,
        "check",
      );

      const gate: PermissionGateResult = getAcknowledgeAlertsGate();

      expect(gate).toEqual({
        isAllowed: false,
        disabledReason: TIMELINE_CREATE_REASON,
      });
      expect(checkSpy).toHaveBeenCalledTimes(1);
      expect((checkSpy.mock.calls[0] as Array<unknown>)[0]).toBeInstanceOf(
        AlertStateTimeline,
      );
    });

    test("names the state timeline even when the alert update is missing too", () => {
      permissionsForTest = [Permission.AlertViewer, Permission.ReadAlert];

      expect(getAcknowledgeAlertsGate()).toEqual({
        isAllowed: false,
        disabledReason: TIMELINE_CREATE_REASON,
      });
    });

    test("names the state timeline for somebody who may edit alerts but not add timeline rows", () => {
      permissionsForTest = [Permission.Viewer, Permission.EditAlert];

      expect(getAcknowledgeAlertsGate()).toEqual({
        isAllowed: false,
        disabledReason: TIMELINE_CREATE_REASON,
      });
    });

    /*
     * AlertStateTimeline is not an operational resource, so the wildcard
     * does not cover it - on the server either.
     */
    test("does not let the operational-resource wildcards stand in for the timeline permission", () => {
      permissionsForTest = [
        Permission.CreateAllOperationalResources,
        Permission.EditAllOperationalResources,
      ];

      expect(getAcknowledgeAlertsGate()).toEqual({
        isAllowed: false,
        disabledReason: TIMELINE_CREATE_REASON,
      });
    });

    test("names the alert update when only that is missing", () => {
      permissionsForTest = [
        Permission.Viewer,
        Permission.CreateAlertStateTimeline,
      ];

      expect(getAcknowledgeAlertsGate()).toEqual({
        isAllowed: false,
        disabledReason: ALERT_UPDATE_REASON,
      });
    });

    test("gives no reason while the permission snapshot has not loaded", () => {
      permissionsForTest = [];

      const gate: PermissionGateResult = getAcknowledgeAlertsGate();

      expect(gate).toEqual({ isAllowed: false });
      expect(gate.disabledReason).toBeUndefined();
    });

    test("allows a master admin without any project permission", () => {
      permissionsForTest = [];
      jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

      expect(getAcknowledgeAlertsGate()).toEqual({ isAllowed: true });
    });
  });
});
