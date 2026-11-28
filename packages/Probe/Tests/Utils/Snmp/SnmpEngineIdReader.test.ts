import {
  COMMUNITY_RETRY_MS,
  ENGINE_REDISCOVERY_INTERVAL_MS,
  EngineIdTarget,
  MAX_DISCOVERIES_AT_ONCE,
  SNMP_ENGINE_ID_OID,
  SnmpEngineIdReader,
  UNANSWERED_DISCOVERY_RETRY_MS,
} from "../../../Utils/Snmp/SnmpEngineIdReader";
import RecordedSnmpAgent, {
  simulatorRecording,
} from "../../TestingUtils/RecordedSnmpAgent";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import snmp from "net-snmp";

/*
 * HOW A v1 OR v2c POLL READS ITS DEVICE'S SNMP ENGINE ID (OneUptime issue
 * #11405).
 *
 * Over the device's own community first (snmpEngineID.0), and by SNMPv3
 * engine discovery when the community's view leaves it out - each held to
 * its bounds, so a fleet polled over v2c that never speaks SNMPv3 costs
 * next to nothing, and no poll ever waits for a discovery.
 */

jest.setTimeout(60000);

const SWITCH_A: string = simulatorRecording("switch-a", "public.snmprec");
const ENGINE: string = "800000090300AABBCC114055";

const agents: Array<RecordedSnmpAgent> = [];
const sessions: Array<snmp.Session> = [];

afterEach(() => {
  for (const session of sessions.splice(0)) {
    session.close();
  }

  for (const agent of agents.splice(0)) {
    agent.close();
  }
});

async function agent(
  options: Partial<Parameters<typeof RecordedSnmpAgent.start>[0]>,
): Promise<RecordedSnmpAgent> {
  const started: RecordedSnmpAgent = await RecordedSnmpAgent.start({
    recording: SWITCH_A,
    community: "public",
    engineId: ENGINE,
    ...options,
  });
  agents.push(started);
  return started;
}

function sessionTo(
  lab: RecordedSnmpAgent,
  version: 0 | 1 = snmp.Version2c,
  community: string = "public",
): snmp.Session {
  const session: snmp.Session = snmp.createSession("127.0.0.1", community, {
    port: lab.port,
    version: version,
    timeout: 1000,
    retries: 0,
  });
  sessions.push(session);
  return session;
}

// A session that answers snmpEngineID.0 as it is told to, and counts the asks.
function sessionAnswering(answer: {
  error?: Error | undefined;
  varbinds?: Array<snmp.Varbind> | undefined;
}): { session: snmp.Session; asked: Array<Array<string>> } {
  const asked: Array<Array<string>> = [];

  return {
    asked: asked,
    session: {
      get: (
        oids: Array<string>,
        callback: (error: Error | null, varbinds?: Array<snmp.Varbind>) => void,
      ): void => {
        asked.push(oids);
        callback(answer.error || null, answer.varbinds);
      },
    } as unknown as snmp.Session,
  };
}

const NO_ENGINE_IN_VIEW: { varbinds: Array<snmp.Varbind> } = {
  varbinds: [
    {
      oid: SNMP_ENGINE_ID_OID,
      type: snmp.ObjectType.NoSuchObject,
      value: null,
    } as unknown as snmp.Varbind,
  ],
};

function engineInView(hex: string): { varbinds: Array<snmp.Varbind> } {
  return {
    varbinds: [
      {
        oid: SNMP_ENGINE_ID_OID,
        type: snmp.ObjectType.OctetString,
        value: Buffer.from(hex, "hex"),
      } as unknown as snmp.Varbind,
    ],
  };
}

const TARGET: EngineIdTarget = { host: "10.20.0.5", port: 161 };

interface Lab {
  reader: SnmpEngineIdReader;
  discovered: Array<EngineIdTarget>;
  answers: Map<string, string | undefined>;
  setNow: (now: number) => void;
}

// A reader on a clock the test moves, whose discovery answers as told.
function readerWithLab(options?: {
  pending?: boolean | undefined;
  maxTargets?: number | undefined;
}): Lab & { release: () => void } {
  let now: number = Date.UTC(2026, 10, 28, 9, 0, 0);
  const discovered: Array<EngineIdTarget> = [];
  const answers: Map<string, string | undefined> = new Map();
  const waiting: Array<() => void> = [];

  const reader: SnmpEngineIdReader = new SnmpEngineIdReader({
    now: (): number => {
      return now;
    },
    maxTargets: options?.maxTargets,
    discover: async (target: EngineIdTarget): Promise<string | undefined> => {
      discovered.push(target);

      if (options?.pending) {
        await new Promise<void>((resolve: () => void) => {
          waiting.push(resolve);
        });
      }

      return answers.get(target.host);
    },
  });

  return {
    reader: reader,
    discovered: discovered,
    answers: answers,
    setNow: (next: number): void => {
      now = next;
    },
    release: (): void => {
      for (const resolve of waiting.splice(0)) {
        resolve();
      }
    },
  };
}

describe("over the device's own community: snmpEngineID.0", () => {
  test("a v2c agent whose view includes it says its engine ID", async () => {
    const lab: RecordedSnmpAgent = await agent({ servesSnmpEngineGroup: true });

    expect(await SnmpEngineIdReader.readOverCommunity(sessionTo(lab))).toBe(
      ENGINE,
    );
  });

  test("so does a v1 agent, in a GET of its own", async () => {
    const lab: RecordedSnmpAgent = await agent({ servesSnmpEngineGroup: true });

    expect(
      await SnmpEngineIdReader.readOverCommunity(sessionTo(lab, snmp.Version1)),
    ).toBe(ENGINE);
  });

  test("a v2c view that leaves it out answers noSuchObject: none", async () => {
    const lab: RecordedSnmpAgent = await agent({});

    expect(
      await SnmpEngineIdReader.readOverCommunity(sessionTo(lab)),
    ).toBeUndefined();
  });

  test("a v1 agent that has none fails the whole GET (noSuchName): none, never a throw", async () => {
    const lab: RecordedSnmpAgent = await agent({});

    expect(
      await SnmpEngineIdReader.readOverCommunity(sessionTo(lab, snmp.Version1)),
    ).toBeUndefined();
  });

  test("a wrong community is never answered: none, within the session's timeout", async () => {
    const lab: RecordedSnmpAgent = await agent({ servesSnmpEngineGroup: true });

    expect(
      await SnmpEngineIdReader.readOverCommunity(
        sessionTo(lab, snmp.Version2c, "not-the-community"),
      ),
    ).toBeUndefined();
  });

  test("what is no engine ID is none: too short, too long, not octets", () => {
    for (const value of [
      Buffer.from("8000", "hex"),
      Buffer.alloc(33, 0xab),
      Buffer.alloc(0),
      "800000090300AABBCC114055",
      42,
      null,
    ]) {
      expect(SnmpEngineIdReader.toEngineId(value)).toBeUndefined();
    }

    expect(
      SnmpEngineIdReader.toEngineId(
        Buffer.from("80001f8803aabbcc114050", "hex"),
      ),
    ).toBe("80001F8803AABBCC114050");
  });
});

describe("readForCommunityPoll: the community first, then discovery", () => {
  test("while the community can read it, every poll reads it there, and nothing is discovered", async () => {
    const lab: ReturnType<typeof readerWithLab> = readerWithLab();
    const device: { session: snmp.Session; asked: Array<Array<string>> } =
      sessionAnswering(engineInView(ENGINE));

    for (let poll: number = 0; poll < 3; poll++) {
      expect(
        await lab.reader.readForCommunityPoll({
          session: device.session,
          target: TARGET,
        }),
      ).toBe(ENGINE);
    }

    expect(device.asked).toEqual([
      [SNMP_ENGINE_ID_OID],
      [SNMP_ENGINE_ID_OID],
      [SNMP_ENGINE_ID_OID],
    ]);
    expect(lab.discovered).toEqual([]);
  });

  test("a view that leaves it out: discovery starts in the background, and the next poll reports what it found", async () => {
    const lab: ReturnType<typeof readerWithLab> = readerWithLab();
    lab.answers.set(TARGET.host, ENGINE);
    const device: { session: snmp.Session; asked: Array<Array<string>> } =
      sessionAnswering(NO_ENGINE_IN_VIEW);

    // No poll waits for discovery.
    expect(
      await lab.reader.readForCommunityPoll({
        session: device.session,
        target: TARGET,
      }),
    ).toBeUndefined();

    await lab.reader.whenIdle();

    expect(lab.discovered).toEqual([
      expect.objectContaining({ host: TARGET.host, port: TARGET.port }),
    ]);
    expect(
      await lab.reader.readForCommunityPoll({
        session: device.session,
        target: TARGET,
      }),
    ).toBe(ENGINE);

    // The community was asked once: not again within the hour.
    expect(device.asked).toHaveLength(1);
  });

  test(`the community is asked again ${COMMUNITY_RETRY_MS / 60000} minutes after it last found nothing, and wins once it answers`, async () => {
    const lab: ReturnType<typeof readerWithLab> = readerWithLab();
    lab.answers.set(TARGET.host, "800000090300AABBCC1140AA");
    const missing: { session: snmp.Session; asked: Array<Array<string>> } =
      sessionAnswering(NO_ENGINE_IN_VIEW);

    await lab.reader.readForCommunityPoll({
      session: missing.session,
      target: TARGET,
    });
    await lab.reader.whenIdle();

    lab.setNow(Date.UTC(2026, 10, 28, 9, 0, 0) + COMMUNITY_RETRY_MS);

    // Its view now includes it: the community's answer is the poll's own.
    const answering: { session: snmp.Session; asked: Array<Array<string>> } =
      sessionAnswering(engineInView(ENGINE));

    expect(
      await lab.reader.readForCommunityPoll({
        session: answering.session,
        target: TARGET,
      }),
    ).toBe(ENGINE);
    expect(answering.asked).toHaveLength(1);
  });

  test("an agent with no SNMPv3: discovery is sent once in six hours, and never waited for", async () => {
    const start: number = Date.UTC(2026, 10, 28, 9, 0, 0);
    const lab: ReturnType<typeof readerWithLab> = readerWithLab();
    const device: { session: snmp.Session; asked: Array<Array<string>> } =
      sessionAnswering(NO_ENGINE_IN_VIEW);

    // A poll a minute, for almost six hours.
    for (
      let at: number = start;
      at < start + UNANSWERED_DISCOVERY_RETRY_MS;
      at += 60 * 1000
    ) {
      lab.setNow(at);
      expect(
        await lab.reader.readForCommunityPoll({
          session: device.session,
          target: TARGET,
        }),
      ).toBeUndefined();
      await lab.reader.whenIdle();
    }

    expect(lab.discovered).toHaveLength(1);

    lab.setNow(start + UNANSWERED_DISCOVERY_RETRY_MS);
    await lab.reader.readForCommunityPoll({
      session: device.session,
      target: TARGET,
    });
    await lab.reader.whenIdle();

    expect(lab.discovered).toHaveLength(2);
    // The community too, once an hour: six asks in six hours, then the seventh.
    expect(device.asked).toHaveLength(7);
  });

  test("an agent that answers is rediscovered once an hour, its engine ID reported meanwhile", async () => {
    const start: number = Date.UTC(2026, 10, 28, 9, 0, 0);
    const lab: ReturnType<typeof readerWithLab> = readerWithLab();
    lab.answers.set(TARGET.host, ENGINE);

    lab.reader.fromDiscovery(TARGET);
    await lab.reader.whenIdle();

    for (const minutes of [1, 30, 59]) {
      lab.setNow(start + minutes * 60 * 1000);
      expect(lab.reader.fromDiscovery(TARGET)).toBe(ENGINE);
    }

    expect(lab.discovered).toHaveLength(1);

    // An hour on: rediscovered, and a replaced device's new engine is taken.
    lab.answers.set(TARGET.host, "800000090300AABBCC1140BB");
    lab.setNow(start + ENGINE_REDISCOVERY_INTERVAL_MS);
    lab.reader.fromDiscovery(TARGET);
    await lab.reader.whenIdle();

    expect(lab.discovered).toHaveLength(2);
    expect(lab.reader.fromDiscovery(TARGET)).toBe("800000090300AABBCC1140BB");
  });

  test("an agent that stops answering is not said to have its old engine any more", async () => {
    const start: number = Date.UTC(2026, 10, 28, 9, 0, 0);
    const lab: ReturnType<typeof readerWithLab> = readerWithLab();
    lab.answers.set(TARGET.host, ENGINE);

    lab.reader.fromDiscovery(TARGET);
    await lab.reader.whenIdle();
    expect(lab.reader.fromDiscovery(TARGET)).toBe(ENGINE);

    lab.answers.set(TARGET.host, undefined);
    lab.setNow(start + ENGINE_REDISCOVERY_INTERVAL_MS);
    lab.reader.fromDiscovery(TARGET);
    await lab.reader.whenIdle();

    expect(lab.reader.fromDiscovery(TARGET)).toBeUndefined();
  });

  test(`at most ${MAX_DISCOVERIES_AT_ONCE} discoveries at once; one agent's is never sent twice at once`, async () => {
    const lab: ReturnType<typeof readerWithLab> = readerWithLab({
      pending: true,
    });

    for (let index: number = 0; index < MAX_DISCOVERIES_AT_ONCE + 10; index++) {
      lab.reader.fromDiscovery({ host: `10.20.1.${index}`, port: 161 });
      lab.reader.fromDiscovery({ host: `10.20.1.${index}`, port: 161 });
    }

    // The discoveries start a turn later, once listed as under way.
    await Promise.resolve();
    await Promise.resolve();

    expect(lab.reader.getDiscoveriesUnderWay()).toBe(MAX_DISCOVERIES_AT_ONCE);
    expect(lab.discovered).toHaveLength(MAX_DISCOVERIES_AT_ONCE);

    lab.release();
    await lab.reader.whenIdle();

    expect(lab.reader.getDiscoveriesUnderWay()).toBe(0);
  });

  test("the agents it remembers are bounded: the oldest is forgotten first", async () => {
    const lab: ReturnType<typeof readerWithLab> = readerWithLab({
      maxTargets: 3,
    });

    for (const host of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]) {
      lab.answers.set(host, ENGINE);
      lab.reader.fromDiscovery({ host: host, port: 161 });
      await lab.reader.whenIdle();
    }

    // 10.0.0.1 was forgotten, so it is asked again; 10.0.0.4 is known.
    expect(lab.reader.fromDiscovery({ host: "10.0.0.4", port: 161 })).toBe(
      ENGINE,
    );
    expect(
      lab.reader.fromDiscovery({ host: "10.0.0.1", port: 161 }),
    ).toBeUndefined();
    await lab.reader.whenIdle();
    expect(
      lab.discovered.filter((target: EngineIdTarget) => {
        return target.host === "10.0.0.1";
      }),
    ).toHaveLength(2);
  });

  test("an agent is known by its host and port: another port is another agent", async () => {
    const lab: ReturnType<typeof readerWithLab> = readerWithLab();
    lab.answers.set(TARGET.host, ENGINE);

    lab.reader.fromDiscovery({ host: TARGET.host, port: 161 });
    lab.reader.fromDiscovery({
      host: ` ${TARGET.host.toUpperCase()} `,
      port: 161,
    });
    lab.reader.fromDiscovery({ host: TARGET.host, port: 1161 });
    await lab.reader.whenIdle();

    expect(lab.discovered).toHaveLength(2);
  });

  test("a discovery that throws is no engine ID, and is not sent again until it is due", async () => {
    const reader: SnmpEngineIdReader = new SnmpEngineIdReader({
      discover: (): Promise<string | undefined> => {
        throw new Error("socket refused");
      },
    });

    expect(reader.fromDiscovery(TARGET)).toBeUndefined();
    await reader.whenIdle();
    expect(reader.fromDiscovery(TARGET)).toBeUndefined();
    expect(reader.getDiscoveriesUnderWay()).toBe(0);
  });

  test("a community that throws is a community that found nothing", async () => {
    const lab: ReturnType<typeof readerWithLab> = readerWithLab();
    lab.answers.set(TARGET.host, ENGINE);

    expect(
      await lab.reader.readForCommunityPoll({
        session: sessionAnswering({ error: new Error("Request timed out") })
          .session,
        target: TARGET,
      }),
    ).toBeUndefined();
    await lab.reader.whenIdle();
    expect(lab.discovered).toHaveLength(1);
  });
});

describe("against net-snmp's own agent, over real sockets", () => {
  test("a view that includes it: read over the community, no SNMPv3 sent", async () => {
    const lab: RecordedSnmpAgent = await agent({ servesSnmpEngineGroup: true });
    const reader: SnmpEngineIdReader = new SnmpEngineIdReader();

    expect(
      await reader.readForCommunityPoll({
        session: sessionTo(lab),
        target: { host: "127.0.0.1", port: lab.port, timeoutMs: 1000 },
      }),
    ).toBe(ENGINE);
    await reader.whenIdle();

    expect(
      lab.requests.filter((request: { isSnmpV3: boolean }) => {
        return request.isSnmpV3;
      }),
    ).toHaveLength(0);
  });

  test("a view that leaves it out: the next poll has it, by discovery", async () => {
    const lab: RecordedSnmpAgent = await agent({});
    const reader: SnmpEngineIdReader = new SnmpEngineIdReader();
    const target: EngineIdTarget = {
      host: "127.0.0.1",
      port: lab.port,
      timeoutMs: 1000,
    };

    expect(
      await reader.readForCommunityPoll({
        session: sessionTo(lab),
        target: target,
      }),
    ).toBeUndefined();
    await reader.whenIdle();

    expect(
      await reader.readForCommunityPoll({
        session: sessionTo(lab),
        target: target,
      }),
    ).toBe(ENGINE);
  });

  test("an agent with no SNMPv3: nothing, and one unanswered datagram", async () => {
    const lab: RecordedSnmpAgent = await agent({ answersSnmpV3: false });
    const reader: SnmpEngineIdReader = new SnmpEngineIdReader();
    const target: EngineIdTarget = {
      host: "127.0.0.1",
      port: lab.port,
      timeoutMs: 300,
    };

    for (let poll: number = 0; poll < 3; poll++) {
      expect(
        await reader.readForCommunityPoll({
          session: sessionTo(lab),
          target: target,
        }),
      ).toBeUndefined();
      await reader.whenIdle();
    }

    expect(
      lab.requests.filter((request: { isSnmpV3: boolean }) => {
        return request.isSnmpV3;
      }),
    ).toHaveLength(1);
  });
});
