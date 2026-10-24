import { describe, expect, test } from "@jest/globals";
import snmp from "net-snmp";
import { SnmpWalkStopReason } from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import SnmpOidWalker, {
  SnmpOidWalkOptions,
  SnmpOidWalkOutcome,
  SnmpOidWalkSession,
  SnmpWalkOutOfOrderError,
} from "../../../Utils/Snmp/SnmpOidWalker";

/*
 * The walk's bounds and its defences against agents that misbehave, driven
 * by a scripted agent: every request the walk sends is recorded, and every
 * answer is whatever the test says it is. The real wire is
 * SnmpWalkEndToEnd's job; this is the part a real agent cannot be made to
 * do on demand - answer tooBig, loop, go backwards, stop answering halfway,
 * or answer slowly enough to run a budget out.
 */

type SentRequest =
  | { kind: "getBulk"; oid: string; maxRepetitions: number }
  | { kind: "getNext"; oid: string }
  | { kind: "get"; oid: string };

type Answer =
  | { varbinds: Array<snmp.Varbind> }
  | { error: Error }
  | { throws: Error };

function value(oid: string, data: number = 1): snmp.Varbind {
  return { oid: oid, type: snmp.ObjectType.Integer, value: data };
}

function endOfMibView(oid: string): snmp.Varbind {
  return { oid: oid, type: snmp.ObjectType.EndOfMibView, value: null };
}

function requestFailed(status: number): Error {
  const error: Error & { status?: number } = new Error(
    snmp.ErrorStatus[status] as unknown as string,
  );
  error.name = "RequestFailedError";
  error.status = status;
  return error;
}

function timedOut(): Error {
  const error: Error = new Error("Request timed out");
  error.name = "RequestTimedOutError";
  return error;
}

/*
 * An agent that answers each request with the next scripted answer, or -
 * with no script left - with an endOfMibView.
 */
class ScriptedAgent implements SnmpOidWalkSession {
  public sent: Array<SentRequest> = [];
  private answers: Array<Answer>;

  public constructor(answers: Array<Answer>) {
    this.answers = [...answers];
  }

  public getBulk(
    oids: Array<string>,
    _nonRepeaters: number,
    maxRepetitions: number,
    responseCb: (
      error: Error | null,
      varbinds?: Array<snmp.Varbind | Array<snmp.Varbind>>,
    ) => void,
  ): unknown {
    this.sent.push({
      kind: "getBulk",
      oid: oids[0]!,
      maxRepetitions: maxRepetitions,
    });
    const answer: Answer = this.next(oids[0]!);

    if ("throws" in answer) {
      throw answer.throws;
    }

    if ("error" in answer) {
      responseCb(answer.error);
      return undefined;
    }

    // net-snmp's shape: one list of repetitions per requested OID.
    responseCb(null, [answer.varbinds]);
    return undefined;
  }

  public getNext(
    oids: Array<string>,
    responseCb: (error: Error | null, varbinds?: Array<snmp.Varbind>) => void,
  ): unknown {
    this.sent.push({ kind: "getNext", oid: oids[0]! });
    return this.answer(oids[0]!, responseCb);
  }

  public get(
    oids: Array<string>,
    responseCb: (error: Error | null, varbinds?: Array<snmp.Varbind>) => void,
  ): unknown {
    this.sent.push({ kind: "get", oid: oids[0]! });
    return this.answer(oids[0]!, responseCb);
  }

  private answer(
    oid: string,
    responseCb: (error: Error | null, varbinds?: Array<snmp.Varbind>) => void,
  ): unknown {
    const answer: Answer = this.next(oid);

    if ("throws" in answer) {
      throw answer.throws;
    }

    if ("error" in answer) {
      responseCb(answer.error);
      return undefined;
    }

    responseCb(null, answer.varbinds);
    return undefined;
  }

  private next(oid: string): Answer {
    return this.answers.shift() || { varbinds: [endOfMibView(oid)] };
  }
}

const ROOT: string = "1.3.6.1.2.1.2";

function oids(count: number, start: number = 1): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `${ROOT}.2.1.2.${start + index}`;
  });
}

function options(
  overrides: Partial<SnmpOidWalkOptions> = {},
): SnmpOidWalkOptions {
  return {
    rootOid: ROOT,
    maxOids: 1000,
    timeBudgetInMs: 45000,
    maxRepetitions: 25,
    pauseBetweenRequestsInMs: 0,
    useGetNext: false,
    sleep: async (): Promise<void> => {
      // No real pauses in a unit test.
    },
    ...overrides,
  };
}

function walkedOids(outcome: SnmpOidWalkOutcome): Array<string> {
  return outcome.varbinds.map((varbind: snmp.Varbind): string => {
    return varbind.oid;
  });
}

describe("walking to the end of a subtree", () => {
  test("starts at the root, then after the last OID each answer returned", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: oids(3).map((oid: string) => {
          return value(oid);
        }),
      },
      {
        varbinds: oids(2, 4).map((oid: string) => {
          return value(oid);
        }),
      },
      { varbinds: [endOfMibView(`${ROOT}.2.1.2.5`)] },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ maxRepetitions: 3 }),
    );

    expect(walkedOids(outcome)).toEqual(oids(5));
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(outcome.nextOid).toBeUndefined();
    expect(outcome.error).toBeUndefined();
    expect(agent.sent).toEqual([
      { kind: "getBulk", oid: ROOT, maxRepetitions: 3 },
      { kind: "getBulk", oid: `${ROOT}.2.1.2.3`, maxRepetitions: 3 },
      { kind: "getBulk", oid: `${ROOT}.2.1.2.5`, maxRepetitions: 3 },
    ]);
    expect(outcome.requestCount).toBe(3);
  });

  test("an OID outside the root ends the walk and is left out", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: [
          value(`${ROOT}.1.0`),
          value("1.3.6.1.2.1.3.1.1.1.1"),
          value("1.3.6.1.2.1.3.1.1.1.2"),
        ],
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(walkedOids(outcome)).toEqual([`${ROOT}.1.0`]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(agent.sent).toHaveLength(1);
  });

  test("an OID that only shares the root's digits is outside it", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      // 1.3.6.1.2.1.25 is not under 1.3.6.1.2.1.2.
      { varbinds: [value("1.3.6.1.2.1.25.1.1.0")] },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(outcome.varbinds).toEqual([]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
  });

  test.each([
    ["endOfMibView", snmp.ObjectType.EndOfMibView],
    ["noSuchObject", snmp.ObjectType.NoSuchObject],
    ["noSuchInstance", snmp.ObjectType.NoSuchInstance],
  ])(
    "a %s in an answer ends the walk, keeping what came before it",
    async (_label: string, type: number) => {
      const agent: ScriptedAgent = new ScriptedAgent([
        {
          varbinds: [
            value(`${ROOT}.1.0`),
            { oid: `${ROOT}.2.0`, type: type, value: null },
            value(`${ROOT}.3.0`),
          ],
        },
      ]);

      const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
        agent,
        options(),
      );

      expect(walkedOids(outcome)).toEqual([`${ROOT}.1.0`]);
      expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
    },
  );

  test("an empty answer ends the walk", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { varbinds: [value(`${ROOT}.1.0`)] },
      { varbinds: [] },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(walkedOids(outcome)).toEqual([`${ROOT}.1.0`]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
  });
});

describe("a walk that finds nothing under its root", () => {
  test("reads the root itself with a GET, as snmpwalk does, when it is an object", async () => {
    const leaf: string = "1.3.6.1.2.1.1.3.0";
    const agent: ScriptedAgent = new ScriptedAgent([
      { varbinds: [value("1.3.6.1.2.1.1.4.0")] },
      {
        varbinds: [
          { oid: leaf, type: snmp.ObjectType.TimeTicks, value: 12345 },
        ],
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ rootOid: leaf }),
    );

    expect(walkedOids(outcome)).toEqual([leaf]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(agent.sent).toEqual([
      { kind: "getBulk", oid: leaf, maxRepetitions: 25 },
      { kind: "get", oid: leaf },
    ]);
    expect(outcome.requestCount).toBe(2);
  });

  test("is complete and empty when the root is no object either", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { varbinds: [endOfMibView(ROOT)] },
      {
        varbinds: [
          { oid: ROOT, type: snmp.ObjectType.NoSuchObject, value: null },
        ],
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(outcome.varbinds).toEqual([]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(outcome.error).toBeUndefined();
  });

  test("a GET of the root that fails still leaves a complete, empty walk", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { varbinds: [endOfMibView(ROOT)] },
      { error: requestFailed(snmp.ErrorStatus.GeneralError) },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(outcome.varbinds).toEqual([]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(outcome.error).toBeUndefined();
  });

  test("a continued walk never reads its root again", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { varbinds: [endOfMibView(`${ROOT}.9`)] },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ afterOid: `${ROOT}.9.1` }),
    );

    expect(outcome.varbinds).toEqual([]);
    expect(agent.sent).toEqual([
      { kind: "getBulk", oid: `${ROOT}.9.1`, maxRepetitions: 25 },
    ]);
  });
});

describe("the OID limit", () => {
  test("stops at the limit and says where to continue", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: oids(4).map((oid: string) => {
          return value(oid);
        }),
      },
      {
        varbinds: oids(4, 5).map((oid: string) => {
          return value(oid);
        }),
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ maxOids: 6, maxRepetitions: 4 }),
    );

    expect(walkedOids(outcome)).toEqual(oids(6));
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.OidLimit);
    expect(outcome.nextOid).toBe(`${ROOT}.2.1.2.6`);
  });

  test("asks for no more OIDs than the limit leaves room for", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: oids(4).map((oid: string) => {
          return value(oid);
        }),
      },
      {
        varbinds: oids(2, 5).map((oid: string) => {
          return value(oid);
        }),
      },
    ]);

    await SnmpOidWalker.walk(agent, options({ maxOids: 6, maxRepetitions: 4 }));

    expect(agent.sent).toEqual([
      { kind: "getBulk", oid: ROOT, maxRepetitions: 4 },
      { kind: "getBulk", oid: `${ROOT}.2.1.2.4`, maxRepetitions: 2 },
    ]);
  });

  test("a continued walk starts after the OID it was given", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: oids(2, 7).map((oid: string) => {
          return value(oid);
        }),
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ afterOid: `${ROOT}.2.1.2.6` }),
    );

    expect(agent.sent[0]).toEqual({
      kind: "getBulk",
      oid: `${ROOT}.2.1.2.6`,
      maxRepetitions: 25,
    });
    expect(walkedOids(outcome)).toEqual(oids(2, 7));
  });
});

describe("the time budget", () => {
  test("stops when the budget runs out, keeping what it read and where to continue", async () => {
    let clock: number = 1000;
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: oids(2).map((oid: string) => {
          return value(oid);
        }),
      },
      {
        varbinds: oids(2, 3).map((oid: string) => {
          return value(oid);
        }),
      },
      {
        varbinds: oids(2, 5).map((oid: string) => {
          return value(oid);
        }),
      },
    ]);

    // Every request takes ten seconds on this agent.
    const slowAgent: SnmpOidWalkSession = {
      getBulk: (...args: Parameters<ScriptedAgent["getBulk"]>): unknown => {
        clock += 10000;
        return agent.getBulk(...args);
      },
      getNext: agent.getNext.bind(agent),
      get: agent.get.bind(agent),
    };

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      slowAgent,
      options({
        timeBudgetInMs: 25000,
        now: (): number => {
          return clock;
        },
      }),
    );

    expect(walkedOids(outcome)).toEqual(oids(6));
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.TimeLimit);
    expect(outcome.nextOid).toBe(`${ROOT}.2.1.2.6`);
    expect(outcome.requestCount).toBe(3);
  });

  test("a walk with no time at all sends nothing", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({
        timeBudgetInMs: 0,
        now: (): number => {
          return 5;
        },
      }),
    );

    expect(agent.sent).toEqual([]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.TimeLimit);
    expect(outcome.nextOid).toBeUndefined();
  });
});

describe("the pause between requests", () => {
  test("is taken between requests, never before the first", async () => {
    const pauses: Array<number> = [];
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: oids(2).map((oid: string) => {
          return value(oid);
        }),
      },
      {
        varbinds: oids(2, 3).map((oid: string) => {
          return value(oid);
        }),
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({
        maxRepetitions: 2,
        pauseBetweenRequestsInMs: 20,
        sleep: async (milliseconds: number): Promise<void> => {
          pauses.push(milliseconds);
        },
      }),
    );

    expect(outcome.requestCount).toBe(3);
    expect(pauses).toEqual([20, 20]);
  });

  test("is not taken when there is none", async () => {
    const pauses: Array<number> = [];
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: oids(2).map((oid: string) => {
          return value(oid);
        }),
      },
    ]);

    await SnmpOidWalker.walk(
      agent,
      options({
        maxRepetitions: 2,
        sleep: async (milliseconds: number): Promise<void> => {
          pauses.push(milliseconds);
        },
      }),
    );

    expect(pauses).toEqual([]);
  });
});

describe("an agent that answers tooBig", () => {
  test("is asked for half as many OIDs, until the answer fits", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { error: requestFailed(snmp.ErrorStatus.TooBig) },
      { error: requestFailed(snmp.ErrorStatus.TooBig) },
      {
        varbinds: oids(6).map((oid: string) => {
          return value(oid);
        }),
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ maxRepetitions: 24 }),
    );

    expect(walkedOids(outcome)).toEqual(oids(6));
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(
      agent.sent.map((request: SentRequest): number | undefined => {
        return request.kind === "getBulk" ? request.maxRepetitions : undefined;
      }),
    ).toEqual([24, 12, 6, 6]);
  });

  test("fails when even one OID at a time is too big", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { error: requestFailed(snmp.ErrorStatus.TooBig) },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ maxRepetitions: 1 }),
    );

    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect((outcome.error as Error).name).toBe("RequestFailedError");
  });
});

describe("an agent that misbehaves", () => {
  test("an OID that goes backwards stops the walk instead of looping, keeping what came before", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: [
          value(`${ROOT}.2.1.2.5`),
          value(`${ROOT}.2.1.2.6`),
          value(`${ROOT}.2.1.2.4`),
        ],
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(walkedOids(outcome)).toEqual([`${ROOT}.2.1.2.5`, `${ROOT}.2.1.2.6`]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect(outcome.error).toBeInstanceOf(SnmpWalkOutOfOrderError);
    expect(outcome.nextOid).toBe(`${ROOT}.2.1.2.6`);
  });

  test("an agent that answers the same OID again is stopped on the second request", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { varbinds: [value(`${ROOT}.1.0`)] },
      { varbinds: [value(`${ROOT}.1.0`)] },
      { varbinds: [value(`${ROOT}.1.0`)] },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(walkedOids(outcome)).toEqual([`${ROOT}.1.0`]);
    expect(outcome.error).toBeInstanceOf(SnmpWalkOutOfOrderError);
    expect(agent.sent).toHaveLength(2);
  });

  test("an answer that starts before where the request asked is out of order too", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { varbinds: [value(`${ROOT}.2.1.2.1`)] },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ afterOid: `${ROOT}.2.1.2.9` }),
    );

    expect(outcome.varbinds).toEqual([]);
    expect(outcome.error).toBeInstanceOf(SnmpWalkOutOfOrderError);
    // Nothing new was read: continue where this walk started.
    expect(outcome.nextOid).toBe(`${ROOT}.2.1.2.9`);
  });
});

describe("a device that stops answering", () => {
  test("keeps what was read before the failure, and where to continue", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      {
        varbinds: oids(3).map((oid: string) => {
          return value(oid);
        }),
      },
      { error: timedOut() },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ maxRepetitions: 3 }),
    );

    expect(walkedOids(outcome)).toEqual(oids(3));
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect((outcome.error as Error).name).toBe("RequestTimedOutError");
    expect(outcome.nextOid).toBe(`${ROOT}.2.1.2.3`);
  });

  test("a failure on the first request reads nothing and has nowhere to continue from", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([{ error: timedOut() }]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(outcome.varbinds).toEqual([]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect(outcome.nextOid).toBeUndefined();
  });

  test("a session that throws on send is a failure, not a crash", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { throws: new Error("Socket forcibly closed") },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect((outcome.error as Error).message).toBe("Socket forcibly closed");
  });
});

describe("SNMPv1", () => {
  test("walks one GETNEXT at a time and ends on noSuchName", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { varbinds: [value(`${ROOT}.1.0`)] },
      { varbinds: [value(`${ROOT}.2.1.1.1`)] },
      { error: requestFailed(snmp.ErrorStatus.NoSuchName) },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ useGetNext: true }),
    );

    expect(walkedOids(outcome)).toEqual([`${ROOT}.1.0`, `${ROOT}.2.1.1.1`]);
    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(agent.sent).toEqual([
      { kind: "getNext", oid: ROOT },
      { kind: "getNext", oid: `${ROOT}.1.0` },
      { kind: "getNext", oid: `${ROOT}.2.1.1.1` },
    ]);
  });

  test("noSuchName on the first GETNEXT reads the root itself", async () => {
    const leaf: string = "1.3.6.1.2.1.1.5.0";
    const agent: ScriptedAgent = new ScriptedAgent([
      { error: requestFailed(snmp.ErrorStatus.NoSuchName) },
      {
        varbinds: [
          {
            oid: leaf,
            type: snmp.ObjectType.OctetString,
            value: Buffer.from("core-01"),
          },
        ],
      },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options({ rootOid: leaf, useGetNext: true }),
    );

    expect(walkedOids(outcome)).toEqual([leaf]);
    expect(outcome.requestCount).toBe(2);
  });

  test("noSuchName is only the end of a v1 walk: on GETBULK it is a failure", async () => {
    const agent: ScriptedAgent = new ScriptedAgent([
      { error: requestFailed(snmp.ErrorStatus.NoSuchName) },
    ]);

    const outcome: SnmpOidWalkOutcome = await SnmpOidWalker.walk(
      agent,
      options(),
    );

    expect(outcome.stopReason).toBe(SnmpWalkStopReason.Failed);
  });
});
