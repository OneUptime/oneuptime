import SnmpEngineDiscovery, {
  DEFAULT_ENGINE_DISCOVERY_TIMEOUT_MS,
} from "./SnmpEngineDiscovery";
import logger from "Common/Server/Utils/Logger";
import SnmpTrapReceiverUtil from "Common/Types/Probe/SnmpTrapReceiver";
import OldestKeyMap from "Common/Utils/OldestKeyMap";
import snmp from "net-snmp";

/*
 * A DEVICE'S SNMP ENGINE ID, WHATEVER VERSION IT IS POLLED WITH (OneUptime
 * issue #11405).
 *
 * #11172 tells apart devices that send SNMPv3 traps from one address by the
 * engine ID each device's own agent answers its polls with: an SNMPv3 poll
 * learns it from the agent's answer to its first request. A device polled
 * over v1 or v2c that sends its traps as SNMPv3 - as its site's default
 * user, say - had none. Its engine ID is read now too, from its own agent,
 * at the address and port it is polled at:
 *
 *   1. Over its own poll: snmpEngineID.0 (SNMP-FRAMEWORK-MIB, RFC 3411),
 *      asked for with the device's own community, in a GET of its own -
 *      an SNMPv1 agent fails a whole GET for an object it does not have, so
 *      it never rides with the system group. Most agents' default views
 *      include it (Cisco's v1default, Brocade's, a full Net-SNMP view).
 *   2. When the community's view leaves it out (Net-SNMP's `systemonly`),
 *      or the agent does not answer for it: SNMPv3 engine discovery at the
 *      same address and port (SnmpEngineDiscovery), which needs no
 *      credential and which every agent that sends SNMPv3 traps answers.
 *
 * Bounded, so a v2c-only fleet costs next to nothing. The GET is asked
 * every poll while it answers; once it does not, not again for
 * COMMUNITY_RETRY_MS. Discovery runs in the background - no poll waits for
 * it, and what it finds is reported with the device's next poll - at most
 * MAX_DISCOVERIES_AT_ONCE at a time, once an ENGINE_REDISCOVERY_INTERVAL_MS
 * while the agent answers, and once an UNANSWERED_DISCOVERY_RETRY_MS while
 * it does not: one unanswered datagram every six hours for an agent with
 * no SNMPv3. What is remembered is bounded too (MAX_ENGINE_ID_TARGETS).
 *
 * Only the device's own poll reads it, at its own polling address - never a
 * trap, which anyone who can reach the probe can send as any engine
 * (#11172's trust rule). The server keeps the last one a poll read
 * (NetworkDevice.snmpEngineId); a poll that read none leaves it as it was.
 */

// SNMP-FRAMEWORK-MIB::snmpEngineID.0.
export const SNMP_ENGINE_ID_OID: string = "1.3.6.1.6.3.10.2.1.1.0";

export const COMMUNITY_RETRY_MS: number = 60 * 60 * 1000;
export const ENGINE_REDISCOVERY_INTERVAL_MS: number = 60 * 60 * 1000;
export const UNANSWERED_DISCOVERY_RETRY_MS: number = 6 * 60 * 60 * 1000;
export const MAX_DISCOVERIES_AT_ONCE: number = 16;
export const MAX_ENGINE_ID_TARGETS: number = 20000;

export interface EngineIdTarget {
  host: string;
  port: number;
  // How long discovery waits for the agent's answer.
  timeoutMs?: number | undefined;
}

export type EngineDiscoverFunction = (
  target: EngineIdTarget,
) => Promise<string | undefined>;

// What is known of one agent, by its host and port.
interface EngineIdState {
  // When asking over its community last found nothing.
  communityMissedAt?: number | undefined;
  // What discovery last found, and when; none while it does not answer.
  discoveredEngineId?: string | undefined;
  discoveredAt?: number | undefined;
  // When discovery was last sent.
  discoveryTriedAt?: number | undefined;
}

export class SnmpEngineIdReader {
  private readonly states: OldestKeyMap<string, EngineIdState> =
    new OldestKeyMap();
  private readonly discoveriesUnderWay: Map<string, Promise<void>> = new Map();
  private readonly now: () => number;
  private readonly discover: EngineDiscoverFunction;
  private readonly maxTargets: number;

  public constructor(options?: {
    now?: (() => number) | undefined;
    discover?: EngineDiscoverFunction | undefined;
    maxTargets?: number | undefined;
  }) {
    this.now = options?.now || Date.now;
    this.discover =
      options?.discover ||
      ((target: EngineIdTarget): Promise<string | undefined> => {
        return SnmpEngineDiscovery.discover(target);
      });
    this.maxTargets = options?.maxTargets || MAX_ENGINE_ID_TARGETS;
  }

  /*
   * The engine ID of the agent a v1 or v2c session polls, as hex in
   * capitals, or undefined: over the session when its community may read
   * it, else what discovery found at the agent, while it is fresh. Never
   * throws.
   */
  public async readForCommunityPoll(data: {
    session: snmp.Session;
    target: EngineIdTarget;
  }): Promise<string | undefined> {
    const key: string = SnmpEngineIdReader.keyOf(data.target);
    const missedAt: number | undefined =
      this.states.get(key)?.communityMissedAt;

    if (missedAt === undefined || this.now() - missedAt >= COMMUNITY_RETRY_MS) {
      const engineId: string | undefined =
        await SnmpEngineIdReader.readOverCommunity(data.session);

      // As it is now: a discovery may have answered while the GET was out.
      const latest: EngineIdState = this.states.get(key) || {};

      if (engineId) {
        this.remember(key, { ...latest, communityMissedAt: undefined });
        return engineId;
      }

      this.remember(key, { ...latest, communityMissedAt: this.now() });
    }

    return this.fromDiscovery(data.target);
  }

  /*
   * What discovery last found at the agent, while it is fresh; when one is
   * due, starts it in the background, for the next poll to report.
   */
  public fromDiscovery(target: EngineIdTarget): string | undefined {
    const key: string = SnmpEngineIdReader.keyOf(target);
    const now: number = this.now();
    const state: EngineIdState = this.states.get(key) || {};

    const isFresh: boolean =
      Boolean(state.discoveredEngineId) &&
      state.discoveredAt !== undefined &&
      now - state.discoveredAt < ENGINE_REDISCOVERY_INTERVAL_MS;

    const isDue: boolean =
      state.discoveryTriedAt === undefined ||
      now - state.discoveryTriedAt >=
        (state.discoveredEngineId
          ? ENGINE_REDISCOVERY_INTERVAL_MS
          : UNANSWERED_DISCOVERY_RETRY_MS);

    if (
      isDue &&
      !this.discoveriesUnderWay.has(key) &&
      this.discoveriesUnderWay.size < MAX_DISCOVERIES_AT_ONCE
    ) {
      this.startDiscovery(key, target, state);
    }

    return isFresh ? state.discoveredEngineId : undefined;
  }

  // Resolves once every discovery under way has its answer (tests).
  public async whenIdle(): Promise<void> {
    while (this.discoveriesUnderWay.size > 0) {
      await Promise.all(Array.from(this.discoveriesUnderWay.values()));
    }
  }

  // Forgets every agent (tests).
  public clear(): void {
    this.states.clear();
    this.discoveriesUnderWay.clear();
  }

  public getDiscoveriesUnderWay(): number {
    return this.discoveriesUnderWay.size;
  }

  /*
   * snmpEngineID.0 over a v1 or v2c session: undefined when the agent's
   * view leaves it out (noSuchObject, or an SNMPv1 noSuchName), when it
   * does not answer, and when what it holds is no engine ID.
   */
  public static async readOverCommunity(
    session: snmp.Session,
  ): Promise<string | undefined> {
    try {
      const varbinds: Array<snmp.Varbind> = await new Promise(
        (
          resolve: (value: Array<snmp.Varbind>) => void,
          reject: (reason: Error) => void,
        ): void => {
          session.get(
            [SNMP_ENGINE_ID_OID],
            (
              error: Error | null,
              answered: Array<snmp.Varbind> | undefined,
            ): void => {
              if (error || !answered) {
                reject(error || new Error("No varbinds returned"));
                return;
              }

              resolve(answered);
            },
          );
        },
      );

      const varbind: snmp.Varbind | undefined = varbinds[0];

      if (!varbind || snmp.isVarbindError(varbind)) {
        return undefined;
      }

      return SnmpEngineIdReader.toEngineId(varbind.value);
    } catch (error) {
      logger.debug(
        `snmpEngineID could not be read over the device's community: ${(error as Error)?.message || error}`,
      );
      return undefined;
    }
  }

  // An agent's snmpEngineID as the server keeps it: 5 to 32 octets, as hex.
  public static toEngineId(value: unknown): string | undefined {
    if (!Buffer.isBuffer(value) || value.length === 0) {
      return undefined;
    }

    return (
      SnmpTrapReceiverUtil.normalizeEngineId(value.toString("hex")) || undefined
    );
  }

  private startDiscovery(
    key: string,
    target: EngineIdTarget,
    state: EngineIdState,
  ): void {
    this.remember(key, { ...state, discoveryTriedAt: this.now() });

    // Starts once it is listed as under way, so it is never listed after it ended.
    const discovery: Promise<void> = Promise.resolve().then(
      async (): Promise<void> => {
        let engineId: string | undefined = undefined;

        try {
          engineId = await this.discover({
            host: target.host,
            port: target.port,
            timeoutMs: target.timeoutMs ?? DEFAULT_ENGINE_DISCOVERY_TIMEOUT_MS,
          });
        } catch (error) {
          logger.debug(
            `SNMPv3 engine discovery failed for ${target.host}:${target.port}: ${(error as Error)?.message || error}`,
          );
        } finally {
          this.discoveriesUnderWay.delete(key);
        }

        const latest: EngineIdState = this.states.get(key) || {};

        this.remember(
          key,
          engineId
            ? {
                ...latest,
                discoveredEngineId: engineId,
                discoveredAt: this.now(),
              }
            : {
                // An agent that stopped answering: what it said is not said again.
                ...latest,
                discoveredEngineId: undefined,
                discoveredAt: undefined,
              },
        );
      },
    );

    this.discoveriesUnderWay.set(key, discovery);
  }

  private remember(key: string, state: EngineIdState): void {
    if (!this.states.has(key) && this.states.size >= this.maxTargets) {
      const oldest: string | undefined = this.states.oldestKey();

      if (oldest !== undefined) {
        this.states.delete(oldest);
      }
    }

    this.states.set(key, state);
  }

  private static keyOf(target: EngineIdTarget): string {
    return `${(target.host || "").trim().toLowerCase()}|${target.port}`;
  }
}

export default new SnmpEngineIdReader();
