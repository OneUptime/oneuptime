import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Dashboard's useServiceNames feeds real `service.name` values into
 * attribute scoping (e.g. `resource.service.name` on the companion metrics
 * tab). It is now a thin wrapper over the generic telemetry entity
 * resolver, and the danger is that it inherits the resolver's default of
 * searching every table: a RUM application or host name used as a
 * service.name would scope charts to the wrong thing. These tests pin that
 * it only ever looks at the Service table and only returns Services.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the
 * compiled requires, so getListMock is still unassigned when the factory
 * runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import useServiceNames from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Host from "../../../Models/DatabaseModels/Host";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000001";
const SERVICE_ID: string = "11111111-0000-4000-8000-000000000001";
const SERVICE_ID_2: string = "11111111-0000-4000-8000-000000000002";
const RUM_ID: string = "22222222-0000-4000-8000-000000000001";
const HOST_ID: string = "33333333-0000-4000-8000-000000000001";

type ModelType = unknown;

interface HookProps {
  ids: Array<ObjectID> | undefined;
}

interface Row {
  id: ObjectID;
  name: string;
}

interface GetListArgs {
  modelType: ModelType;
  query: { _id: { values: Array<string> } };
  select: Record<string, boolean>;
}

const TABLES: Array<[ModelType, Array<Row>]> = [
  [
    Service,
    [
      { id: new ObjectID(SERVICE_ID), name: "checkout-api" },
      { id: new ObjectID(SERVICE_ID_2), name: "payments-api" },
    ],
  ],
  [RumApplication, [{ id: new ObjectID(RUM_ID), name: "checkout-web" }]],
  [Host, [{ id: new ObjectID(HOST_ID), name: "prod-db-1" }]],
];

const queriedModels: () => Array<ModelType> = (): Array<ModelType> => {
  return getListMock.mock.calls.map((call: Array<unknown>): ModelType => {
    return (call[0] as GetListArgs).modelType;
  });
};

/*
 * Named structurally rather than as jest.SpiedFunction: jest.spyOn from
 * @jest/globals returns jest-mock's SpyInstance, which does not assign to
 * the global @types/jest declaration.
 */
interface ResolveSpy {
  mock: { calls: Array<Array<unknown>> };
  mockResolvedValue: (value: TelemetryEntityNameMap) => unknown;
}

const renderServiceNames: (initialProps: HookProps) => {
  result: { current: Record<string, string> };
  rerender: (props: HookProps) => void;
} = (
  initialProps: HookProps,
): {
  result: { current: Record<string, string> };
  rerender: (props: HookProps) => void;
} => {
  return renderHook(
    (props: HookProps): Record<string, string> => {
      return useServiceNames(props.ids);
    },
    { initialProps },
  );
};

const flushPromises: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  getListMock.mockImplementation((...callArgs: Array<unknown>) => {
    const args: GetListArgs = callArgs[0] as GetListArgs;
    const ids: Array<string> = args.query._id.values.map(
      (value: string): string => {
        return value.toString();
      },
    );
    const table: [ModelType, Array<Row>] | undefined = TABLES.find(
      (entry: [ModelType, Array<Row>]): boolean => {
        return entry[0] === args.modelType;
      },
    );
    return Promise.resolve({
      data: (table ? table[1] : []).filter((item: Row): boolean => {
        return ids.includes(item.id.toString());
      }),
    });
  });
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Dashboard useServiceNames", () => {
  test("resolves Service ids to a plain id -> name record", async () => {
    const { result } = renderServiceNames({
      ids: [new ObjectID(SERVICE_ID), new ObjectID(SERVICE_ID_2)],
    });
    expect(result.current).toEqual({});
    await waitFor(() => {
      expect(result.current).toEqual({
        [SERVICE_ID]: "checkout-api",
        [SERVICE_ID_2]: "payments-api",
      });
    });
  });

  test("only ever queries the Service table", async () => {
    const { result } = renderServiceNames({
      ids: [
        new ObjectID(SERVICE_ID),
        new ObjectID(RUM_ID),
        new ObjectID(HOST_ID),
      ],
    });
    await waitFor(() => {
      expect(result.current).toEqual({ [SERVICE_ID]: "checkout-api" });
    });
    await act(async () => {
      await flushPromises();
    });

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(queriedModels()).toEqual([Service]);
  });

  test("a RUM application id (not a Service) is excluded even though it exists", async () => {
    const { result } = renderServiceNames({ ids: [new ObjectID(RUM_ID)] });
    await act(async () => {
      await flushPromises();
    });
    expect(result.current).toEqual({});
    expect(queriedModels()).toEqual([Service]);
    expect(queriedModels()).not.toContain(RumApplication);
  });

  test("the projectId (Unknown Service bucket) is excluded and never queried", async () => {
    const { result } = renderServiceNames({
      ids: [new ObjectID(PROJECT_ID), new ObjectID(SERVICE_ID)],
    });
    await waitFor(() => {
      expect(result.current).toEqual({ [SERVICE_ID]: "checkout-api" });
    });
    expect(result.current[PROJECT_ID]).toBeUndefined();
    const queriedIds: Array<string> = getListMock.mock.calls.flatMap(
      (call: Array<unknown>): Array<string> => {
        return (call[0] as GetListArgs).query._id.values.map(
          (value: string): string => {
            return value.toString();
          },
        );
      },
    );
    expect(queriedIds).not.toContain(PROJECT_ID);
  });

  test("a RUM entity already cached by a generic lookup is not leaked", async () => {
    await TelemetryEntityNameResolver.resolve({
      ids: [RUM_ID, HOST_ID],
      projectId: PROJECT_ID,
    });
    getListMock.mockClear();

    const { result } = renderServiceNames({
      ids: [new ObjectID(RUM_ID), new ObjectID(HOST_ID)],
    });
    await act(async () => {
      await flushPromises();
    });
    expect(result.current).toEqual({});
  });

  test("asks the resolver for Service-only resolution", async () => {
    const resolveSpy: ResolveSpy = jest.spyOn(
      TelemetryEntityNameResolver,
      "resolve",
    ) as unknown as ResolveSpy;
    resolveSpy.mockResolvedValue({});

    renderServiceNames({ ids: [new ObjectID(SERVICE_ID)] });
    await waitFor(() => {
      expect(resolveSpy.mock.calls).toHaveLength(1);
    });
    const args: {
      entityTypes?: Array<ServiceType> | undefined;
      typeHints?: unknown;
    } = resolveSpy.mock.calls[0]![0] as {
      entityTypes?: Array<ServiceType> | undefined;
      typeHints?: unknown;
    };
    expect(args.entityTypes).toEqual([ServiceType.OpenTelemetry]);
    expect(args.typeHints).toBeUndefined();
  });

  test("defensively drops non-Service and Unknown entities from whatever the resolver returns", async () => {
    const resolveSpy: ResolveSpy = jest.spyOn(
      TelemetryEntityNameResolver,
      "resolve",
    ) as unknown as ResolveSpy;
    resolveSpy.mockResolvedValue({
      [SERVICE_ID]: {
        id: SERVICE_ID,
        name: "checkout-api",
        entityType: ServiceType.OpenTelemetry,
        typeLabel: "Service",
      },
      [PROJECT_ID]: {
        id: PROJECT_ID,
        name: "Unknown Service",
        entityType: ServiceType.Unknown,
        typeLabel: "Service",
      },
      [RUM_ID]: {
        id: RUM_ID,
        name: "checkout-web",
        entityType: ServiceType.RealUserMonitor,
        typeLabel: "RUM Application",
      },
      [HOST_ID]: {
        id: HOST_ID,
        name: "prod-db-1",
        entityType: ServiceType.Host,
        typeLabel: "Host",
      },
    });

    const { result } = renderServiceNames({
      ids: [
        new ObjectID(SERVICE_ID),
        new ObjectID(PROJECT_ID),
        new ObjectID(RUM_ID),
        new ObjectID(HOST_ID),
      ],
    });
    await waitFor(() => {
      expect(result.current).toEqual({ [SERVICE_ID]: "checkout-api" });
    });
  });

  test("undefined or empty ids return {} without a request", async () => {
    const { result, rerender } = renderServiceNames({ ids: undefined });
    await act(async () => {
      await flushPromises();
    });
    expect(result.current).toEqual({});

    rerender({ ids: [] });
    await act(async () => {
      await flushPromises();
    });
    expect(result.current).toEqual({});
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("ids that do not resolve are absent so callers fall back to the id", async () => {
    const missing: string = "99999999-0000-4000-8000-000000000001";
    const { result } = renderServiceNames({
      ids: [new ObjectID(missing), new ObjectID(SERVICE_ID)],
    });
    await waitFor(() => {
      expect(result.current[SERVICE_ID]).toBe("checkout-api");
    });
    expect(Object.keys(result.current)).toEqual([SERVICE_ID]);
  });

  test("re-rendering with equivalent ObjectIDs keeps the same record and does not refetch", async () => {
    const { result, rerender } = renderServiceNames({
      ids: [new ObjectID(SERVICE_ID)],
    });
    await waitFor(() => {
      expect(result.current).toEqual({ [SERVICE_ID]: "checkout-api" });
    });
    const first: Record<string, string> = result.current;

    rerender({ ids: [new ObjectID(SERVICE_ID)] });
    await act(async () => {
      await flushPromises();
    });

    expect(result.current).toBe(first);
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("changing the ids resolves the new set", async () => {
    const { result, rerender } = renderServiceNames({
      ids: [new ObjectID(SERVICE_ID)],
    });
    await waitFor(() => {
      expect(result.current).toEqual({ [SERVICE_ID]: "checkout-api" });
    });
    rerender({ ids: [new ObjectID(SERVICE_ID_2)] });
    await waitFor(() => {
      expect(result.current).toEqual({ [SERVICE_ID_2]: "payments-api" });
    });
    expect(queriedModels()).toEqual([Service, Service]);
  });
});
