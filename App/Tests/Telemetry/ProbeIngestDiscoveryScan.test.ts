import fs from "fs";
import path from "path";
import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Response from "Common/Server/Utils/Response";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { DiscoveryScanSnmpConfig } from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

/*
 * Only the one method this route uses. Deliberately narrow: the route used to
 * page every device in the project itself with findBy, and leaving findBy on
 * this mock would let that walk quietly come back — the tests here would keep
 * passing while the request went back to eight full-table scans. With just
 * this method mocked, any other call on the service throws.
 */
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      getRegisteredHostnames: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

/*
 * Importing the router module registers its routes on the mocked router so
 * each handler can be invoked directly. The probe-auth middleware is mocked
 * out; tests attach `req.probe` themselves, exactly what the middleware
 * does after validating probeId + probeKey.
 */
import "../../FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan";

type MockedService = {
  findBy: jest.Mock;
  findOneBy: jest.Mock;
  updateOneById: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
};

const scanService: MockedService =
  NetworkDeviceDiscoveryScanService as unknown as MockedService;
const deviceService: { getRegisteredHostnames: jest.Mock } =
  NetworkDeviceService as unknown as { getRegisteredHostnames: jest.Mock };
const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendEntityArrayResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendEntityArrayResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

function makeRequest(data: {
  probeId?: ObjectID | undefined;
  body?: JSONObject | undefined;
}): ExpressRequest {
  const req: JSONObject = {
    body: data.body || {},
  };

  if (data.probeId) {
    req["probe"] = new Probe(data.probeId);
  }

  return req as unknown as ExpressRequest;
}

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallListEndpointFunction = (
  req: ExpressRequest,
) => Promise<{ next: NextFunction }>;

const callListEndpoint: CallListEndpointFunction = async (
  req: ExpressRequest,
): Promise<{ next: NextFunction }> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter
    .match("post", "/probe/discovery-scan/list")
    .handlerFunction(req, mockResponse, next);
  return { next };
};

type CallResultEndpointFunction = CallListEndpointFunction;

const callResultEndpoint: CallResultEndpointFunction = async (
  req: ExpressRequest,
): Promise<{ next: NextFunction }> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter
    .match("post", "/probe/discovery-scan/result")
    .handlerFunction(req, mockResponse, next);
  return { next };
};

/*
 * Shared regression assertion: the update payload handed to the service MUST
 * be a plain object, never a model instance. A `new
 * NetworkDeviceDiscoveryScan()` payload carries the non-column base property
 * `isPermissionIf`, which made every update throw `TableColumnMetadata not
 * found for isPermissionIf column` — the bug that left every scan stuck in
 * "Pending" and lost every probe result.
 */
function expectPlainUpdateData(data: unknown): JSONObject {
  expect(data).not.toBeInstanceOf(DatabaseBaseModel);
  expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  expect(Object.keys(data as JSONObject)).not.toContain("isPermissionIf");
  return data as JSONObject;
}

describe("POST /probe/discovery-scan/list", () => {
  const probeId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * The probe logs the scan it is sweeping, and since scans can be named
   * (issue #3391) that log line names it the way its operator did. The name is
   * of no use to the sweep itself — it has to be asked for here or it never
   * reaches the probe at all.
   */
  test("hands the scan's name to the probe alongside its target", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findArgs["select"] as JSONObject;

    expect(select["name"]).toBe(true);
    expect(select["cidr"]).toBe(true);
  });

  /*
   * The claim is a read-then-write: the SELECT above filters on
   * `probeId + status = "Pending"`, but the UPDATE addresses the row by id
   * alone. That gap was harmless while a scan's settings were fixed at
   * creation. Once they became editable (OneUptime issue #3444) a save landing
   * inside it would hand this probe one configuration and stamp the row with
   * another — and, if the probe was reassigned, wedge the scan for two hours:
   * the old probe's result is rejected on the probeId scope, and the new probe
   * can never claim a row that already says In Progress.
   *
   * So the claim carries its own precondition. Every setting handed to the
   * probe is asserted in the same statement, which makes a claim on stale
   * settings a no-op rather than a lie.
   */
  test("claims a scan only while the settings it was handed are still current", async () => {
    const scanId: ObjectID = ObjectID.generate();
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.cidr = "192.168.1.0/24";
    /*
     * An SNMP scan, said out loud on the fixture. The METHOD is a sweep
     * setting in its own right (issue #3445) — turning Check SNMP off changes
     * what the sweep asks of every address, not merely which credentials it
     * asks with — so it belongs in this guard next to the credentials, and
     * with the column left unset here the assertion below could be satisfied
     * by a guard that hardcoded null.
     */
    scan.isSnmpEnabled = true;
    scan.snmpVersion = "V3";
    scan.snmpCommunityString = "public";
    scan.snmpPort = 161;
    /*
     * The v3 credentials are SET on this fixture on purpose. With them left
     * unset the expectation could be satisfied by a guard that hardcoded null,
     * and the assertion would say nothing about whether the claim actually
     * carries the values the probe was handed.
     */
    scan.snmpV3SecurityLevel = "authPriv";
    scan.snmpV3Username = "netops";
    scan.snmpV3AuthProtocol = "sha";
    scan.snmpV3AuthKey = "auth-secret";
    scan.snmpV3PrivProtocol = "aes";
    scan.snmpV3PrivKey = "priv-secret";

    /*
     * TWO configs, and the first one deliberately mirrors the flattened
     * columns set above — that is the shape the service's write hooks
     * actually store (OneUptime issue #3458: the flattened columns are kept
     * as a mirror of the list's FIRST entry so a probe a version behind still
     * has credentials to sweep with).
     *
     * The second entry is what makes the assertion below worth making. A
     * guard built only out of the flattened columns would look complete on a
     * one-config scan and would still pass every claim on a row whose second
     * credential set had been replaced wholesale a moment earlier.
     */
    const snmpConfigs: Array<DiscoveryScanSnmpConfig> = [
      {
        id: "config-core",
        name: "Core switches",
        snmpVersion: "V3",
        snmpCommunityString: "public",
        snmpPort: 161,
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "netops",
        snmpV3AuthProtocol: "sha",
        snmpV3AuthKey: "auth-secret",
        snmpV3PrivProtocol: "aes",
        snmpV3PrivKey: "priv-secret",
      },
      {
        id: "config-access",
        name: "Access switches",
        snmpVersion: "V2c",
        snmpCommunityString: "readonly",
        snmpPort: 1161,
      },
    ];
    scan.snmpConfigs = snmpConfigs;

    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    const expected: JSONObject = expectPlainUpdateData(
      updateArgs["expectedData"],
    );

    /*
     * Status and probe first: those are what a re-queue and a probe
     * reassignment change, and either one invalidates a claim outright.
     */
    expect(expected["status"]).toBe("Pending");
    expect((expected["probeId"] as ObjectID).toString()).toBe(
      probeId.toString(),
    );

    // ...then every setting that decides what the sweep actually does.
    expect(expected["cidr"]).toBe("192.168.1.0/24");

    /*
     * The method, before the credentials it decides the fate of. A claim that
     * ignored it would hand this probe an SNMP sweep of a scan the operator
     * had just turned into a ping sweep — credentials fired at hosts they
     * asked only to ping — and stamp the row In Progress against it.
     */
    expect(Object.keys(expected)).toContain("isSnmpEnabled");
    expect(expected["isSnmpEnabled"]).toBe(true);

    /*
     * The credential list, and the WHOLE list — every entry, every field.
     * This is the setting the sweep is now mostly made of: the probe tries
     * these in order against each host and stops at the first that answers.
     * Asserting only the first entry (or only its id) would leave the guard
     * blind to an edit that swapped out every other credential set, and the
     * probe would then sweep, and stamp its hosts with ids from, a list the
     * row no longer holds.
     */
    expect(expected["snmpConfigs"]).toEqual(snmpConfigs);

    expect(expected["snmpVersion"]).toBe("V3");
    expect(expected["snmpCommunityString"]).toBe("public");
    expect(expected["snmpPort"]).toBe(161);
    expect(expected["snmpV3SecurityLevel"]).toBe("authPriv");
    expect(expected["snmpV3Username"]).toBe("netops");
    expect(expected["snmpV3AuthProtocol"]).toBe("sha");
    expect(expected["snmpV3AuthKey"]).toBe("auth-secret");
    expect(expected["snmpV3PrivProtocol"]).toBe("aes");
    expect(expected["snmpV3PrivKey"]).toBe("priv-secret");

    /*
     * And NOT the name. A rename changes nothing about the sweep, and voiding
     * a claim over one would cost the probe a whole cycle for nothing.
     */
    expect(Object.keys(expected)).not.toContain("name");
  });

  /*
   * An UNSET credential is expected as NULL rather than left out of the
   * guard. expectedData renders each key as `IS NOT DISTINCT FROM`, so an
   * omitted key is not "must still be empty" — it is "do not care", and a
   * credential appearing between the SELECT and the UPDATE would not void the
   * claim.
   */
  test("expects an unset credential to still be unset, rather than not caring", async () => {
    const scanId: ObjectID = ObjectID.generate();
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.cidr = "192.168.1.0/24";
    scan.snmpVersion = "V2c";
    scan.snmpCommunityString = "public";

    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    const expected: JSONObject = expectPlainUpdateData(
      updateArgs["expectedData"],
    );

    for (const column of [
      /*
       * The credential LIST is unset on this fixture — a scan created before
       * the column existed, or one written by an API caller that only knows
       * the flattened fields — and it has to be expected as NULL just like a
       * missing v3 key.
       *
       * Omitting it would be the worse half of the bug this test exists for.
       * `IS NOT DISTINCT FROM` is generated per key, so a key that is not
       * there is not "must still be empty", it is "do not care": an operator
       * saving a four-credential list between the SELECT and the UPDATE would
       * leave the claim standing, and this probe would sweep the subnet with
       * the single flattened credential set it was handed while the row said
       * it was being swept with four.
       */
      "snmpConfigs",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
    ]) {
      expect(Object.keys(expected)).toContain(column);
      expect({ column: column, value: expected[column] }).toEqual({
        column: column,
        value: null,
      });
    }
  });

  /*
   * The two changes that met in this file meet again in this one guard, and
   * they meet as EQUALS: the credential list (issue #3458) says what the sweep
   * authenticates with, the method (issue #3445) says whether it authenticates
   * at all. Both are sweep columns in the service, both are handed to the
   * probe in the SELECT above, and a claim that omitted either would let an
   * edit landing in between go unnoticed.
   *
   * Pinned as a whole SET rather than key by key, because the failure this
   * guards against is a key quietly LEAVING. Each key becomes an
   * `IS NOT DISTINCT FROM` in the UPDATE's WHERE, so a key that is not here is
   * not "must still be empty" — it is "do not care", which is invisible in any
   * assertion that only looks at the keys that remain.
   *
   * A new sweep column added to the route is expected to fail here: add it to
   * this list once you have checked it really does change what the sweep does.
   * `name` must never appear — a rename changes nothing about the sweep, and
   * voiding a claim over one costs the probe a whole cycle for nothing.
   */
  test("the claim guard names exactly the columns that decide what the sweep does", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      ObjectID.generate(),
    );
    scan.cidr = "192.168.1.0/24";
    scan.isSnmpEnabled = true;
    scan.snmpConfigs = [
      {
        id: "config-core",
        snmpVersion: "V2c",
        snmpCommunityString: "public",
        snmpPort: 161,
      },
    ];

    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    const expected: JSONObject = expectPlainUpdateData(
      updateArgs["expectedData"],
    );

    expect(Object.keys(expected).sort()).toEqual([
      "cidr",
      "isSnmpEnabled",
      "probeId",
      "snmpCommunityString",
      "snmpConfigs",
      "snmpPort",
      "snmpV3AuthKey",
      "snmpV3AuthProtocol",
      "snmpV3PrivKey",
      "snmpV3PrivProtocol",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpVersion",
      "status",
    ]);
  });

  /*
   * An ICMP-only scan is claimed under the same guard, and the two new columns
   * carry the two halves of what it is: the method says SNMP is off, and the
   * credential list is empty because the service clears every SNMP setting
   * when Check SNMP is switched off (SNMP_CONFIG_COLUMNS in
   * NetworkDeviceDiscoveryScanService).
   *
   * Both still have to be GUARDED. The dangerous edit here is the one that
   * turns SNMP back on: it writes a credential list onto the row, and a claim
   * that had left either column out would stand — this probe would sweep with
   * ICMP alone and the row would say, for the whole sweep, that it was being
   * SNMP-swept with the credentials the operator had just entered.
   */
  test("claiming an ICMP-only scan guards both the method being off and the credential list being empty", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      ObjectID.generate(),
    );
    scan.cidr = "192.168.1.0/24";
    scan.isSnmpEnabled = false;

    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    const expected: JSONObject = expectPlainUpdateData(
      updateArgs["expectedData"],
    );

    /*
     * An explicit false, not an absent key: absent means "SNMP" everywhere in
     * this codebase, so a guard that dropped the column here would compare an
     * ICMP-only row against nothing at all.
     */
    expect(Object.keys(expected)).toContain("isSnmpEnabled");
    expect(expected["isSnmpEnabled"]).toBe(false);

    expect(Object.keys(expected)).toContain("snmpConfigs");
    expect(expected["snmpConfigs"]).toBeNull();
  });

  /*
   * A row that carries neither column — written before either existed, or by
   * an API caller that knows only the flattened fields. Both are guarded as
   * NULL, exactly like an unset credential: the claim must say "and these were
   * still empty when I read them", not "I did not look".
   */
  test("a scan carrying neither the method nor a credential list guards both as null", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      ObjectID.generate(),
    );
    scan.cidr = "192.168.1.0/24";
    scan.snmpVersion = "V2c";
    scan.snmpCommunityString = "public";

    expect(scan.isSnmpEnabled).toBeUndefined();
    expect(scan.snmpConfigs).toBeUndefined();

    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    const expected: JSONObject = expectPlainUpdateData(
      updateArgs["expectedData"],
    );

    for (const column of ["isSnmpEnabled", "snmpConfigs"]) {
      expect(Object.keys(expected)).toContain(column);
      expect({ column: column, value: expected[column] }).toEqual({
        column: column,
        value: null,
      });
    }
  });

  test("hands out the probe's pending scans and marks each In Progress with plain column data", async () => {
    const scanId: ObjectID = ObjectID.generate();
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).not.toHaveBeenCalled();

    // Scans are claimed for the requesting probe only, oldest first, one at a time.
    expect(scanService.findBy).toHaveBeenCalledTimes(1);
    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    expect((findArgs["query"] as JSONObject)["probeId"]?.toString()).toBe(
      probeId.toString(),
    );
    expect((findArgs["query"] as JSONObject)["status"]).toBe("Pending");
    expect(findArgs["limit"]).toBe(1);
    expect((findArgs["sort"] as JSONObject)["createdAt"]).toBe(
      SortOrder.Ascending,
    );
    expect((findArgs["props"] as JSONObject)["isRoot"]).toBe(true);

    /*
     * The claim: status In Progress + startedAt, and nothing else — via the
     * hook-free single-statement write. The probe synchronously waits on
     * this route every minute, so the claim must not pay the full
     * updateOneById pipeline (permission pre-fetch + row re-fetch + save()
     * transaction).
     *
     * "and nothing else" is load-bearing, not cosmetic: the service's
     * onBeforeUpdate validates the scan target, and skipping hooks is only
     * safe while the claim payload stays disjoint from the `cidr` column
     * that hook checks. Adding `cidr` here fails this assertion.
     */
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(scanService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(1);
    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    expect((updateArgs["id"] as ObjectID).toString()).toBe(scanId.toString());
    const data: JSONObject = expectPlainUpdateData(updateArgs["data"]);
    expect(Object.keys(data).sort()).toEqual([
      "startedAt",
      "status",
      "statusMessage",
    ]);
    expect(data["status"]).toBe("In Progress");
    expect(data["startedAt"]).toBeInstanceOf(Date);
    /*
     * Cleared, not left behind: the worker writes a "nobody has picked this
     * scan up" note onto a long-unclaimed Pending scan
     * (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts), and a
     * probe claiming the scan is exactly the thing that note said was not
     * happening. Leaving it would have the row explain, for the whole sweep,
     * why it had not started.
     */
    expect(data["statusMessage"]).toBeNull();

    // The scans are returned to the probe.
    expect(responseUtil.sendEntityArrayResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      [scan],
      1,
      NetworkDeviceDiscoveryScan,
    );
  });

  test("marks scans In Progress BEFORE responding, so a scan can never be handed out twice", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      ObjectID.generate(),
    );
    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateOrder: number =
      scanService.updateColumnsByIdWithoutHooks.mock.invocationCallOrder[0]!;
    const respondOrder: number =
      responseUtil.sendEntityArrayResponse.mock.invocationCallOrder[0]!;
    expect(updateOrder).toBeLessThan(respondOrder);
  });

  test("selects every SNMP credential column the probe needs to actually run the scan", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findArgs["select"] as JSONObject;

    for (const column of [
      "cidr",
      /*
       * The ordered credential list is what a current probe actually sweeps
       * with. An unselected column arrives undefined, which
       * SnmpScanConfigUtil.resolve reads as "this scan has no list" — so it
       * would synthesize the single legacy config from the flattened columns
       * and the sweep would quietly use one credential set out of the
       * operator's four, reporting a confident zero for everything else.
       */
      "snmpConfigs",
      "snmpVersion",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
    ]) {
      expect(select[column]).toBe(true);
    }
  });

  /*
   * The flattened columns are NOT dead weight now that the list exists, and
   * this pins the half of that statement the select is responsible for.
   *
   * A probe is deployed separately from the server and is routinely a version
   * behind. A probe that has never heard of `snmpConfigs` reads the flattened
   * columns and nothing else, and the server keeps them populated from the
   * list's first entry precisely so that probe still has a credential set to
   * sweep with. Dropping them from this select — the natural tidy-up once the
   * list is here — would not fail a single type check, would look correct
   * against a current probe, and would blank the credentials of every probe in
   * the fleet that had not been upgraded yet: every one of their sweeps would
   * come back "0 discovered".
   *
   * So: both, together, in the same select.
   */
  test("still selects the flattened SNMP columns alongside the list, because an older probe reads only those", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findArgs["select"] as JSONObject;

    // The new column is there — or the assertion below proves nothing.
    expect(select["snmpConfigs"]).toBe(true);

    for (const legacyColumn of [
      "snmpVersion",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
    ]) {
      expect({ column: legacyColumn, selected: select[legacyColumn] }).toEqual({
        column: legacyColumn,
        selected: true,
      });
    }
  });

  /*
   * Issue #3445: a scan can now sweep with ICMP alone, and this column is the
   * only thing that tells the probe which of the two kinds of scan it is
   * holding.
   *
   * Leaving it out of this select does not hand the probe `false` — it hands
   * it `undefined`, and `undefined` is deliberately read as "this is an SNMP
   * scan" (ScanModeUtil.isSnmpEnabled is `!== false`, so that every row
   * written before the column existed keeps meaning what it always meant).
   * The regression is therefore silent and one-directional: drop this column
   * and every ICMP-only scan in every project is SNMP-swept again — community
   * strings and v3 credentials the operator deliberately did not enter, fired
   * at hosts they only asked to ping — while the wizard goes on describing
   * the scan as "Ping only". Nothing throws. The scan just does the thing it
   * was configured not to do.
   *
   * The credential list makes that worse, not better: the operator's four
   * credential sets are now all in one column, so an ICMP-only scan swept as
   * an SNMP one fires every one of them at every host.
   */
  test("selects isSnmpEnabled, without which an ICMP-only scan reaches the probe looking like an SNMP scan", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findArgs["select"] as JSONObject;

    expect(select["isSnmpEnabled"]).toBe(true);
  });

  /*
   * The select, pinned whole. The tests above prove that particular columns
   * are PRESENT; this is the one that notices a column quietly leaving —
   * which for `isSnmpEnabled` is the silent SNMP sweep described above, for
   * `snmpConfigs` is a multi-credential scan quietly demoted to the single
   * mirrored set in the flattened columns, and for the flattened columns
   * themselves is an older probe left with nothing to authenticate with. All
   * three look like a working scan from the outside, so none of them shows up
   * in a test that only asserts the happy path.
   *
   * A new column added to the route is expected to fail here: add it to this
   * list too, once you have checked the probe actually reads it. Everything
   * selected costs bytes on a route the probe polls every minute.
   */
  test("the claim asks for exactly the columns the probe needs to run the sweep", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const findArgs: JSONObject = scanService.findBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findArgs["select"] as JSONObject;

    expect(Object.keys(select).sort()).toEqual([
      "_id",
      "cidr",
      "isSnmpEnabled",
      "name",
      "projectId",
      "snmpCommunityString",
      "snmpConfigs",
      "snmpPort",
      "snmpV3AuthKey",
      "snmpV3AuthProtocol",
      "snmpV3PrivKey",
      "snmpV3PrivProtocol",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpVersion",
    ]);

    // Every one of them asked for, not merely mentioned.
    for (const column of Object.keys(select)) {
      expect(select[column]).toBe(true);
    }
  });

  /*
   * Selecting the column is only half of it: the method has to survive
   * SERIALIZATION. The probe never re-reads the scan — this response IS the
   * instruction it executes — and what it reads is not the model object the
   * route holds but the JSON `Response.sendEntityArrayResponse` renders out
   * of it with `DatabaseBaseModel.toJSONArray(list, modelType)`.
   *
   * That serializer walks `getVanillaModel(modelType).getTableColumns()` and
   * silently drops every property that is not a declared `@TableColumn`
   * (Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel.ts).
   * A missing or misdeclared decorator on `isSnmpEnabled` therefore costs
   * nothing at compile time, leaves the select pinned above perfectly green,
   * and still strips the method off the wire: every ICMP-only scan in every
   * project is SNMP-swept again, with community strings and v3 credentials
   * the operator deliberately did not enter, while the wizard goes on calling
   * the scan "Ping only". Nothing throws.
   *
   * `Response` is mocked in this file, so that render has to be run here
   * explicitly — and through the model type taken FROM the call rather than
   * hard-coded, so a route that names the wrong model type fails here too.
   *
   * The legacy row is the other half of the invariant: it has to leave with
   * no `isSnmpEnabled` on it at all. Absent is read as "SNMP" everywhere
   * (ScanModeUtil is `!== false`); a `false` on the wire would turn every
   * scan written before this column existed — every scan in every project
   * that upgraded — into a ping sweep, and SNMP discovery would simply stop
   * happening. No error, no failed scan; just an inventory that stops finding
   * devices.
   */
  test("the method reaches the probe through serialization, and an absent one stays absent", async () => {
    const icmpOnlyScan: NetworkDeviceDiscoveryScan =
      new NetworkDeviceDiscoveryScan(ObjectID.generate());
    icmpOnlyScan.isSnmpEnabled = false;

    const snmpScan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      ObjectID.generate(),
    );
    snmpScan.isSnmpEnabled = true;

    /*
     * Written before the column existed: the property is never assigned, which
     * is what the database hands back for such a row.
     */
    const legacyScan: NetworkDeviceDiscoveryScan =
      new NetworkDeviceDiscoveryScan(ObjectID.generate());

    scanService.findBy.mockResolvedValue([
      icmpOnlyScan,
      snmpScan,
      legacyScan,
    ] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const responseArgs: Array<unknown> = responseUtil.sendEntityArrayResponse
      .mock.calls[0]! as Array<unknown>;
    const handedBack: Array<NetworkDeviceDiscoveryScan> =
      responseArgs[2] as Array<NetworkDeviceDiscoveryScan>;
    const modelType: DatabaseBaseModelType =
      responseArgs[4] as DatabaseBaseModelType;

    expect(handedBack).toHaveLength(3);

    // The exact render Response.sendEntityArrayResponse performs on that list.
    const onTheWire: JSONArray = DatabaseBaseModel.toJSONArray(
      handedBack,
      modelType,
    );

    /*
     * Two different answers out of one batch: whatever carries the method, it
     * is per-scan, not read once and applied to the whole response.
     */
    expect((onTheWire[0] as JSONObject)["isSnmpEnabled"]).toBe(false);
    expect((onTheWire[1] as JSONObject)["isSnmpEnabled"]).toBe(true);

    /*
     * And the legacy row emits no key at all — toJSONObject skips undefined
     * properties, so the probe reads nothing and falls back on "absent means
     * SNMP". A `false` here, from the column defaulting on its way out, is
     * the silent-ping-sweep regression described above.
     */
    expect(Object.keys(onTheWire[2] as JSONObject)).not.toContain(
      "isSnmpEnabled",
    );
  });

  /*
   * The same serialization argument, for the other new column — and it is a
   * sharper one, because the credential LIST failing to reach the probe is
   * invisible from every direction.
   *
   * `snmpConfigs` is a jsonb column of secrets, and the probe reads it through
   * SnmpScanConfigUtil.resolve, whose documented fallback for a scan with no
   * list is to synthesize ONE config out of the flattened columns. So a
   * decorator problem here does not produce a probe that errors, or a sweep
   * that finds nothing: it produces a sweep that quietly uses the operator's
   * FIRST credential set against every host and reports a confident zero for
   * everything the other sets would have found — which is the exact failure
   * issue #3458 was opened about, reintroduced one layer further down.
   *
   * The entries have to arrive whole, too. `toJSONArray` runs the model
   * through `JSONFunctions.serialize`, which walks arrays element by element,
   * so this asserts the list deep-equals what the row carried rather than
   * merely that a key is present: a serializer that flattened the array into
   * `{ "0": ..., "1": ... }` would satisfy a presence check and hand the probe
   * a list it cannot iterate.
   */
  test("the credential list reaches the probe through serialization, entry for entry", async () => {
    const snmpConfigs: Array<DiscoveryScanSnmpConfig> = [
      {
        id: "config-core",
        name: "Core switches",
        snmpVersion: "V3",
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "netops",
        snmpV3AuthProtocol: "sha",
        snmpV3AuthKey: "auth-secret",
        snmpV3PrivProtocol: "aes",
        snmpV3PrivKey: "priv-secret",
        snmpPort: 161,
      },
      {
        id: "config-access",
        name: "Access switches",
        snmpVersion: "V2c",
        snmpCommunityString: "readonly",
        snmpPort: 1161,
      },
    ];

    const multiConfigScan: NetworkDeviceDiscoveryScan =
      new NetworkDeviceDiscoveryScan(ObjectID.generate());
    multiConfigScan.isSnmpEnabled = true;
    multiConfigScan.snmpConfigs = snmpConfigs;

    /*
     * An ICMP-only scan alongside it: the service clears every SNMP setting
     * when Check SNMP is switched off, so this row genuinely has no list, and
     * it must leave with no key rather than an empty array. `resolve` reads an
     * empty list and an absent one the same way, but a key on the wire is a
     * statement about credentials that a ping-only scan has no business
     * making.
     */
    const icmpOnlyScan: NetworkDeviceDiscoveryScan =
      new NetworkDeviceDiscoveryScan(ObjectID.generate());
    icmpOnlyScan.isSnmpEnabled = false;

    scanService.findBy.mockResolvedValue([
      multiConfigScan,
      icmpOnlyScan,
    ] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const responseArgs: Array<unknown> = responseUtil.sendEntityArrayResponse
      .mock.calls[0]! as Array<unknown>;
    const handedBack: Array<NetworkDeviceDiscoveryScan> =
      responseArgs[2] as Array<NetworkDeviceDiscoveryScan>;
    const modelType: DatabaseBaseModelType =
      responseArgs[4] as DatabaseBaseModelType;

    // The exact render Response.sendEntityArrayResponse performs on that list.
    const onTheWire: JSONArray = DatabaseBaseModel.toJSONArray(
      handedBack,
      modelType,
    );

    expect((onTheWire[0] as JSONObject)["snmpConfigs"]).toEqual(snmpConfigs);
    expect((onTheWire[0] as JSONObject)["isSnmpEnabled"]).toBe(true);

    expect(Object.keys(onTheWire[1] as JSONObject)).not.toContain(
      "snmpConfigs",
    );
    expect((onTheWire[1] as JSONObject)["isSnmpEnabled"]).toBe(false);
  });

  /*
   * The claim payload stays what it was: three run-state columns, and nothing
   * about how the scan is configured.
   *
   * Both new columns are SWEEP columns now — `isSnmpEnabled` and `snmpConfigs`
   * are listed in SWEEP_COLUMNS in NetworkDeviceDiscoveryScanService, and both
   * are updatable since scans gained an edit form (issue #3444). That is
   * exactly why the claim must not name them. A payload carrying a sweep
   * column is a payload the service's reconciliation would treat as an EDIT of
   * the sweep — retiring the run this write is in the middle of claiming — and
   * it would break the disjointness that makes the hook-free write above safe
   * in the first place (pinned by Common/Tests/Server/Services/
   * DiscoveryScanClaimHookFreeSafety.test.ts).
   *
   * A probe claiming a scan reads its configuration. It never restates it.
   */
  test("claiming an ICMP-only scan writes the same three columns as any other claim", async () => {
    const scanId: ObjectID = ObjectID.generate();
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.isSnmpEnabled = false;
    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    const data: JSONObject = expectPlainUpdateData(updateArgs["data"]);
    expect(Object.keys(data).sort()).toEqual([
      "startedAt",
      "status",
      "statusMessage",
    ]);
    expect(Object.keys(data)).not.toContain("isSnmpEnabled");
    expect(Object.keys(data)).not.toContain("snmpConfigs");
  });

  /*
   * And the same for a scan that DOES carry a credential list: claiming it
   * writes no credentials back. Worth saying separately from the ICMP-only
   * case above, because the tempting bug is the opposite one — "stamp the
   * config the probe was handed onto the row so the result can be matched to
   * it" — which would rewrite a sweep column on every single claim and retire
   * every scan the moment a probe picked it up.
   */
  test("claiming a multi-credential scan writes no credentials back onto the row", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      ObjectID.generate(),
    );
    scan.isSnmpEnabled = true;
    scan.snmpConfigs = [
      { id: "config-core", snmpVersion: "V2c", snmpCommunityString: "public" },
      {
        id: "config-access",
        snmpVersion: "V2c",
        snmpCommunityString: "readonly",
      },
    ];

    scanService.findBy.mockResolvedValue([scan] as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    const updateArgs: JSONObject = scanService.updateColumnsByIdWithoutHooks
      .mock.calls[0]![0] as JSONObject;
    const data: JSONObject = expectPlainUpdateData(updateArgs["data"]);
    expect(Object.keys(data).sort()).toEqual([
      "startedAt",
      "status",
      "statusMessage",
    ]);
  });

  test("claims each scan the query returns, not just the first", async () => {
    const scans: Array<NetworkDeviceDiscoveryScan> = [
      new NetworkDeviceDiscoveryScan(ObjectID.generate()),
      new NetworkDeviceDiscoveryScan(ObjectID.generate()),
    ];
    scanService.findBy.mockResolvedValue(scans as never);
    scanService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );

    await callListEndpoint(makeRequest({ probeId }));

    expect(scanService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(2);
  });

  test("no pending scans: responds with an empty list and updates nothing", async () => {
    scanService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    expect(scanService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendEntityArrayResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      [],
      0,
      NetworkDeviceDiscoveryScan,
    );
  });

  test("rejects a request with no authenticated probe", async () => {
    await callListEndpoint(makeRequest({}));

    expect(scanService.findBy).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("passes service failures to the error handler", async () => {
    const boom: Error = new Error("db down");
    scanService.findBy.mockRejectedValue(boom as never);

    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe("POST /probe/discovery-scan/result", () => {
  const probeId: ObjectID = ObjectID.generate();
  const scanId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  function makeFoundScan(overrides?: {
    isRecurring?: boolean;
    rescanIntervalInMinutes?: number;
  }): NetworkDeviceDiscoveryScan {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.projectId = projectId;
    if (overrides?.isRecurring !== undefined) {
      scan.isRecurring = overrides.isRecurring;
    }
    if (overrides?.rescanIntervalInMinutes !== undefined) {
      scan.rescanIntervalInMinutes = overrides.rescanIntervalInMinutes;
    }
    return scan;
  }

  function lastUpdateData(): JSONObject {
    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
    const updateArgs: JSONObject = scanService.updateOneById.mock
      .calls[0]![0] as JSONObject;
    expect((updateArgs["id"] as ObjectID).toString()).toBe(scanId.toString());
    return expectPlainUpdateData(updateArgs["data"]);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
    scanService.updateOneById.mockResolvedValue(undefined as never);
  });

  test("stores a successful sweep: Completed, devices, counts, completedAt", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    const { next } = await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          success: true,
          statusMessage: "Swept 254 hosts.",
          scannedHostCount: 254,
          discoveredDevices: [
            { ipAddress: "10.0.0.5", sysName: "sw1" },
            { ipAddress: "10.0.0.9", sysName: "sw2" },
          ],
        },
      }),
    );

    expect(next).not.toHaveBeenCalled();

    // The lookup is scoped to the authenticated probe, not just the scanId.
    const findOneArgs: JSONObject = scanService.findOneBy.mock
      .calls[0]![0] as JSONObject;
    expect(
      ((findOneArgs["query"] as JSONObject)["probeId"] as ObjectID).toString(),
    ).toBe(probeId.toString());
    expect(
      ((findOneArgs["query"] as JSONObject)["_id"] as ObjectID).toString(),
    ).toBe(scanId.toString());

    const data: JSONObject = lastUpdateData();
    expect(Object.keys(data).sort()).toEqual([
      /*
       * Cleared on every result: a NULL marker is how the auto-import worker
       * knows the results now on this row have not been processed yet
       * (Workers/Jobs/NetworkDeviceDiscovery/ProcessAutoImportRules.ts).
       */
      "autoImportProcessedAt",
      "completedAt",
      "discoveredDevices",
      "respondedHostCount",
      "scannedHostCount",
      "status",
      "statusMessage",
    ]);
    expect(data["autoImportProcessedAt"]).toBeNull();
    expect(data["status"]).toBe("Completed");
    expect(data["statusMessage"]).toBe("Swept 254 hosts.");
    expect(data["scannedHostCount"]).toBe(254);
    expect(data["respondedHostCount"]).toBe(2);
    expect(data["completedAt"]).toBeInstanceOf(Date);
    expect((data["discoveredDevices"] as Array<JSONObject>).length).toBe(2);

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "ok" },
    );
  });

  /*
   * respondedHostCount is documented on the column as "Number of hosts that
   * responded to SNMP during the sweep" and is rendered as "Responded Hosts:
   * N of M". The probe reports ping-only hosts in the same array (tagged
   * snmpReachable: false), so counting the whole array would overstate the
   * manageable devices and contradict the statusMessage on the same row.
   */
  test("respondedHostCount counts SNMP responders only, not ping-only hosts", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          scannedHostCount: 254,
          statusMessage:
            "Swept 254 hosts: 5 answered ICMP ping, 2 answered SNMP.",
          discoveredDevices: [
            { ipAddress: "10.0.0.5", sysName: "sw1", snmpReachable: true },
            { ipAddress: "10.0.0.9", sysName: "sw2", snmpReachable: true },
            { ipAddress: "10.0.0.20", snmpReachable: false },
            { ipAddress: "10.0.0.21", snmpReachable: false },
            { ipAddress: "10.0.0.22", snmpReachable: false },
          ],
        },
      }),
    );

    const data: JSONObject = lastUpdateData();
    expect(data["respondedHostCount"]).toBe(2);
    // Every alive host is still stored for the review modal — only the count is filtered.
    expect((data["discoveredDevices"] as Array<JSONObject>).length).toBe(5);
  });

  test("a sweep that found only ping-only hosts reports zero SNMP responders", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          discoveredDevices: [
            { ipAddress: "10.0.0.20", snmpReachable: false },
            { ipAddress: "10.0.0.21", snmpReachable: false },
          ],
        },
      }),
    );

    expect(lastUpdateData()["respondedHostCount"]).toBe(0);
  });

  /*
   * An older probe omits snmpReachable entirely, and only pushed SNMP
   * responders into the array, so a missing key must still count.
   */
  test("hosts from an older probe with no snmpReachable key still count as responders", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          discoveredDevices: [
            { ipAddress: "10.0.0.5", sysName: "sw1" },
            { ipAddress: "10.0.0.9", sysName: "sw2" },
            { ipAddress: "10.0.0.11", sysName: "sw3" },
          ],
        },
      }),
    );

    expect(lastUpdateData()["respondedHostCount"]).toBe(3);
  });

  test("flags hosts that already exist as devices so the UI can't re-import them", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          discoveredDevices: [
            { ipAddress: "10.0.0.5", sysName: "known" },
            { ipAddress: "10.0.0.9", sysName: "new" },
          ],
        },
      }),
    );

    // Existing devices are looked up within the scan's project.
    const lookupArgs: JSONObject = deviceService.getRegisteredHostnames.mock
      .calls[0]![0] as JSONObject;
    expect((lookupArgs["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );

    const devices: Array<JSONObject> = lastUpdateData()[
      "discoveredDevices"
    ] as Array<JSONObject>;
    expect(devices[0]!["isAlreadyRegistered"]).toBe(true);
    expect(devices[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("a reported failure is stored as Failed with the probe's reason", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          success: false,
          statusMessage: "CIDR too large.",
          discoveredDevices: [],
        },
      }),
    );

    const data: JSONObject = lastUpdateData();
    expect(data["status"]).toBe("Failed");
    expect(data["statusMessage"]).toBe("CIDR too large.");
    expect(data["respondedHostCount"]).toBe(0);
  });

  test("success defaults to true when the probe omits it", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
        },
      }),
    );

    const data: JSONObject = lastUpdateData();
    expect(data["status"]).toBe("Completed");
    // No devices reported → stored as an empty result, not a crash.
    expect(data["discoveredDevices"]).toEqual([]);
    expect(data["respondedHostCount"]).toBe(0);
    // Optional fields that weren't sent must not appear as writes.
    expect(Object.keys(data)).not.toContain("statusMessage");
    expect(Object.keys(data)).not.toContain("scannedHostCount");
    expect(Object.keys(data)).not.toContain("nextScanAt");
  });

  test("a recurring scan schedules its next run after the configured interval", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({
        isRecurring: true,
        rescanIntervalInMinutes: 60,
      }) as never,
    );

    const before: number = Date.now();
    await callResultEndpoint(
      makeRequest({
        probeId,
        body: { scanId: scanId.toString(), discoveredDevices: [] },
      }),
    );
    const after: number = Date.now();

    const nextScanAt: Date = lastUpdateData()["nextScanAt"] as Date;
    expect(nextScanAt).toBeInstanceOf(Date);
    const sixtyMinutes: number = 60 * 60 * 1000;
    expect(nextScanAt.getTime()).toBeGreaterThanOrEqual(
      before + sixtyMinutes - 1000,
    );
    expect(nextScanAt.getTime()).toBeLessThanOrEqual(
      after + sixtyMinutes + 1000,
    );
  });

  test("a recurring scan reschedules even when the sweep failed — one bad run must not end the recurrence", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({
        isRecurring: true,
        rescanIntervalInMinutes: 60,
      }) as never,
    );

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          success: false,
          statusMessage: "probe crashed mid-sweep",
        },
      }),
    );

    const data: JSONObject = lastUpdateData();
    expect(data["status"]).toBe("Failed");
    expect(data["nextScanAt"]).toBeInstanceOf(Date);
  });

  test("intervals below the 15-minute floor are clamped and the clamp is surfaced to the user", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeFoundScan({ isRecurring: true, rescanIntervalInMinutes: 5 }) as never,
    );

    const before: number = Date.now();
    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          statusMessage: "Swept 254 hosts.",
          discoveredDevices: [],
        },
      }),
    );
    const after: number = Date.now();

    const data: JSONObject = lastUpdateData();
    const nextScanAt: Date = data["nextScanAt"] as Date;
    const fifteenMinutes: number = 15 * 60 * 1000;
    expect(nextScanAt.getTime()).toBeGreaterThanOrEqual(
      before + fifteenMinutes - 1000,
    );
    expect(nextScanAt.getTime()).toBeLessThanOrEqual(
      after + fifteenMinutes + 1000,
    );

    // The probe's own message is kept and the clamp note is appended.
    expect(data["statusMessage"]).toBe(
      "Swept 254 hosts. Rescan interval is below the 15-minute minimum; rescanning every 15 minutes instead.",
    );
  });

  /*
   * statusMessage is a varchar(500). Postgres rejects an over-long value
   * rather than truncating it, and that rejection would fail this write —
   * losing the sweep's results and leaving a finished scan In Progress until
   * the stale-scan reaper notices. Clip instead.
   */
  test("an over-long status message is clipped instead of failing the write", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          statusMessage: "S".repeat(900),
          discoveredDevices: [],
        },
      }),
    );

    const message: string = lastUpdateData()["statusMessage"] as string;
    expect(message).toHaveLength(500);
    // Still the probe's message, just shorter.
    expect(message.startsWith("SSS")).toBe(true);
  });

  test("a message that fits is stored verbatim", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          statusMessage: "Swept 254 hosts: 12 answered ICMP ping.",
          discoveredDevices: [],
        },
      }),
    );

    expect(lastUpdateData()["statusMessage"]).toBe(
      "Swept 254 hosts: 12 answered ICMP ping.",
    );
  });

  test("a one-time scan gets no nextScanAt", async () => {
    scanService.findOneBy.mockResolvedValue(makeFoundScan() as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: { scanId: scanId.toString(), discoveredDevices: [] },
      }),
    );

    expect(Object.keys(lastUpdateData())).not.toContain("nextScanAt");
  });

  test("rejects a result with no scanId", async () => {
    await callResultEndpoint(makeRequest({ probeId, body: {} }));

    expect(scanService.findOneBy).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("rejects a result with no authenticated probe", async () => {
    await callResultEndpoint(
      makeRequest({ body: { scanId: scanId.toString() } }),
    );

    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalled();
  });

  test("rejects a result for a scan the probe does not own (scoped lookup finds nothing)", async () => {
    scanService.findOneBy.mockResolvedValue(null as never);

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: { scanId: scanId.toString(), discoveredDevices: [] },
      }),
    );

    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("passes service failures to the error handler", async () => {
    const boom: Error = new Error("db down");
    scanService.findOneBy.mockRejectedValue(boom as never);

    const { next } = await callResultEndpoint(
      makeRequest({
        probeId,
        body: { scanId: scanId.toString() },
      }),
    );

    expect(next).toHaveBeenCalledWith(boom);
  });
});

/*
 * What "responded" means depends on what the scan actually asked for (issue
 * #3445).
 *
 * respondedHostCount is one number on the row, and it is the number the
 * product shows: the Discovery Scans card on the Network Devices overview
 * page renders it as "N host(s)", and the scans list renders "N of M hosts".
 * That page selects respondedHostCount and NOT discoveredDevices, so whatever
 * is written here is final — no screen can recover the truth from the hosts
 * afterwards.
 *
 * On an SNMP scan the number is the SNMP responders. The probe reports
 * ping-only hosts in the same array, tagged `snmpReachable: false`, and
 * collapsing the two together would erase exactly the distinction the
 * "+N alive without SNMP" line exists to draw.
 *
 * On an ICMP-only scan every host is `snmpReachable: false` by construction,
 * so that same filter is always zero. A sweep that found 254 live hosts would
 * be written down as having found none, and the operator would read
 * "0 of 254 hosts" for a scan that worked perfectly — the exact false
 * negative issue #3287 exists to prevent. Ping was the question, and the
 * hosts answered it.
 *
 * Which of the two counts applies is decided by the scan row alone, and a row
 * that does not carry the column at all — legacy, or an older server — has to
 * decide "SNMP". The absence tests below are the ones that matter most: get
 * that backwards and SNMP discovery silently stops for every scan that
 * predates the column.
 */
describe('POST /probe/discovery-scan/result — what "responded" counts, per scan method', () => {
  const probeId: ObjectID = ObjectID.generate();
  const scanId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  /*
   * `mode` left out builds the legacy row: a scan whose isSnmpEnabled never
   * arrives, because it was written before the column existed or because a
   * caller never asked for it. The property is deliberately not assigned in
   * that case — an explicitly-assigned `undefined` and an absent one are the
   * same thing to the predicate, but only the absent one is what the database
   * actually hands back.
   */
  function makeScan(
    mode?: boolean | undefined,
    overrides?: {
      isRecurring?: boolean;
      rescanIntervalInMinutes?: number;
    },
  ): NetworkDeviceDiscoveryScan {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.projectId = projectId;
    scan.status = "In Progress";

    if (mode !== undefined) {
      scan.isSnmpEnabled = mode;
    }

    if (overrides?.isRecurring !== undefined) {
      scan.isRecurring = overrides.isRecurring;
    }

    if (overrides?.rescanIntervalInMinutes !== undefined) {
      scan.rescanIntervalInMinutes = overrides.rescanIntervalInMinutes;
    }

    return scan;
  }

  function writtenData(): JSONObject {
    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
    const updateArgs: JSONObject = scanService.updateOneById.mock
      .calls[0]![0] as JSONObject;
    expect((updateArgs["id"] as ObjectID).toString()).toBe(scanId.toString());
    return expectPlainUpdateData(updateArgs["data"]);
  }

  function reportResult(
    scan: NetworkDeviceDiscoveryScan,
    body: JSONObject,
  ): Promise<{ next: NextFunction }> {
    scanService.findOneBy.mockResolvedValue(scan as never);

    return callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          ...body,
        },
      }),
    );
  }

  /*
   * One sweep, start to finish, from a clean set of mocks — so a single test
   * can report the SAME host list under both methods and compare the two
   * numbers side by side.
   */
  async function respondedHostCountFor(
    scan: NetworkDeviceDiscoveryScan,
    discoveredDevices: Array<JSONObject>,
  ): Promise<number> {
    jest.clearAllMocks();
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
    scanService.updateOneById.mockResolvedValue(undefined as never);

    await reportResult(scan, { discoveredDevices: discoveredDevices });

    return writtenData()["respondedHostCount"] as number;
  }

  /*
   * Fresh arrays per call, deliberately: the handler writes
   * `isAlreadyRegistered` onto the host objects it is given, so a shared
   * fixture would carry one test's flags into the next.
   */

  // Two SNMP responders and three hosts that only answered ping.
  function mixedHosts(): Array<JSONObject> {
    return [
      { ipAddress: "10.0.0.5", sysName: "sw1", snmpReachable: true },
      { ipAddress: "10.0.0.9", sysName: "sw2", snmpReachable: true },
      { ipAddress: "10.0.0.20", snmpReachable: false },
      { ipAddress: "10.0.0.21", snmpReachable: false },
      { ipAddress: "10.0.0.22", snmpReachable: false },
    ];
  }

  /*
   * What an OLDER probe reports: it omitted `snmpReachable` entirely and only
   * ever pushed SNMP responders into the array, so a missing key means "SNMP
   * responder". Mixed here with two hosts a current probe tagged
   * `snmpReachable: false` on purpose, so that the SNMP reading (3) and the
   * ICMP-only reading (5) are DIFFERENT numbers — a keyless-only list would
   * make both branches return the same count and the test could not tell
   * which one ran.
   */
  function keylessAndPingOnlyHosts(): Array<JSONObject> {
    return [
      { ipAddress: "10.0.0.5", sysName: "sw1" },
      { ipAddress: "10.0.0.9", sysName: "sw2" },
      { ipAddress: "10.0.0.11", sysName: "sw3" },
      { ipAddress: "10.0.0.20", snmpReachable: false },
      { ipAddress: "10.0.0.21", snmpReachable: false },
    ];
  }

  // What an ICMP-only sweep reports: alive hosts, every one snmpReachable:false.
  function pingOnlyHosts(): Array<JSONObject> {
    return [
      { ipAddress: "10.0.0.20", snmpReachable: false },
      { ipAddress: "10.0.0.21", snmpReachable: false },
      { ipAddress: "10.0.0.22", snmpReachable: false },
      { ipAddress: "10.0.0.23", snmpReachable: false },
    ];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
    scanService.updateOneById.mockResolvedValue(undefined as never);
  });

  /*
   * The column has to be asked for, or the row arrives without it and reads
   * as an SNMP scan — which for an ICMP-only sweep means storing a hard zero
   * for a scan that swept the whole range successfully. Same absent-means-
   * SNMP rule as the claim endpoint, failing in the opposite direction: there
   * it SNMP-probes a scan that asked not to be, here it reports a good scan
   * as having found nothing.
   */
  test("the result handler selects isSnmpEnabled, or it cannot tell which count to store", async () => {
    await reportResult(makeScan(false), { discoveredDevices: [] });

    const findOneArgs: JSONObject = scanService.findOneBy.mock
      .calls[0]![0] as JSONObject;
    expect((findOneArgs["select"] as JSONObject)["isSnmpEnabled"]).toBe(true);
  });

  /*
   * The result select, pinned whole — the counterpart of the claim's pin. A
   * column dropped from here does not fail: it arrives undefined and the
   * handler carries on with a wrong default (no reschedule, an SNMP count for
   * a ping sweep, a superseded result accepted).
   */
  test("the result handler asks for exactly the columns it needs to interpret the result", async () => {
    await reportResult(makeScan(false), { discoveredDevices: [] });

    const findOneArgs: JSONObject = scanService.findOneBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findOneArgs["select"] as JSONObject;

    expect(Object.keys(select).sort()).toEqual([
      "_id",
      "isRecurring",
      "isSnmpEnabled",
      "projectId",
      "rescanIntervalInMinutes",
      "status",
    ]);

    for (const column of Object.keys(select)) {
      expect(select[column]).toBe(true);
    }
  });

  /*
   * The headline of issue #3445's second half. Four hosts answered ping on a
   * scan that only ever asked about ping, so four hosts responded. Filtering
   * this list for SNMP responders — the rule that is right for the other kind
   * of scan — would store 0, and the Discovery Scans list would tell the
   * operator their working sweep found nothing.
   */
  test("an ICMP-only sweep counts every host that answered ping", async () => {
    await reportResult(makeScan(false), {
      scannedHostCount: 254,
      discoveredDevices: pingOnlyHosts(),
    });

    expect(writtenData()["respondedHostCount"]).toBe(4);
  });

  /*
   * The existing rule, asserted next to the new one so the two are visibly
   * different rather than accidentally the same. On an SNMP scan the
   * ping-only hosts are still stored (the review modal offers them as
   * ICMP-monitored devices) but they are NOT what "responded" means there.
   */
  test("an SNMP scan still counts SNMP responders only and still leaves the ping-only hosts out", async () => {
    await reportResult(makeScan(true), {
      scannedHostCount: 254,
      discoveredDevices: mixedHosts(),
    });

    const data: JSONObject = writtenData();
    expect(data["respondedHostCount"]).toBe(2);
    // All five are kept for the review modal — only the count is filtered.
    expect((data["discoveredDevices"] as Array<JSONObject>).length).toBe(5);
  });

  /*
   * The same five hosts, counted twice. This is the whole change in one
   * assertion: the number depends on the question the scan asked, not on the
   * hosts. If these two ever come out equal, one of the two meanings has been
   * lost.
   */
  test("the same host list is counted differently by the two methods", async () => {
    const underSnmp: number = await respondedHostCountFor(
      makeScan(true),
      mixedHosts(),
    );
    const underIcmpOnly: number = await respondedHostCountFor(
      makeScan(false),
      mixedHosts(),
    );

    expect(underSnmp).toBe(2);
    expect(underIcmpOnly).toBe(5);
    expect(underIcmpOnly).not.toBe(underSnmp);
  });

  /*
   * THE load-bearing legacy case. Every scan row written before this column
   * existed comes back without it, and so does every row read by a server
   * that has not been upgraded. Absence has to mean SNMP — it is what those
   * scans were — and the count has to stay the SNMP count for them.
   *
   * Read it the other way round and nothing errors: every legacy scan in
   * every project would quietly be treated as a ping sweep, its
   * respondedHostCount would jump to include hosts that answered nothing but
   * ICMP, and the "manageable devices" number the inventory is built on would
   * stop meaning that.
   *
   * Not new coverage, strictly: `makeFoundScan` in the describe above never
   * sets the column either, so every result test up there is already a legacy
   * row, so "respondedHostCount counts SNMP responders only, not ping-only
   * hosts" and "a sweep that found only ping-only hosts reports zero SNMP
   * responders" up there already pin this rule. These two say it out loud,
   * next to the ICMP-only cases they have to be read against.
   */
  test("a scan whose isSnmpEnabled never arrived counts SNMP responders — absence means SNMP", async () => {
    await reportResult(makeScan(), { discoveredDevices: mixedHosts() });

    expect(writtenData()["respondedHostCount"]).toBe(2);
  });

  test("a legacy scan is not accidentally read as ICMP-only", async () => {
    const legacyScan: NetworkDeviceDiscoveryScan = makeScan();
    expect(legacyScan.isSnmpEnabled).toBeUndefined();

    const counted: number = await respondedHostCountFor(
      legacyScan,
      pingOnlyHosts(),
    );

    /*
     * Four alive hosts, none of them SNMP-reachable, on a scan that never
     * said it was ICMP-only: the honest answer is zero SNMP responders. A 4
     * here would mean absence had been read as "ping sweep".
     */
    expect(counted).toBe(0);
  });

  /*
   * The column is NOT NULL in Postgres, but a row can still reach this
   * handler with a null in it — a partial select, a hand-written query, a
   * fixture. `!== false` covers null for the same reason it covers
   * undefined, and this pins that it does.
   */
  test("a scan whose isSnmpEnabled arrived as null is treated exactly like a legacy row", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan();
    (scan as unknown as JSONObject)["isSnmpEnabled"] = null;

    await reportResult(scan, { discoveredDevices: mixedHosts() });

    expect(writtenData()["respondedHostCount"]).toBe(2);
  });

  /*
   * Only an EXPLICIT false switches the count over. Anything else — absent,
   * null — is an SNMP scan, so the ICMP-only branch can never be entered by
   * accident.
   */
  test("only an explicit false switches the count to ping responders", async () => {
    expect(await respondedHostCountFor(makeScan(false), mixedHosts())).toBe(5);
    expect(await respondedHostCountFor(makeScan(true), mixedHosts())).toBe(2);
    expect(await respondedHostCountFor(makeScan(), mixedHosts())).toBe(2);
  });

  /*
   * An older probe omits `snmpReachable` entirely and only ever pushed SNMP
   * responders into the array, so a missing key still has to count as a
   * responder on an SNMP scan. This is the same `!== false` shape as the mode
   * flag itself, one level down, and it has to survive the #3445 change
   * untouched.
   *
   * Three keyless hosts among two the probe tagged `snmpReachable: false`, so
   * the number distinguishes all three ways this can break: 5 means the mode
   * was ignored and the ICMP-only branch ran, 2 means a missing key was read
   * as "not reachable", 3 is right.
   */
  test("hosts from an older probe that carry no snmpReachable key still count as SNMP responders", async () => {
    await reportResult(makeScan(true), {
      discoveredDevices: keylessAndPingOnlyHosts(),
    });

    expect(writtenData()["respondedHostCount"]).toBe(3);
  });

  /*
   * The same list again on a legacy row, which is where the two rules meet:
   * the scan carries no method AND some hosts carry no snmpReachable. Both
   * absences have to read as "SNMP", so the answer stays 3. A 5 here is the
   * absence-means-ICMP-only regression; a 2 is the missing-key one.
   */
  test("the same keyless hosts on a legacy scan are also counted as SNMP responders", async () => {
    await reportResult(makeScan(), {
      discoveredDevices: keylessAndPingOnlyHosts(),
    });

    expect(writtenData()["respondedHostCount"]).toBe(3);
  });

  /*
   * The scan's method wins over anything the hosts claim. An ICMP-only sweep
   * has no SNMP result to report, so a `snmpReachable: true` on one of its
   * hosts is a probe bug or a stale payload — and either way, dropping the
   * other hosts on the strength of it would be the "0 of 254" failure again,
   * just partially.
   */
  test("an ICMP-only sweep counts every alive host even if a host arrives tagged snmpReachable", async () => {
    await reportResult(makeScan(false), {
      discoveredDevices: [
        { ipAddress: "10.0.0.5", snmpReachable: true },
        { ipAddress: "10.0.0.20", snmpReachable: false },
        { ipAddress: "10.0.0.21" },
      ],
    });

    expect(writtenData()["respondedHostCount"]).toBe(3);
  });

  /*
   * The method is a property of the SCAN, read from the row the server owns —
   * never from the request. The probe is authenticated as a probe, not as the
   * project, so a probe that sent its own `isSnmpEnabled` (buggy, old, or
   * hostile) must not be able to change how its results are counted, in
   * either direction.
   */
  test("a method sent in the request body cannot turn an SNMP scan into a ping sweep", async () => {
    await reportResult(makeScan(true), {
      isSnmpEnabled: false,
      discoveredDevices: mixedHosts(),
    });

    expect(writtenData()["respondedHostCount"]).toBe(2);
  });

  test("a method sent in the request body cannot turn a ping sweep into an SNMP scan", async () => {
    await reportResult(makeScan(false), {
      isSnmpEnabled: true,
      discoveredDevices: mixedHosts(),
    });

    expect(writtenData()["respondedHostCount"]).toBe(5);
  });

  /*
   * The empty sweep. Nothing answered ping on a range that was swept
   * perfectly well, so zero is the truthful number — reached by counting an
   * empty array, not by anything throwing on the way.
   */
  test("an ICMP-only sweep that found nothing stores zero and still completes", async () => {
    const { next } = await reportResult(makeScan(false), {
      scannedHostCount: 254,
      statusMessage:
        "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 0 answered ping.",
      discoveredDevices: [],
    });

    expect(next).not.toHaveBeenCalled();

    const data: JSONObject = writtenData();
    expect(data["respondedHostCount"]).toBe(0);
    expect(data["status"]).toBe("Completed");
    expect(data["discoveredDevices"]).toEqual([]);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "ok" },
    );
  });

  /*
   * An ICMP-only result whose probe sent no discoveredDevices key at all —
   * an older probe, or a payload trimmed in transit. The count must still be
   * a number, because the column is numeric and the overview page prints it
   * verbatim: an undefined or a NaN here is a broken cell on a page nobody
   * can fix from the UI.
   */
  test("an ICMP-only result with no discoveredDevices key at all stores the number zero", async () => {
    await reportResult(makeScan(false), {});

    const stored: unknown = writtenData()["respondedHostCount"];
    expect(stored).toBe(0);
    expect(typeof stored).toBe("number");
    expect(Number.isNaN(stored as number)).toBe(false);
  });

  /*
   * A probe that sends `discoveredDevices: null` — the shape an aborted sweep
   * serialises to. The handler falls back to an empty list, so the row still
   * gets a number and the sweep is recorded as having found nothing, rather
   * than the request dying and the scan being left In Progress for the reaper.
   */
  test("an ICMP-only result whose discoveredDevices arrived as null stores zero", async () => {
    const { next } = await reportResult(makeScan(false), {
      discoveredDevices: null,
    });

    expect(next).not.toHaveBeenCalled();

    const data: JSONObject = writtenData();
    expect(data["respondedHostCount"]).toBe(0);
    expect(data["discoveredDevices"]).toEqual([]);
  });

  // The smallest non-empty sweep: one host up in the range.
  test("an ICMP-only sweep that found a single host stores one", async () => {
    await reportResult(makeScan(false), {
      scannedHostCount: 254,
      discoveredDevices: [{ ipAddress: "10.0.0.20", snmpReachable: false }],
    });

    expect(writtenData()["respondedHostCount"]).toBe(1);
  });

  /*
   * The number from the issue, end to end: a full /24 where everything is
   * alive. This is the row that used to read "0 of 254 hosts".
   */
  test("an ICMP-only sweep of a full /24 stores 254, not zero", async () => {
    const discovered: Array<JSONObject> = [];
    for (let index: number = 1; index <= 254; index++) {
      discovered.push({
        ipAddress: `10.0.0.${index}`,
        snmpReachable: false,
      });
    }

    await reportResult(makeScan(false), {
      scannedHostCount: 254,
      discoveredDevices: discovered,
    });

    const data: JSONObject = writtenData();
    expect(data["respondedHostCount"]).toBe(254);
    expect(data["respondedHostCount"]).not.toBe(0);
    // Same denominator the list renders against, so the cell reads "254 of 254".
    expect(data["scannedHostCount"]).toBe(254);
  });

  /*
   * A host that already has a device answered the ping just the same. The
   * already-registered flag is about what the review modal may import, and
   * has nothing to do with what responded — on either method.
   */
  test("already-registered hosts still count on an ICMP-only sweep", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.20", "10.0.0.21"]) as never,
    );

    await reportResult(makeScan(false), { discoveredDevices: pingOnlyHosts() });

    const data: JSONObject = writtenData();
    expect(data["respondedHostCount"]).toBe(4);
    expect(
      (data["discoveredDevices"] as Array<JSONObject>).filter(
        (device: JSONObject): boolean => {
          return device["isAlreadyRegistered"] === true;
        },
      ),
    ).toHaveLength(2);
  });

  /*
   * A sweep the probe reports as failed still reports the hosts it managed to
   * find, and those hosts still answered ping. The method decides the count;
   * success decides the status. Mixing the two would lose the partial results
   * of a sweep that stopped early — which is exactly the ICMP-incomplete case
   * the probe now reports.
   */
  test("a failed ICMP-only sweep still counts the hosts it did find", async () => {
    await reportResult(makeScan(false), {
      success: false,
      statusMessage: "This ping sweep stopped early.",
      discoveredDevices: pingOnlyHosts(),
    });

    const data: JSONObject = writtenData();
    expect(data["status"]).toBe("Failed");
    expect(data["respondedHostCount"]).toBe(4);
  });

  /*
   * Everything else about a result is method-agnostic. The columns written
   * for an ICMP-only sweep are the same columns, so nothing downstream — the
   * auto-import worker's autoImportProcessedAt marker, the reaper's status,
   * the review modal's host list — has to learn about the new mode.
   */
  test("an ICMP-only result writes exactly the same columns as an SNMP one", async () => {
    await reportResult(makeScan(false), {
      success: true,
      statusMessage: "Swept 254 hosts with ICMP ping only.",
      scannedHostCount: 254,
      discoveredDevices: pingOnlyHosts(),
    });

    const data: JSONObject = writtenData();
    expect(Object.keys(data).sort()).toEqual([
      "autoImportProcessedAt",
      "completedAt",
      "discoveredDevices",
      "respondedHostCount",
      "scannedHostCount",
      "status",
      "statusMessage",
    ]);
    expect(data["autoImportProcessedAt"]).toBeNull();
    expect(data["completedAt"]).toBeInstanceOf(Date);
  });

  /*
   * The hosts themselves are stored untouched apart from the registration
   * flag — the review modal is what turns them into devices, and it reads
   * them off this row.
   */
  test("an ICMP-only sweep stores every host it found, in the order the probe reported them", async () => {
    await reportResult(makeScan(false), {
      discoveredDevices: [
        { ipAddress: "10.0.0.23", snmpReachable: false },
        { ipAddress: "10.0.0.20", snmpReachable: false },
      ],
    });

    expect(writtenData()["discoveredDevices"]).toEqual([
      {
        ipAddress: "10.0.0.23",
        snmpReachable: false,
        isAlreadyRegistered: false,
      },
      {
        ipAddress: "10.0.0.20",
        snmpReachable: false,
        isAlreadyRegistered: false,
      },
    ]);
  });

  /*
   * Where the two changes actually touch on this endpoint: the credential set
   * that found a host (issue #3458) and a sweep that used no credentials at
   * all (issue #3445).
   *
   * `snmpConfigId` is the probe's report of WHICH of the scan's credential
   * sets answered a host, and it is the only input SnmpScanConfigUtil.
   * resolveForHost has when the import path builds the device. An ICMP-only
   * sweep sent no SNMP at all, so no credential set found anything and there
   * is no id to report — the probe sends none, and this endpoint must not
   * invent one.
   *
   * Inventing one is not a hypothetical: the resolver's documented fallback
   * for an ABSENT id is the scan's first config, so an id written here — even
   * a placeholder — would be taken at face value later. On an ICMP-only scan
   * the row's credential columns were cleared when Check SNMP was switched
   * off, so the fabricated id would resolve to nothing and every host from
   * this sweep would import as an SNMP device with no credentials: a device
   * that fails every poll from the moment it is created, on a scan the
   * operator asked to do nothing but ping.
   */
  test("an ICMP-only sweep's hosts are stored with no snmpConfigId, because no credential set found them", async () => {
    await reportResult(makeScan(false), {
      scannedHostCount: 254,
      discoveredDevices: pingOnlyHosts(),
    });

    const data: JSONObject = writtenData();
    const stored: Array<JSONObject> = data[
      "discoveredDevices"
    ] as Array<JSONObject>;

    expect(stored).toHaveLength(4);
    for (const host of stored) {
      /*
       * The key, not just the value: toEqual would read an explicit
       * `undefined` and an absent key as the same thing, and an id written as
       * undefined is still an id the endpoint decided to write.
       */
      expect(Object.keys(host)).not.toContain("snmpConfigId");
    }

    // ...and they still all count, because ping was the question.
    expect(data["respondedHostCount"]).toBe(4);
  });

  /*
   * The other side of that pair, so the two are visibly different: an SNMP
   * scan's responders keep the id of the config that answered them, and the
   * ping-only hosts in the SAME sweep keep none — they are stored (the review
   * modal offers them as ICMP-monitored devices) but no credential set found
   * them either.
   */
  test("an SNMP scan keeps each responder's config id and leaves the ping-only hosts without one", async () => {
    await reportResult(makeScan(true), {
      discoveredDevices: [
        {
          ipAddress: "10.0.0.5",
          sysName: "core-1",
          snmpReachable: true,
          snmpConfigId: "config-core",
        },
        {
          ipAddress: "10.0.0.9",
          sysName: "access-3",
          snmpReachable: true,
          snmpConfigId: "config-access",
        },
        { ipAddress: "10.0.0.20", snmpReachable: false },
      ],
    });

    const data: JSONObject = writtenData();
    const stored: Array<JSONObject> = data[
      "discoveredDevices"
    ] as Array<JSONObject>;

    expect(stored[0]!["snmpConfigId"]).toBe("config-core");
    expect(stored[1]!["snmpConfigId"]).toBe("config-access");
    expect(Object.keys(stored[2]!)).not.toContain("snmpConfigId");

    // The ping-only host is stored, but it is not what "responded" means here.
    expect(stored).toHaveLength(3);
    expect(data["respondedHostCount"]).toBe(2);
  });

  /*
   * scannedHostCount is the probe's own number — how many addresses the sweep
   * walked — and is the denominator of "N of M hosts". It is reported the
   * same way by both methods and must not be derived from, or clipped to, the
   * responder count.
   */
  test("scannedHostCount is stored as reported on an ICMP-only sweep, independent of the responder count", async () => {
    await reportResult(makeScan(false), {
      scannedHostCount: 1024,
      discoveredDevices: pingOnlyHosts(),
    });

    const data: JSONObject = writtenData();
    expect(data["scannedHostCount"]).toBe(1024);
    expect(data["respondedHostCount"]).toBe(4);
  });

  /*
   * The probe's ICMP-only summary is the user-facing explanation of a sweep
   * that found nothing, and it is the product here — it is what tells an
   * operator that Windows hosts drop ping. It has to be stored verbatim, not
   * rewritten or replaced by the SNMP wording.
   */
  test("an ICMP-only status message is stored verbatim", async () => {
    const message: string =
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 0 answered ping. Nothing answered ICMP ping. Check that this probe can reach the range and that ICMP echo is permitted to it.";

    await reportResult(makeScan(false), {
      statusMessage: message,
      discoveredDevices: [],
    });

    expect(writtenData()["statusMessage"]).toBe(message);
  });

  /*
   * The ICMP-only summary is longer than the SNMP one (it carries the
   * incomplete-sweep warning and the "hosts that drop ping" advice), so the
   * varchar(500) clip matters more here, not less. Clipping loses words;
   * failing the write loses the whole sweep.
   */
  test("an over-long ICMP-only status message is clipped rather than failing the write", async () => {
    await reportResult(makeScan(false), {
      statusMessage: "P".repeat(900),
      discoveredDevices: pingOnlyHosts(),
    });

    const data: JSONObject = writtenData();
    expect(data["statusMessage"]).toHaveLength(500);
    expect(data["respondedHostCount"]).toBe(4);
  });

  /*
   * Recurrence is orthogonal to method. An ICMP-only scan that recurs gets
   * its next run scheduled on the same interval arithmetic — the mode must
   * not slip into the branch that decides whether to reschedule.
   */
  test("a recurring ICMP-only scan schedules its next run like any other", async () => {
    const before: number = Date.now();
    await reportResult(
      makeScan(false, { isRecurring: true, rescanIntervalInMinutes: 60 }),
      { discoveredDevices: pingOnlyHosts() },
    );
    const after: number = Date.now();

    const data: JSONObject = writtenData();
    const nextScanAt: Date = data["nextScanAt"] as Date;
    expect(nextScanAt).toBeInstanceOf(Date);
    const sixtyMinutes: number = 60 * 60 * 1000;
    expect(nextScanAt.getTime()).toBeGreaterThanOrEqual(
      before + sixtyMinutes - 1000,
    );
    expect(nextScanAt.getTime()).toBeLessThanOrEqual(
      after + sixtyMinutes + 1000,
    );
    expect(data["respondedHostCount"]).toBe(4);
  });

  test("a one-time ICMP-only scan gets no nextScanAt", async () => {
    await reportResult(makeScan(false), { discoveredDevices: pingOnlyHosts() });

    expect(Object.keys(writtenData())).not.toContain("nextScanAt");
  });

  /*
   * The clamp note is appended to whatever the probe said — including the
   * ICMP-only summary, which is a different sentence from the SNMP one. Both
   * have to survive together in the one varchar the user reads.
   */
  test("the rescan clamp note is appended to an ICMP-only scan's own summary", async () => {
    await reportResult(
      makeScan(false, { isRecurring: true, rescanIntervalInMinutes: 5 }),
      {
        statusMessage:
          "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 4 answered ping.",
        discoveredDevices: pingOnlyHosts(),
      },
    );

    expect(writtenData()["statusMessage"]).toBe(
      "Swept 254 hosts with ICMP ping only (Check SNMP is off for this scan): 4 answered ping. Rescan interval is below the 15-minute minimum; rescanning every 15 minutes instead.",
    );
  });

  /*
   * The superseded-run guard runs before any of this. An ICMP-only result for
   * a run that has already been requeued is discarded like any other, and in
   * particular must not overwrite the new run's empty result with a count
   * from hours ago.
   */
  test("an ICMP-only result for a run that was already requeued is discarded", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan(false);
    scan.status = "Pending";

    await reportResult(scan, { discoveredDevices: pingOnlyHosts() });

    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "discarded" },
    );
  });
});

/*
 * A sweep can outlive its own claim. The stale-In-Progress reaper marks a scan
 * Failed after two hours and, if it recurs, the requeue pass then flips it
 * back to Pending for a fresh run
 * (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts). A probe that
 * finally reports the ABANDONED run lands on that row — and used to stamp it
 * Completed, retiring a run that had been queued and never happened and
 * replacing the new run's empty result set with findings from hours earlier.
 */
describe("POST /probe/discovery-scan/result — a result for a superseded run", () => {
  const probeId: ObjectID = ObjectID.generate();
  const scanId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  function makeScanWithStatus(status: string): NetworkDeviceDiscoveryScan {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.projectId = projectId;
    scan.status = status;
    return scan;
  }

  function resultRequest(): ExpressRequest {
    return makeRequest({
      probeId,
      body: {
        scanId: scanId.toString(),
        success: true,
        statusMessage: "Swept 254 hosts.",
        scannedHostCount: 254,
        discoveredDevices: [{ ipAddress: "10.0.0.5", sysName: "sw1" }],
      },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
    scanService.updateOneById.mockResolvedValue(undefined as never);
  });

  test("a scan that is queued for a new run keeps its fresh state", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeScanWithStatus("Pending") as never,
    );

    const { next } = await callResultEndpoint(resultRequest());

    expect(next).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "discarded" },
    );
  });

  /*
   * Only Pending is refused. A late result for a scan the reaper GUESSED was
   * abandoned is still the truth about that same run, so the probe's actual
   * findings must replace the reaper's guess.
   */
  test("a scan the reaper marked Failed still accepts the real result", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeScanWithStatus("Failed") as never,
    );

    await callResultEndpoint(resultRequest());

    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
    const data: JSONObject = expectPlainUpdateData(
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)["data"],
    );
    expect(data["status"]).toBe("Completed");
  });

  test("an In Progress scan — the ordinary case — is written as before", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeScanWithStatus("In Progress") as never,
    );

    await callResultEndpoint(resultRequest());

    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("the status column is actually selected, or the check above is vacuous", async () => {
    scanService.findOneBy.mockResolvedValue(
      makeScanWithStatus("In Progress") as never,
    );

    await callResultEndpoint(resultRequest());

    const findOneArgs: JSONObject = scanService.findOneBy.mock
      .calls[0]![0] as JSONObject;
    expect((findOneArgs["select"] as JSONObject)["status"]).toBe(true);
  });
});

/*
 * Which discovered hosts already have a device — the flag the review modal
 * uses to grey out "import", and therefore the thing standing between a
 * re-scan and a duplicated inventory.
 *
 * The endpoint used to work this out itself, by copying every hostname in the
 * project into a Set: first one findBy capped at 10,000 (so a larger fleet
 * silently reported its devices as NOT registered), then a paged walk ordered
 * by createdAt (so a bulk import's identically-stamped rows made the pages
 * overlap and skip, with the same result). It now ASKS — one narrow question
 * about the addresses this sweep actually found.
 *
 * That moved the interesting arithmetic — chunking, dedup, how many
 * statements — into NetworkDeviceService, where
 * Common/Tests/Server/Services/NetworkDeviceRegisteredHostnames.test.ts
 * covers it. What is left for the endpoint, and what this block covers, is
 * the contract between the two: ask about the right addresses in the right
 * project, and put the answer on the right hosts.
 */
describe("POST /probe/discovery-scan/result — flagging already-registered hosts", () => {
  const probeId: ObjectID = ObjectID.generate();
  const scanId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  function makeScan(
    status: string = "In Progress",
  ): NetworkDeviceDiscoveryScan {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      scanId,
    );
    scan.projectId = projectId;
    scan.status = status;
    return scan;
  }

  function resultRequest(discoveredDevices: Array<JSONObject>): ExpressRequest {
    return makeRequest({
      probeId,
      body: {
        scanId: scanId.toString(),
        success: true,
        discoveredDevices: discoveredDevices,
      },
    });
  }

  // The argument the endpoint handed the service.
  function lookupArgs(): JSONObject {
    expect(deviceService.getRegisteredHostnames).toHaveBeenCalledTimes(1);
    return deviceService.getRegisteredHostnames.mock.calls[0]![0] as JSONObject;
  }

  function askedAbout(): Array<string> {
    return lookupArgs()["hostnames"] as Array<string>;
  }

  // The hosts as they were written to the scan row, flags and all.
  function storedDevices(): Array<JSONObject> {
    expect(scanService.updateOneById).toHaveBeenCalledTimes(1);
    const data: JSONObject = expectPlainUpdateData(
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)["data"],
    );
    return data["discoveredDevices"] as Array<JSONObject>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    scanService.updateOneById.mockResolvedValue(undefined as never);
    scanService.findOneBy.mockResolvedValue(makeScan() as never);
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>() as never,
    );
  });

  /*
   * The load-bearing one. The question is about the sweep's addresses, so its
   * cost is bounded by the sweep — not by the fleet, which is what made the
   * old walk both slow and wrong.
   */
  test("asks about the addresses this sweep found, not about the whole project", async () => {
    await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }, { ipAddress: "10.0.0.6" }]),
    );

    expect(askedAbout()).toEqual(["10.0.0.5", "10.0.0.6"]);
  });

  test("asks within the scan's own project", async () => {
    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect((lookupArgs()["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
  });

  /*
   * The probe is authenticated as a probe, not as a project member, so the
   * lookup has no user permissions to ride on.
   */
  test("asks as root", async () => {
    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect((lookupArgs()["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  /*
   * One question for the whole sweep. The endpoint no longer loops: a large
   * sweep must not turn into a page-at-a-time walk inside the request the
   * probe is synchronously waiting on.
   */
  test("asks once, however many hosts the sweep found", async () => {
    const discovered: Array<JSONObject> = [];
    for (let index: number = 0; index < 300; index++) {
      discovered.push({
        ipAddress: `10.7.${Math.floor(index / 256)}.${index % 256}`,
      });
    }

    await callResultEndpoint(resultRequest(discovered));

    expect(deviceService.getRegisteredHostnames).toHaveBeenCalledTimes(1);
    expect(askedAbout()).toHaveLength(300);
  });

  test("flags exactly the hosts the answer named", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5", "10.0.0.7"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5" },
        { ipAddress: "10.0.0.6" },
        { ipAddress: "10.0.0.7" },
      ]),
    );

    expect(
      storedDevices().map((device: JSONObject) => {
        return device["isAlreadyRegistered"];
      }),
    ).toEqual([true, false, true]);
  });

  /*
   * Every host carries the flag explicitly. A missing key reads as falsy in
   * the review modal by accident rather than by decision, and "accidentally
   * importable" is the failure mode that duplicates devices.
   */
  test("every host is flagged, never left undefined", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }, { ipAddress: "10.0.0.6" }]),
    );

    for (const device of storedDevices()) {
      expect(Object.keys(device)).toContain("isAlreadyRegistered");
      expect(typeof device["isAlreadyRegistered"]).toBe("boolean");
    }
  });

  /*
   * A host the probe found but could not name. It is asked about as the empty
   * string — which the service drops — and must never come back flagged, or
   * the modal would refuse to import a host that has no device at all.
   */
  test("a host with no ipAddress is asked about as an empty string and is not flagged", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }, { sysName: "unnamed" }]),
    );

    expect(askedAbout()).toEqual(["10.0.0.5", ""]);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("a host reported with a null ipAddress is handled the same way", async () => {
    await callResultEndpoint(resultRequest([{ ipAddress: null }]));

    expect(askedAbout()).toEqual([""]);
    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(false);
  });

  /*
   * A sweep can report the same address twice — two interfaces answering, or
   * a probe retry. Both entries describe the same device, so both must be
   * flagged; flagging only the first would offer the second for import.
   */
  test("a repeated address is flagged on every entry that carries it", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", sysName: "first" },
        { ipAddress: "10.0.0.5", sysName: "second" },
      ]),
    );

    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(true);
  });

  /*
   * Ping-only hosts are offered for import too (as ICMP-monitored devices),
   * so they need the same guard against being imported twice.
   */
  test("ping-only hosts are asked about alongside the SNMP responders", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.20"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", snmpReachable: true },
        { ipAddress: "10.0.0.20", snmpReachable: false },
      ]),
    );

    expect(askedAbout()).toEqual(["10.0.0.5", "10.0.0.20"]);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(true);
  });

  test("addresses are asked about in the order the probe reported them", async () => {
    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.9" },
        { ipAddress: "10.0.0.5" },
        { ipAddress: "10.0.0.7" },
      ]),
    );

    expect(askedAbout()).toEqual(["10.0.0.9", "10.0.0.5", "10.0.0.7"]);
  });

  test("a sweep that found nothing asks about nothing and stores nothing", async () => {
    await callResultEndpoint(resultRequest([]));

    expect(askedAbout()).toEqual([]);
    expect(storedDevices()).toEqual([]);
  });

  /*
   * The flags have to survive onto the array that is actually persisted — the
   * review modal reads them off the stored row, not off the request.
   */
  test("the flags land on the hosts written to the scan row", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", sysName: "known" },
        { ipAddress: "10.0.0.9", sysName: "new" },
      ]),
    );

    expect(storedDevices()).toEqual([
      { ipAddress: "10.0.0.5", sysName: "known", isAlreadyRegistered: true },
      { ipAddress: "10.0.0.9", sysName: "new", isAlreadyRegistered: false },
    ]);
  });

  /*
   * The one field on a discovered host that the endpoint must not touch and
   * must not lose: WHICH of the scan's credential sets answered that host.
   *
   * A scan now tries an ordered list, so "the scan's SNMP credentials" is no
   * longer a single answer — `snmpConfigId` is the probe's report of which
   * entry actually worked, and it is the only input
   * SnmpScanConfigUtil.resolveForHost has to work from when the import path
   * (manual review and the auto-import rule engine, both through
   * DiscoveredDeviceBuilder) builds the device. Drop it here and every host
   * found by the second credential set is imported carrying the FIRST set's
   * community string: a device that fails every poll from the moment it is
   * created, with nothing on it to say why, and no error at any point in
   * between.
   *
   * The endpoint stores `discoveredDevices` verbatim apart from the
   * already-registered flag it adds, so this asserts the whole array: the ids
   * ride through untouched, and the flag is the only thing that changed.
   */
  test("a probe-reported snmpConfigId survives verbatim onto the stored hosts", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        {
          ipAddress: "10.0.0.5",
          sysName: "core-1",
          snmpReachable: true,
          snmpConfigId: "config-core",
        },
        {
          ipAddress: "10.0.0.9",
          sysName: "access-3",
          snmpReachable: true,
          snmpConfigId: "config-access",
        },
        /*
         * A ping-only host: no credential set found it, so the probe reports
         * no id at all and the endpoint must not invent one — a ping-only
         * host is imported as an ICMP device with NO credentials, and handing
         * it the first config's would be a fabrication.
         */
        { ipAddress: "10.0.0.20", snmpReachable: false },
      ]),
    );

    expect(storedDevices()).toEqual([
      {
        ipAddress: "10.0.0.5",
        sysName: "core-1",
        snmpReachable: true,
        snmpConfigId: "config-core",
        isAlreadyRegistered: true,
      },
      {
        ipAddress: "10.0.0.9",
        sysName: "access-3",
        snmpReachable: true,
        snmpConfigId: "config-access",
        isAlreadyRegistered: false,
      },
      {
        ipAddress: "10.0.0.20",
        snmpReachable: false,
        isAlreadyRegistered: false,
      },
    ]);

    /*
     * toEqual treats an absent key and an explicit `undefined` as the same
     * thing, so the ping-only host's missing id is checked directly. An id
     * written as undefined would still be an id the endpoint had decided to
     * write.
     */
    expect(Object.keys(storedDevices()[2]!)).not.toContain("snmpConfigId");
  });

  /*
   * An older probe knows nothing about the credential list and reports no
   * `snmpConfigId` on any host. Those results still have to store cleanly —
   * the resolver falls back to the scan's first config for an absent id,
   * which for the single-config scan such a probe was actually sweeping is
   * exactly the credential set it used.
   */
  test("hosts from a probe that predates the credential list store with no snmpConfigId", async () => {
    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", sysName: "sw1" },
        { ipAddress: "10.0.0.9", sysName: "sw2" },
      ]),
    );

    for (const device of storedDevices()) {
      expect(Object.keys(device)).not.toContain("snmpConfigId");
      expect(device["isAlreadyRegistered"]).toBe(false);
    }
  });

  test("the hosts are flagged before the row is written", async () => {
    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect(
      deviceService.getRegisteredHostnames.mock.invocationCallOrder[0]!,
    ).toBeLessThan(scanService.updateOneById.mock.invocationCallOrder[0]!);
  });

  /*
   * A result for a run that was already superseded is discarded, and a
   * discarded result must not spend a query proving it.
   */
  test("a result for a superseded run never asks", async () => {
    scanService.findOneBy.mockResolvedValue(makeScan("Pending") as never);

    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect(deviceService.getRegisteredHostnames).not.toHaveBeenCalled();
    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * If the lookup fails, the honest answer is an error. Treating the failure
   * as "none of these are registered" would offer the whole sweep for import
   * and duplicate every device in it.
   */
  test("a failed lookup errors instead of storing every host as new", async () => {
    const boom: Error = new Error("db down");
    deviceService.getRegisteredHostnames.mockRejectedValue(boom as never);

    const { next } = await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }]),
    );

    expect(next).toHaveBeenCalledWith(boom);
    expect(scanService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * The scale the endpoint has to survive: a sweep of ScanTargetUtil-sized
   * range. Still one question, and the answer still lands on the right hosts.
   */
  test("a 5,000-host sweep is one question, and the flags still land correctly", async () => {
    const discovered: Array<JSONObject> = [];
    for (let index: number = 0; index < 5000; index++) {
      discovered.push({
        ipAddress: `10.60.${Math.floor(index / 256)}.${index % 256}`,
      });
    }

    const registeredAddress: string = discovered[4999]!["ipAddress"] as string;
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>([registeredAddress]) as never,
    );

    await callResultEndpoint(resultRequest(discovered));

    expect(deviceService.getRegisteredHostnames).toHaveBeenCalledTimes(1);
    expect(askedAbout()).toHaveLength(5000);

    const stored: Array<JSONObject> = storedDevices();
    expect(stored[4999]!["isAlreadyRegistered"]).toBe(true);
    expect(
      stored.filter((device: JSONObject) => {
        return device["isAlreadyRegistered"] === true;
      }),
    ).toHaveLength(1);
  });

  /*
   * Three things and no more. The paging arguments the endpoint used to build
   * itself — skip, limit, sort — are the service's business now, and passing
   * one from here would mean the walk had started growing back.
   */
  test("asks with exactly three things: the project, the addresses, and root", () => {
    return callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }])).then(
      (): void => {
        expect(Object.keys(lookupArgs()).sort()).toEqual([
          "hostnames",
          "projectId",
          "props",
        ]);
      },
    );
  });

  /*
   * The flag is the endpoint's answer, not the probe's claim. A probe that
   * sent isAlreadyRegistered itself — buggy, old, or hostile — could
   * otherwise hide a host from the review modal, or offer a host that already
   * has a device.
   */
  test("a flag the probe sent itself is overwritten, not trusted", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", isAlreadyRegistered: false },
        { ipAddress: "10.0.0.9", isAlreadyRegistered: true },
      ]),
    );

    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("a numeric ipAddress is asked about as its string form", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["42"]) as never,
    );

    await callResultEndpoint(resultRequest([{ ipAddress: 42 }]));

    expect(askedAbout()).toEqual(["42"]);
    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
  });

  /*
   * Exact string matching, and deliberately so — "10.0.0.5 " and "10.0.0.5"
   * are different hostnames in the column this is asked of, and pretending
   * otherwise here would flag a host against a device that does not exist.
   */
  test("matching is exact — a padded or differently-cased answer flags nothing", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>([" 10.0.0.5", "SWITCH-1"]) as never,
    );

    await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }, { ipAddress: "switch-1" }]),
    );

    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(false);
    expect(storedDevices()[1]!["isAlreadyRegistered"]).toBe(false);
  });

  test("an answer naming an address this sweep never reported changes nothing", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5", "192.168.1.1"]) as never,
    );

    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));

    expect(storedDevices()).toHaveLength(1);
    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
  });

  /*
   * The two things the endpoint does to the host list are independent: a host
   * that already has a device still answered SNMP, and still counts.
   */
  test("flagging a host does not take it out of respondedHostCount", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5", "10.0.0.6"]) as never,
    );

    await callResultEndpoint(
      resultRequest([
        { ipAddress: "10.0.0.5", snmpReachable: true },
        { ipAddress: "10.0.0.6", snmpReachable: true },
      ]),
    );

    const data: JSONObject = expectPlainUpdateData(
      (scanService.updateOneById.mock.calls[0]![0] as JSONObject)["data"],
    );
    expect(data["respondedHostCount"]).toBe(2);
  });

  // A failed sweep still reports the hosts it managed to find.
  test("a sweep the probe reports as failed still gets its hosts flagged", async () => {
    deviceService.getRegisteredHostnames.mockResolvedValue(
      new Set<string>(["10.0.0.5"]) as never,
    );

    await callResultEndpoint(
      makeRequest({
        probeId,
        body: {
          scanId: scanId.toString(),
          success: false,
          statusMessage: "probe crashed mid-sweep",
          discoveredDevices: [{ ipAddress: "10.0.0.5" }],
        },
      }),
    );

    expect(storedDevices()[0]!["isAlreadyRegistered"]).toBe(true);
  });

  test("the happy path never reaches the error handler", async () => {
    const { next } = await callResultEndpoint(
      resultRequest([{ ipAddress: "10.0.0.5" }]),
    );

    expect(next).not.toHaveBeenCalled();
  });

  /*
   * Every way the request can be turned away before the scan is in hand. None
   * of them should spend a query on a result that is going to be refused.
   */
  test("a request refused before the scan is loaded never asks", async () => {
    await callResultEndpoint(makeRequest({ probeId, body: {} }));
    expect(deviceService.getRegisteredHostnames).not.toHaveBeenCalled();

    await callResultEndpoint(
      makeRequest({ body: { scanId: scanId.toString() } }),
    );
    expect(deviceService.getRegisteredHostnames).not.toHaveBeenCalled();

    scanService.findOneBy.mockResolvedValue(null as never);
    await callResultEndpoint(resultRequest([{ ipAddress: "10.0.0.5" }]));
    expect(deviceService.getRegisteredHostnames).not.toHaveBeenCalled();
  });
});

/*
 * The failure this file was recovered from, guarded from the other side.
 *
 * PR #3441 moved the already-registered lookup into
 * NetworkDeviceService.getRegisteredHostnames. The mock factory at the top of
 * this file still offered only findBy, so every test here died with
 * "getRegisteredHostnames is not a function" and the App Test job went red on
 * master.
 *
 * TypeScript could not see it coming: a jest.mock factory is an untyped
 * object literal, and nothing checks it against the module it replaces. So
 * the route's own source is read here and every service method it calls is
 * required to exist on the stub. A method nobody stubbed now fails with a
 * sentence naming it, instead of thirty identical TypeErrors.
 */
describe("the service stubs in this file track the route they stand in for", () => {
  const ROUTE_SOURCE_PATH: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Telemetry",
    "API",
    "ProbeIngest",
    "DiscoveryScan.ts",
  );

  /*
   * Comments are stripped first: this file's own prose names these services
   * and their methods, and the route's does too. Only real call sites count.
   */
  const routeCode: string = fs
    .readFileSync(ROUTE_SOURCE_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  function methodsCalledOn(serviceName: string): Array<string> {
    const called: Set<string> = new Set<string>();
    const callSite: RegExp = new RegExp(
      `\\b${serviceName}\\.([A-Za-z0-9_]+)\\s*\\(`,
      "g",
    );

    let match: RegExpExecArray | null = callSite.exec(routeCode);

    while (match) {
      called.add(match[1]!);
      match = callSite.exec(routeCode);
    }

    return Array.from(called).sort();
  }

  function methodsMissingFrom(
    stub: unknown,
    serviceName: string,
  ): Array<string> {
    return methodsCalledOn(serviceName).filter((method: string): boolean => {
      return typeof (stub as JSONObject)[method] !== "function";
    });
  }

  /*
   * If the route ever moves, the scan below would find nothing and pass
   * vacuously. Pin what it is expected to see.
   */
  test("the route's source is found and its calls are visible", () => {
    expect(methodsCalledOn("NetworkDeviceService")).toEqual([
      "getRegisteredHostnames",
    ]);
    expect(methodsCalledOn("NetworkDeviceDiscoveryScanService")).toEqual(
      expect.arrayContaining([
        "findBy",
        "findOneBy",
        "updateColumnsByIdWithoutHooks",
        "updateOneById",
      ]),
    );
  });

  test("every NetworkDeviceService method the route calls is stubbed here", () => {
    expect(methodsMissingFrom(deviceService, "NetworkDeviceService")).toEqual(
      [],
    );
  });

  test("every NetworkDeviceDiscoveryScanService method the route calls is stubbed here", () => {
    expect(
      methodsMissingFrom(scanService, "NetworkDeviceDiscoveryScanService"),
    ).toEqual([]);
  });

  /*
   * The same source scan, put to a second use: how the route READS the scan's
   * method.
   *
   * `isSnmpEnabled` is a three-state column — true, false, and absent — and
   * absent has to mean SNMP, because that is what every row written before
   * the column existed was. The whole rule lives in one place,
   * Common/Utils/NetworkDiscovery/ScanModeUtil, whose predicate is `!==
   * false`; the model's own comment on the column says it must be read
   * everywhere through that util rather than directly.
   *
   * A bare `scan.isSnmpEnabled === true` here would compile, pass every
   * behavioural test that sets the column explicitly, and silently flip every
   * legacy row to ICMP-only — which on this route means storing a ping count
   * as the SNMP responder count for every scan that predates the column. A
   * bare truthiness check (`if (scan.isSnmpEnabled)`) has the same effect.
   * Neither is visible in a result assertion unless the fixture happens to
   * leave the column unset, so pin the call shape itself.
   *
   * Everything about how the predicate BEHAVES is tested above, against the
   * real (unmocked) util. This only pins that the route asks it.
   */
  /*
   * Hoisted out of the filter below: eslint's wrap-regex refuses a bare regexp
   * literal in an expression position, and naming them says what each matches.
   */
  const UTIL_CALL: RegExp = /ScanModeUtil\.isSnmpEnabled\s*\(/;
  const SELECT_KEY: RegExp = /^\s*isSnmpEnabled:\s*true,?\s*$/;
  /*
   * The third and last legitimate shape, and the one this merge added: the
   * claim's optimistic guard echoing the column's raw value back into
   * `expectedData`, where it becomes an `IS NOT DISTINCT FROM` in the UPDATE's
   * WHERE clause.
   *
   * That read is deliberately NOT routed through ScanModeUtil, and routing it
   * through the util would be a bug rather than a tidy-up: the util's whole
   * job is to collapse absent and null into "SNMP", and the guard has to
   * compare what the COLUMN actually held a moment ago. `?? true` here — the
   * shape the util would suggest — would make a claim on a legacy row compare
   * against a value the row does not contain, and the claim would silently
   * never match: the scan would stay Pending forever, handed out and swept
   * once a minute, its results discarded every time.
   *
   * It is exempted by an exact shape, not by a substring, so the reads this
   * scan exists to catch (`=== true`, `if (scan.isSnmpEnabled)`, a ternary on
   * the bare column) are all still caught.
   */
  const GUARD_ECHO: RegExp =
    /^\s*isSnmpEnabled:\s*scan\.isSnmpEnabled\s*\?\?\s*null,?\s*$/;

  function modeReadsNotGoingThroughScanModeUtil(): Array<string> {
    return routeCode
      .split("\n")
      .filter((line: string): boolean => {
        return line.includes("isSnmpEnabled");
      })
      .filter((line: string): boolean => {
        /*
         * A call into the util, a select key asking for the column, or the
         * claim guard comparing the column against the value it was read at.
         */
        return (
          !UTIL_CALL.test(line) &&
          !SELECT_KEY.test(line) &&
          !GUARD_ECHO.test(line)
        );
      })
      .map((line: string): string => {
        return line.trim();
      });
  }

  test("the route reads the scan method through ScanModeUtil, never by comparing the column", () => {
    /*
     * Guard against the scan passing vacuously: the route has to mention the
     * column at all (two selects, plus the claim's optimistic guard) and call
     * the util at least twice (the respondedHostCount branch and the
     * completion log line).
     */
    const mentions: number = routeCode.split("isSnmpEnabled").length - 1;
    expect(mentions).toBeGreaterThanOrEqual(4);
    expect(
      routeCode.split(/ScanModeUtil\.isSnmpEnabled\s*\(/).length - 1,
    ).toBeGreaterThanOrEqual(2);

    expect(methodsCalledOn("ScanModeUtil")).toEqual(["isSnmpEnabled"]);
    expect(modeReadsNotGoingThroughScanModeUtil()).toEqual([]);
  });
});
