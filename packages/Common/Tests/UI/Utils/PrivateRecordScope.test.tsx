import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, renderHook, RenderHookResult } from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { HeldPermissions } from "../../../Types/HeldPermissions";
import Permission from "../../../Types/Permission";
import { PermissionGateOptions } from "../../../UI/Utils/PermissionGate";
import {
  getPrivateRecordGateOptions,
  PrivateRecordScope,
  PrivateRecordScopeContext,
  usePrivateRecordGate,
  usePrivateRecordGateOptions,
  withPrivateRecordGateOptions,
} from "../../../UI/Utils/PrivateRecordScope";
import { PrivateRecordPartModel } from "../../../Types/PrivateRecord/PrivateRecordParts";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";

/*
 * THE PRIVATE RECORD A PAGE IS OPEN ON, handed to its gates. A private
 * incident, alert or episode is changed only with the permissions of the
 * teams that own it: its view layout provides what the reader holds on it,
 * and every gate on its pages that asks about the record or a part of it -
 * Edit, Acknowledge, a note, an owner, a link, a role - asks with that. A
 * gate about anything else on the page (a monitor, an on-call policy) asks
 * as before.
 */

const HELD: HeldPermissions = {
  allowed: [Permission.Viewer, Permission.ProjectUser],
  allowedProjectWide: [Permission.Viewer, Permission.ProjectUser],
  blocked: [],
  blockedForSomeLabels: [],
};

const REASON: string =
  "This incident is private, so it is changed only with the permissions of the teams that own it, and Team 2, your team that owns it, may not do this.";

const INCIDENT_SCOPE: PrivateRecordScope = {
  tableName: "Incident",
  held: HELD,
  reason: REASON,
};

const ALERT_SCOPE: PrivateRecordScope = {
  tableName: "Alert",
  held: HELD,
  reason: REASON,
};

const EXPECTED: PermissionGateOptions = {
  held: HELD,
  privateRecordReason: REASON,
};

type WrapperFunction = (
  scope: PrivateRecordScope | null,
) => (props: { children: ReactNode }) => ReactElement;

const wrapperOf: WrapperFunction = (
  scope: PrivateRecordScope | null,
): ((props: { children: ReactNode }) => ReactElement) => {
  const PrivateRecordPage: (props: {
    children: ReactNode;
  }) => ReactElement = (props: { children: ReactNode }): ReactElement => {
    return (
      <PrivateRecordScopeContext.Provider value={scope}>
        {props.children}
      </PrivateRecordScopeContext.Provider>
    );
  };

  return PrivateRecordPage;
};

afterEach(() => {
  cleanup();
});

describe("getPrivateRecordGateOptions", () => {
  test.each([
    ["the incident itself", new Incident()],
    ["its state change", new IncidentStateTimeline()],
    ["its private note", new IncidentInternalNote()],
    ["its owner team", new IncidentOwnerTeam()],
    ["its link to an alert", new IncidentAlert()],
  ])(
    "hands a gate of %s what the reader holds on the incident",
    (_name: string, model: PrivateRecordPartModel) => {
      expect(getPrivateRecordGateOptions(INCIDENT_SCOPE, model)).toEqual(
        EXPECTED,
      );
    },
  );

  test.each([
    ["a monitor", new Monitor()],
    ["an on-call policy", new OnCallDutyPolicy()],
    ["an alert", new Alert()],
  ])(
    "hands a gate of %s nothing on an incident's page",
    (_name: string, model: PrivateRecordPartModel) => {
      expect(
        getPrivateRecordGateOptions(INCIDENT_SCOPE, model),
      ).toBeUndefined();
    },
  );

  test("an incident's link to an alert is as much a part of the alert", () => {
    expect(
      getPrivateRecordGateOptions(ALERT_SCOPE, new IncidentAlert()),
    ).toEqual(EXPECTED);
    expect(
      getPrivateRecordGateOptions(ALERT_SCOPE, new IncidentStateTimeline()),
    ).toBeUndefined();
  });

  test("an alert episode's member row is a part of the episode", () => {
    expect(
      getPrivateRecordGateOptions(
        { ...ALERT_SCOPE, tableName: new AlertEpisode().tableName || "" },
        new AlertEpisodeMember(),
      ),
    ).toEqual(EXPECTED);
  });

  test("a page open on no private record hands nothing", () => {
    expect(getPrivateRecordGateOptions(null, new Incident())).toBeUndefined();
    expect(getPrivateRecordGateOptions(INCIDENT_SCOPE, null)).toBeUndefined();
    expect(
      getPrivateRecordGateOptions(INCIDENT_SCOPE, undefined),
    ).toBeUndefined();
  });
});

describe("usePrivateRecordGateOptions", () => {
  test("outside a private record's page: nothing, so every gate asks as before", () => {
    const { result } = renderHook(() => {
      return usePrivateRecordGateOptions(new Incident());
    });

    expect(result.current).toBeUndefined();
  });

  test("on a private incident's page: what the reader holds on it, for its parts", () => {
    const { result } = renderHook(
      () => {
        return usePrivateRecordGateOptions(new IncidentStateTimeline());
      },
      { wrapper: wrapperOf(INCIDENT_SCOPE) },
    );

    expect(result.current).toEqual(EXPECTED);
  });

  test("on a private incident's page: nothing for a monitor", () => {
    const { result } = renderHook(
      () => {
        return usePrivateRecordGateOptions(new Monitor());
      },
      { wrapper: wrapperOf(INCIDENT_SCOPE) },
    );

    expect(result.current).toBeUndefined();
  });

  test("the same object while the page's scope stays the same, so what a component worked out is kept", () => {
    const hook: RenderHookResult<PermissionGateOptions | undefined, unknown> =
      renderHook(
        () => {
          // A new model every render, as the components build them.
          return usePrivateRecordGateOptions(new IncidentInternalNote());
        },
        { wrapper: wrapperOf(INCIDENT_SCOPE) },
      );

    const first: PermissionGateOptions | undefined = hook.result.current;

    hook.rerender();

    expect(hook.result.current).toBe(first);
  });
});

describe("usePrivateRecordGate", () => {
  test("hands each model's gate what it should have, from one hook", () => {
    const { result } = renderHook(
      () => {
        return usePrivateRecordGate();
      },
      { wrapper: wrapperOf(ALERT_SCOPE) },
    );

    expect(result.current(new IncidentAlert())).toEqual(EXPECTED);
    expect(result.current(new Alert())).toEqual(EXPECTED);
    expect(result.current(new Incident())).toBeUndefined();
    expect(result.current(new Monitor())).toBeUndefined();
  });

  test("outside a private record's page it hands nothing to any model", () => {
    const { result } = renderHook(() => {
      return usePrivateRecordGate();
    });

    expect(result.current(new Incident())).toBeUndefined();
    expect(result.current(new IncidentAlert())).toBeUndefined();
  });

  test("the same function while the page's scope stays the same", () => {
    const hook: RenderHookResult<
      (model: PrivateRecordPartModel | null | undefined) => unknown,
      unknown
    > = renderHook(
      () => {
        return usePrivateRecordGate();
      },
      { wrapper: wrapperOf(INCIDENT_SCOPE) },
    );

    const first: unknown = hook.result.current;

    hook.rerender();

    expect(hook.result.current).toBe(first);
  });
});

describe("withPrivateRecordGateOptions", () => {
  test("adds the record's held permissions and reason to a gate's own options", () => {
    expect(
      withPrivateRecordGateOptions(
        {
          sentence:
            "You do not have permission to change this incident's state.",
        },
        EXPECTED,
      ),
    ).toEqual({
      sentence: "You do not have permission to change this incident's state.",
      held: HELD,
      privateRecordReason: REASON,
    });
  });

  test("keeps a gate's own options as they are off a private record's page", () => {
    const own: PermissionGateOptions = { singularName: "Alert" };

    expect(withPrivateRecordGateOptions(own, undefined)).toBe(own);
    expect(withPrivateRecordGateOptions(undefined, undefined)).toBeUndefined();
    expect(withPrivateRecordGateOptions(undefined, EXPECTED)).toEqual(EXPECTED);
  });
});
