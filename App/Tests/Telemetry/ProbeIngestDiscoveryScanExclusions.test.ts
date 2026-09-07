import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import Response from "Common/Server/Utils/Response";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "Common/Models/DatabaseModels/Probe";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { getRegisteredHostnames: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedServiceMiddleware: jest.fn() },
  };
});

import "../../FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan";

interface RawExclusion {
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, Array<string>>;
}

interface FindScansArgs {
  query: {
    probeId: ObjectID;
    status: string;
    _id?: RawExclusion;
  };
  limit: number;
  skip: number;
  sort: { createdAt: SortOrder };
}

interface ClaimArgs {
  id: ObjectID;
  data: { status: string; startedAt: Date; statusMessage: null };
  expectedData: { status: string; probeId: ObjectID };
}

const scanService: {
  findBy: jest.Mock;
  findOneBy: jest.Mock;
  updateOneById: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
} = NetworkDeviceDiscoveryScanService as never;

const response: {
  sendErrorResponse: jest.Mock;
  sendEntityArrayResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as never;

const probeId: ObjectID = ObjectID.generate();
const otherProbeId: ObjectID = ObjectID.generate();
const mockResponse: ExpressResponse = {} as ExpressResponse;

async function callEndpoint(
  route: "list" | "result",
  body: JSONObject = {},
  authenticatedProbe: ObjectID | null = probeId,
): Promise<NextFunction> {
  const request: ExpressRequest = {
    body,
    ...(authenticatedProbe ? { probe: new Probe(authenticatedProbe) } : {}),
  } as unknown as ExpressRequest;
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter
    .match("post", `/probe/discovery-scan/${route}`)
    .handlerFunction(request, mockResponse, next);
  return next;
}

function findArgs(): FindScansArgs {
  return scanService.findBy.mock.calls[0]![0] as FindScansArgs;
}

function excludedIds(query: FindScansArgs["query"]): Array<string> {
  return query._id
    ? Object.values(query._id.objectLiteralParameters).flat()
    : [];
}

function makeScan(
  status: string = "Pending",
  assignedProbe: ObjectID = probeId,
): NetworkDeviceDiscoveryScan {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
    ObjectID.generate(),
  );
  scan.probeId = assignedProbe;
  scan.status = status;
  scan.cidr = "192.0.2.0/30";
  return scan;
}

/*
 * Exercise list claims and result rejection against the same mutable rows.
 * Filtering consumes the real query's bound exclusion values before its limit.
 */
function useRows(rows: Array<NetworkDeviceDiscoveryScan>): void {
  scanService.findBy.mockImplementation((input: unknown) => {
    const args: FindScansArgs = input as FindScansArgs;
    const excluded: Array<string> = excludedIds(args.query);
    return Promise.resolve(
      rows
        .filter((row: NetworkDeviceDiscoveryScan): boolean => {
          return (
            row.probeId?.toString() === args.query.probeId.toString() &&
            row.status === args.query.status &&
            !excluded.includes(row.id!.toString())
          );
        })
        .slice(args.skip, args.skip + args.limit),
    );
  });
  scanService.updateColumnsByIdWithoutHooks.mockImplementation(
    (input: unknown) => {
      const args: ClaimArgs = input as ClaimArgs;
      const row: NetworkDeviceDiscoveryScan | undefined = rows.find(
        (scan: NetworkDeviceDiscoveryScan): boolean => {
          return (
            scan.id?.toString() === args.id.toString() &&
            scan.status === args.expectedData.status &&
            scan.probeId?.toString() === args.expectedData.probeId.toString()
          );
        },
      );
      if (row) {
        Object.assign(row, args.data);
      }
      return Promise.resolve();
    },
  );
  scanService.findOneBy.mockImplementation((input: unknown) => {
    const query: { _id: ObjectID; probeId: ObjectID } = (
      input as {
        query: { _id: ObjectID; probeId: ObjectID };
      }
    ).query;
    return Promise.resolve(
      rows.find((row: NetworkDeviceDiscoveryScan): boolean => {
        return (
          row.id?.toString() === query._id.toString() &&
          row.probeId?.toString() === query.probeId.toString()
        );
      }) || null,
    );
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  scanService.findBy.mockResolvedValue([] as never);
  scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
    undefined as never,
  );
});

describe("discovery claims exclude scans still reserved by the probe (#3597)", () => {
  test.each([{}, { excludeScanIds: [] }])(
    "keeps older and idle probes' queries unchanged: %j",
    async (body: JSONObject) => {
      const next: NextFunction = await callEndpoint("list", body);
      expect(next).not.toHaveBeenCalled();
      expect(findArgs().query).toEqual({ probeId, status: "Pending" });
      expect(response.sendEntityArrayResponse).toHaveBeenCalledWith(
        expect.anything(),
        mockResponse,
        [],
        0,
        NetworkDeviceDiscoveryScan,
      );
    },
  );

  test("adds a parameterized ID exclusion before the oldest pending scan is selected", async () => {
    const ids: Array<string> = [
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
    ];
    await callEndpoint("list", {
      excludeScanIds: ids,
      probeId: otherProbeId.toString(),
    });
    const args: FindScansArgs = findArgs();
    expect(args.query.probeId.toString()).toBe(probeId.toString());
    expect(args.query.status).toBe("Pending");
    expect(excludedIds(args.query)).toEqual(ids);
    expect(args.query._id!.getSql('"scan"."_id"')).toMatch(/NOT IN \(:\.\.\./);
    for (const id of ids) {
      expect(args.query._id!.getSql('"scan"."_id"')).not.toContain(id);
    }
    expect(args.limit).toBe(1);
    expect(args.skip).toBe(0);
    expect(args.sort).toEqual({ createdAt: SortOrder.Ascending });
  });

  test("accepts the bounded exclusion list, including the maximum scheduler capacity", async () => {
    const ids: Array<string> = Array.from({ length: 128 }, (): string => {
      return ObjectID.generate().toString();
    });
    const next: NextFunction = await callEndpoint("list", {
      excludeScanIds: ids,
    });
    expect(next).not.toHaveBeenCalled();
    expect(excludedIds(findArgs().query)).toEqual(ids);
  });

  test.each([
    { name: "null", value: null },
    { name: "a string", value: "scan-id" },
    { name: "a number", value: 1 },
    { name: "a boolean", value: true },
    { name: "an object", value: {} },
    { name: "a null entry", value: [null] },
    { name: "a numeric entry", value: [1] },
    { name: "a boolean entry", value: [true] },
    { name: "an object entry", value: [{}] },
    { name: "an empty entry", value: [""] },
    { name: "a malformed UUID", value: ["not-a-uuid"] },
    { name: "an address", value: ["192.0.2.1"] },
    {
      name: "an invalid entry after a valid one",
      value: [ObjectID.generate().toString(), "invalid"],
    },
    {
      name: "a serialized ObjectID instead of a string",
      value: [ObjectID.generate().toJSON()],
    },
    {
      name: "more than 128 entries",
      value: Array.from({ length: 129 }, (): string => {
        return ObjectID.generate().toString();
      }),
    },
  ])(
    "rejects $name before reading or claiming any scan",
    async ({ value }: { value: unknown }) => {
      const next: NextFunction = await callEndpoint("list", {
        excludeScanIds: value,
      } as JSONObject);
      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(scanService.findBy).not.toHaveBeenCalled();
      expect(scanService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
      expect(response.sendEntityArrayResponse).not.toHaveBeenCalled();
    },
  );

  test("authenticates before processing an exclusion list", async () => {
    await callEndpoint("list", { excludeScanIds: ["invalid"] }, null);
    expect(response.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
    expect(scanService.findBy).not.toHaveBeenCalled();
    expect(scanService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
  });

  test("keeps an edited active scan Pending, discards its old result, then claims the edited run", async () => {
    const edited: NetworkDeviceDiscoveryScan = makeScan();
    edited.cidr = "198.51.100.0/30";
    edited.statusMessage =
      "Settings changed, so this scan is queued to run again.";
    const independent: NetworkDeviceDiscoveryScan = makeScan();
    const otherProbe: NetworkDeviceDiscoveryScan = makeScan(
      "Pending",
      otherProbeId,
    );
    const completed: NetworkDeviceDiscoveryScan = makeScan("Completed");
    useRows([otherProbe, completed, edited, independent]);

    await callEndpoint("list", { excludeScanIds: [edited.id!.toString()] });

    expect(edited.status).toBe("Pending");
    expect(edited.statusMessage).toContain("Settings changed");
    expect(independent.status).toBe("In Progress");
    expect(otherProbe.status).toBe("Pending");
    expect(completed.status).toBe("Completed");
    expect(scanService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(1);
    expect(
      (
        scanService.updateColumnsByIdWithoutHooks.mock.calls[0]![0] as ClaimArgs
      ).id.toString(),
    ).toBe(independent.id!.toString());
    expect(response.sendEntityArrayResponse).toHaveBeenLastCalledWith(
      expect.anything(),
      mockResponse,
      [independent],
      1,
      NetworkDeviceDiscoveryScan,
    );

    for (const oldResult of [
      { success: true, discoveredDevices: [] },
      { success: true, isPartial: true, discoveredDevices: [] },
      { success: false, statusMessage: "Old sweep failed" },
    ]) {
      await callEndpoint("result", {
        scanId: edited.id!.toString(),
        ...oldResult,
      });
      expect(response.sendJsonObjectResponse).toHaveBeenLastCalledWith(
        expect.anything(),
        mockResponse,
        { result: "discarded" },
      );
      expect(scanService.updateOneById).not.toHaveBeenCalled();
      expect(edited.status).toBe("Pending");
    }

    await callEndpoint("list", { excludeScanIds: [] });
    expect(edited.status).toBe("In Progress");
    expect(response.sendEntityArrayResponse).toHaveBeenLastCalledWith(
      expect.anything(),
      mockResponse,
      [edited],
      1,
      NetworkDeviceDiscoveryScan,
    );
    expect(edited.cidr).toBe("198.51.100.0/30");
  });

  test("returns nothing and writes nothing when the only pending scan remains reserved", async () => {
    const reserved: NetworkDeviceDiscoveryScan = makeScan();
    useRows([reserved]);
    await callEndpoint("list", { excludeScanIds: [reserved.id!.toString()] });
    expect(reserved.status).toBe("Pending");
    expect(scanService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(response.sendEntityArrayResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      [],
      0,
      NetworkDeviceDiscoveryScan,
    );
  });
});
