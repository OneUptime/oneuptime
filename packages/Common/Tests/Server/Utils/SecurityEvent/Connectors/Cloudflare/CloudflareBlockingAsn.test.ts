import CloudflareBlocking from "../../../../../../Server/Utils/SecurityEvent/Connectors/Cloudflare/CloudflareBlocking";
import CloudflareClient from "../../../../../../Server/Utils/SecurityEvent/Connectors/Cloudflare/CloudflareClient";
import {
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockWriteResult,
} from "../../../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION,
  CLOUDFLARE_BLOCK_LIST_NAMES,
  CloudflareBlockingMechanism,
  CloudflareBlockingStatus,
} from "../../../../../../Types/SecurityBlocklist/CloudflareBlocking";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
} from "../../../../../../Types/SecurityBlocklist/SecurityBlock";
import CloudflareBlockingFakeApi, {
  FakeAccessRule,
  FakeList,
} from "./CloudflareBlockingFakeApi";
import { ACCOUNT_ID, FakeZone, TOKEN, ZONE_A } from "./CloudflareFakeApi";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A WHOLE NETWORK BY ITS ASN AT CLOUDFLARE (#10354), against Cloudflare's
 * API as it answers (CloudflareBlockingFakeApi): an ASN is one IP Access
 * Rule whose target is asn - which every plan has, where lists of ASNs are
 * Enterprise's alone - whatever the action's addresses use. It is read
 * back as blocks write it, taken away by its rule, and a token without the
 * IP Access Rules permission fails the network's block alone, never the
 * addresses' beside it.
 */

const PROJECT_ID: string = "10354000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-11-23T10:42:00.000Z");
const COMMENT: string = "OneUptime blocklist until 2026-11-24 10:42 UTC";

const PRO: { name: string; legacy_id: string } = {
  name: "Pro Website",
  legacy_id: "pro",
};

let api: CloudflareBlockingFakeApi;
let clock: number;

function blocking(): CloudflareBlocking {
  return new CloudflareBlocking({
    client: new CloudflareClient({
      apiToken: TOKEN,
      transport: api.transport(),
      requestTimeoutInMs: 20000,
      sleep: async (): Promise<void> => {
        return undefined;
      },
      now: (): number => {
        return clock;
      },
    }),
    scope: {
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      readZoneIds: [],
      blockZoneIds: [],
    },
    now: (): Date => {
      return new Date(clock);
    },
    sleep: async (ms: number): Promise<void> => {
      clock += ms;
    },
  });
}

function entry(
  value: string,
  action: SecurityBlockAction = SecurityBlockAction.Challenge,
): SecurityBlockEntry {
  return {
    securityBlockId: ObjectID.generate(),
    indicatorType: value.startsWith("AS")
      ? SecurityBlockIndicatorType.Asn
      : SecurityBlockIndicatorType.IpRange,
    value,
    action,
    expiresAt: new Date("2026-11-24T10:42:00.000Z"),
    comment: COMMENT,
  };
}

function asnRules(): Array<FakeAccessRule> {
  return api.accessRules.filter((rule: FakeAccessRule): boolean => {
    return rule.target === "asn";
  });
}

beforeEach(() => {
  const zone: FakeZone = { id: ZONE_A, name: "example.com", plan: PRO };
  api = new CloudflareBlockingFakeApi([zone]);
  api.operationPolls = 1;
  clock = NOW.getTime();
});

describe("a network by its ASN, where the account's addresses use lists", () => {
  let status: CloudflareBlockingStatus;

  beforeEach(async () => {
    status = await blocking().setUp({ previous: null });

    // A Pro account: both actions use a list and a rule per zone.
    for (const action of status.actions) {
      expect(action.choice.mechanism).toBe(CloudflareBlockingMechanism.List);
    }
  });

  test("is one IP Access Rule whose target is asn, in the action's mode, never a list item", async () => {
    const results: Array<SecurityBlockWriteResult> = await blocking().add(
      [entry("AS14061"), entry("203.0.113.0/24")],
      status,
    );

    expect(asnRules()).toEqual([
      expect.objectContaining({
        target: "asn",
        value: "AS14061",
        mode: "managed_challenge",
        notes: COMMENT,
      }),
    ]);

    const list: FakeList = api.listNamed(
      CLOUDFLARE_BLOCK_LIST_NAMES[SecurityBlockAction.Challenge],
    )!;
    expect(
      list.items.map((item: { ip: string }): string => {
        return item.ip;
      }),
    ).toEqual(["203.0.113.0/24"]);

    const asn: SecurityBlockWriteResult | undefined = results.find(
      (result: SecurityBlockWriteResult): boolean => {
        return result.value === "AS14061";
      },
    );
    expect(asn?.isDone).toBe(true);
    expect(asn?.providerRef).toBe(asnRules()[0]!.id);
  });

  test("a block of a network is an IP Access Rule that blocks", async () => {
    await blocking().add([entry("AS64500", SecurityBlockAction.Block)], status);

    expect(asnRules()[0]).toEqual(
      expect.objectContaining({ value: "AS64500", mode: "block" }),
    );
  });

  test("is read back as blocks write it, by its rule, beside the lists' items", async () => {
    await blocking().add([entry("AS14061"), entry("203.0.113.0/24")], status);

    const held: Array<SecurityBlockHeldItem> =
      await blocking().readHeld(status);

    expect(
      held
        .map((item: SecurityBlockHeldItem): string => {
          return `${item.action}:${item.value}`;
        })
        .sort(),
    ).toEqual(["Challenge:203.0.113.0/24", "Challenge:AS14061"]);
    expect(
      held.find((item: SecurityBlockHeldItem): boolean => {
        return item.value === "AS14061";
      })?.providerRef,
    ).toBe(asnRules()[0]!.id);
  });

  test("an IP Access Rule of the customer's own, or of another target, is never read back as a network", async () => {
    api.accessRules.push({
      id: "customer-rule",
      mode: "managed_challenge",
      notes: "Our own rule for AS13335",
      target: "asn",
      value: "AS13335",
    });

    expect(await blocking().readHeld(status)).toEqual([]);
  });

  test("is taken away by its rule, and the list's items by theirs", async () => {
    await blocking().add([entry("AS14061"), entry("203.0.113.0/24")], status);

    const held: Array<SecurityBlockHeldItem> =
      await blocking().readHeld(status);
    const results: Array<SecurityBlockWriteResult> = await blocking().remove(
      held,
      status,
    );

    expect(
      results.every((result: SecurityBlockWriteResult): boolean => {
        return result.isDone;
      }),
    ).toBe(true);
    expect(asnRules()).toEqual([]);
    expect(
      api.listNamed(CLOUDFLARE_BLOCK_LIST_NAMES[SecurityBlockAction.Challenge])!
        .items,
    ).toEqual([]);
  });

  test("a rule removed by hand already is removed", async () => {
    await blocking().add([entry("AS14061")], status);
    const held: Array<SecurityBlockHeldItem> =
      await blocking().readHeld(status);
    api.accessRules = [];

    const results: Array<SecurityBlockWriteResult> = await blocking().remove(
      held,
      status,
    );

    expect(results).toEqual([
      { value: "AS14061", action: SecurityBlockAction.Challenge, isDone: true },
    ]);
  });

  test("without the IP Access Rules permission, the network's block fails saying which permission, and the addresses beside it are added", async () => {
    api.permissions.delete("accessRules");

    const results: Array<SecurityBlockWriteResult> = await blocking().add(
      [entry("AS14061"), entry("203.0.113.0/24")],
      status,
    );

    const asn: SecurityBlockWriteResult | undefined = results.find(
      (result: SecurityBlockWriteResult): boolean => {
        return result.value === "AS14061";
      },
    );
    expect(asn?.isDone).toBe(false);
    expect(asn?.error).toContain(CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION);

    expect(
      api
        .listNamed(CLOUDFLARE_BLOCK_LIST_NAMES[SecurityBlockAction.Challenge])!
        .items.map((item: { ip: string }): string => {
          return item.ip;
        }),
    ).toEqual(["203.0.113.0/24"]);

    // The lists' items are still read back: a token that may not read IP Access Rules holds no network.
    expect(
      (await blocking().readHeld(status)).map(
        (item: SecurityBlockHeldItem): string => {
          return item.value;
        },
      ),
    ).toEqual(["203.0.113.0/24"]);
  });

  test("is taken away with everything else OneUptime added when blocking is turned off", async () => {
    await blocking().add([entry("AS14061")], status);

    const done: { isDone: boolean; left: number } = await blocking().tearDown({
      previous: status,
      budgetInMs: 60000,
    });

    expect(done.isDone).toBe(true);
    expect(asnRules()).toEqual([]);
  });
});

test("before blocking is set up, a network's block says so", async () => {
  const results: Array<SecurityBlockWriteResult> = await blocking().add(
    [entry("AS14061")],
    {
      checkedAt: NOW.toISOString(),
      accountId: ACCOUNT_ID,
      plan: "pro",
      actions: [],
      zones: [],
      usage: { items: 0, limit: null },
    } as unknown as CloudflareBlockingStatus,
  );

  expect(results).toEqual([
    {
      value: "AS14061",
      action: SecurityBlockAction.Challenge,
      isDone: false,
      error: "blocking at Cloudflare is not set up yet",
    },
  ]);
  expect(asnRules()).toEqual([]);
});
