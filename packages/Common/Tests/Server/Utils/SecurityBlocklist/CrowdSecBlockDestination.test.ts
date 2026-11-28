import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CrowdSecBlockDestination, {
  CROWDSEC_ADDRESSES_ONLY,
  CROWDSEC_CANNOT_CHALLENGE,
  CROWDSEC_RENEW_WHEN_LEFT_IN_MS,
  CROWDSEC_UNTIL_LIFTED_IN_MS,
  getCrowdSecAllowlistReason,
} from "../../../../Server/Utils/SecurityBlocklist/Destinations/CrowdSecBlockDestination";
import SecurityBlockDestination, {
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockWriteResult,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import CrowdSecLapiClient from "../../../../Server/Utils/SecurityEvent/Response/CrowdSecLapiClient";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { SecurityBlockHolder } from "../../../../Types/SecurityBlocklist/SecurityBlockHolders";
import {
  CROWDSEC_ENDS_WHEN_LIFTED,
  CROWDSEC_META_BLOCK,
  CROWDSEC_META_CONNECTION,
  CROWDSEC_META_ENDS,
  CROWDSEC_ONEUPTIME_SCENARIO,
} from "../../../../Types/SecurityEvent/CrowdSec/CrowdSecDecisions";
import FakeCrowdSecLapi, {
  FakeLapiAlert,
  FakeLapiDecision,
  loopbackTransport,
} from "../SecurityEvent/Response/FakeCrowdSecLapi";

/*
 * THE BLOCKLIST IN CROWDSEC (#11158), against a Local API that answers as
 * CrowdSec v1.8.2 does (FakeCrowdSecLapi): what the destination holds and
 * refuses, how long each ban lasts and when one is renewed, how a ban's
 * end moves without a moment unbanned, and that only this connection's
 * bans are ever read or ended.
 */

const MACHINE: string = "oneuptime";
const PASSWORD: string = "Rv8n2Qw7xKp4Lm9ZtY3sB6dF";
const CONNECTION_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-000000000001",
);
const NOW: Date = new Date("2026-11-28T10:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

let lapi: FakeCrowdSecLapi;
let url: string;
let now: Date;

function destination(): CrowdSecBlockDestination {
  return new CrowdSecBlockDestination({
    connectionId: CONNECTION_ID,
    name: "CrowdSec",
    client: new CrowdSecLapiClient({
      lapiUrl: url,
      machineId: MACHINE,
      password: PASSWORD,
      transport: loopbackTransport,
    }),
    now: (): Date => {
      return now;
    },
  });
}

function advance(ms: number): void {
  now = new Date(now.getTime() + ms);
  lapi.setNow(now);
}

let nextBlock: number = 1;

function entry(data: {
  value: string;
  expiresAt?: Date | null | undefined;
  action?: SecurityBlockAction | undefined;
}): SecurityBlockEntry {
  const id: number = nextBlock++;

  return {
    securityBlockId: new ObjectID(
      `bbbbbbbb-bbbb-4bbb-8bbb-${String(id).padStart(12, "0")}`,
    ),
    indicatorType: data.value.includes("/")
      ? SecurityBlockIndicatorType.IpRange
      : SecurityBlockIndicatorType.IpAddress,
    value: data.value,
    action: data.action || SecurityBlockAction.Block,
    expiresAt:
      data.expiresAt === undefined
        ? new Date(now.getTime() + DAY)
        : data.expiresAt,
    comment: "OneUptime case CASE-12 until 2026-11-29 10:00 UTC",
  };
}

function supports(
  target: CrowdSecBlockDestination,
  value: string,
  data?: {
    indicatorType?: SecurityBlockIndicatorType;
    action?: SecurityBlockAction;
  },
): SecurityBlockSupport {
  return target.supports({
    indicatorType:
      data?.indicatorType ||
      (value.includes("/")
        ? SecurityBlockIndicatorType.IpRange
        : SecurityBlockIndicatorType.IpAddress),
    action: data?.action || SecurityBlockAction.Block,
    value,
  });
}

function ours(): Array<FakeLapiDecision & { alert: FakeLapiAlert }> {
  return lapi
    .activeDecisions()
    .filter((decision: FakeLapiDecision): boolean => {
      return decision.scenario === CROWDSEC_ONEUPTIME_SCENARIO;
    });
}

beforeEach(async () => {
  now = NOW;
  nextBlock = 1;
  lapi = new FakeCrowdSecLapi();
  lapi.setNow(now);
  lapi.addMachine(MACHINE, { password: PASSWORD });
  url = await lapi.start();
});

afterEach(async () => {
  await lapi.stop();
});

describe("what CrowdSec holds", () => {
  test("bans addresses and ranges, IPv4 and IPv6", () => {
    const target: CrowdSecBlockDestination = destination();

    for (const value of [
      "35.205.11.131",
      "35.205.11.0/24",
      "2001:db8::7",
      "2001:db8::/48",
    ]) {
      expect(supports(target, value)).toEqual({ isSupported: true });
    }
  });

  test("challenges nothing, and holds no domain, URL, file or AS", () => {
    const target: CrowdSecBlockDestination = destination();

    expect(
      supports(target, "35.205.11.131", {
        action: SecurityBlockAction.Challenge,
      }),
    ).toEqual({ isSupported: false, reason: CROWDSEC_CANNOT_CHALLENGE });

    for (const indicatorType of [
      SecurityBlockIndicatorType.Domain,
      SecurityBlockIndicatorType.Url,
      SecurityBlockIndicatorType.FileSha256,
      SecurityBlockIndicatorType.FileMd5,
      SecurityBlockIndicatorType.Asn,
    ]) {
      expect(supports(target, "example.com", { indicatorType })).toEqual({
        isSupported: false,
        reason: CROWDSEC_ADDRESSES_ONLY,
      });
    }
  });

  test("never an address or range CrowdSec's own allowlists hold, read each pass", async () => {
    lapi.allowlists = [
      {
        name: "office",
        items: [{ value: "198.51.100.10" }, { value: "203.0.113.0/24" }],
      },
      {
        name: "partners",
        items: [{ value: "2001:db8:42::/48" }],
      },
    ];

    const target: CrowdSecBlockDestination = destination();
    await target.prepare();

    expect(supports(target, "198.51.100.10")).toEqual({
      isSupported: false,
      reason: getCrowdSecAllowlistReason({
        value: "198.51.100.10",
        allowlist: "office",
      }),
    });
    // An address inside an allowlisted range, and a range holding an allowlisted address.
    expect(supports(target, "203.0.113.77").isSupported).toBe(false);
    expect(supports(target, "198.51.100.0/24").isSupported).toBe(false);
    expect(supports(target, "2001:db8:42::9").isSupported).toBe(false);
    // Beside them, banned.
    expect(supports(target, "198.51.100.11")).toEqual({ isSupported: true });
    expect(supports(target, "203.0.114.1")).toEqual({ isSupported: true });
  });

  test("an allowlist entry that has expired holds nothing", async () => {
    lapi.allowlists = [
      {
        name: "office",
        items: [
          { value: "198.51.100.10", expiration: new Date(NOW.getTime() - 1) },
        ],
      },
    ];

    const target: CrowdSecBlockDestination = destination();
    await target.prepare();

    expect(supports(target, "198.51.100.10")).toEqual({ isSupported: true });
  });

  test("a LAPI older than allowlists holds no allowlist, and bans as before", async () => {
    lapi.hasAllowlists = false;

    const target: CrowdSecBlockDestination = destination();
    await expect(target.prepare()).resolves.toBeUndefined();
    expect(supports(target, "198.51.100.10")).toEqual({ isSupported: true });
  });

  test("a pass that cannot sign in or read the allowlists is not ready", async () => {
    lapi.machines.delete(MACHINE);
    await expect(destination().prepare()).rejects.toThrow(
      "CrowdSec Local API login failed (HTTP 401)",
    );

    lapi.addMachine(MACHINE, { password: PASSWORD });
    lapi.failEveryRequestWith = 502;
    await expect(destination().prepare()).rejects.toThrow("HTTP 502");
  });

  test("has no limit, its destination is CrowdSec's, and it holds addresses alone", async () => {
    const target: CrowdSecBlockDestination = destination();

    expect(await target.capacity()).toEqual({ limit: null });
    expect(target.key).toBe(`CrowdSec:${CONNECTION_ID.toString()}`);
    expect(target.provider).toBe(SecurityBlockDestinationProvider.CrowdSec);
    // Neither challenges nor enforces on every machine, as the reconciler reads the destination.
    const asDestination: SecurityBlockDestination = target;
    expect(asDestination.canChallenge).toBeUndefined();
    expect(asDestination.enforcesOnEveryMachine).toBeUndefined();

    const holders: Array<SecurityBlockHolder> =
      SecurityBlockDestinations.getHolders([target]);
    expect(holders[0]?.blocks).toEqual([
      SecurityBlockIndicatorType.IpAddress,
      SecurityBlockIndicatorType.IpRange,
    ]);
    expect(holders[0]?.enforcesOnEveryMachine).toBe(false);
  });
});

describe("a ban, made and read back", () => {
  test("lasts until its block's end, and says which connection, block and end it is", async () => {
    const target: CrowdSecBlockDestination = destination();
    const ban: SecurityBlockEntry = entry({
      value: "35.205.11.131",
      expiresAt: new Date(NOW.getTime() + 6 * HOUR + 500),
    });

    const results: Array<SecurityBlockWriteResult> = await target.apply([ban]);
    expect(results).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: true,
      },
    ]);

    const held: Array<FakeLapiDecision & { alert: FakeLapiAlert }> = ours();
    expect(held).toHaveLength(1);
    expect(held[0]?.type).toBe("ban");
    expect(held[0]?.origin).toBe("cscli");
    // Rounded up to the second, so the ban never ends before the block.
    expect(held[0]?.until.toISOString()).toBe("2026-11-28T16:00:01.000Z");
    expect(held[0]?.alert.message).toBe(ban.comment);
    expect(held[0]?.alert.meta).toEqual([
      { key: CROWDSEC_META_CONNECTION, value: CONNECTION_ID.toString() },
      { key: CROWDSEC_META_BLOCK, value: ban.securityBlockId.toString() },
      { key: CROWDSEC_META_ENDS, value: ban.expiresAt!.toISOString() },
    ]);

    const read: Array<SecurityBlockHeldItem> = await target.readBack();
    expect(read).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        providerRef: String(held[0]?.id),
        expiresAt: new Date("2026-11-28T16:00:01.000Z"),
      },
    ]);
  });

  test("a range is a Range decision, read back as it was written", async () => {
    const target: CrowdSecBlockDestination = destination();
    await target.apply([entry({ value: "2001:db8::/48" })]);

    expect(ours()[0]?.scope).toBe("Range");
    expect((await target.readBack())[0]?.value).toBe("2001:db8::/48");
  });

  test("lifting it ends the decision there at once", async () => {
    const target: CrowdSecBlockDestination = destination();
    await target.apply([entry({ value: "35.205.11.131" })]);

    const read: Array<SecurityBlockHeldItem> = await target.readBack();
    const removed: Array<SecurityBlockWriteResult> = await target.remove(read);

    expect(removed).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: true,
      },
    ]);
    expect(ours()).toEqual([]);
    expect(await target.readBack()).toEqual([]);
  });

  test("an item with no decision id is not ended, and says why", async () => {
    const removed: Array<SecurityBlockWriteResult> = await destination().remove(
      [{ value: "35.205.11.131", action: SecurityBlockAction.Block }],
    );

    expect(removed[0]?.isDone).toBe(false);
    expect(removed[0]?.error).toContain(
      "does not know which CrowdSec decision holds it",
    );
  });

  test("a batch LAPI refuses is not done, with why, on every entry of it", async () => {
    lapi.failEveryRequestWith = null;
    const target: CrowdSecBlockDestination = destination();
    await target.prepare();
    lapi.failEveryRequestWith = 500;

    const results: Array<SecurityBlockWriteResult> = await target.apply([
      entry({ value: "35.205.11.131" }),
      entry({ value: "35.205.11.132" }),
    ]);

    expect(
      results.map((result: SecurityBlockWriteResult) => {
        return result.isDone;
      }),
    ).toEqual([false, false]);
    expect(results[0]?.error).toContain(
      "CrowdSec Local API ban failed (HTTP 500)",
    );
  });

  test("a person's decision, CrowdSec's own and another connection's are never read back, nor ended", async () => {
    lapi.addDecisionAlert({
      machineId: "localhost",
      scenario: "manual 'ban' from 'localhost'",
      origin: "cscli",
      value: "35.205.11.131",
      durationInMs: DAY,
    });
    lapi.addDecisionAlert({
      machineId: "web-01",
      scenario: "crowdsecurity/ssh-bf",
      origin: "crowdsec",
      value: "35.205.11.132",
      durationInMs: 4 * HOUR,
    });
    lapi.addDecisionAlert({
      machineId: MACHINE,
      scenario: CROWDSEC_ONEUPTIME_SCENARIO,
      origin: "cscli",
      value: "35.205.11.133",
      durationInMs: DAY,
      meta: [
        {
          key: CROWDSEC_META_CONNECTION,
          value: "cccccccc-cccc-4ccc-8ccc-000000000002",
        },
      ],
    });

    expect(await destination().readBack()).toEqual([]);
    expect(lapi.activeDecisions()).toHaveLength(3);
  });

  test("a decision under OneUptime's scenario that is no ban reads as what it is, so no block wants it", async () => {
    const target: CrowdSecBlockDestination = destination();
    await target.apply([entry({ value: "35.205.11.131" })]);
    ours()[0]!.alert.decisions[0]!.type = "captcha";

    expect((await target.readBack())[0]?.action).toBe("captcha");
  });
});

describe("a block until it is lifted", () => {
  test("is a week's ban, read back as never ending while more than three days are left", async () => {
    const target: CrowdSecBlockDestination = destination();
    await target.apply([entry({ value: "35.205.11.131", expiresAt: null })]);

    expect(ours()[0]?.until.getTime()).toBe(
      NOW.getTime() + CROWDSEC_UNTIL_LIFTED_IN_MS,
    );
    expect(ours()[0]?.alert.meta[2]).toEqual({
      key: CROWDSEC_META_ENDS,
      value: CROWDSEC_ENDS_WHEN_LIFTED,
    });
    expect((await target.readBack())[0]?.expiresAt).toBeNull();

    advance(
      CROWDSEC_UNTIL_LIFTED_IN_MS - CROWDSEC_RENEW_WHEN_LEFT_IN_MS - HOUR,
    );
    expect((await target.readBack())[0]?.expiresAt).toBeNull();
  });

  test("reads as ending once three days or less are left, so it is renewed", async () => {
    const target: CrowdSecBlockDestination = destination();
    await target.apply([entry({ value: "35.205.11.131", expiresAt: null })]);

    advance(CROWDSEC_UNTIL_LIFTED_IN_MS - CROWDSEC_RENEW_WHEN_LEFT_IN_MS);

    expect((await target.readBack())[0]?.expiresAt?.toISOString()).toBe(
      new Date(NOW.getTime() + CROWDSEC_UNTIL_LIFTED_IN_MS).toISOString(),
    );
  });
});

describe("a ban whose end moves", () => {
  test("is a new decision with the new end, and the old one ended after it: never a moment unbanned", async () => {
    const target: CrowdSecBlockDestination = destination();
    const first: SecurityBlockEntry = entry({ value: "35.205.11.131" });
    await target.apply([first]);
    const [held] = await target.readBack();

    advance(HOUR);
    const renewed: SecurityBlockEntry = {
      ...first,
      expiresAt: new Date(now.getTime() + 7 * DAY),
    };
    const results: Array<SecurityBlockWriteResult> = await target.moveEnds([
      { entry: renewed, item: held! },
    ]);

    expect(results[0]?.isDone).toBe(true);

    const order: Array<string> = lapi.requests
      .filter((request: { method: string; path: string }) => {
        return request.method !== "GET";
      })
      .map((request: { method: string; path: string }) => {
        return `${request.method} ${request.path.replace(/\d+$/, "<id>")}`;
      });
    expect(order.slice(-2)).toEqual([
      "POST /v1/alerts",
      "DELETE /v1/decisions/<id>",
    ]);

    const read: Array<SecurityBlockHeldItem> = await target.readBack();
    expect(read).toHaveLength(1);
    expect(read[0]?.expiresAt?.toISOString()).toBe(
      renewed.expiresAt!.toISOString(),
    );
  });

  test("a new decision LAPI refuses leaves the old one in force", async () => {
    const target: CrowdSecBlockDestination = destination();
    const first: SecurityBlockEntry = entry({ value: "35.205.11.131" });
    await target.apply([first]);
    const [held] = await target.readBack();
    lapi.failEveryRequestWith = 500;

    const results: Array<SecurityBlockWriteResult> = await target.moveEnds([
      { entry: { ...first, expiresAt: null }, item: held! },
    ]);

    expect(results[0]?.isDone).toBe(false);
    lapi.failEveryRequestWith = null;
    expect(ours()).toHaveLength(1);
    expect(ours()[0]?.id).toBe(Number(held!.providerRef));
  });
});
