import SecurityBlockDestination, {
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockWriteResult,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import { getSecurityBlockDestinationSources } from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import TestSecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TEST DESTINATION KEEPS THE CONTRACT EVERY DESTINATION KEEPS (#10338).
 *
 * The reconciler's tests, and each provider's issue before it has a
 * provider of its own, lean on TestSecurityBlockDestination behaving as a
 * provider does: it shows OneUptime only OneUptime's items, never gives up
 * the customer's own, says why it cannot hold an entry, and misbehaves only
 * when a test tells it to - down for exactly as many calls as it was told,
 * turning down exactly the value it was told. A test destination that
 * drifted from that would let a reconciler bug pass, so its contract is
 * pinned here.
 */

const BLOCK_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-000000000001");

function entry(
  value: string,
  action: SecurityBlockAction = SecurityBlockAction.Block,
): SecurityBlockEntry {
  const read: SecurityBlockValue = readSecurityBlockValue(value)!;

  return {
    securityBlockId: BLOCK_ID,
    indicatorType: read.indicatorType,
    value: read.value,
    action,
    expiresAt: null,
    comment: "OneUptime blocklist until lifted",
  };
}

function held(
  value: string,
  action: SecurityBlockAction = SecurityBlockAction.Block,
): SecurityBlockHeldItem {
  return { value, action };
}

describe("the destination", () => {
  test("is a destination like any other, named and keyed for the reconciler", () => {
    const destination: SecurityBlockDestination =
      new TestSecurityBlockDestination();

    expect(destination.key).toBe("Test:destination");
    expect(destination.name).toBe("Test destination");
    expect(destination.provider).toBe(SecurityBlockDestinationProvider.Test);
    expect(destination.connectionId).toBeNull();
    expect(destination.lockKey).toBeUndefined();

    const named: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({
        key: "Test:edge",
        lockKey: "Test:account",
        name: "Edge",
        connectionId: BLOCK_ID,
      });

    expect(named.key).toBe("Test:edge");
    expect(named.lockKey).toBe("Test:account");
    expect(named.name).toBe("Edge");
    expect(named.connectionId).toBe(BLOCK_ID);
  });

  test("is never one a project has: no source in production lists it", () => {
    expect(
      getSecurityBlockDestinationSources().some(
        (source: { provider: SecurityBlockDestinationProvider }): boolean => {
          return source.provider === SecurityBlockDestinationProvider.Test;
        },
      ),
    ).toBe(false);
  });
});

describe("apply and readBack", () => {
  test("hold what was applied, each under a reference of its own, kept when it is applied again", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();

    const first: Array<SecurityBlockWriteResult> = await destination.apply([
      entry("35.205.11.131"),
      entry("35.205.11.0/24", SecurityBlockAction.Challenge),
    ]);

    expect(first).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: true,
        providerRef: "test-item-1",
      },
      {
        value: "35.205.11.0/24",
        action: SecurityBlockAction.Challenge,
        isDone: true,
        providerRef: "test-item-2",
      },
    ]);

    const again: Array<SecurityBlockWriteResult> = await destination.apply([
      entry("35.205.11.131"),
    ]);
    expect(again[0]!.providerRef).toBe("test-item-1");

    expect(await destination.readBack()).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        providerRef: "test-item-1",
      },
      {
        value: "35.205.11.0/24",
        action: SecurityBlockAction.Challenge,
        providerRef: "test-item-2",
      },
    ]);
  });

  test("a value blocked and challenged is two items, one per action", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();

    await destination.apply([
      entry("35.205.11.131", SecurityBlockAction.Block),
      entry("35.205.11.131", SecurityBlockAction.Challenge),
    ]);

    expect(destination.getOneUptimeValues()).toEqual([
      "35.205.11.131",
      "35.205.11.131",
    ]);
    expect(destination.getOneUptimeValues(SecurityBlockAction.Block)).toEqual([
      "35.205.11.131",
    ]);
    expect(
      destination.getOneUptimeValues(SecurityBlockAction.Challenge),
    ).toEqual(["35.205.11.131"]);
  });

  test("readBack shows only OneUptime's items, never the customer's own", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    destination.addCustomerItem("198.51.100.0/24", SecurityBlockAction.Block);
    await destination.apply([entry("35.205.11.131")]);

    const items: Array<SecurityBlockHeldItem> = await destination.readBack();

    expect(
      items.map((item: SecurityBlockHeldItem): string => {
        return item.value;
      }),
    ).toEqual(["35.205.11.131"]);
    expect(destination.getCustomerValues()).toEqual(["198.51.100.0/24"]);
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);
  });

  test("readBack says when the provider confirmed an item, and that one is still on its way", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    const confirmedAt: Date = new Date("2026-11-20T10:00:00.000Z");
    destination.addOneUptimeItem({
      value: "35.205.11.131",
      action: SecurityBlockAction.Block,
      confirmedAt,
    });
    await destination.apply([entry("35.205.11.132")]);
    destination.setPropagating("35.205.11.132", true);

    expect(await destination.readBack()).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        providerRef: "test-item-1",
        confirmedAt,
      },
      {
        value: "35.205.11.132",
        action: SecurityBlockAction.Block,
        providerRef: "test-item-2",
        isPropagating: true,
      },
    ]);

    destination.setPropagating("35.205.11.132", false);
    expect((await destination.readBack())[1]).toEqual({
      value: "35.205.11.132",
      action: SecurityBlockAction.Block,
      providerRef: "test-item-2",
    });
  });

  test("an item taken away at the provider is gone from readBack", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    await destination.apply([entry("35.205.11.131")]);

    destination.removeAtProvider("35.205.11.131", SecurityBlockAction.Block);

    expect(await destination.readBack()).toEqual([]);
  });
});

describe("remove", () => {
  test("takes away OneUptime's item", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    await destination.apply([entry("35.205.11.131"), entry("35.205.11.132")]);

    expect(await destination.remove([held("35.205.11.131")])).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: true,
      },
    ]);
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.132"]);
  });

  test("never takes the customer's own, even asked for it by value, and says it did not", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    destination.addCustomerItem("198.51.100.9", SecurityBlockAction.Block);

    expect(await destination.remove([held("198.51.100.9")])).toEqual([
      {
        value: "198.51.100.9",
        action: SecurityBlockAction.Block,
        isDone: false,
      },
    ]);
    expect(destination.getCustomerValues()).toEqual(["198.51.100.9"]);
  });

  test("of an item it does not hold is done: it is gone already", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();

    expect(await destination.remove([held("35.205.11.131")])).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: true,
      },
    ]);
  });

  test("takes only the action asked for", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    await destination.apply([
      entry("35.205.11.131", SecurityBlockAction.Block),
      entry("35.205.11.131", SecurityBlockAction.Challenge),
    ]);

    await destination.remove([
      held("35.205.11.131", SecurityBlockAction.Challenge),
    ]);

    expect(destination.getOneUptimeValues(SecurityBlockAction.Block)).toEqual([
      "35.205.11.131",
    ]);
    expect(
      destination.getOneUptimeValues(SecurityBlockAction.Challenge),
    ).toEqual([]);
  });
});

describe("supports", () => {
  const ipv4: { indicatorType: SecurityBlockIndicatorType; value: string } = {
    indicatorType: SecurityBlockIndicatorType.IpAddress,
    value: "35.205.11.131",
  };
  const ipv6Range: {
    indicatorType: SecurityBlockIndicatorType;
    value: string;
  } = {
    indicatorType: SecurityBlockIndicatorType.IpRange,
    value: "2001:db8::/48",
  };

  test("holds anything by default: blocks and challenges, IPv4 and IPv6", () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();

    for (const value of [ipv4, ipv6Range]) {
      for (const action of [
        SecurityBlockAction.Block,
        SecurityBlockAction.Challenge,
      ]) {
        expect(destination.supports({ ...value, action })).toEqual({
          isSupported: true,
        });
      }
    }
  });

  test("a destination that cannot challenge says so, in its own name, and still blocks", () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ name: "Edge", canChallenge: false });

    expect(
      destination.supports({ ...ipv4, action: SecurityBlockAction.Challenge }),
    ).toEqual({ isSupported: false, reason: "Edge cannot challenge" });
    expect(
      destination.supports({ ...ipv4, action: SecurityBlockAction.Block }),
    ).toEqual({ isSupported: true });
  });

  test("a destination that matches IPv4 only says so of an IPv6 address or range, and holds IPv4", () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ name: "Edge", ipv4Only: true });

    expect(
      destination.supports({ ...ipv6Range, action: SecurityBlockAction.Block }),
    ).toEqual({ isSupported: false, reason: "Edge matches IPv4 only" });
    expect(
      destination.supports({
        indicatorType: SecurityBlockIndicatorType.IpAddress,
        value: "2001:db8::7",
        action: SecurityBlockAction.Block,
      }),
    ).toEqual({ isSupported: false, reason: "Edge matches IPv4 only" });
    expect(
      destination.supports({ ...ipv4, action: SecurityBlockAction.Block }),
    ).toEqual({ isSupported: true });
  });

  test("what it can hold is a setting a test can change between passes", () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    destination.canChallenge = false;

    expect(
      destination.supports({ ...ipv4, action: SecurityBlockAction.Challenge })
        .isSupported,
    ).toBe(false);
  });
});

describe("capacity", () => {
  test("has no limit unless it is given one", async () => {
    expect(await new TestSecurityBlockDestination().capacity()).toEqual({
      limit: null,
    });
  });

  test("is the limit it is given, with its words for being full only when it has them", async () => {
    expect(
      await new TestSecurityBlockDestination({ capacity: 2 }).capacity(),
    ).toEqual({ limit: 2 });
    expect(
      await new TestSecurityBlockDestination({
        capacity: 2,
        fullReason: "the test list is full (2)",
      }).capacity(),
    ).toEqual({ limit: 2, fullReason: "the test list is full (2)" });
  });
});

describe("misbehaving on purpose", () => {
  test("failNextCalls makes exactly that many calls of a kind throw, and no other kind", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    destination.failNextCalls("readBack", 2);

    await expect(destination.readBack()).rejects.toThrow(
      "The test destination is down.",
    );
    await expect(destination.capacity()).resolves.toEqual({ limit: null });
    await expect(destination.readBack()).rejects.toThrow(
      "The test destination is down.",
    );
    await expect(destination.readBack()).resolves.toEqual([]);
  });

  test("failNextCalls throws in the words it is given, and a failed write holds nothing", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    destination.failNextCalls("apply", 1, "The write timed out.");

    await expect(destination.apply([entry("35.205.11.131")])).rejects.toThrow(
      "The write timed out.",
    );
    expect(destination.getOneUptimeValues()).toEqual([]);

    destination.failNextCalls("remove", 1, "The delete timed out.");
    await destination.apply([entry("35.205.11.131")]);
    await expect(destination.remove([held("35.205.11.131")])).rejects.toThrow(
      "The delete timed out.",
    );
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.131"]);
  });

  test("refuseValue turns down that value alone, in the provider's words, until stopRefusing", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    destination.refuseValue("35.205.11.131", "the provider said no");

    expect(
      await destination.apply([entry("35.205.11.131"), entry("35.205.11.132")]),
    ).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: false,
        error: "the provider said no",
      },
      {
        value: "35.205.11.132",
        action: SecurityBlockAction.Block,
        isDone: true,
        providerRef: "test-item-1",
      },
    ]);
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.132"]);

    destination.stopRefusing("35.205.11.131");
    expect((await destination.apply([entry("35.205.11.131")]))[0]!.isDone).toBe(
      true,
    );
    expect(destination.getOneUptimeValues()).toEqual([
      "35.205.11.131",
      "35.205.11.132",
    ]);
  });

  test("every call is recorded in order with the values it was handed, a failed one too", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination();
    destination.failNextCalls("remove", 1);

    await destination.capacity();
    await destination.readBack();
    await destination.apply([entry("35.205.11.131"), entry("35.205.11.0/24")]);
    await expect(destination.remove([held("35.205.11.131")])).rejects.toThrow();

    expect(destination.calls).toEqual([
      { call: "capacity", values: [] },
      { call: "readBack", values: [] },
      { call: "apply", values: ["35.205.11.131", "35.205.11.0/24"] },
      { call: "remove", values: ["35.205.11.131"] },
    ]);
    expect(destination.countCalls("apply")).toBe(1);
    expect(destination.countCalls("remove")).toBe(1);
  });
});

describe("update, for a destination that batches its writes", () => {
  test("only one told to has it, and it removes then adds, answering each as remove and apply do", async () => {
    expect(new TestSecurityBlockDestination().update).toBeUndefined();

    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ batchesWrites: true });

    await destination.update!({ add: [entry("35.205.11.131")], remove: [] });

    const written: {
      applied: Array<SecurityBlockWriteResult>;
      removed: Array<SecurityBlockWriteResult>;
    } = await destination.update!({
      add: [entry("35.205.11.132")],
      remove: [held("35.205.11.131")],
    });

    expect(written.removed).toEqual([
      {
        value: "35.205.11.131",
        action: SecurityBlockAction.Block,
        isDone: true,
      },
    ]);
    expect(written.applied).toEqual([
      expect.objectContaining({ value: "35.205.11.132", isDone: true }),
    ]);
    expect(destination.getOneUptimeValues()).toEqual(["35.205.11.132"]);
    expect(
      destination.calls.map(
        (made: { call: string; values: Array<string> }): Array<unknown> => {
          return [made.call, made.values];
        },
      ),
    ).toEqual([
      ["update", ["+35.205.11.131"]],
      ["update", ["-35.205.11.131", "+35.205.11.132"]],
    ]);
  });

  test("fails as the destination does when told to, holding nothing new", async () => {
    const destination: TestSecurityBlockDestination =
      new TestSecurityBlockDestination({ batchesWrites: true });

    destination.failNextCalls("update", 1, "down");

    await expect(
      destination.update!({ add: [entry("35.205.11.131")], remove: [] }),
    ).rejects.toThrow("down");
    expect(destination.getOneUptimeValues()).toEqual([]);
  });
});
