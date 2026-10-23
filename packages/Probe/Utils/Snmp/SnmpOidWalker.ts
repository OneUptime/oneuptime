import { SnmpWalkStopReason } from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import Sleep from "Common/Types/Sleep";
import SnmpWalkResultUtil from "Common/Utils/NetworkDevice/SnmpWalkResultUtil";
import snmp from "net-snmp";

/*
 * The bounded walk behind a device's SNMP Walk page (issue #5184): every
 * OID an agent answers under a starting OID, read the way `snmpwalk` reads
 * it - GETBULK after GETBULK (GETNEXT for SNMPv1), each starting after the
 * last OID the previous one returned, until the agent leaves the subtree or
 * runs out - but bounded, because a walk is a burst against a device that
 * is usually in production:
 *
 *   - at most `maxOids` OIDs, then it stops and says where to continue;
 *   - within `timeBudgetInMs`, checked before every request;
 *   - one request in flight, with a pause between requests;
 *   - an agent answering tooBig is asked for fewer OIDs at a time;
 *   - an agent returning OIDs that do not move forward (a known agent bug
 *     that loops a walk forever) is stopped, keeping what it read.
 *
 * It knows nothing about devices, credentials or how values read: it is
 * handed an open session and returns the varbinds. SnmpMonitor.walkOidTree
 * opens the session and turns the varbinds into rows.
 */

/*
 * The part of a net-snmp session a walk uses. A structural type, so tests
 * can drive the walk with a scripted agent as well as a real one.
 */
export interface SnmpOidWalkSession {
  getBulk(
    oids: Array<string>,
    nonRepeaters: number,
    maxRepetitions: number,
    responseCb: (
      error: Error | null,
      varbinds?: Array<snmp.Varbind | Array<snmp.Varbind>>,
    ) => void,
  ): unknown;
  getNext(
    oids: Array<string>,
    responseCb: (error: Error | null, varbinds?: Array<snmp.Varbind>) => void,
  ): unknown;
  get(
    oids: Array<string>,
    responseCb: (error: Error | null, varbinds?: Array<snmp.Varbind>) => void,
  ): unknown;
}

export interface SnmpOidWalkOptions {
  rootOid: string;
  // Walk what follows this OID instead of the root: a continued walk.
  afterOid?: string | undefined;
  maxOids: number;
  timeBudgetInMs: number;
  maxRepetitions: number;
  pauseBetweenRequestsInMs: number;
  // SNMPv1 has no GETBULK: walk one GETNEXT at a time.
  useGetNext: boolean;
  // Seams for tests: the clock and the pause.
  now?: (() => number) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

export interface SnmpOidWalkOutcome {
  varbinds: Array<snmp.Varbind>;
  stopReason: SnmpWalkStopReason;
  // The last OID read, to continue from; absent when the walk was complete.
  nextOid?: string | undefined;
  // What stopped a Failed walk.
  error?: unknown;
  requestCount: number;
}

/*
 * The agent returned an OID that is not after the one before it. Walking on
 * would ask for the same OIDs again, forever.
 */
export class SnmpWalkOutOfOrderError extends Error {
  public constructor(previousOid: string, oid: string) {
    super(
      `The device returned ${oid} after ${previousOid}: OIDs must only move forward, so the walk stopped here rather than loop.`,
    );
    this.name = "SnmpWalkOutOfOrderError";
  }
}

const ERROR_STATUS_TOO_BIG: number = 1;
const ERROR_STATUS_NO_SUCH_NAME: number = 2;

function readErrorStatus(error: unknown): number | undefined {
  if (
    error instanceof Error &&
    error.name === "RequestFailedError" &&
    typeof (error as unknown as { status?: unknown }).status === "number"
  ) {
    return (error as unknown as { status: number }).status;
  }

  return undefined;
}

export default class SnmpOidWalker {
  public static async walk(
    session: SnmpOidWalkSession,
    options: SnmpOidWalkOptions,
  ): Promise<SnmpOidWalkOutcome> {
    const now: () => number =
      options.now ||
      ((): number => {
        return Date.now();
      });
    const sleep: (milliseconds: number) => Promise<void> =
      options.sleep ||
      ((milliseconds: number): Promise<void> => {
        return Sleep.sleep(milliseconds);
      });

    const deadlineAt: number = now() + Math.max(0, options.timeBudgetInMs);
    const maxOids: number = Math.max(1, Math.floor(options.maxOids));
    let maxRepetitions: number = Math.max(
      1,
      Math.floor(options.maxRepetitions),
    );

    const varbinds: Array<snmp.Varbind> = [];
    let requestCount: number = 0;
    let lastOid: string | undefined = undefined;
    let cursor: string = options.afterOid || options.rootOid;

    const outcome: (
      stopReason: SnmpWalkStopReason,
      error?: unknown,
    ) => SnmpOidWalkOutcome = (
      stopReason: SnmpWalkStopReason,
      error?: unknown,
    ): SnmpOidWalkOutcome => {
      const result: SnmpOidWalkOutcome = {
        varbinds: varbinds,
        stopReason: stopReason,
        requestCount: requestCount,
      };

      /*
       * Where the next walk picks up: after the last OID read, or, when
       * this walk read nothing before it stopped, where it started.
       */
      const continueFrom: string | undefined = lastOid || options.afterOid;

      if (stopReason !== SnmpWalkStopReason.Complete && continueFrom) {
        result.nextOid = continueFrom;
      }

      if (error !== undefined) {
        result.error = error;
      }

      return result;
    };

    // The GET a leaf root ends with counts as a request too.
    const countRequest: () => void = (): void => {
      requestCount++;
    };

    for (;;) {
      if (varbinds.length >= maxOids) {
        return outcome(SnmpWalkStopReason.OidLimit);
      }

      if (now() >= deadlineAt) {
        return outcome(SnmpWalkStopReason.TimeLimit);
      }

      if (requestCount > 0 && options.pauseBetweenRequestsInMs > 0) {
        await sleep(options.pauseBetweenRequestsInMs);
      }

      let batch: Array<snmp.Varbind>;

      try {
        requestCount++;
        batch = options.useGetNext
          ? await SnmpOidWalker.getNext(session, cursor)
          : await SnmpOidWalker.getBulk(
              session,
              cursor,
              Math.min(maxRepetitions, maxOids - varbinds.length),
            );
      } catch (error) {
        const status: number | undefined = readErrorStatus(error);

        // The answer would not fit one message: ask for fewer at a time.
        if (status === ERROR_STATUS_TOO_BIG && maxRepetitions > 1) {
          maxRepetitions = Math.max(1, Math.floor(maxRepetitions / 2));
          continue;
        }

        // How an SNMPv1 agent says there is nothing after the cursor.
        if (status === ERROR_STATUS_NO_SUCH_NAME && options.useGetNext) {
          return await SnmpOidWalker.finish({
            session: session,
            options: options,
            varbinds: varbinds,
            deadlineAt: deadlineAt,
            now: now,
            outcome: outcome,
            onRequest: countRequest,
          });
        }

        return outcome(SnmpWalkStopReason.Failed, error);
      }

      if (batch.length === 0) {
        break;
      }

      let isSubtreeDone: boolean = false;

      for (const varbind of batch) {
        /*
         * endOfMibView ends the walk. Any other error varbind in a walk's
         * answer (noSuchObject, noSuchInstance) means the agent has nothing
         * more to give from here, which is the end of it too.
         */
        if (
          varbind.type === snmp.ObjectType.EndOfMibView ||
          snmp.isVarbindError(varbind)
        ) {
          isSubtreeDone = true;
          break;
        }

        if (!SnmpWalkResultUtil.isWithinSubtree(options.rootOid, varbind.oid)) {
          isSubtreeDone = true;
          break;
        }

        const previousOid: string = lastOid || cursor;

        if (SnmpWalkResultUtil.compareOids(varbind.oid, previousOid) <= 0) {
          return outcome(
            SnmpWalkStopReason.Failed,
            new SnmpWalkOutOfOrderError(previousOid, varbind.oid),
          );
        }

        varbinds.push(varbind);
        lastOid = varbind.oid;

        if (varbinds.length >= maxOids) {
          return outcome(SnmpWalkStopReason.OidLimit);
        }
      }

      if (isSubtreeDone) {
        break;
      }

      cursor = lastOid || cursor;
    }

    return await SnmpOidWalker.finish({
      session: session,
      options: options,
      varbinds: varbinds,
      deadlineAt: deadlineAt,
      now: now,
      outcome: outcome,
      onRequest: countRequest,
    });
  }

  /*
   * The end of a walk that ran out of subtree. A walk that found nothing
   * under its starting OID may have been started ON an object rather than
   * above one - 1.3.6.1.2.1.1.3.0, sysUpTime itself - so it reads that OID
   * with a GET, as snmpwalk does, and shows its value when it has one.
   */
  private static async finish(data: {
    session: SnmpOidWalkSession;
    options: SnmpOidWalkOptions;
    varbinds: Array<snmp.Varbind>;
    deadlineAt: number;
    now: () => number;
    outcome: (
      stopReason: SnmpWalkStopReason,
      error?: unknown,
    ) => SnmpOidWalkOutcome;
    onRequest: () => void;
  }): Promise<SnmpOidWalkOutcome> {
    if (
      data.varbinds.length > 0 ||
      data.options.afterOid ||
      data.now() >= data.deadlineAt
    ) {
      return data.outcome(SnmpWalkStopReason.Complete);
    }

    try {
      data.onRequest();
      const answer: Array<snmp.Varbind> = await SnmpOidWalker.get(
        data.session,
        data.options.rootOid,
      );

      for (const varbind of answer) {
        if (
          !snmp.isVarbindError(varbind) &&
          SnmpWalkResultUtil.compareOids(varbind.oid, data.options.rootOid) ===
            0
        ) {
          data.varbinds.push(varbind);
        }
      }
    } catch {
      /*
       * The walk itself answered - with nothing - so the device is there
       * and the credentials work; a GET of the root that fails only means
       * the root is not an object. The walk is complete and empty.
       */
    }

    return data.outcome(SnmpWalkStopReason.Complete);
  }

  private static getBulk(
    session: SnmpOidWalkSession,
    oid: string,
    maxRepetitions: number,
  ): Promise<Array<snmp.Varbind>> {
    return new Promise(
      (
        resolve: (value: Array<snmp.Varbind>) => void,
        reject: (reason?: unknown) => void,
      ) => {
        try {
          session.getBulk(
            [oid],
            0,
            maxRepetitions,
            (
              error: Error | null,
              varbinds?: Array<snmp.Varbind | Array<snmp.Varbind>>,
            ) => {
              if (error) {
                reject(error);
                return;
              }

              /*
               * With no non-repeaters, net-snmp answers one list per
               * requested OID: the repetitions of the one OID asked for.
               */
              const first: snmp.Varbind | Array<snmp.Varbind> | undefined =
                varbinds?.[0];

              if (Array.isArray(first)) {
                resolve(first);
                return;
              }

              resolve(
                (varbinds || []).filter(
                  (
                    entry: snmp.Varbind | Array<snmp.Varbind>,
                  ): entry is snmp.Varbind => {
                    return !Array.isArray(entry);
                  },
                ),
              );
            },
          );
        } catch (dispatchError) {
          // A synchronous throw from a closed or broken session.
          reject(dispatchError);
        }
      },
    );
  }

  private static getNext(
    session: SnmpOidWalkSession,
    oid: string,
  ): Promise<Array<snmp.Varbind>> {
    return SnmpOidWalker.request((callback: SessionCallback) => {
      session.getNext([oid], callback);
    });
  }

  private static get(
    session: SnmpOidWalkSession,
    oid: string,
  ): Promise<Array<snmp.Varbind>> {
    return SnmpOidWalker.request((callback: SessionCallback) => {
      session.get([oid], callback);
    });
  }

  private static request(
    send: (callback: SessionCallback) => void,
  ): Promise<Array<snmp.Varbind>> {
    return new Promise(
      (
        resolve: (value: Array<snmp.Varbind>) => void,
        reject: (reason?: unknown) => void,
      ) => {
        try {
          send((error: Error | null, varbinds?: Array<snmp.Varbind>) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(varbinds || []);
          });
        } catch (dispatchError) {
          reject(dispatchError);
        }
      },
    );
  }
}

type SessionCallback = (
  error: Error | null,
  varbinds?: Array<snmp.Varbind>,
) => void;
