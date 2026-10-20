import { describe, expect, test } from "@jest/globals";
import GoogleSecOpsClient, {
  GoogleSecOpsImportResult,
} from "../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsSender, {
  GOOGLE_SECOPS_RETRY_DELAYS_IN_MS,
  GOOGLE_SECOPS_SEND_ATTEMPTS,
  describeGoogleSecOpsSendFailure,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/GoogleSecOps/GoogleSecOpsSender";
import SecurityEventDestinationRegistry from "../../../../../Server/Utils/SecurityEvent/Destinations/SecurityEventDestinationRegistry";
import { SecurityEventSendResult } from "../../../../../Server/Utils/SecurityEvent/Destinations/Types";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import { SecurityEventRecord } from "../../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import {
  DETECTION_FINDING,
  SSH_FAILURE,
  securityEventRecord,
} from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecordFixtures";
import {
  DESTINATION_SETTINGS,
  FakeSecOps,
  IMPORT_URL,
  INSTANCE,
  REGION,
  SERVICE_ACCOUNT_JSON,
  fakeSecOps,
  googleError,
} from "./GoogleSecOpsFakeEndpoint";

function records(count: number): Array<SecurityEventRecord> {
  const list: Array<SecurityEventRecord> = [];

  for (let index: number = 0; index < count; index++) {
    list.push(
      securityEventRecord({
        id: `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`,
        eventUid: `evt-${index}`,
        message: `event ${index}`,
      }),
    );
  }

  return list;
}

function sender(
  fake: FakeSecOps,
  sleeps: Array<number> = [],
): GoogleSecOpsSender {
  return new GoogleSecOpsSender({
    fetchImplementation: fake.fetchImplementation,
    sleep: async (delayInMs: number): Promise<void> => {
      sleeps.push(delayInMs);
    },
  });
}

function eventUidsOf(fake: FakeSecOps): Array<string> {
  return fake.imports.flatMap((request: { events: Array<JSONObject> }) => {
    return request.events.map((event: JSONObject): string => {
      return String((event["metadata"] as JSONObject)["productLogId"]);
    });
  });
}

/*
 * The Chronicle API's events:import, as GoogleSecOpsClient calls it: the
 * request OneUptime sends and how it reads the answer.
 */
describe("GoogleSecOpsClient.importUdmEvents", () => {
  test("posts the UDM events under inlineSource.events[].udm with a fresh bearer token", async () => {
    const fake: FakeSecOps = fakeSecOps();
    const client: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: REGION,
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation: fake.fetchImplementation,
    });

    const answer: GoogleSecOpsImportResult = await client.importUdmEvents([
      { metadata: { eventType: "GENERIC_EVENT" } },
      { metadata: { eventType: "USER_LOGIN" } },
    ]);

    expect(answer).toEqual({
      ok: true,
      status: 200,
      errorText: "",
      errorReason: "",
    });
    expect(fake.tokenRequests).toBe(1);
    expect(fake.imports).toHaveLength(1);
    expect(fake.imports[0]!.url).toBe(IMPORT_URL);
    expect(fake.imports[0]!.authorization).toBe("Bearer token-1");
    expect(fake.imports[0]!.body).toEqual({
      inlineSource: {
        events: [
          { udm: { metadata: { eventType: "GENERIC_EVENT" } } },
          { udm: { metadata: { eventType: "USER_LOGIN" } } },
        ],
      },
    });
  });

  test("a refused token is minted again once, and the import tried again", async () => {
    const fake: FakeSecOps = fakeSecOps(
      (_events: Array<JSONObject>, callIndex: number) => {
        return callIndex === 0 ? { status: 401, body: "" } : { status: 200 };
      },
    );
    const client: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: REGION,
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation: fake.fetchImplementation,
    });

    const answer: GoogleSecOpsImportResult = await client.importUdmEvents([{}]);

    expect(answer.ok).toBe(true);
    expect(fake.tokenRequests).toBe(2);
    expect(
      fake.imports.map((request: { authorization: string }) => {
        return request.authorization;
      }),
    ).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  test("a refusal comes back with Google's reason, not as a throw", async () => {
    const fake: FakeSecOps = fakeSecOps(() => {
      return {
        status: 403,
        body: googleError(403, "Permission denied", "IAM_PERMISSION_DENIED"),
      };
    });
    const client: GoogleSecOpsClient = new GoogleSecOpsClient({
      region: REGION,
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation: fake.fetchImplementation,
    });

    const answer: GoogleSecOpsImportResult = await client.importUdmEvents([{}]);

    expect(answer.ok).toBe(false);
    expect(answer.status).toBe(403);
    expect(answer.errorReason).toBe("IAM_PERMISSION_DENIED");
    expect(answer.errorText).toContain("Permission denied");
  });
});

describe("GoogleSecOpsSender", () => {
  test("is the sender the registry hands out for Google SecOps", () => {
    expect(
      SecurityEventDestinationRegistry.getSender(
        SecurityEventDestinationProvider.GoogleSecOps,
      ),
    ).toBeInstanceOf(GoogleSecOpsSender);
    expect(() => {
      return SecurityEventDestinationRegistry.getSender("splunk");
    }).toThrow(BadDataException);
  });

  test("sends every event once, in order, a hundred to a request", async () => {
    const fake: FakeSecOps = fakeSecOps();
    const result: SecurityEventSendResult = await sender(fake).send({
      settings: DESTINATION_SETTINGS,
      events: records(250),
    });

    expect(result).toEqual({
      processed: 250,
      sent: 250,
      rejected: 0,
      rejectionReason: "",
      requests: 3,
      failure: "",
      failureStatus: null,
    });
    expect(
      fake.imports.map((request: { events: Array<JSONObject> }) => {
        return request.events.length;
      }),
    ).toEqual([100, 100, 50]);
    expect(eventUidsOf(fake)).toEqual(
      records(250).map((record: SecurityEventRecord): string => {
        return record.eventUid;
      }),
    );
    // One token serves every request.
    expect(fake.tokenRequests).toBe(1);
  });

  test("large events go in smaller batches, so no request passes the size limit", async () => {
    const fake: FakeSecOps = fakeSecOps();
    const big: Array<SecurityEventRecord> = records(12).map(
      (record: SecurityEventRecord): SecurityEventRecord => {
        return {
          ...record,
          attributes: Object.fromEntries(
            Array.from({ length: 39 }, (_value: unknown, index: number) => {
              return [`k${index}`, "x".repeat(510)];
            }),
          ),
          message: "m".repeat(1000),
        };
      },
    );

    await sender(fake).send({ settings: DESTINATION_SETTINGS, events: big });

    for (const request of fake.imports) {
      expect(JSON.stringify(request.body).length).toBeLessThan(
        900 * 1024 + 2048,
      );
    }

    expect(
      fake.imports.reduce(
        (total: number, request: { events: Array<JSONObject> }) => {
          return total + request.events.length;
        },
        0,
      ),
    ).toBe(12);
  });

  test("nothing to send makes no request", async () => {
    const fake: FakeSecOps = fakeSecOps();
    const result: SecurityEventSendResult = await sender(fake).send({
      settings: DESTINATION_SETTINGS,
      events: [],
    });

    expect(result.sent).toBe(0);
    expect(fake.imports).toHaveLength(0);
    expect(fake.tokenRequests).toBe(0);
  });

  test("a server error is tried again after a pause, and sent when it recovers", async () => {
    const sleeps: Array<number> = [];
    const fake: FakeSecOps = fakeSecOps(
      (_events: Array<JSONObject>, callIndex: number) => {
        return callIndex < 2 ? { status: 503 } : { status: 200 };
      },
    );

    const result: SecurityEventSendResult = await sender(fake, sleeps).send({
      settings: DESTINATION_SETTINGS,
      events: records(3),
    });

    expect(result.sent).toBe(3);
    expect(result.requests).toBe(3);
    expect(result.failure).toBe("");
    expect(sleeps).toEqual([...GOOGLE_SECOPS_RETRY_DELAYS_IN_MS]);
  });

  test("rate limiting and no answer at all are tried again too", async () => {
    const answers: Array<{ status: number; throws?: boolean }> = [
      { status: 429 },
      { status: 0, throws: true },
      { status: 200 },
    ];
    const fake: FakeSecOps = fakeSecOps(
      (_events: Array<JSONObject>, callIndex: number) => {
        return answers[callIndex]!;
      },
    );

    const result: SecurityEventSendResult = await sender(fake).send({
      settings: DESTINATION_SETTINGS,
      events: records(1),
    });

    expect(result.sent).toBe(1);
    expect(fake.imports).toHaveLength(3);
  });

  test("a SIEM that keeps failing stops the send, saying how far it got", async () => {
    // The first batch goes through; the second never does.
    const fake: FakeSecOps = fakeSecOps(
      (_events: Array<JSONObject>, callIndex: number) => {
        return callIndex === 0 ? { status: 200 } : { status: 500 };
      },
    );

    const result: SecurityEventSendResult = await sender(fake).send({
      settings: DESTINATION_SETTINGS,
      events: records(150),
    });

    expect(result.processed).toBe(100);
    expect(result.sent).toBe(100);
    expect(result.failureStatus).toBe(500);
    expect(result.failure).toContain("did not accept the events (HTTP 500)");
    expect(fake.imports).toHaveLength(1 + GOOGLE_SECOPS_SEND_ATTEMPTS);
  });

  test("a SIEM that cannot be reached stops the send with why", async () => {
    const fake: FakeSecOps = fakeSecOps(() => {
      return { status: 0, throws: true };
    });

    const result: SecurityEventSendResult = await sender(fake).send({
      settings: DESTINATION_SETTINGS,
      events: records(2),
    });

    expect(result.processed).toBe(0);
    expect(result.failure).toContain("Could not reach Google SecOps");
    expect(result.failure).toContain("ECONNREFUSED");
    expect(result.failureStatus).toBeNull();
  });

  test.each<[number, string, string]>([
    [403, "IAM_PERMISSION_DENIED", "chronicle.events.import"],
    [404, "", "Check the region and the instance resource name"],
    [401, "", "refused the service account's token"],
  ])(
    "HTTP %s stops at once - retrying cannot help - and says what to fix",
    async (status: number, reason: string, hint: string) => {
      const sleeps: Array<number> = [];
      const fake: FakeSecOps = fakeSecOps(() => {
        return { status, body: googleError(status, "no", reason || undefined) };
      });

      const result: SecurityEventSendResult = await sender(fake, sleeps).send({
        settings: DESTINATION_SETTINGS,
        events: records(5),
      });

      expect(result.processed).toBe(0);
      expect(result.failure).toContain(hint);
      expect(sleeps).toEqual([]);
      // A 401 is tried once more with a fresh token by the client itself.
      expect(fake.imports).toHaveLength(status === 401 ? 2 : 1);
    },
  );

  test("an event SecOps refuses is found by splitting the batch, and the rest are sent", async () => {
    // SecOps refuses any batch that holds "evt-5", whatever its type.
    const fake: FakeSecOps = fakeSecOps((events: Array<JSONObject>) => {
      const holdsBadOne: boolean = events.some((event: JSONObject): boolean => {
        return (event["metadata"] as JSONObject)["productLogId"] === "evt-5";
      });

      return holdsBadOne
        ? { status: 400, body: googleError(400, "Invalid UDM event") }
        : { status: 200 };
    });

    const result: SecurityEventSendResult = await sender(fake).send({
      settings: DESTINATION_SETTINGS,
      events: records(8),
    });

    expect(result.sent).toBe(7);
    expect(result.rejected).toBe(1);
    expect(result.processed).toBe(8);
    expect(result.failure).toBe("");
    expect(result.rejectionReason).toContain("HTTP 400");
    expect(eventUidsOf(fake)).toContain("evt-7");
  });

  test("an event refused as its type is sent again as a GENERIC_EVENT, which SecOps takes", async () => {
    const fake: FakeSecOps = fakeSecOps((events: Array<JSONObject>) => {
      const holdsLogin: boolean = events.some((event: JSONObject): boolean => {
        return (event["metadata"] as JSONObject)["eventType"] === "USER_LOGIN";
      });

      return holdsLogin ? { status: 400 } : { status: 200 };
    });

    const result: SecurityEventSendResult = await sender(fake).send({
      settings: DESTINATION_SETTINGS,
      events: [SSH_FAILURE, DETECTION_FINDING],
    });

    expect(result.sent).toBe(2);
    expect(result.rejected).toBe(0);

    // The sign-in went as USER_LOGIN first, and was taken as GENERIC_EVENT.
    const typesTheSignInWentAs: Array<string> = fake.imports.flatMap(
      (request: { events: Array<JSONObject> }): Array<string> => {
        return request.events
          .filter((event: JSONObject): boolean => {
            return (
              (event["metadata"] as JSONObject)["productLogId"] ===
              SSH_FAILURE.eventUid
            );
          })
          .map((event: JSONObject): string => {
            return String((event["metadata"] as JSONObject)["eventType"]);
          });
      },
    );

    expect(typesTheSignInWentAs[0]).toBe("USER_LOGIN");
    expect(typesTheSignInWentAs[typesTheSignInWentAs.length - 1]).toBe(
      "GENERIC_EVENT",
    );
  });

  test("an oversized batch (413) is split like a refused one", async () => {
    const fake: FakeSecOps = fakeSecOps((events: Array<JSONObject>) => {
      return events.length > 2 ? { status: 413 } : { status: 200 };
    });

    const result: SecurityEventSendResult = await sender(fake).send({
      settings: DESTINATION_SETTINGS,
      events: records(8),
    });

    expect(result.sent).toBe(8);
    expect(result.rejected).toBe(0);
  });

  test("settings are checked before anything is sent", () => {
    const check: GoogleSecOpsSender = new GoogleSecOpsSender();

    expect(() => {
      check.validateSettings(DESTINATION_SETTINGS);
    }).not.toThrow();

    for (const settings of [
      {
        ...DESTINATION_SETTINGS,
        config: { ...DESTINATION_SETTINGS.config, region: "mars" },
      },
      {
        ...DESTINATION_SETTINGS,
        config: {
          ...DESTINATION_SETTINGS.config,
          instanceResourceName: "my-instance",
        },
      },
      {
        ...DESTINATION_SETTINGS,
        config: { ...DESTINATION_SETTINGS.config, region: "europe" },
      },
      { ...DESTINATION_SETTINGS, secrets: { serviceAccountJson: "{}" } },
      { ...DESTINATION_SETTINGS, secrets: { serviceAccountJson: "not json" } },
    ]) {
      expect(() => {
        check.validateSettings(settings);
      }).toThrow(BadDataException);
    }
  });

  test("the test event is one GENERIC_EVENT that says it is a test", async () => {
    const fake: FakeSecOps = fakeSecOps();

    await sender(fake).sendTestEvent(DESTINATION_SETTINGS);

    expect(fake.imports).toHaveLength(1);
    expect(fake.imports[0]!.events).toHaveLength(1);

    const metadata: JSONObject = fake.imports[0]!.events[0]![
      "metadata"
    ] as JSONObject;

    expect(metadata["eventType"]).toBe("GENERIC_EVENT");
    expect(metadata["vendorName"]).toBe("OneUptime");
    expect(String(metadata["description"])).toContain(
      "OneUptime connection test",
    );
  });

  test("a test SecOps refuses throws what to fix", async () => {
    const fake: FakeSecOps = fakeSecOps(() => {
      return {
        status: 403,
        body: googleError(403, "denied", "IAM_PERMISSION_DENIED"),
      };
    });

    await expect(
      sender(fake).sendTestEvent(DESTINATION_SETTINGS),
    ).rejects.toThrow("chronicle.events.import");
  });
});

describe("describeGoogleSecOpsSendFailure", () => {
  test("names the role for a permission refusal", () => {
    expect(
      describeGoogleSecOpsSendFailure({
        status: 403,
        errorReason: "",
        errorText: "",
      }),
    ).toBe(
      "The service account cannot import events into this Google SecOps instance (HTTP 403). Grant it chronicle.events.import, for example with the Chronicle API Editor role, and check the instance resource name.",
    );
  });

  test("says it will try again for rate limiting", () => {
    expect(
      describeGoogleSecOpsSendFailure({
        status: 429,
        errorReason: "RATE_LIMIT_EXCEEDED",
        errorText: "quota",
      }),
    ).toBe(
      "Google SecOps is rate limiting this service account (HTTP 429). OneUptime tries again on the next run. quota",
    );
  });
});
