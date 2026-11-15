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

/*
 * Holds a probe scheduling request - /monitor/list, /monitor-test/list,
 * /probe/network-device/list - to the process's probe scheduling limit
 * (Common/Server/Utils/Probe/ProbeSchedulingLimiter, issue #7920): it runs
 * once a slot is free, keeps the slot until its answer has gone, and a
 * request the limiter refuses is answered busy here and never reaches the
 * handler, so it claims nothing - what it would have been handed stays due
 * for the next request.
 *
 * Busy is a 429 with Retry-After to a probe that declares
 * ProbeCapability.RetryWhenBusy, which reads it as "ask again at the next
 * tick". An older probe gets the endpoint's empty batch instead: it reads
 * that the same way without a word, where a 429 would reach its error log
 * every tick (its monitor and monitor test fetches parse any answer as a
 * list).
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
  // Whether the probe that sent `req` reads a 429 as "ask again later".
  public static probeRetriesWhenBusy(req: ExpressRequest): boolean {
    return ProbeCapabilityUtil.has(
      ProbeCapabilityUtil.parse(
        (req.body as { probeCapabilities?: unknown } | undefined)
          ?.probeCapabilities,
      ),
      ProbeCapability.RetryWhenBusy,
    );
  }

  // The busy answer for `req`: see the comment at the top.
  public static answerBusy(
    req: ExpressRequest,
    res: ExpressResponse,
    emptyAnswer: EmptySchedulingAnswer,
  ): void {
    if (ProbeSchedulingMiddleware.probeRetriesWhenBusy(req)) {
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
    limiter: ProbeSchedulingLimiter = ProbeSchedulingLimiterInstance,
  ): ProbeSchedulingMiddlewareFunction {
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
        });
      } catch (error) {
        if (error instanceof ProbeSchedulingAbandonedError) {
          // The probe hung up while it waited: there is nobody to answer.
          return;
        }

        if (error instanceof ProbeSchedulingBusyError) {
          return ProbeSchedulingMiddleware.answerBusy(req, res, emptyAnswer);
        }

        return next(error);
      }

      releaseWhenAnswered(res, release);
      return next();
    };
  }
}
