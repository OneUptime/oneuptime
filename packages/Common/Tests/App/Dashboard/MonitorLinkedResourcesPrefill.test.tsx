import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import MonitorLinkedResourcesPrefill, {
  MonitorLinkedResourcesPrefillState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/MonitorLinkedResourcesPrefill";
import {
  INCIDENT_PREFILL_PAYLOAD_KEYS,
  MONITOR_LINKED_RESOURCES_SELECT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/MonitorLinkedResourcesPrefillRules";
import { AffectedResourcesPayload } from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import type { Mock } from "jest-mock";

/*
 * The footer under a create form's Other Affected Resources that adds what
 * the picked monitors are linked to:
 *
 * - picking a monitor reads its linked resources and sets the field the
 *   way picking in it would, keeping what the form already holds;
 * - each monitor is read once per form - its state lives with the page,
 *   so a wizard step left and reopened does not bring back a resource the
 *   person removed;
 * - a monitor linked to nothing new changes nothing, and a failed read
 *   changes nothing and lets the monitor be read again;
 * - the line under the field names what was added and is still there.
 */

const MONITOR_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_MONITOR_ID: string = "44444444-4444-4444-8444-444444444445";
const CLUSTER_ID: string = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const SERVICE_ID: string = "5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e";

let getListSpy: ReturnType<typeof jest.spyOn>;

function linkedMonitor(): Monitor {
  return Object.assign(new Monitor(), {
    _id: MONITOR_ID,
    kubernetesClusters: [{ _id: CLUSTER_ID, name: "prod-east" }],
    services: [{ _id: SERVICE_ID, name: "checkout" }],
  });
}

function serveMonitors(monitors: Array<Monitor> | Error): void {
  getListSpy.mockImplementation((async (): Promise<ListResult<Monitor>> => {
    if (monitors instanceof Error) {
      throw monitors;
    }
    return { data: monitors, count: monitors.length, skip: 0, limit: 10 };
  }) as never);
}

function newState(): React.MutableRefObject<MonitorLinkedResourcesPrefillState> {
  return {
    current: { seenMonitorIds: new Set<string>(), added: [] },
  };
}

type SetValue = (value: unknown) => void;

interface Harness {
  setValue: Mock<SetValue>;
  rerender: (values: JSONObject) => void;
  unmount: () => void;
}

function renderFooter(
  values: JSONObject,
  state: React.MutableRefObject<MonitorLinkedResourcesPrefillState>,
): Harness {
  const setValue: Mock<SetValue> = jest.fn<SetValue>();

  const element: (current: JSONObject) => React.ReactElement = (
    current: JSONObject,
  ): React.ReactElement => {
    return (
      <MonitorLinkedResourcesPrefill
        monitorIds={current["monitors"]}
        values={current}
        footer={{ setValue }}
        payloadKeys={INCIDENT_PREFILL_PAYLOAD_KEYS}
        state={state}
      />
    );
  };

  const result: ReturnType<typeof render> = render(element(values));

  return {
    setValue,
    rerender: (next: JSONObject): void => {
      result.rerender(element(next));
    },
    unmount: result.unmount,
  };
}

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("MonitorLinkedResourcesPrefill", () => {
  test("adds what a picked monitor is linked to, keeping what the form holds", async () => {
    serveMonitors([linkedMonitor()]);
    const state: React.MutableRefObject<MonitorLinkedResourcesPrefillState> =
      newState();

    const harness: Harness = renderFooter(
      {
        monitors: [MONITOR_ID],
        services: [SERVICE_ID],
      },
      state,
    );

    await waitFor(() => {
      expect(harness.setValue).toHaveBeenCalledTimes(1);
    });

    const payload: AffectedResourcesPayload = harness.setValue.mock
      .calls[0]![0] as AffectedResourcesPayload;
    expect(payload.__affectedResourcesPayload).toBe(true);
    expect(payload.monitors).toBeUndefined();
    expect(payload.kubernetesClusters).toEqual([CLUSTER_ID]);
    expect(payload.services).toEqual([SERVICE_ID]);

    // The monitor is read with its linked resources, named.
    const args: { query: JSONObject; select: JSONObject } = getListSpy.mock
      .calls[0]![0] as { query: JSONObject; select: JSONObject };
    expect(args.select).toEqual(MONITOR_LINKED_RESOURCES_SELECT);
    expect(JSON.stringify(args.query["_id"])).toContain(MONITOR_ID);

    // Only the cluster was added; the service was already there.
    expect(state.current.added).toEqual([
      { key: "kubernetesClusters", id: CLUSTER_ID, name: "prod-east" },
    ]);
  });

  test("names what it added while the form still holds it", async () => {
    serveMonitors([linkedMonitor()]);
    const state: React.MutableRefObject<MonitorLinkedResourcesPrefillState> =
      newState();
    const harness: Harness = renderFooter({ monitors: [MONITOR_ID] }, state);

    await waitFor(() => {
      expect(harness.setValue).toHaveBeenCalled();
    });

    // The form now holds what the field was set to.
    harness.rerender({
      monitors: [MONITOR_ID],
      kubernetesClusters: [CLUSTER_ID],
      services: [SERVICE_ID],
    });

    expect(
      screen.getByTestId("monitor-linked-resources-prefilled"),
    ).toHaveTextContent(
      "Added from what the picked monitor is linked to: prod-east, checkout.",
    );

    // Removed in the picker: no longer named.
    harness.rerender({
      monitors: [MONITOR_ID],
      kubernetesClusters: [],
      services: [SERVICE_ID],
    });
    expect(
      screen.getByTestId("monitor-linked-resources-prefilled"),
    ).toHaveTextContent(
      "Added from what the picked monitor is linked to: checkout.",
    );
  });

  test("reads each monitor once per form, even across a step left and reopened", async () => {
    serveMonitors([linkedMonitor()]);
    const state: React.MutableRefObject<MonitorLinkedResourcesPrefillState> =
      newState();
    const first: Harness = renderFooter({ monitors: [MONITOR_ID] }, state);

    await waitFor(() => {
      expect(first.setValue).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    // The person removed the cluster, moved on, and came back.
    const second: Harness = renderFooter(
      { monitors: [MONITOR_ID], kubernetesClusters: [] },
      state,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(getListSpy).toHaveBeenCalledTimes(1);
    expect(second.setValue).not.toHaveBeenCalled();
  });

  test("reads only the newly picked monitor when another is added", async () => {
    serveMonitors([linkedMonitor()]);
    const state: React.MutableRefObject<MonitorLinkedResourcesPrefillState> =
      newState();
    const harness: Harness = renderFooter({ monitors: [MONITOR_ID] }, state);

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalledTimes(1);
    });

    serveMonitors([]);
    harness.rerender({ monitors: [MONITOR_ID, OTHER_MONITOR_ID] });

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalledTimes(2);
    });
    const query: JSONObject = (
      getListSpy.mock.calls[1]![0] as {
        query: JSONObject;
      }
    ).query;
    expect(JSON.stringify(query["_id"])).toContain(OTHER_MONITOR_ID);
    expect(JSON.stringify(query["_id"])).not.toContain(MONITOR_ID);
  });

  test("changes nothing for a monitor linked to nothing new", async () => {
    serveMonitors([linkedMonitor()]);
    const harness: Harness = renderFooter(
      {
        monitors: [MONITOR_ID],
        kubernetesClusters: [CLUSTER_ID],
        services: [SERVICE_ID],
      },
      newState(),
    );

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.setValue).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("monitor-linked-resources-prefilled"),
    ).not.toBeInTheDocument();
  });

  test("changes nothing when the read fails, and lets the monitor be read again", async () => {
    serveMonitors(new Error("network down"));
    const state: React.MutableRefObject<MonitorLinkedResourcesPrefillState> =
      newState();
    const harness: Harness = renderFooter({ monitors: [MONITOR_ID] }, state);

    await waitFor(() => {
      expect(getListSpy).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.setValue).not.toHaveBeenCalled();
    expect(state.current.seenMonitorIds.has(MONITOR_ID)).toBe(false);
  });

  test("reads nothing while no monitor is picked", async () => {
    renderFooter({ monitors: [] }, newState());

    await act(async () => {
      await Promise.resolve();
    });
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("reads an alert's single monitor", async () => {
    serveMonitors([linkedMonitor()]);
    const setValue: Mock<SetValue> = jest.fn<SetValue>();

    render(
      <MonitorLinkedResourcesPrefill
        monitorIds={MONITOR_ID}
        values={{ monitor: MONITOR_ID }}
        footer={{ setValue }}
        payloadKeys={INCIDENT_PREFILL_PAYLOAD_KEYS}
        state={newState()}
      />,
    );

    await waitFor(() => {
      expect(setValue).toHaveBeenCalledTimes(1);
    });
  });
});
