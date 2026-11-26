import { ProbeExpressRequest } from "../Types/Request";
import { KeyedConcurrencyRelease } from "Common/Server/Utils/KeyedConcurrencyLimiter";
import ProbeSchedulingLimiterInstance, {
  PROBE_SCHEDULING_BUSY_MESSAGE,
  PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS,
  ProbeSchedulingAbandonedError,
  ProbeSchedulingBusyError,
  ProbeSchedulingLimiter,
} from "Common/Server/Utils/Probe/ProbeSchedulingLimiter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability, {
  ProbeCapabilityUtil,
} from "Common/Types/Probe/ProbeCapability";
import ProbeSchedulingLane from "Common/Server/Utils/Probe/ProbeSchedulingLane";

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
 * Busy is a 429 with Retry-After to a probe whose fetch of the endpoint
 * reads it as "ask again at the next tick": one that declares the
 * endpoint's capability (ProbeCapability.RetryWhenBusy for the three
 * scheduling endpoints, RetryAllWorkWhenBusy for the rest). Any other probe
 * gets the endpoint's empty batch instead: it reads that the same way
 * without a word, where a 429 would reach its log every tick (its monitor
 * and monitor test fetches parse any answer as a list, and its other work
 * fetches log a refused request as a failure).
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
}

interface ResponseEvents {
  once?: (event: string, listener: () => void) => void;
  writableFinished?: boolean;
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

// Gives the slot back once the answer has gone, or the client has.
function releaseWhenAnswered(
  res: ExpressResponse,
  release: KeyedConcurrencyRelease,
): void {
  const events: ResponseEvents = res as unknown as ResponseEvents;

  if (typeof events.once !== "function") {
    // Nothing to listen to (a unit test's bare object): do not keep it.
    release();
    return;
  }

  events.once("finish", release);
  events.once("close", release);
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

      releaseWhenAnswered(res, release);
      return next();
    };
  }
}
