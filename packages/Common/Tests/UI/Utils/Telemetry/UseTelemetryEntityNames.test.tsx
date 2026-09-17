import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * useTelemetryEntityNames is what every telemetry viewer calls to turn the
 * ids behind its scope / facet chips into "RUM Application: checkout-web".
 * It runs on every render of those viewers, so it must not refetch when a
 * parent re-creates the same ids as new ObjectID instances, must refetch
 * when the id set really changes, and must never set state after unmount
 * or surface a failed lookup as an error.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the
 * compiled requires, so getListMock is still unassigned when the factory
 * runs.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import useTelemetryEntityNames, {
  UseTelemetryEntityNamesOptions,
} from "../../../../UI/Utils/Telemetry/UseTelemetryEntityNames";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "../../../../UI/Utils/Telemetry/TelemetryEntityNames";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import Service from "../../../../Models/DatabaseModels/Service";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import ProjectUtil from "../../../../UI/Utils/Project";

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000001";
const SERVICE_ID: string = "11111111-0000-4000-8000-000000000001";
const SERVICE_ID_2: string = "11111111-0000-4000-8000-000000000002";
const RUM_ID: string = "22222222-0000-4000-8000-000000000001";

type IdList = Array<ObjectID | string | null | undefined> | undefined;

interface HookProps {
  ids: IdList;
  options?: UseTelemetryEntityNamesOptions | undefined;
}

interface ResolveArgs {
  ids: Array<string>;
  projectId: ObjectID | string | null | undefined;
  typeHints?: Record<string, ServiceType | undefined> | undefined;
  entityTypes?: Array<ServiceType> | undefined;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

const deferred: <T>() => Deferred<T> = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: Error) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
};

const flushPromises: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

const entityMap: (
  entries: Array<[string, string, ServiceType, string]>,
) => TelemetryEntityNameMap = (
  entries: Array<[string, string, ServiceType, string]>,
): TelemetryEntityNameMap => {
  const map: TelemetryEntityNameMap = {};
  for (const [id, name, entityType, typeLabel] of entries) {
    map[id] = { id, name, entityType, typeLabel };
  }
  return map;
};

const RUM_MAP: TelemetryEntityNameMap = entityMap([
  [RUM_ID, "checkout-web", ServiceType.RealUserMonitor, "RUM Application"],
]);
const SERVICE_MAP: TelemetryEntityNameMap = entityMap([
  [SERVICE_ID, "checkout-api", ServiceType.OpenTelemetry, "Service"],
]);

/*
 * Named structurally rather than as jest.SpiedFunction: jest.spyOn from
 * @jest/globals returns jest-mock's SpyInstance, which does not assign to
 * the global @types/jest declaration.
 */
interface ResolveSpy {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (
    fn: (args: ResolveArgs) => Promise<TelemetryEntityNameMap>,
  ) => unknown;
  mockResolvedValue: (value: TelemetryEntityNameMap) => unknown;
  mockRejectedValue: (value: Error) => unknown;
}

interface ConsoleSpy {
  mock: { calls: Array<Array<unknown>> };
}

let resolveSpy: ResolveSpy;
let consoleErrorSpy: ConsoleSpy;

const resolveCalls: () => Array<ResolveArgs> = (): Array<ResolveArgs> => {
  return resolveSpy.mock.calls.map((call: Array<unknown>): ResolveArgs => {
    return call[0] as ResolveArgs;
  });
};

const renderNames: (initialProps: HookProps) => {
  result: { current: TelemetryEntityNameMap };
  rerender: (props: HookProps) => void;
  unmount: () => void;
} = (
  initialProps: HookProps,
): {
  result: { current: TelemetryEntityNameMap };
  rerender: (props: HookProps) => void;
  unmount: () => void;
} => {
  return renderHook(
    (props: HookProps): TelemetryEntityNameMap => {
      return useTelemetryEntityNames(props.ids, props.options);
    },
    { initialProps },
  );
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  resolveSpy = jest.spyOn(
    TelemetryEntityNameResolver,
    "resolve",
  ) as unknown as ResolveSpy;
  resolveSpy.mockResolvedValue({});
  consoleErrorSpy = jest.spyOn(console, "error") as unknown as ConsoleSpy;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("useTelemetryEntityNames", () => {
  test("starts empty, then fills in once the lookup lands", async () => {
    const response: Deferred<TelemetryEntityNameMap> = deferred();
    resolveSpy.mockImplementation(() => {
      return response.promise;
    });

    const { result } = renderNames({ ids: [RUM_ID] });
    expect(result.current).toEqual({});

    await act(async () => {
      response.resolve(RUM_MAP);
      await flushPromises();
    });

    expect(result.current).toEqual(RUM_MAP);
  });

  test("forwards the current projectId and the normalized id list", async () => {
    renderNames({
      ids: [
        new ObjectID(SERVICE_ID_2),
        ` ${SERVICE_ID} `,
        null,
        undefined,
        "",
        SERVICE_ID,
      ],
    });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });
    const args: ResolveArgs = resolveCalls()[0]!;
    expect(args.ids).toEqual([SERVICE_ID, SERVICE_ID_2]);
    expect(args.projectId?.toString()).toBe(PROJECT_ID);
  });

  test("forwards typeHints and entityTypes", async () => {
    const options: UseTelemetryEntityNamesOptions = {
      typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
      entityTypes: [ServiceType.RealUserMonitor, ServiceType.OpenTelemetry],
    };
    renderNames({ ids: [RUM_ID], options });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });
    expect(resolveCalls()[0]!.typeHints).toEqual({
      [RUM_ID]: ServiceType.RealUserMonitor,
    });
    expect(resolveCalls()[0]!.entityTypes).toEqual([
      ServiceType.RealUserMonitor,
      ServiceType.OpenTelemetry,
    ]);
  });

  test("without options, no hints or type restriction are sent", async () => {
    renderNames({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });
    expect(resolveCalls()[0]!.typeHints).toBeUndefined();
    expect(resolveCalls()[0]!.entityTypes).toBeUndefined();
  });

  test.each([
    ["an empty array", []],
    ["undefined", undefined],
    ["only blank / null ids", ["", "  ", null, undefined]],
  ])(
    "%s returns {} and makes no request",
    async (_name: string, ids: IdList) => {
      const { result } = renderNames({ ids });
      await act(async () => {
        await flushPromises();
      });
      expect(result.current).toEqual({});
      expect(resolveSpy.mock.calls).toHaveLength(0);
      expect(getListMock).not.toHaveBeenCalled();
    },
  );

  test("re-renders with equivalent new ObjectID instances do not refetch", async () => {
    resolveSpy.mockResolvedValue(SERVICE_MAP);
    const { result, rerender } = renderNames({
      ids: [new ObjectID(SERVICE_ID), new ObjectID(SERVICE_ID_2)],
    });
    await waitFor(() => {
      expect(result.current).toEqual(SERVICE_MAP);
    });

    // New instances, new array, different order, plus a duplicate string.
    rerender({
      ids: [new ObjectID(SERVICE_ID_2), new ObjectID(SERVICE_ID), SERVICE_ID],
    });
    rerender({ ids: [SERVICE_ID, SERVICE_ID_2] });
    await act(async () => {
      await flushPromises();
    });

    expect(resolveSpy.mock.calls).toHaveLength(1);
    expect(result.current).toEqual(SERVICE_MAP);
  });

  test("re-renders with equivalent new options objects do not refetch", async () => {
    const { rerender } = renderNames({
      ids: [RUM_ID],
      options: {
        typeHints: { [RUM_ID]: ServiceType.RealUserMonitor },
        entityTypes: [ServiceType.RealUserMonitor, ServiceType.Host],
      },
    });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });

    rerender({
      ids: [RUM_ID],
      options: {
        // Fresh objects, types in another order, an undefined hint added.
        typeHints: {
          [RUM_ID]: ServiceType.RealUserMonitor,
          [SERVICE_ID]: undefined,
        },
        entityTypes: [ServiceType.Host, ServiceType.RealUserMonitor],
      },
    });
    await act(async () => {
      await flushPromises();
    });

    expect(resolveCalls()).toHaveLength(1);
  });

  test("a changed id set refetches and replaces the map", async () => {
    resolveSpy.mockImplementation((args: ResolveArgs) => {
      return Promise.resolve(args.ids.includes(RUM_ID) ? RUM_MAP : SERVICE_MAP);
    });

    const { result, rerender } = renderNames({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(SERVICE_MAP);
    });

    rerender({ ids: [RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(RUM_MAP);
    });

    expect(
      resolveCalls().map((args: ResolveArgs): Array<string> => {
        return args.ids;
      }),
    ).toEqual([[SERVICE_ID], [RUM_ID]]);
  });

  test("switching project refetches the same ids for the new project", async () => {
    const OTHER_PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000002";
    const { rerender } = renderNames({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(OTHER_PROJECT_ID));
    rerender({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(2);
    });

    expect(
      resolveCalls().map((args: ResolveArgs): string => {
        return `${args.projectId}`;
      }),
    ).toEqual([PROJECT_ID, OTHER_PROJECT_ID]);
  });

  test("adding an id to the set refetches", async () => {
    const { rerender } = renderNames({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });
    rerender({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(2);
    });
    expect(resolveCalls()[1]!.ids).toEqual([SERVICE_ID, RUM_ID].sort());
  });

  test("changed typeHints refetch with the new hints", async () => {
    const { rerender } = renderNames({ ids: [RUM_ID] });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });
    rerender({
      ids: [RUM_ID],
      options: { typeHints: { [RUM_ID]: ServiceType.RealUserMonitor } },
    });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(2);
    });
    expect(resolveCalls()[1]!.typeHints).toEqual({
      [RUM_ID]: ServiceType.RealUserMonitor,
    });
  });

  test("changed entityTypes refetch with the new restriction", async () => {
    const { rerender } = renderNames({
      ids: [RUM_ID],
      options: { entityTypes: [ServiceType.OpenTelemetry] },
    });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });
    rerender({ ids: [RUM_ID] });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(2);
    });
    expect(resolveCalls()[1]!.entityTypes).toBeUndefined();
  });

  test("clearing the ids resets the map to {} without a request", async () => {
    resolveSpy.mockResolvedValue(SERVICE_MAP);
    const { result, rerender } = renderNames({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(SERVICE_MAP);
    });

    rerender({ ids: [] });
    await waitFor(() => {
      expect(result.current).toEqual({});
    });
    expect(resolveCalls()).toHaveLength(1);
  });

  test("a slow response for a superseded id set never overwrites the newer one", async () => {
    const slow: Deferred<TelemetryEntityNameMap> = deferred();
    const fast: Deferred<TelemetryEntityNameMap> = deferred();
    resolveSpy.mockImplementation((args: ResolveArgs) => {
      return args.ids.includes(SERVICE_ID) ? slow.promise : fast.promise;
    });

    const { result, rerender } = renderNames({ ids: [SERVICE_ID] });
    await act(async () => {
      await flushPromises();
    });
    rerender({ ids: [RUM_ID] });

    await act(async () => {
      fast.resolve(RUM_MAP);
      await flushPromises();
    });
    expect(result.current).toEqual(RUM_MAP);

    await act(async () => {
      slow.resolve(SERVICE_MAP);
      await flushPromises();
    });
    expect(result.current).toEqual(RUM_MAP);
  });

  test("unmounting before the lookup lands does not set state or warn", async () => {
    const response: Deferred<TelemetryEntityNameMap> = deferred();
    resolveSpy.mockImplementation(() => {
      return response.promise;
    });

    const { result, unmount } = renderNames({ ids: [RUM_ID] });
    await act(async () => {
      await flushPromises();
    });
    unmount();

    response.resolve(RUM_MAP);
    await flushPromises();

    expect(result.current).toEqual({});
    expect(consoleErrorSpy.mock.calls).toHaveLength(0);
  });

  test("a rejected lookup is swallowed: map stays {} and nothing is logged", async () => {
    /*
     * Rejected through a deferred, after the hook has subscribed. An
     * already-rejected promise returned from the spy trips zone.js (loaded
     * by a transitive dependency in this jsdom environment) into logging a
     * false "unhandled rejection": native `await` attaches its handler to
     * a non-native thenable one job later than zone's check runs.
     */
    const response: Deferred<TelemetryEntityNameMap> = deferred();
    resolveSpy.mockImplementation(() => {
      return response.promise;
    });

    const { result } = renderNames({ ids: [SERVICE_ID] });
    await act(async () => {
      await flushPromises();
    });
    await act(async () => {
      response.reject(new Error("network down"));
      await flushPromises();
    });

    expect(resolveCalls()).toHaveLength(1);
    expect(result.current).toEqual({});
    expect(consoleErrorSpy.mock.calls).toHaveLength(0);
  });

  test("a rejection after unmount is swallowed too", async () => {
    const response: Deferred<TelemetryEntityNameMap> = deferred();
    resolveSpy.mockImplementation(() => {
      return response.promise;
    });
    const { unmount } = renderNames({ ids: [SERVICE_ID] });
    await act(async () => {
      await flushPromises();
    });
    unmount();
    response.reject(new Error("late failure"));
    await flushPromises();
    expect(consoleErrorSpy.mock.calls).toHaveLength(0);
  });

  test("a map already filled survives a later failed lookup for new ids", async () => {
    // Deferred rejection: see the zone.js note in the test above.
    const failing: Deferred<TelemetryEntityNameMap> = deferred();
    resolveSpy.mockImplementation((args: ResolveArgs) => {
      return args.ids.includes(RUM_ID)
        ? failing.promise
        : Promise.resolve(SERVICE_MAP);
    });
    const { result, rerender } = renderNames({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(SERVICE_MAP);
    });
    rerender({ ids: [SERVICE_ID, RUM_ID] });
    await act(async () => {
      await flushPromises();
    });
    await act(async () => {
      failing.reject(new Error("forbidden"));
      await flushPromises();
    });
    expect(consoleErrorSpy.mock.calls).toHaveLength(0);
    expect(resolveCalls()).toHaveLength(2);
    expect(result.current).toEqual(SERVICE_MAP);
  });
});

describe("useTelemetryEntityNames — merging refreshes", () => {
  /*
   * Once the resolver's hit TTL passes, a lookup for ids already on screen
   * can come back without them (the refresh request failed, or the role
   * lost access). The chip must not flip back to a raw UUID, so the hook
   * keeps a name it already shows for an id that is still requested — but
   * only within the same project, and never for ids no longer requested.
   */
  const OTHER_PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000002";

  const BOTH_MAP: TelemetryEntityNameMap = { ...SERVICE_MAP, ...RUM_MAP };

  // Answers the n-th resolve call with responses[n] (the last one repeats).
  const respondInOrder: (responses: Array<TelemetryEntityNameMap>) => void = (
    responses: Array<TelemetryEntityNameMap>,
  ): void => {
    let call: number = 0;
    resolveSpy.mockImplementation(() => {
      const response: TelemetryEntityNameMap =
        responses[Math.min(call, responses.length - 1)]!;
      call++;
      return Promise.resolve(response);
    });
  };

  const settle: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      await flushPromises();
    });
  };

  test("a refresh for the same ids that comes back empty keeps the names already shown", async () => {
    respondInOrder([BOTH_MAP, {}]);
    const { result, rerender } = renderNames({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(BOTH_MAP);
    });

    // New hints re-run the lookup for exactly the same ids.
    rerender({
      ids: [SERVICE_ID, RUM_ID],
      options: { typeHints: { [RUM_ID]: ServiceType.RealUserMonitor } },
    });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(2);
    });
    await settle();

    expect(resolveCalls()[1]!.ids).toEqual([SERVICE_ID, RUM_ID].sort());
    expect(result.current).toEqual(BOTH_MAP);
  });

  test("a partial refresh updates what it resolved, keeps the rest and adds new ids", async () => {
    const renamed: TelemetryEntityNameMap = entityMap([
      [
        SERVICE_ID,
        "checkout-api-renamed",
        ServiceType.OpenTelemetry,
        "Service",
      ],
      [SERVICE_ID_2, "payments-api", ServiceType.OpenTelemetry, "Service"],
    ]);
    respondInOrder([BOTH_MAP, renamed]);
    const { result, rerender } = renderNames({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(BOTH_MAP);
    });

    rerender({ ids: [SERVICE_ID, RUM_ID, SERVICE_ID_2] });
    await waitFor(() => {
      expect(result.current[SERVICE_ID_2]?.name).toBe("payments-api");
    });

    expect(result.current).toEqual({ ...RUM_MAP, ...renamed });
    expect(result.current[SERVICE_ID]?.name).toBe("checkout-api-renamed");
    expect(result.current[RUM_ID]?.name).toBe("checkout-web");
  });

  test("ids dropped from the request are removed from the map even when the lookup is empty", async () => {
    respondInOrder([BOTH_MAP, {}]);
    const { result, rerender } = renderNames({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(BOTH_MAP);
    });

    rerender({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(SERVICE_MAP);
    });
    await settle();
    expect(result.current[RUM_ID]).toBeUndefined();
    expect(result.current).toEqual(SERVICE_MAP);
  });

  test("after a project switch, names resolved for the old project are not kept", async () => {
    respondInOrder([BOTH_MAP, {}]);
    const { result, rerender } = renderNames({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(BOTH_MAP);
    });

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(OTHER_PROJECT_ID));
    rerender({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual({});
    });
    expect(`${resolveCalls()[1]!.projectId}`).toBe(OTHER_PROJECT_ID);
  });

  test("a RUM name is not kept once the same ids are looked up Service-only", async () => {
    respondInOrder([RUM_MAP, {}]);
    const { result, rerender } = renderNames({ ids: [RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(RUM_MAP);
    });

    rerender({
      ids: [RUM_ID],
      options: { entityTypes: [ServiceType.OpenTelemetry] },
    });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(2);
    });
    await act(async () => {
      await flushPromises();
    });
    expect(result.current).toEqual({});
  });

  test("after a project switch, old names are cleared before the new lookup lands", async () => {
    const pending: Deferred<TelemetryEntityNameMap> = deferred();
    let call: number = 0;
    resolveSpy.mockImplementation(() => {
      call++;
      return call === 1 ? Promise.resolve(BOTH_MAP) : pending.promise;
    });
    const { result, rerender } = renderNames({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(BOTH_MAP);
    });

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(OTHER_PROJECT_ID));
    rerender({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual({});
    });

    await act(async () => {
      pending.resolve({});
      await flushPromises();
    });
    expect(result.current).toEqual({});
  });

  test("after a project switch, only the new project's names are shown", async () => {
    const otherProjectRum: TelemetryEntityNameMap = entityMap([
      [RUM_ID, "other-web", ServiceType.RealUserMonitor, "RUM Application"],
    ]);
    respondInOrder([BOTH_MAP, otherProjectRum]);
    const { result, rerender } = renderNames({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(BOTH_MAP);
    });

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(OTHER_PROJECT_ID));
    rerender({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(otherProjectRum);
    });
    expect(result.current[SERVICE_ID]).toBeUndefined();
  });

  test("names kept in the same project are dropped again after a later switch away", async () => {
    respondInOrder([SERVICE_MAP, {}, {}]);
    const { result, rerender } = renderNames({ ids: [SERVICE_ID] });
    await waitFor(() => {
      expect(result.current).toEqual(SERVICE_MAP);
    });

    // Same project, empty refresh: kept.
    rerender({
      ids: [SERVICE_ID],
      options: { typeHints: { [SERVICE_ID]: ServiceType.OpenTelemetry } },
    });
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(2);
    });
    await settle();
    expect(result.current).toEqual(SERVICE_MAP);

    // Other project, empty lookup: gone.
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(OTHER_PROJECT_ID));
    rerender({
      ids: [SERVICE_ID],
      options: { typeHints: { [SERVICE_ID]: ServiceType.OpenTelemetry } },
    });
    await waitFor(() => {
      expect(result.current).toEqual({});
    });
  });
});

describe("useTelemetryEntityNames — end to end through the resolver", () => {
  beforeEach(() => {
    // Use the real resolver; only ModelAPI is faked.
    (resolveSpy as unknown as { mockRestore: () => void }).mockRestore();
    getListMock.mockImplementation((...callArgs: Array<unknown>) => {
      const args: { modelType: unknown } = callArgs[0] as {
        modelType: unknown;
      };
      if (args.modelType === RumApplication) {
        return Promise.resolve({
          data: [{ id: new ObjectID(RUM_ID), name: "checkout-web" }],
        });
      }
      if (args.modelType === Service) {
        return Promise.resolve({
          data: [{ id: new ObjectID(SERVICE_ID), name: "checkout-api" }],
        });
      }
      return Promise.resolve({ data: [] });
    });
  });

  test("a hinted RUM scope id resolves to its application name in one request", async () => {
    const { result } = renderNames({
      ids: [new ObjectID(RUM_ID)],
      options: { typeHints: { [RUM_ID]: ServiceType.RealUserMonitor } },
    });
    await waitFor(() => {
      expect(result.current[RUM_ID]).toEqual({
        id: RUM_ID,
        name: "checkout-web",
        entityType: ServiceType.RealUserMonitor,
        typeLabel: "RUM Application",
      });
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(
      (getListMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(RumApplication);
  });

  test("a mixed Service + RUM set resolves both with their own type labels", async () => {
    const { result } = renderNames({ ids: [SERVICE_ID, RUM_ID] });
    await waitFor(() => {
      expect(result.current[RUM_ID]?.typeLabel).toBe("RUM Application");
    });
    expect(result.current[SERVICE_ID]?.typeLabel).toBe("Service");
    expect(result.current[SERVICE_ID]?.name).toBe("checkout-api");
  });

  test("the projectId id resolves to Unknown Service without a request", async () => {
    const { result } = renderNames({ ids: [PROJECT_ID] });
    await waitFor(() => {
      expect(result.current[PROJECT_ID]?.name).toBe("Unknown Service");
    });
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a failed refresh after the resolver's hit TTL keeps the name on screen", async () => {
    const start: number = 1_800_000_000_000;
    // Structural type: see the SpyInstance note on ResolveSpy above.
    const nowSpy: { mockReturnValue: (value: number) => unknown } = jest
      .spyOn(Date, "now")
      .mockReturnValue(start);
    const settle: () => Promise<void> = async (): Promise<void> => {
      for (let i: number = 0; i < 5; i++) {
        await act(async () => {
          await flushPromises();
        });
      }
    };

    const { result, rerender } = renderNames({ ids: [RUM_ID] });
    await settle();
    expect(result.current[RUM_ID]?.name).toBe("checkout-web");

    /*
     * Every table now fails (thrown synchronously: see the zone.js note
     * above about already-rejected promises), the hit has expired, and a
     * new id makes the hook look the whole set up again.
     */
    getListMock.mockReset();
    getListMock.mockImplementation(() => {
      throw new Error("offline");
    });
    nowSpy.mockReturnValue(start + 61 * 1000);
    rerender({ ids: [RUM_ID, SERVICE_ID_2] });
    await settle();

    // The refresh really was attempted, straight at the RUM table…
    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === RumApplication;
      }),
    ).toBe(true);
    // …and its failure did not turn the chip back into a UUID.
    expect(result.current).toEqual(RUM_MAP);
  });

  test("no project selected: map stays {} and nothing is queried", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
    const { result } = renderNames({ ids: [SERVICE_ID] });
    await act(async () => {
      await flushPromises();
    });
    expect(result.current).toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });
});
