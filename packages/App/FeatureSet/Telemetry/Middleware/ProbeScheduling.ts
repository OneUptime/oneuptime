import { ProbeExpressRequest } from "../Types/Request";
import { KeyedConcurrencyRelease } from "Common/Server/Utils/KeyedConcurrencyLimiter";
import ProbeSchedulingLimiterInstance, {
  PROBE_SCHEDULING_BUSY_MESSAGE,
  PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS,
  PROBE_SCHEDULING_MAX_SLOT_HOLD_MS,
  ProbeSchedulingAbandonedError,
  ProbeSchedulingBusyError,
  ProbeSchedulingLimiter,
} from "Common/Server/Utils/Probe/ProbeSchedulingLimiter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability, {
  ProbeCapabilityUtil,
} from "Common/Types/Probe/ProbeCapability";
import ProbeSchedulingLane from "Common/Server/Utils/Probe/ProbeSchedulingLane";
import ProbeSchedulingReconnectInstance, {
  ProbeSchedulingReconnect,
} from "Common/Server/Utils/Probe/ProbeSchedulingReconnect";

/*
 * Holds a request a probe makes for work - /monitor/list, /monitor-test/list,
 * /probe/network-device/list (issue #7920), and the other work it asks for:
 * discovery scans, device diagnostics, packet captures, VMware and OpenStack
 * collections and checks, Data Security and Data Observability (issue #8051)
 * - to the process's probe scheduling limit
 * (Common/Server/Utils/Probe/ProbeSchedulingLimiter), in the lane the route
 * names: the work lane unless said, the monitor test lane for
 * /monitor-test/list (#10819). It runs once a slot of its lane is free,
 * keeps the slot until its answer has gone, and a request the limiter
 * refuses is answered busy here and never reaches the handler, so it claims
 * nothing - what it would have been handed stays due for the next request.
 *
 * A request whose probe has hung up already - it was authenticated after
 * the probe's own deadline, on a slow database or Valkey - takes no slot and
 * never reaches the handler either. Its "close" has been and gone, so
 * nothing would ever give a slot taken for it back: once every slot of a
 * process went that way, that process answered every probe busy, and handed
 * none of them a monitor, until it was restarted.
 *
 * Busy is a 429 with Retry-After to a probe whose fetch of the endpoint
 * reads it as "ask again at the next tick": one that declares the
 * endpoint's capability (ProbeCapability.RetryWhenBusy for the three
 * scheduling endpoints, RetryAllWorkWhenBusy for the rest). Any other probe
 * gets the endpoint's empty batch instead: it reads that the same way
 * without a word, where a 429 would reach its log every tick (its monitor
 * and monitor test fetches parse any answer as a list, and its other work
 * fetches log a refused request as a failure).
 *
 * While the lane has requests waiting for a slot here, the answer to a
 * request it ran asks its client to reconnect ("Connection: close", at
 * most one answer a lane every PROBE_SCHEDULING_RECONNECT_EVERY_MS): the
 * probe's or nginx's next request then opens a new connection, which
 * kube-proxy may send to a pod KEDA added for the probes, or to one less
 * busy (ProbeSchedulingReconnect, #11121). Kept alive, the probes'
 * connections stayed on the pods that were there when they were opened.
 */

// The endpoint's answer when it has nothing to hand out.
export type EmptySchedulingAnswer = (
  req: ExpressRequest,
  res: ExpressResponse,
) => void;

export type ProbeSchedulingMiddlewareFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

export interface ProbeSchedulingLimitOptions {
  /*
   * The capability of a probe whose fetch of this endpoint reads a 429 as
   * "ask again at the next tick": RetryWhenBusy unless said. A busy request
   * from such a probe is answered 429; every other probe gets the empty
   * answer. null: every probe gets the empty answer - an endpoint whose
   * empty answer still says something a 429 would lose.
   */
  retriesWhenBusy?: ProbeCapability | null | undefined;
  limiter?: ProbeSchedulingLimiter | undefined;
  // The limit's lane: the work lane unless said.
  lane?: ProbeSchedulingLane | undefined;
  /*
   * Longest a request keeps its slot with neither its answer gone nor its
   * probe hung up: PROBE_SCHEDULING_MAX_SLOT_HOLD_MS unless said.
   */
  maxSlotHoldMs?: number | undefined;
  // What says when an answer asks to reconnect: the process's unless said.
  reconnect?: ProbeSchedulingReconnect | undefined;
}

interface ResponseEvents {
  once?: (event: string, listener: () => void) => void;
  writableFinished?: boolean;
  // Node sets both just before the response's "close", and never clears them.
  destroyed?: boolean;
  closed?: boolean;
}

/*
 * Whether the probe hung up before its answer was complete, and the
 * response's "close" has been and gone: nothing more will ever be heard of
 * this response, so a listener added now never fires.
 */
export function hasProbeHungUp(res: ExpressResponse): boolean {
  const events: ResponseEvents = res as unknown as ResponseEvents;

  return Boolean(
    (events.destroyed === true || events.closed === true) &&
      !events.writableFinished,
  );
}

/*
 * Fires when the client hangs up before the answer is complete: a request
 * still waiting for a slot then gives its place up and never runs.
 */
function abandonedWhenClientLeaves(res: ExpressResponse): AbortSignal {
  const controller: AbortController = new AbortController();
  const events: ResponseEvents = res as unknown as ResponseEvents;

  if (typeof events.once === "function") {
    events.once("close", (): void => {
      if (!events.writableFinished) {
        controller.abort();
      }
    });
  }

  return controller.signal;
}

interface AnswerHeaders {
  writeHead?: (...args: Array<unknown>) => unknown;
  headersSent?: boolean;
}

/*
 * Runs `decide` just before the answer's headers are written, however the
 * handler sends it (res.send writes them through writeHead too), so what it
 * sets goes out with them. An answer whose headers have gone already, or a
 * bare object with nothing to write them (a unit test's), is left alone.
 */
export function beforeAnswerHeaders(
  res: ExpressResponse,
  decide: () => void,
): void {
  const response: AnswerHeaders = res as unknown as AnswerHeaders;
  const writeHead: ((...args: Array<unknown>) => unknown) | undefined =
    response.writeHead;

  if (typeof writeHead !== "function" || response.headersSent) {
    return;
  }

  response.writeHead = function (
    this: unknown,
    ...args: Array<unknown>
  ): unknown {
    response.writeHead = writeHead;

    try {
      decide();
    } catch (error) {
      // What it would have set is not worth the answer.
      logger.error(error);
    }

    return writeHead.apply(this, args);
  };
}

/*
 * Gives the slot back once the answer has gone, or the client has - or,
 * should both be missed, once it has been held `maxSlotHoldMs`
 * (PROBE_SCHEDULING_MAX_SLOT_HOLD_MS), saying so in the log.
 */
function releaseWhenAnswered(data: {
  req: ExpressRequest;
  res: ExpressResponse;
  release: KeyedConcurrencyRelease;
  probeId: string;
  maxSlotHoldMs: number;
}): void {
  const events: ResponseEvents = data.res as unknown as ResponseEvents;

  if (typeof events.once !== "function") {
    // Nothing to listen to (a unit test's bare object): do not keep it.
    data.release();
    return;
  }

  const takenAt: number = Date.now();

  const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
    logger.error(
      `Probe scheduling: a slot taken for ${data.req.originalUrl || data.req.url || "a request"} of probe ${data.probeId} was still held ${Date.now() - takenAt} ms later, with no answer sent and no hang-up seen. It is given back now; kept, it would be one slot fewer for every probe until this process restarts.`,
    );
    data.release();
  }, data.maxSlotHoldMs);

  // The timer must never keep the process up on its own.
  (timer as { unref?: () => void }).unref?.();

  const giveBack: () => void = (): void => {
    clearTimeout(timer);
    data.release();
  };

  events.once("finish", giveBack);
  events.once("close", giveBack);
}

export default class ProbeSchedulingMiddleware {
  /*
   * Whether the probe that sent `req` reads a 429 as "ask again later":
   * whether it declares `capability` (RetryWhenBusy unless said).
   */
  public static probeRetriesWhenBusy(
    req: ExpressRequest,
    capability: ProbeCapability = ProbeCapability.RetryWhenBusy,
  ): boolean {
    return ProbeCapabilityUtil.has(
      ProbeCapabilityUtil.parse(
        (req.body as { probeCapabilities?: unknown } | undefined)
          ?.probeCapabilities,
      ),
      capability,
    );
  }

  // The busy answer for `req`: see the comment at the top.
  public static answerBusy(
    req: ExpressRequest,
    res: ExpressResponse,
    emptyAnswer: EmptySchedulingAnswer,
    retriesWhenBusy: ProbeCapability | null = ProbeCapability.RetryWhenBusy,
  ): void {
    if (
      retriesWhenBusy !== null &&
      ProbeSchedulingMiddleware.probeRetriesWhenBusy(req, retriesWhenBusy)
    ) {
      res.setHeader(
        "Retry-After",
        String(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS),
      );
      res.status(429).send({ message: PROBE_SCHEDULING_BUSY_MESSAGE });
      return;
    }

    emptyAnswer(req, res);
  }

  public static limit(
    emptyAnswer: EmptySchedulingAnswer,
    options: ProbeSchedulingLimitOptions = {},
  ): ProbeSchedulingMiddlewareFunction {
    const limiter: ProbeSchedulingLimiter =
      options.limiter || ProbeSchedulingLimiterInstance;
    const retriesWhenBusy: ProbeCapability | null =
      options.retriesWhenBusy === undefined
        ? ProbeCapability.RetryWhenBusy
        : options.retriesWhenBusy;
    const maxSlotHoldMs: number =
      options.maxSlotHoldMs ?? PROBE_SCHEDULING_MAX_SLOT_HOLD_MS;
    const reconnect: ProbeSchedulingReconnect =
      options.reconnect || ProbeSchedulingReconnectInstance;
    const lane: ProbeSchedulingLane = options.lane || ProbeSchedulingLane.Work;

    return async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      const probeId: ObjectID | null | undefined = (req as ProbeExpressRequest)
        .probe?.id;

      // The handler answers a request with no probe, as it always has.
      if (!probeId) {
        return next();
      }

      /*
       * The probe hung up while its request was on its way here: there is
       * nobody to answer, and a slot taken now would never be given back
       * (see the comment at the top). Nothing is claimed: what it would
       * have been handed stays due for its next request.
       */
      if (hasProbeHungUp(res)) {
        return;
      }

      let release: KeyedConcurrencyRelease;

      try {
        release = await limiter.acquire(probeId.toString(), {
          signal: abandonedWhenClientLeaves(res),
          lane: options.lane,
        });
      } catch (error) {
        if (error instanceof ProbeSchedulingAbandonedError) {
          // The probe hung up while it waited: there is nobody to answer.
          return;
        }

        if (error instanceof ProbeSchedulingBusyError) {
          return ProbeSchedulingMiddleware.answerBusy(
            req,
            res,
            emptyAnswer,
            retriesWhenBusy,
          );
        }

        return next(error);
      }

      // Handed the slot as its probe hung up: give it straight back.
      if (hasProbeHungUp(res)) {
        release();
        return;
      }

      /*
       * Requests waiting behind this one as its answer goes: the answer
       * moves the probe's connection, so its next request may go to another
       * pod (see the comment at the top).
       */
      beforeAnswerHeaders(res, (): void => {
        if (
          reconnect.shouldAskToReconnect({
            lane: lane,
            waiting: limiter.waitingCount(undefined, lane),
          })
        ) {
          res.setHeader("Connection", "close");
        }
      });

      releaseWhenAnswered({
        req: req,
        res: res,
        release: release,
        probeId: probeId.toString(),
        maxSlotHoldMs: maxSlotHoldMs,
      });
      return next();
    };
  }
}
