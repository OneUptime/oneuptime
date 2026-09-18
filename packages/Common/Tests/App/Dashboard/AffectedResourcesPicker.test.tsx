import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The affected-resources picker is the chip input on every incident, alert and
 * scheduled maintenance form. In an edit form it is handed bare IDs: ModelForm
 * flattens every relation it loads into Array<string>, and on a fresh mount
 * the picker's name cache is empty. It used to render each of those as
 * "Unnamed Monitor" (or "Unnamed Host", ...) - the Edit modal of an incident's
 * Affected Resources card showed "MONITOR Unnamed Monitor" for a monitor that
 * very much had a name. The picker now looks the names up.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

import AffectedResourcesPicker, {
  AffectedResourceItem,
  AffectedResourcesPayload,
  AffectedResourceType,
  ComponentProps,
  NAME_LOADING_PLACEHOLDER,
  NAME_LOOKUP_BATCH_SIZE,
  getUnknownResourceLabel,
  getUnnamedResourceLabel,
  toItems,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import Service from "../../../Models/DatabaseModels/Service";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import Includes from "../../../Types/BaseDatabase/Includes";
import FormSummary from "../../../UI/Components/Forms/FormSummary";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../Types/JSON";
import Search from "../../../Types/BaseDatabase/Search";

type ModelClass = { new (): BaseModel };

interface FakeRow {
  _id: string;
  name?: string | undefined;
}

interface GetListArgs {
  modelType: ModelClass;
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const makeDeferred: () => Deferred = (): Deferred => {
  let resolve: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((res: () => void) => {
    resolve = res;
  });
  return { promise, resolve };
};

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

const MONITOR_ID: string = id(1);
const MONITOR_NAME: string = "Checkout API";
const SECOND_MONITOR_ID: string = id(2);
const SECOND_MONITOR_NAME: string = "Orders DB";

/*
 * A tiny in-memory stand-in for the API. Each model type has its own rows;
 * getList honours `_id: Includes([...])` and `name: Search(...)` the way the
 * server does, and returns real model instances.
 */
let fakeDb: Map<ModelClass, Array<FakeRow>> = new Map();
let failingModelTypes: Set<ModelClass> = new Set();
let gate: Deferred | null = null;

const seed: (modelType: ModelClass, rows: Array<FakeRow>) => void = (
  modelType: ModelClass,
  rows: Array<FakeRow>,
): void => {
  fakeDb.set(modelType, [...(fakeDb.get(modelType) || []), ...rows]);
};

const fakeGetList: (args: GetListArgs) => Promise<{
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
}> = async (
  args: GetListArgs,
): Promise<{
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
}> => {
  if (gate) {
    await gate.promise;
  }
  if (failingModelTypes.has(args.modelType)) {
    throw new Error("Request failed");
  }
  let rows: Array<FakeRow> = fakeDb.get(args.modelType) || [];
  const idFilter: unknown = args.query["_id"];
  if (idFilter instanceof Includes) {
    const wanted: Set<string> = new Set(
      (idFilter.values as Array<string>).map((v: string) => {
        return String(v);
      }),
    );
    rows = rows.filter((row: FakeRow) => {
      return wanted.has(row._id);
    });
  }
  const nameFilter: unknown = args.query["name"];
  if (nameFilter instanceof Search) {
    const needle: string = String(nameFilter.toString()).toLowerCase();
    rows = rows.filter((row: FakeRow) => {
      return (row.name || "").toLowerCase().includes(needle);
    });
  }
  if (args.query["description"] !== undefined) {
    rows = [];
  }
  const data: Array<BaseModel> = rows
    .slice(0, args.limit)
    .map((row: FakeRow) => {
      const model: BaseModel = new args.modelType();
      model._id = row._id;
      (model as unknown as { name?: string | undefined }).name = row.name;
      return model;
    });
  return { data, count: data.length, skip: 0, limit: args.limit };
};

const lookupCalls: () => Array<GetListArgs> = (): Array<GetListArgs> => {
  return getListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as GetListArgs;
    })
    .filter((args: GetListArgs) => {
      return args.query["_id"] instanceof Includes;
    });
};

const lookedUpIds: (args: GetListArgs) => Array<string> = (
  args: GetListArgs,
): Array<string> => {
  return ((args.query["_id"] as Includes).values as Array<string>).map(
    (v: string) => {
      return String(v);
    },
  );
};

const ALL_RESOURCE_TYPES: Array<AffectedResourceType> = [
  "Monitor",
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "DockerSwarmCluster",
  "IoTFleet",
  "NetworkSite",
  "Service",
];

const noop: (payload: AffectedResourcesPayload) => void = (): void => {};

const renderPicker: (props: Partial<ComponentProps>) => RenderResult = (
  props: Partial<ComponentProps>,
): RenderResult => {
  return render(<AffectedResourcesPicker onChange={noop} {...props} />);
};

const asModels: <T>(ids: Array<string>) => Array<T> = <T,>(
  ids: Array<string>,
): Array<T> => {
  // What an edit form actually passes: the prop is typed Array<Model>, the value is Array<string>.
  return ids as unknown as Array<T>;
};

beforeEach(() => {
  fakeDb = new Map();
  failingModelTypes = new Set();
  gate = null;
  getListMock.mockReset();
  getListMock.mockImplementation((...args: Array<unknown>) => {
    return fakeGetList(args[0] as GetListArgs);
  });
});

afterEach(() => {
  cleanup();
});

describe("toItems", () => {
  test("a bare ID nobody has named yet is waiting for its name, not 'Unnamed'", () => {
    const cache: Map<string, string> = new Map();

    const items: Array<AffectedResourceItem> = toItems(
      [MONITOR_ID],
      "Monitor",
      cache,
      new Set(),
    );

    expect(items).toEqual([
      {
        _id: MONITOR_ID,
        name: NAME_LOADING_PLACEHOLDER,
        type: "Monitor",
        isNameLoading: true,
      },
    ]);
    expect(items[0]!.name).not.toBe(getUnnamedResourceLabel("Monitor"));
  });

  test("a bare ID whose name is cached shows that name", () => {
    const cache: Map<string, string> = new Map([
      [`Monitor:${MONITOR_ID}`, MONITOR_NAME],
    ]);

    expect(toItems([MONITOR_ID], "Monitor", cache, new Set())).toEqual([
      { _id: MONITOR_ID, name: MONITOR_NAME, type: "Monitor" },
    ]);
  });

  test("the cache is keyed per type, so a host never borrows a monitor's name", () => {
    const cache: Map<string, string> = new Map([
      [`Monitor:${MONITOR_ID}`, MONITOR_NAME],
    ]);

    const items: Array<AffectedResourceItem> = toItems(
      [MONITOR_ID],
      "Host",
      cache,
      new Set(),
    );

    expect(items[0]!.isNameLoading).toBe(true);
    expect(items[0]!.name).not.toBe(MONITOR_NAME);
  });

  test("a model instance that carries its name is shown and cached", () => {
    const cache: Map<string, string> = new Map();
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    monitor.name = MONITOR_NAME;

    expect(toItems([monitor], "Monitor", cache, new Set())).toEqual([
      { _id: MONITOR_ID, name: MONITOR_NAME, type: "Monitor" },
    ]);
    expect(cache.get(`Monitor:${MONITOR_ID}`)).toBe(MONITOR_NAME);
  });

  test("a plain object may use `id` instead of `_id`", () => {
    expect(
      toItems(
        [{ id: MONITOR_ID, name: MONITOR_NAME }],
        "Monitor",
        new Map(),
        new Set(),
      ),
    ).toEqual([{ _id: MONITOR_ID, name: MONITOR_NAME, type: "Monitor" }]);
  });

  test("an `{ _id }`-only object - a relation selected as `true` - is looked up like a bare ID", () => {
    const items: Array<AffectedResourceItem> = toItems(
      [{ _id: MONITOR_ID }],
      "Monitor",
      new Map(),
      new Set(),
    );

    expect(items).toEqual([
      {
        _id: MONITOR_ID,
        name: NAME_LOADING_PLACEHOLDER,
        type: "Monitor",
        isNameLoading: true,
      },
    ]);
  });

  test("an object with an empty name falls back to the cache before anything else", () => {
    const cache: Map<string, string> = new Map([
      [`Monitor:${MONITOR_ID}`, MONITOR_NAME],
    ]);

    expect(
      toItems([{ _id: MONITOR_ID, name: "" }], "Monitor", cache, new Set()),
    ).toEqual([{ _id: MONITOR_ID, name: MONITOR_NAME, type: "Monitor" }]);
  });

  test("an ID whose lookup failed is shown as unknown and no longer waits", () => {
    const items: Array<AffectedResourceItem> = toItems(
      [MONITOR_ID],
      "Monitor",
      new Map(),
      new Set([`Monitor:${MONITOR_ID}`]),
    );

    expect(items).toEqual([
      { _id: MONITOR_ID, name: "Unknown Monitor", type: "Monitor" },
    ]);
  });

  test("a name that turns up after a failed lookup wins over 'unknown'", () => {
    const cache: Map<string, string> = new Map([
      [`Monitor:${MONITOR_ID}`, MONITOR_NAME],
    ]);

    expect(
      toItems(
        [MONITOR_ID],
        "Monitor",
        cache,
        new Set([`Monitor:${MONITOR_ID}`]),
      ),
    ).toEqual([{ _id: MONITOR_ID, name: MONITOR_NAME, type: "Monitor" }]);
  });

  test("placeholders are never written to the cache", () => {
    const cache: Map<string, string> = new Map();

    toItems(
      [MONITOR_ID, { _id: SECOND_MONITOR_ID }],
      "Monitor",
      cache,
      new Set([`Monitor:${SECOND_MONITOR_ID}`]),
    );

    expect(cache.size).toBe(0);
  });

  test("empty entries and objects without an ID are skipped", () => {
    expect(
      toItems(
        [null, undefined, "", { name: "orphan" }, MONITOR_ID],
        "Monitor",
        new Map(),
        new Set(),
      ).map((item: AffectedResourceItem) => {
        return item._id;
      }),
    ).toEqual([MONITOR_ID]);
  });

  test("an undefined or empty list gives no items", () => {
    expect(toItems(undefined, "Monitor", new Map(), new Set())).toEqual([]);
    expect(toItems([], "Monitor", new Map(), new Set())).toEqual([]);
  });

  test("a value that is not a list - the picker's own payload, mid form update - gives no items instead of throwing", () => {
    const payload: AffectedResourcesPayload = {
      __affectedResourcesPayload: true,
      monitors: [MONITOR_ID],
      hosts: [],
      kubernetesClusters: [],
      dockerHosts: [],
      podmanHosts: [],
      proxmoxClusters: [],
      vmwareVCenters: [],
      cephClusters: [],
      dockerSwarmClusters: [],
      iotFleets: [],
      networkSites: [],
      services: [],
    };

    expect(
      toItems(
        payload as unknown as Array<unknown>,
        "Monitor",
        new Map(),
        new Set(),
      ),
    ).toEqual([]);
    expect(
      toItems(
        MONITOR_ID as unknown as Array<unknown>,
        "Monitor",
        new Map(),
        new Set(),
      ),
    ).toEqual([]);
  });

  test("fallback labels use each type's display label", () => {
    expect(getUnnamedResourceLabel("KubernetesCluster")).toBe(
      "Unnamed Kubernetes Cluster",
    );
    expect(getUnknownResourceLabel("KubernetesCluster")).toBe(
      "Unknown Kubernetes Cluster",
    );
    expect(getUnknownResourceLabel("VMwareVCenter")).toBe("Unknown vCenter");
    expect(getUnknownResourceLabel("Service")).toBe("Unknown Service");
  });
});

describe("AffectedResourcesPicker chips for resources that arrive as bare IDs", () => {
  test("shows the monitor's real name, never 'Unnamed Monitor' (the Edit Incident modal regression)", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);

    renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID]),
      resourceTypes: ["Monitor"],
    });

    // While the lookup is in flight the chip says so, rather than inventing a name.
    const pending: HTMLElement = screen.getByText(NAME_LOADING_PLACEHOLDER);
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Unnamed Monitor")).toBeNull();

    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();
    expect(screen.queryByText("Unnamed Monitor")).toBeNull();
    expect(screen.queryByText(NAME_LOADING_PLACEHOLDER)).toBeNull();
    expect(screen.getByText(MONITOR_NAME)).not.toHaveAttribute("aria-busy");
  });

  test("asks the API for exactly the IDs it needs, by ID, selecting only the name", async () => {
    seed(Monitor, [
      { _id: MONITOR_ID, name: MONITOR_NAME },
      { _id: SECOND_MONITOR_ID, name: SECOND_MONITOR_NAME },
    ]);

    renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID, SECOND_MONITOR_ID]),
      resourceTypes: ["Monitor"],
    });

    await screen.findByText(SECOND_MONITOR_NAME);

    expect(getListMock).toHaveBeenCalledTimes(1);
    const call: GetListArgs = lookupCalls()[0]!;
    expect(call.modelType).toBe(Monitor);
    expect(lookedUpIds(call)).toEqual([MONITOR_ID, SECOND_MONITOR_ID]);
    expect(call.select).toEqual({ _id: true, name: true });
    expect(call.limit).toBe(2);
    expect(call.skip).toBe(0);
  });

  test("resolves `{ _id }`-only objects too", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);

    renderPicker({
      monitors: [{ _id: MONITOR_ID } as unknown as Monitor],
      resourceTypes: ["Monitor"],
    });

    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();
  });

  test("makes no request when every resource already carries its name", async () => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    monitor.name = MONITOR_NAME;

    renderPicker({ monitors: [monitor], resourceTypes: ["Monitor"] });

    expect(screen.getByText(MONITOR_NAME)).toBeInTheDocument();
    // Give any stray effect a chance to fire before asserting it did not.
    await act(async () => {
      await Promise.resolve();
    });
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("names every resource type with its own model, one request per type", async () => {
    const models: Record<AffectedResourceType, ModelClass> = {
      Monitor: Monitor,
      Host: Host,
      KubernetesCluster: KubernetesCluster,
      DockerHost: DockerHost,
      PodmanHost: PodmanHost,
      ProxmoxCluster: ProxmoxCluster,
      VMwareVCenter: VMwareVCenter,
      CephCluster: CephCluster,
      DockerSwarmCluster: DockerSwarmCluster,
      IoTFleet: IoTFleet,
      NetworkSite: NetworkSite,
      Service: Service,
    };
    ALL_RESOURCE_TYPES.forEach((type: AffectedResourceType, index: number) => {
      seed(models[type], [{ _id: id(100 + index), name: `${type} one` }]);
    });

    const idFor: (type: AffectedResourceType) => Array<never> = (
      type: AffectedResourceType,
    ): Array<never> => {
      return asModels<never>([id(100 + ALL_RESOURCE_TYPES.indexOf(type))]);
    };

    renderPicker({
      monitors: idFor("Monitor"),
      hosts: idFor("Host"),
      kubernetesClusters: idFor("KubernetesCluster"),
      dockerHosts: idFor("DockerHost"),
      podmanHosts: idFor("PodmanHost"),
      proxmoxClusters: idFor("ProxmoxCluster"),
      vmwareVCenters: idFor("VMwareVCenter"),
      cephClusters: idFor("CephCluster"),
      dockerSwarmClusters: idFor("DockerSwarmCluster"),
      iotFleets: idFor("IoTFleet"),
      networkSites: idFor("NetworkSite"),
      services: idFor("Service"),
      resourceTypes: ALL_RESOURCE_TYPES,
    });

    for (const type of ALL_RESOURCE_TYPES) {
      expect(await screen.findByText(`${type} one`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/^Unnamed /)).toBeNull();
    expect(screen.queryByText(/^Unknown /)).toBeNull();

    const calls: Array<GetListArgs> = lookupCalls();
    expect(calls).toHaveLength(ALL_RESOURCE_TYPES.length);
    for (const type of ALL_RESOURCE_TYPES) {
      const forType: Array<GetListArgs> = calls.filter((call: GetListArgs) => {
        return call.modelType === models[type];
      });
      expect(forType).toHaveLength(1);
      expect(lookedUpIds(forType[0]!)).toEqual([
        id(100 + ALL_RESOURCE_TYPES.indexOf(type)),
      ]);
    }
  });

  test("does not look up a type the page does not offer", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);
    seed(Host, [{ _id: id(50), name: "web-01" }]);

    renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID]),
      hosts: asModels<Host>([id(50)]),
      resourceTypes: ["Monitor"],
    });

    await screen.findByText(MONITOR_NAME);

    expect(
      lookupCalls().map((call: GetListArgs) => {
        return call.modelType;
      }),
    ).toEqual([Monitor]);
    expect(screen.queryByText("web-01")).toBeNull();
  });

  test(`splits a large selection into batches of ${NAME_LOOKUP_BATCH_SIZE}`, async () => {
    const count: number = NAME_LOOKUP_BATCH_SIZE * 2 + 50;
    const ids: Array<string> = [];
    for (let i: number = 0; i < count; i++) {
      ids.push(id(1000 + i));
    }
    seed(
      Monitor,
      ids.map((monitorId: string, i: number) => {
        return { _id: monitorId, name: `monitor-${i}` };
      }),
    );

    renderPicker({
      monitors: asModels<Monitor>(ids),
      resourceTypes: ["Monitor"],
    });

    // The first chip is always rendered, even past the visible-chip cap.
    expect(await screen.findByText("monitor-0")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(NAME_LOADING_PLACEHOLDER)).toBeNull();
    });

    const calls: Array<GetListArgs> = lookupCalls();
    expect(
      calls.map((call: GetListArgs) => {
        return lookedUpIds(call).length;
      }),
    ).toEqual([NAME_LOOKUP_BATCH_SIZE, NAME_LOOKUP_BATCH_SIZE, 50]);
    expect(
      calls.flatMap((call: GetListArgs) => {
        return lookedUpIds(call);
      }),
    ).toEqual(ids);

    // Every chip is named once revealed, including the ones in the last batch.
    fireEvent.click(screen.getByRole("button", { name: /more/ }));
    expect(screen.getByText(`monitor-${count - 1}`)).toBeInTheDocument();
    expect(screen.queryByText("Unnamed Monitor")).toBeNull();
  });

  test("a re-render with the same IDs does not ask again, in flight or after", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);
    gate = makeDeferred();

    const view: RenderResult = renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID]),
      resourceTypes: ["Monitor"],
    });

    // New array identity, same IDs, while the first lookup is still pending.
    view.rerender(
      <AffectedResourcesPicker
        onChange={noop}
        monitors={asModels<Monitor>([MONITOR_ID])}
        resourceTypes={["Monitor"]}
      />,
    );
    expect(getListMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate!.resolve();
    });
    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();

    view.rerender(
      <AffectedResourcesPicker
        onChange={noop}
        monitors={asModels<Monitor>([MONITOR_ID])}
        resourceTypes={["Monitor"]}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(MONITOR_NAME)).toBeInTheDocument();
  });

  test("when the selection grows, only the new ID is looked up", async () => {
    seed(Monitor, [
      { _id: MONITOR_ID, name: MONITOR_NAME },
      { _id: SECOND_MONITOR_ID, name: SECOND_MONITOR_NAME },
    ]);

    const view: RenderResult = renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID]),
      resourceTypes: ["Monitor"],
    });
    await screen.findByText(MONITOR_NAME);

    view.rerender(
      <AffectedResourcesPicker
        onChange={noop}
        monitors={asModels<Monitor>([MONITOR_ID, SECOND_MONITOR_ID])}
        resourceTypes={["Monitor"]}
      />,
    );

    expect(await screen.findByText(SECOND_MONITOR_NAME)).toBeInTheDocument();
    expect(screen.getByText(MONITOR_NAME)).toBeInTheDocument();
    const calls: Array<GetListArgs> = lookupCalls();
    expect(calls).toHaveLength(2);
    expect(lookedUpIds(calls[1]!)).toEqual([SECOND_MONITOR_ID]);
  });

  test("a resource that really has no name is the one case that reads 'Unnamed'", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: "" }]);

    renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID]),
      resourceTypes: ["Monitor"],
    });

    expect(await screen.findByText("Unnamed Monitor")).toBeInTheDocument();
  });

  test("an ID the API does not return reads 'Unknown' and is not asked for again", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);

    const view: RenderResult = renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID, SECOND_MONITOR_ID]),
      resourceTypes: ["Monitor"],
    });

    expect(await screen.findByText("Unknown Monitor")).toBeInTheDocument();
    expect(screen.getByText(MONITOR_NAME)).toBeInTheDocument();
    expect(screen.queryByText("Unnamed Monitor")).toBeNull();

    view.rerender(
      <AffectedResourcesPicker
        onChange={noop}
        monitors={asModels<Monitor>([MONITOR_ID, SECOND_MONITOR_ID])}
        resourceTypes={["Monitor"]}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a failed lookup for one type leaves the other types named", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);
    seed(Host, [{ _id: id(50), name: "web-01" }]);
    failingModelTypes.add(Host);

    renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID]),
      hosts: asModels<Host>([id(50)]),
      resourceTypes: ["Monitor", "Host"],
    });

    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();
    expect(await screen.findByText("Unknown Host")).toBeInTheDocument();
    expect(screen.queryByText(NAME_LOADING_PLACEHOLDER)).toBeNull();
  });

  test("a chip can be removed while its name is still loading", async () => {
    seed(Monitor, [
      { _id: MONITOR_ID, name: MONITOR_NAME },
      { _id: SECOND_MONITOR_ID, name: SECOND_MONITOR_NAME },
    ]);
    gate = makeDeferred();
    const onChange: MockFunction = getJestMockFunction();

    renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID, SECOND_MONITOR_ID]),
      resourceTypes: ["Monitor"],
      onChange: onChange as unknown as ComponentProps["onChange"],
    });

    const removeButtons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Remove monitor",
    });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]!);

    const payload: AffectedResourcesPayload = onChange.mock
      .calls[0]![0] as AffectedResourcesPayload;
    expect(payload.monitors).toEqual([SECOND_MONITOR_ID]);

    await act(async () => {
      gate!.resolve();
    });
  });

  test("the remove button is labelled with the real name once it lands", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);

    renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID]),
      resourceTypes: ["Monitor"],
    });

    expect(
      await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Unnamed Monitor" }),
    ).toBeNull();
  });

  test("a lookup that lands after the picker is gone does not throw", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);
    gate = makeDeferred();

    const view: RenderResult = renderPicker({
      monitors: asModels<Monitor>([MONITOR_ID]),
      resourceTypes: ["Monitor"],
    });
    view.unmount();

    await act(async () => {
      gate!.resolve();
      await gate!.promise;
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("works under StrictMode's double effect without leaving a chip on 'Loading...'", async () => {
    seed(Monitor, [{ _id: MONITOR_ID, name: MONITOR_NAME }]);

    render(
      <React.StrictMode>
        <AffectedResourcesPicker
          onChange={noop}
          monitors={asModels<Monitor>([MONITOR_ID])}
          resourceTypes={["Monitor"]}
        />
      </React.StrictMode>,
    );

    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();
    expect(screen.queryByText(NAME_LOADING_PLACEHOLDER)).toBeNull();
    expect(lookupCalls()).toHaveLength(1);
  });
});

/*
 * The form round trip the picker lives in: it reports IDs, the page's onChange
 * writes those IDs back into the form values, and the picker re-renders from
 * bare IDs. This harness plays the form.
 */
const FormHarness: (props: {
  initialMonitors: Array<string>;
}) => ReactElement = (props: {
  initialMonitors: Array<string>;
}): ReactElement => {
  const [monitors, setMonitors] = useState<Array<string>>(
    props.initialMonitors,
  );
  return (
    <AffectedResourcesPicker
      monitors={asModels<Monitor>(monitors)}
      resourceTypes={["Monitor"]}
      onChange={(payload: AffectedResourcesPayload) => {
        setMonitors(payload.monitors);
      }}
    />
  );
};

describe("AffectedResourcesPicker inside a form round trip", () => {
  test("a monitor picked from the search keeps its name once the form stores only its ID", async () => {
    seed(Monitor, [
      { _id: MONITOR_ID, name: MONITOR_NAME },
      { _id: SECOND_MONITOR_ID, name: SECOND_MONITOR_NAME },
    ]);

    render(<FormHarness initialMonitors={[]} />);

    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(
      await screen.findByRole("option", { name: SECOND_MONITOR_NAME }),
    );

    /*
     * The chip reads from a bare ID now; the search result already named it.
     * The dropdown stays open after a pick, so check for the chip's own
     * remove button (named, so not stuck on "Loading...") and that the
     * option left the list — the same text would otherwise match either.
     */
    expect(
      await screen.findByRole("button", {
        name: `Remove ${SECOND_MONITOR_NAME}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: SECOND_MONITOR_NAME }),
    ).toBeNull();
    expect(screen.queryByText("Unnamed Monitor")).toBeNull();
    expect(screen.queryByText(NAME_LOADING_PLACEHOLDER)).toBeNull();
    expect(lookupCalls()).toHaveLength(0);
  });

  test("an edit form that opens on saved IDs names them, and removing one keeps the rest named", async () => {
    seed(Monitor, [
      { _id: MONITOR_ID, name: MONITOR_NAME },
      { _id: SECOND_MONITOR_ID, name: SECOND_MONITOR_NAME },
    ]);

    render(<FormHarness initialMonitors={[MONITOR_ID, SECOND_MONITOR_ID]} />);

    await screen.findByText(MONITOR_NAME);
    await screen.findByText(SECOND_MONITOR_NAME);

    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );

    await waitFor(() => {
      expect(screen.queryByText(MONITOR_NAME)).toBeNull();
    });
    expect(screen.getByText(SECOND_MONITOR_NAME)).toBeInTheDocument();
    expect(lookupCalls()).toHaveLength(1);
  });
});

describe("AffectedResourcesPicker read-only", () => {
  test("names bare IDs, with no search input and no remove buttons", async () => {
    seed(Host, [{ _id: id(50), name: "web-01" }]);
    seed(Service, [{ _id: id(60), name: "checkout-api" }]);

    renderPicker({
      readOnly: true,
      hosts: asModels<Host>([id(50)]),
      services: asModels<Service>([id(60)]),
      resourceTypes: ["Host", "Service"],
    });

    expect(await screen.findByText("web-01")).toBeInTheDocument();
    expect(await screen.findByText("checkout-api")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("a long selection can still be expanded, but offers no Clear all", async () => {
    const ids: Array<string> = [];
    for (let i: number = 0; i < 60; i++) {
      ids.push(id(2000 + i));
    }
    seed(
      Monitor,
      ids.map((monitorId: string, i: number) => {
        return { _id: monitorId, name: `monitor-${i}` };
      }),
    );

    renderPicker({
      readOnly: true,
      monitors: asModels<Monitor>(ids),
      resourceTypes: ["Monitor"],
    });

    await screen.findByText("monitor-0");
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ 10 more" }));
    expect(await screen.findByText("monitor-59")).toBeInTheDocument();
  });

  test("disabled is not read-only: a disabled picker still shows its (disabled) input", () => {
    renderPicker({
      disabled: true,
      monitors: [],
      resourceTypes: ["Monitor"],
    });

    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

/*
 * Create Alert's summary step. The wizard stores the picked resources as
 * bare IDs; the field's own summary element hands them to a read-only picker
 * so the summary names them, instead of the generic summary printing the
 * host IDs raw and dropping every other type.
 */
describe("AffectedResourcesPicker as a wizard summary", () => {
  const HOST_ID: string = id(70);
  const CLUSTER_ID: string = id(71);
  const PODMAN_ID: string = id(72);
  const SERVICE_ID: string = id(73);

  const SUMMARY_FIELDS: Fields<JSONObject> = [
    {
      field: { hosts: true },
      title: "Other Affected Resources",
      fieldType: FormFieldSchemaType.CustomComponent,
      getSummaryElement: (item: FormValues<JSONObject>): ReactElement => {
        return (
          <AffectedResourcesPicker
            readOnly={true}
            hosts={item["hosts"] as Array<Host>}
            kubernetesClusters={
              item["kubernetesClusters"] as Array<KubernetesCluster>
            }
            dockerHosts={item["dockerHosts"] as Array<DockerHost>}
            podmanHosts={item["podmanHosts"] as Array<PodmanHost>}
            services={item["services"] as Array<Service>}
            resourceTypes={[
              "Host",
              "KubernetesCluster",
              "DockerHost",
              "PodmanHost",
              "Service",
            ]}
            onChange={noop}
          />
        );
      },
    },
  ];

  test("names every picked resource type, not only hosts, and prints no IDs", async () => {
    seed(Host, [{ _id: HOST_ID, name: "web-01" }]);
    seed(KubernetesCluster, [{ _id: CLUSTER_ID, name: "prod-eu" }]);
    seed(PodmanHost, [{ _id: PODMAN_ID, name: "podman-1" }]);
    seed(Service, [{ _id: SERVICE_ID, name: "checkout-api" }]);

    render(
      <FormSummary<JSONObject>
        formValues={
          {
            hosts: [HOST_ID],
            kubernetesClusters: [CLUSTER_ID],
            dockerHosts: [],
            podmanHosts: [PODMAN_ID],
            services: [SERVICE_ID],
          } as FormValues<JSONObject>
        }
        formFields={SUMMARY_FIELDS}
        formSteps={undefined}
      />,
    );

    expect(await screen.findByText("web-01")).toBeInTheDocument();
    expect(await screen.findByText("prod-eu")).toBeInTheDocument();
    expect(await screen.findByText("podman-1")).toBeInTheDocument();
    expect(await screen.findByText("checkout-api")).toBeInTheDocument();
    for (const rawId of [HOST_ID, CLUSTER_ID, PODMAN_ID, SERVICE_ID]) {
      expect(screen.queryByText(rawId, { exact: false })).toBeNull();
    }
  });
});
