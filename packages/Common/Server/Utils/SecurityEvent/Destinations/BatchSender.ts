import { JSONObject } from "../../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";
import { redactLogString } from "../../LogRedaction";
import { SecurityEventSendError, SecurityEventSendResult } from "./Types";

/*
 * What every SIEM sender but Google SecOps's shares: the transport, and the
 * batching that reads each answer for what to do next.
 *
 * The transport is DataSourceHttpFetch - a SIEM's address is a person's
 * choice, so the egress guard checks and pins it, no redirect is followed
 * and the answer is capped - injectable so tests drive a fake SIEM.
 *
 * A batch is sent, and its answer decides:
 *
 *   - accepted: every event in it is sent (less the ones the SIEM refused
 *     one by one, when it says which);
 *   - rate limited (429), timed out (408), a server error (5xx), or no
 *     answer at all: tried again after a pause, three times in all, and
 *     then the send stops, to go on from the same event on the next run;
 *   - refused as invalid (400) or too large (413), when the SIEM takes a
 *     batch all or nothing: split in two and each half sent, down to one
 *     event, which is then left out - one event the SIEM will not take
 *     never holds back the others;
 *   - anything else (credentials, permission, a destination that is not
 *     there): nothing more can be sent; the send stops with what to fix.
 */

export type DestinationTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export const defaultDestinationTransport: DestinationTransport = (
  request: DataSourceHttpRequest,
): Promise<DataSourceHttpResponse> => {
  return DataSourceHttpFetch.fetch(request);
};

export type SleepFunction = (delayInMs: number) => Promise<void>;

export const defaultSleep: SleepFunction = (
  delayInMs: number,
): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, delayInMs);
  });
};

export const DESTINATION_SEND_ATTEMPTS: number = 3;
export const DESTINATION_RETRY_DELAYS_IN_MS: ReadonlyArray<number> = [
  1000, 4000,
];
export const DESTINATION_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;

// What a SIEM answered one request with.
export interface DestinationAnswer {
  ok: boolean;
  // The HTTP status; 0 when the request got no answer.
  status: number;
  bodyText: string;
  bodyJson: unknown;
}

const HTTP_ERROR_PREFIX: string = "Data source responded with HTTP ";
const MAX_ERROR_TEXT_LENGTH: number = 300;

/*
 * The transport throws on an answer that is not 2xx, as
 * "Data source responded with HTTP 400: <body>"; that is an answer, with
 * its status and body. Anything else it throws is no answer at all.
 */
export function readTransportError(error: unknown): DestinationAnswer | null {
  const message: string = error instanceof Error ? error.message : "";

  if (!message.startsWith(HTTP_ERROR_PREFIX)) {
    return null;
  }

  const rest: string = message.slice(HTTP_ERROR_PREFIX.length);
  const status: number = Number(rest.slice(0, 3));

  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return null;
  }

  let bodyText: string = rest.slice(3);

  if (bodyText.startsWith(":")) {
    bodyText = bodyText.slice(1).trimStart();
  }

  let bodyJson: unknown = undefined;

  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = undefined;
  }

  return { ok: false, status, bodyText, bodyJson };
}

// What a SIEM said, short and with anything secret-looking taken out, for a person to read.
export function describeAnswerBody(answer: DestinationAnswer): string {
  const text: string = redactLogString(answer.bodyText || "").trim();

  if (!text) {
    return "";
  }

  return text.length > MAX_ERROR_TEXT_LENGTH
    ? `${text.slice(0, MAX_ERROR_TEXT_LENGTH)}…`
    : text;
}

// One request, as an answer; throws only when there is none.
export async function requestAnswer(
  transport: DestinationTransport,
  request: DataSourceHttpRequest,
): Promise<DestinationAnswer> {
  try {
    const response: DataSourceHttpResponse = await transport(request);

    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      bodyText: response.bodyText || "",
      bodyJson: response.bodyJson,
    };
  } catch (error) {
    const answer: DestinationAnswer | null = readTransportError(error);

    if (answer) {
      return answer;
    }

    throw error;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/*
 * How one batch went, as a sender reads its answer: all of it sent, some
 * of it refused event by event (and some to try again), or not at all.
 */
export interface BatchOutcome {
  answer: DestinationAnswer;
  /*
   * For an answer that accepted the batch: the positions in it the SIEM
   * refused one by one, and the reason for the first; and the positions
   * it asks to have sent again (Elasticsearch's per-document 429).
   */
  rejected?: Array<number> | undefined;
  rejectionReason?: string | undefined;
  retry?: Array<number> | undefined;
  /*
   * For an answer that refused the batch: how many events from its start
   * the SIEM took before the one it refused (Splunk's invalid-event-number),
   * when it says.
   */
  acceptedBeforeRefusal?: number | undefined;
}

export interface BatchSendPlan<T> {
  items: Array<T>;
  sizeOf: (item: T) => number;
  maxItems: number;
  maxBytes: number;
  post: (batch: Array<T>) => Promise<BatchOutcome>;
  // Whether a refused batch is split and its halves sent.
  isSplittable: (outcome: BatchOutcome) => boolean;
  // What a person must fix, from an answer that stops the send.
  describeFailure: (answer: DestinationAnswer) => string;
  // The send stopped because the SIEM could not be reached.
  describeUnreachable: (error: unknown) => string;
  sleep?: SleepFunction | undefined;
}

/*
 * Groups items into the batches one request carries: at most maxItems of
 * them, and at most maxBytes (an item bigger on its own still goes, alone).
 */
export function toBatches<T>(
  items: Array<T>,
  sizeOf: (item: T) => number,
  maxItems: number,
  maxBytes: number,
): Array<Array<T>> {
  const batches: Array<Array<T>> = [];
  let current: Array<T> = [];
  let currentBytes: number = 0;

  for (const item of items) {
    const size: number = sizeOf(item);

    if (
      current.length > 0 &&
      (current.length >= maxItems || currentBytes + size > maxBytes)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(item);
    currentBytes += size;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

export function emptySendResult(): SecurityEventSendResult {
  return {
    processed: 0,
    sent: 0,
    rejected: 0,
    rejectionReason: "",
    requests: 0,
    failure: "",
    failureStatus: null,
  };
}

class BatchSender<T> {
  private readonly plan: BatchSendPlan<T>;
  private readonly sleep: SleepFunction;
  public readonly result: SecurityEventSendResult = emptySendResult();

  public constructor(plan: BatchSendPlan<T>) {
    this.plan = plan;
    this.sleep = plan.sleep || defaultSleep;
  }

  public async run(): Promise<SecurityEventSendResult> {
    if (this.plan.items.length === 0) {
      return this.result;
    }

    const batches: Array<Array<T>> = toBatches(
      this.plan.items,
      this.plan.sizeOf,
      this.plan.maxItems,
      this.plan.maxBytes,
    );

    try {
      for (const batch of batches) {
        await this.sendBatch(batch);
      }
    } catch (error) {
      if (!(error instanceof SecurityEventSendError)) {
        throw error;
      }

      this.result.failure = error.message;
      this.result.failureStatus = error.status;
    }

    return this.result;
  }

  private reject(count: number, reason: string): void {
    this.result.rejected += count;
    this.result.processed += count;

    if (!this.result.rejectionReason && reason) {
      this.result.rejectionReason = reason;
    }
  }

  private async sendBatch(batch: Array<T>): Promise<void> {
    const outcome: BatchOutcome = await this.postWithRetries(batch);

    if (outcome.answer.ok) {
      await this.settleAccepted(batch, outcome);
      return;
    }

    if (!this.plan.isSplittable(outcome)) {
      throw new SecurityEventSendError(
        this.plan.describeFailure(outcome.answer),
        outcome.answer.status,
      );
    }

    // The SIEM took the events before the one it refused: the rest go again.
    const accepted: number | undefined = outcome.acceptedBeforeRefusal;

    if (accepted !== undefined && accepted >= 0 && accepted < batch.length) {
      this.result.sent += accepted;
      this.result.processed += accepted;
      this.reject(1, this.plan.describeFailure(outcome.answer));

      const rest: Array<T> = batch.slice(accepted + 1);

      if (rest.length > 0) {
        await this.sendBatch(rest);
      }

      return;
    }

    if (batch.length > 1) {
      const middle: number = Math.ceil(batch.length / 2);

      await this.sendBatch(batch.slice(0, middle));
      await this.sendBatch(batch.slice(middle));
      return;
    }

    this.reject(1, this.plan.describeFailure(outcome.answer));
  }

  /*
   * An accepted batch: what the SIEM refused event by event is left out,
   * and what it asks to have again is sent again, a few times, before the
   * send stops there.
   */
  private async settleAccepted(
    batch: Array<T>,
    outcome: BatchOutcome,
    attempt: number = 1,
  ): Promise<void> {
    const rejected: Set<number> = new Set<number>(outcome.rejected || []);
    const retry: Set<number> = new Set<number>(
      (outcome.retry || []).filter((index: number): boolean => {
        return !rejected.has(index);
      }),
    );

    if (retry.size === 0) {
      this.result.sent += batch.length - rejected.size;
      this.result.processed += batch.length - rejected.size;

      if (rejected.size > 0) {
        this.reject(rejected.size, outcome.rejectionReason || "");
      }

      return;
    }

    if (attempt >= DESTINATION_SEND_ATTEMPTS) {
      /*
       * The events before the first one still waiting were dealt with; the
       * next run goes on from it (a SIEM that is sent one again keeps one).
       */
      const firstWaiting: number = Math.min(...Array.from(retry));

      let before: number = 0;
      let refusedBefore: number = 0;

      for (let index: number = 0; index < firstWaiting; index++) {
        if (rejected.has(index)) {
          refusedBefore++;
        } else if (!retry.has(index)) {
          before++;
        }
      }

      this.result.sent += before;
      this.result.processed += before;

      if (refusedBefore > 0) {
        this.reject(refusedBefore, outcome.rejectionReason || "");
      }

      throw new SecurityEventSendError(
        this.plan.describeFailure({
          ...outcome.answer,
          ok: false,
          status: 429,
        }),
        429,
      );
    }

    await this.sleep(
      DESTINATION_RETRY_DELAYS_IN_MS[attempt - 1] ||
        DESTINATION_RETRY_DELAYS_IN_MS[
          DESTINATION_RETRY_DELAYS_IN_MS.length - 1
        ]!,
    );

    const again: Array<number> = Array.from(retry).sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );
    const second: BatchOutcome = await this.postWithRetries(
      again.map((index: number): T => {
        return batch[index]!;
      }),
    );

    if (!second.answer.ok) {
      throw new SecurityEventSendError(
        this.plan.describeFailure(second.answer),
        second.answer.status,
      );
    }

    // The first answer's settled events, then the second's, by their place in the batch.
    const merged: BatchOutcome = {
      answer: outcome.answer,
      rejected: [
        ...Array.from(rejected),
        ...(second.rejected || []).map((index: number): number => {
          return again[index]!;
        }),
      ],
      rejectionReason: outcome.rejectionReason || second.rejectionReason,
      retry: (second.retry || []).map((index: number): number => {
        return again[index]!;
      }),
    };

    await this.settleAccepted(batch, merged, attempt + 1);
  }

  private async postWithRetries(batch: Array<T>): Promise<BatchOutcome> {
    let lastOutcome: BatchOutcome | null = null;
    let lastError: unknown = null;

    for (
      let attempt: number = 1;
      attempt <= DESTINATION_SEND_ATTEMPTS;
      attempt++
    ) {
      this.result.requests += 1;

      try {
        const outcome: BatchOutcome = await this.plan.post(batch);

        if (outcome.answer.ok || !isRetryableStatus(outcome.answer.status)) {
          return outcome;
        }

        lastOutcome = outcome;
        lastError = null;
      } catch (error) {
        if (error instanceof SecurityEventSendError) {
          throw error;
        }

        // No answer at all: a timeout, a refused connection, a bad token exchange.
        lastError = error;
        lastOutcome = null;
      }

      if (attempt < DESTINATION_SEND_ATTEMPTS) {
        await this.sleep(
          DESTINATION_RETRY_DELAYS_IN_MS[attempt - 1] ||
            DESTINATION_RETRY_DELAYS_IN_MS[
              DESTINATION_RETRY_DELAYS_IN_MS.length - 1
            ]!,
        );
      }
    }

    if (lastOutcome) {
      throw new SecurityEventSendError(
        this.plan.describeFailure(lastOutcome.answer),
        lastOutcome.answer.status,
      );
    }

    throw new SecurityEventSendError(this.plan.describeUnreachable(lastError));
  }
}

export async function sendInBatches<T>(
  plan: BatchSendPlan<T>,
): Promise<SecurityEventSendResult> {
  return new BatchSender<T>(plan).run();
}

// A JSON object answer's string field, or "".
export function readAnswerString(
  answer: DestinationAnswer,
  key: string,
): string {
  const json: unknown = answer.bodyJson;

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return "";
  }

  const value: unknown = (json as JSONObject)[key];

  return typeof value === "string" ? value : "";
}

// A JSON object answer's number field, or null.
export function readAnswerNumber(
  answer: DestinationAnswer,
  key: string,
): number | null {
  const json: unknown = answer.bodyJson;

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }

  const value: unknown = (json as JSONObject)[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
