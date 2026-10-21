import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  SecurityEventDestinationDefinition,
  getSecurityEventDestinationDefinition,
} from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import {
  UdmEventType,
  toUdmEvent,
} from "../../../../../Utils/SecurityEvent/Destinations/GoogleSecOpsUdmMapper";
import { SecurityEventRecord } from "../../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import GoogleSecOpsClient, {
  FetchLike,
  GoogleSecOpsImportResult,
} from "../../Connectors/GoogleSecOps/GoogleSecOpsClient";
import {
  SecurityEventDestinationSettings,
  SecurityEventSendError,
  SecurityEventSendResult,
  SecurityEventSender,
} from "../Types";

/*
 * Sends OneUptime's security events to Google SecOps as UDM events through
 * the Chronicle API's events:import (GoogleSecOpsClient.importUdmEvents).
 *
 * Events go in batches of at most a hundred, and never more bytes than one
 * request takes. Every answer is read for what to do next:
 *
 *   - accepted: the batch is sent;
 *   - rate limited (429) or a server error (5xx), or no answer: the batch
 *     is tried again after a pause, three times in all, and then the send
 *     stops, to be tried again on the next run;
 *   - refused as invalid (400) or too large (413): the batch is split in
 *     two and each half sent, down to one event; one event SecOps still
 *     refuses is sent once more as a GENERIC_EVENT, which needs no fields,
 *     and left out if even that is refused - so one event SecOps will not
 *     take never holds back the others;
 *   - refused credentials (401), permission (403) or an instance that does
 *     not exist (404): nothing more can be sent; the send stops with what
 *     to fix.
 */

export const GOOGLE_SECOPS_SEND_ATTEMPTS: number = 3;
export const GOOGLE_SECOPS_RETRY_DELAYS_IN_MS: ReadonlyArray<number> = [
  1000, 4000,
];

export type SleepFunction = (delayInMs: number) => Promise<void>;

const defaultSleep: SleepFunction = (delayInMs: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, delayInMs);
  });
};

function readSetting(values: JSONObject, key: string): string {
  const value: JSONValue | undefined = values[key];

  return typeof value === "string" ? value.trim() : "";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

function isSplittableStatus(status: number): boolean {
  return status === 400 || status === 413;
}

// What a person must fix when SecOps refuses everything this destination sends.
export function describeGoogleSecOpsSendFailure(
  result: Pick<
    GoogleSecOpsImportResult,
    "status" | "errorReason" | "errorText"
  >,
): string {
  const detail: string = result.errorText ? ` ${result.errorText}` : "";

  if (result.status === 401) {
    return `Google SecOps refused the service account's token (HTTP 401). The key may be revoked, or this server's clock may be wrong.${detail}`;
  }

  if (result.status === 403 || result.errorReason === "IAM_PERMISSION_DENIED") {
    return `The service account cannot import events into this Google SecOps instance (HTTP ${result.status}). Grant it chronicle.events.import, for example with the Chronicle API Editor role, and check the instance resource name.${detail}`;
  }

  if (result.status === 404) {
    return `Google SecOps did not find the instance (HTTP 404). Check the region and the instance resource name.${detail}`;
  }

  if (result.status === 429) {
    return `Google SecOps is rate limiting this service account (HTTP 429). OneUptime tries again on the next run.${detail}`;
  }

  return `Google SecOps did not accept the events (HTTP ${result.status}).${detail}`;
}

export default class GoogleSecOpsSender implements SecurityEventSender {
  private readonly fetchImplementation: FetchLike | undefined;
  private readonly sleep: SleepFunction;

  public constructor(
    options: {
      fetchImplementation?: FetchLike | undefined;
      sleep?: SleepFunction | undefined;
    } = {},
  ) {
    this.fetchImplementation = options.fetchImplementation;
    this.sleep = options.sleep || defaultSleep;
  }

  private getDefinition(): SecurityEventDestinationDefinition {
    return getSecurityEventDestinationDefinition(
      SecurityEventDestinationProvider.GoogleSecOps,
    )!;
  }

  public validateSettings(settings: SecurityEventDestinationSettings): void {
    const region: string = readSetting(settings.config, "region");
    const instanceResourceName: string = readSetting(
      settings.config,
      "instanceResourceName",
    );

    GoogleSecOpsClient.validateRegion(region);
    GoogleSecOpsClient.validateInstanceResourceName(instanceResourceName);
    GoogleSecOpsClient.validateRegionMatchesInstance(
      region,
      instanceResourceName,
    );
    GoogleSecOpsClient.parseServiceAccountJson(
      readSetting(settings.secrets, "serviceAccountJson"),
    );
  }

  public createClient(
    settings: SecurityEventDestinationSettings,
  ): GoogleSecOpsClient {
    this.validateSettings(settings);

    return new GoogleSecOpsClient({
      region: readSetting(settings.config, "region"),
      instanceResourceName: readSetting(
        settings.config,
        "instanceResourceName",
      ),
      serviceAccountJson: readSetting(settings.secrets, "serviceAccountJson"),
      fetchImplementation: this.fetchImplementation,
    });
  }

  /*
   * Groups UDM events into the batches one request carries: at most
   * maxEventsPerRequest of them, and at most maxBytesPerRequest of JSON
   * (an event that is bigger on its own still goes, alone).
   */
  public static toBatches<T>(
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

  public async send(data: {
    settings: SecurityEventDestinationSettings;
    events: Array<SecurityEventRecord>;
  }): Promise<SecurityEventSendResult> {
    const result: SecurityEventSendResult = {
      processed: 0,
      sent: 0,
      rejected: 0,
      rejectionReason: "",
      requests: 0,
      failure: "",
      failureStatus: null,
    };

    if (data.events.length === 0) {
      return result;
    }

    const definition: SecurityEventDestinationDefinition = this.getDefinition();
    const client: GoogleSecOpsClient = this.createClient(data.settings);

    const batches: Array<Array<SecurityEventRecord>> =
      GoogleSecOpsSender.toBatches(
        data.events,
        (record: SecurityEventRecord): number => {
          return JSON.stringify(toUdmEvent(record)).length;
        },
        definition.maxEventsPerRequest,
        definition.maxBytesPerRequest,
      );

    try {
      for (const batch of batches) {
        await this.sendBatch({ client, batch, result });
      }
    } catch (error) {
      if (!(error instanceof SecurityEventSendError)) {
        throw error;
      }

      result.failure = error.message;
      result.failureStatus = error.status;
    }

    return result;
  }

  // One batch, split on refusal; throws SecurityEventSendError to stop.
  private async sendBatch(data: {
    client: GoogleSecOpsClient;
    batch: Array<SecurityEventRecord>;
    result: SecurityEventSendResult;
    asGenericEvents?: boolean | undefined;
  }): Promise<void> {
    const answer: GoogleSecOpsImportResult = await this.importWithRetries({
      client: data.client,
      events: data.batch.map((record: SecurityEventRecord): JSONObject => {
        return data.asGenericEvents
          ? toUdmEvent(record, UdmEventType.GenericEvent)
          : toUdmEvent(record);
      }),
      result: data.result,
    });

    if (answer.ok) {
      data.result.sent += data.batch.length;
      data.result.processed += data.batch.length;
      return;
    }

    if (!isSplittableStatus(answer.status)) {
      throw new SecurityEventSendError(
        describeGoogleSecOpsSendFailure(answer),
        answer.status,
      );
    }

    if (data.batch.length > 1) {
      const middle: number = Math.ceil(data.batch.length / 2);

      await this.sendBatch({
        ...data,
        batch: data.batch.slice(0, middle),
      });
      await this.sendBatch({
        ...data,
        batch: data.batch.slice(middle),
      });
      return;
    }

    // One event SecOps refused: once more as a GENERIC_EVENT, then left out.
    if (!data.asGenericEvents) {
      await this.sendBatch({ ...data, asGenericEvents: true });
      return;
    }

    data.result.rejected += 1;
    data.result.processed += 1;

    if (!data.result.rejectionReason) {
      data.result.rejectionReason = describeGoogleSecOpsSendFailure(answer);
    }
  }

  private async importWithRetries(data: {
    client: GoogleSecOpsClient;
    events: Array<JSONObject>;
    result: SecurityEventSendResult;
  }): Promise<GoogleSecOpsImportResult> {
    let lastAnswer: GoogleSecOpsImportResult | null = null;
    let lastError: unknown = null;

    for (
      let attempt: number = 1;
      attempt <= GOOGLE_SECOPS_SEND_ATTEMPTS;
      attempt++
    ) {
      data.result.requests += 1;

      try {
        const answer: GoogleSecOpsImportResult =
          await data.client.importUdmEvents(data.events);

        if (answer.ok || !isRetryableStatus(answer.status)) {
          return answer;
        }

        lastAnswer = answer;
        lastError = null;
      } catch (error) {
        // No answer at all: a timeout, a refused connection, a bad token exchange.
        lastError = error;
        lastAnswer = null;
      }

      if (attempt < GOOGLE_SECOPS_SEND_ATTEMPTS) {
        await this.sleep(
          GOOGLE_SECOPS_RETRY_DELAYS_IN_MS[attempt - 1] ||
            GOOGLE_SECOPS_RETRY_DELAYS_IN_MS[
              GOOGLE_SECOPS_RETRY_DELAYS_IN_MS.length - 1
            ]!,
        );
      }
    }

    if (lastAnswer) {
      throw new SecurityEventSendError(
        describeGoogleSecOpsSendFailure(lastAnswer),
        lastAnswer.status,
      );
    }

    throw new SecurityEventSendError(
      `Could not reach Google SecOps: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  public async sendTestEvent(
    settings: SecurityEventDestinationSettings,
  ): Promise<void> {
    const client: GoogleSecOpsClient = this.createClient(settings);
    const now: Date = new Date();

    const testEvent: JSONObject = toUdmEvent(
      {
        id: "",
        time: now,
        createdAt: now,
        eventUid: `oneuptime-test-${now.getTime()}`,
        categoryUid: 0,
        categoryName: "",
        classUid: 0,
        className: "Connection test",
        activityName: "",
        severityId: 1,
        severityName: "Informational",
        statusName: "",
        message:
          "OneUptime connection test: this destination can send security events to Google SecOps.",
        vendorName: "OneUptime",
        productName: "OneUptime Security Events",
        ruleId: "",
        ruleName: "",
        mitreTactics: [],
        mitreTechniques: [],
        principalUser: "",
        principalHost: "",
        principalIp: "",
        principalProcess: "",
        processName: "",
        processPath: "",
        processCommandLine: "",
        parentProcessName: "",
        parentProcessPath: "",
        parentProcessCommandLine: "",
        targetUser: "",
        targetHost: "",
        targetIp: "",
        targetPort: 0,
        targetResource: "",
        observables: [],
        attributes: {},
      },
      UdmEventType.GenericEvent,
    );

    const answer: GoogleSecOpsImportResult = await client.importUdmEvents([
      testEvent,
    ]);

    if (!answer.ok) {
      throw new BadDataException(describeGoogleSecOpsSendFailure(answer));
    }
  }
}
