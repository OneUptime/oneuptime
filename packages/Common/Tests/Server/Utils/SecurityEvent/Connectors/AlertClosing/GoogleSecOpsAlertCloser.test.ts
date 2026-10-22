import { describe, expect, test } from "@jest/globals";
import GoogleSecOpsAlertCloser, {
  GOOGLE_SECOPS_CLOSE_RETRY_DELAYS_IN_MS,
  describeGoogleSecOpsCloseFailure,
  googleSecOpsClosingFeedback,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/AlertClosing/GoogleSecOpsAlertCloser";
import {
  SOURCE_ALERTS_PER_CLOSE_LIMIT,
  SOURCE_ALERT_COMMENT_MAX_LENGTH,
  SourceAlertCloseResult,
  SourceAlertClosing,
  sourceAlertClosingComment,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/AlertClosing/SecurityAlertCloser";
import SecurityAlertCloserRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/AlertClosing/SecurityAlertCloserRegistry";
import GoogleSecOpsClient, {
  GoogleSecOpsIocMatchesResult,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { JSONObject } from "../../../../../../Types/JSON";
import SecurityCaseVerdict from "../../../../../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  API_BASE,
  CONNECTION_SETTINGS,
  FakeChronicle,
  INSTANCE,
  REGION,
  RecordedCall,
  SERVICE_ACCOUNT_JSON,
  UPDATE_ALERT_URL,
  fakeChronicle,
  googleError,
} from "./GoogleSecOpsFakeApi";

/*
 * Closing Google SecOps alerts when their OneUptime case closes: the
 * feedback a verdict reads as, the request the Chronicle API's
 * legacyUpdateAlert gets, and what every answer leads to - a closed alert,
 * one that is not an alert there, one refused, a key that may not update
 * alerts, a rate limit or an outage tried again, and a verdict Google might
 * spell differently sent once more without it. Also the IOC matches search
 * the Google SecOps threat-intel feed reads.
 */

const CLOSING: SourceAlertClosing = {
  verdict: SecurityCaseVerdict.TruePositive,
  closingNote: "Phished credentials; account reset.",
  caseLabel: "CASE-42",
  caseUrl: "https://oneuptime.example.com/dashboard/p/security-events/cases/c",
};

function closer(
  fake: FakeChronicle,
  sleeps: Array<number> = [],
): GoogleSecOpsAlertCloser {
  return new GoogleSecOpsAlertCloser({
    fetchImplementation: fake.fetchImplementation,
    sleep: async (delayInMs: number): Promise<void> => {
      sleeps.push(delayInMs);
    },
  });
}

function alertIdsOf(fake: FakeChronicle): Array<string> {
  return fake.calls.map((call: RecordedCall): string => {
    return String(call.body["alertId"]);
  });
}

async function close(
  fake: FakeChronicle,
  alertIds: Array<string>,
  closing: SourceAlertClosing = CLOSING,
  sleeps: Array<number> = [],
): Promise<SourceAlertCloseResult> {
  return closer(fake, sleeps).closeAlerts({
    settings: CONNECTION_SETTINGS,
    alertIds,
    closing,
  });
}

describe("the feedback a closed case gives its alerts", () => {
  test("each verdict, as Google's reason and verdict", () => {
    const comment: string = sourceAlertClosingComment(CLOSING);

    expect(googleSecOpsClosingFeedback(CLOSING)).toEqual({
      status: "CLOSED",
      comment,
      reason: "REASON_MALICIOUS",
      verdict: "TRUE_POSITIVE",
    });

    expect(
      googleSecOpsClosingFeedback({
        ...CLOSING,
        verdict: SecurityCaseVerdict.FalsePositive,
      }),
    ).toEqual({
      status: "CLOSED",
      comment: sourceAlertClosingComment({
        ...CLOSING,
        verdict: SecurityCaseVerdict.FalsePositive,
      }),
      reason: "REASON_NOT_MALICIOUS",
      verdict: "FALSE_POSITIVE",
    });

    // A real detection of harmless activity: not malicious, no verdict either way.
    expect(
      googleSecOpsClosingFeedback({
        ...CLOSING,
        verdict: SecurityCaseVerdict.BenignPositive,
      }),
    ).toMatchObject({ status: "CLOSED", reason: "REASON_NOT_MALICIOUS" });
    expect(
      googleSecOpsClosingFeedback({
        ...CLOSING,
        verdict: SecurityCaseVerdict.BenignPositive,
      })["verdict"],
    ).toBeUndefined();

    // Undetermined says nothing about either.
    const undetermined: JSONObject = googleSecOpsClosingFeedback({
      ...CLOSING,
      verdict: SecurityCaseVerdict.Undetermined,
    });
    expect(undetermined["reason"]).toBeUndefined();
    expect(undetermined["verdict"]).toBeUndefined();
  });

  test("without the verdict, when asked", () => {
    expect(
      googleSecOpsClosingFeedback(CLOSING, { withVerdict: false }),
    ).toEqual({
      status: "CLOSED",
      comment: sourceAlertClosingComment(CLOSING),
      reason: "REASON_MALICIOUS",
    });
  });

  test("the comment says where it was closed, the verdict, the note and the way back", () => {
    expect(sourceAlertClosingComment(CLOSING)).toBe(
      "Closed in OneUptime with CASE-42 as True Positive. Phished credentials; account reset. https://oneuptime.example.com/dashboard/p/security-events/cases/c",
    );

    expect(
      sourceAlertClosingComment({
        ...CLOSING,
        closingNote: "  ",
        caseLabel: "",
        caseUrl: "",
      }),
    ).toBe("Closed in OneUptime with its security case as True Positive.");
  });

  test("a long note is cut so the comment keeps its link", () => {
    const comment: string = sourceAlertClosingComment({
      ...CLOSING,
      closingNote: "x".repeat(5000),
    });

    expect(comment.length).toBeLessThanOrEqual(SOURCE_ALERT_COMMENT_MAX_LENGTH);
    expect(comment.endsWith(CLOSING.caseUrl)).toBe(true);
    expect(comment).toContain("…");
  });
});

describe("GoogleSecOpsAlertCloser", () => {
  test("is the closer registered for Google SecOps, and only it", () => {
    expect(
      SecurityAlertCloserRegistry.getCloser(
        SecurityEventConnectorProvider.GoogleSecOps,
      ),
    ).toBeInstanceOf(GoogleSecOpsAlertCloser);
    expect(SecurityAlertCloserRegistry.providers()).toEqual([
      SecurityEventConnectorProvider.GoogleSecOps,
    ]);
    expect(
      SecurityAlertCloserRegistry.getCloser(
        SecurityEventConnectorProvider.OktaSystemLog,
      ),
    ).toBeUndefined();
  });

  test("closes each alert through legacyUpdateAlert with a bearer token", async () => {
    const fake: FakeChronicle = fakeChronicle();

    const result: SourceAlertCloseResult = await close(fake, [
      "de_1111",
      "de_2222",
    ]);

    expect(result).toEqual({
      closed: 2,
      notFound: 0,
      refused: 0,
      notTried: 0,
      failure: "",
      retryable: false,
    });
    expect(fake.tokenRequests).toBe(1);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toEqual({
      method: "POST",
      url: UPDATE_ALERT_URL,
      authorization: "Bearer token-1",
      body: {
        alertId: "de_1111",
        feedback: googleSecOpsClosingFeedback(CLOSING),
      },
    });
    expect(alertIdsOf(fake)).toEqual(["de_1111", "de_2222"]);
  });

  test("each alert once, trimmed, and no more than one case closes", async () => {
    const fake: FakeChronicle = fakeChronicle();
    const many: Array<string> = [];

    for (
      let index: number = 0;
      index < SOURCE_ALERTS_PER_CLOSE_LIMIT + 50;
      index++
    ) {
      many.push(`de_${index}`);
    }

    await close(fake, [" de_a ", "de_a", "", ...many]);

    expect(fake.calls).toHaveLength(SOURCE_ALERTS_PER_CLOSE_LIMIT);
    expect(alertIdsOf(fake)[0]).toBe("de_a");

    const none: FakeChronicle = fakeChronicle();
    expect(await close(none, ["", "  "])).toMatchObject({ closed: 0 });
    expect(none.calls).toHaveLength(0);
    expect(none.tokenRequests).toBe(0);
  });

  test("an alert Google SecOps does not have is not an alert there, and the rest carry on", async () => {
    const fake: FakeChronicle = fakeChronicle(
      (call: RecordedCall): { status: number; body?: string } => {
        return call.body["alertId"] === "de_rule_only"
          ? { status: 404, body: googleError(404, "alert not found") }
          : { status: 200, body: "{}" };
      },
    );

    const result: SourceAlertCloseResult = await close(fake, [
      "de_rule_only",
      "de_2",
    ]);

    expect(result).toMatchObject({ closed: 1, notFound: 1, failure: "" });
  });

  test("a refused alert is sent once more without the verdict before it is given up on", async () => {
    const fake: FakeChronicle = fakeChronicle(
      (call: RecordedCall): { status: number; body?: string } => {
        const feedback: JSONObject = call.body["feedback"] as JSONObject;

        if (call.body["alertId"] === "de_stubborn") {
          return { status: 400, body: googleError(400, "invalid argument") };
        }

        return feedback["verdict"]
          ? {
              status: 400,
              body: googleError(400, "Invalid value at 'feedback.verdict'"),
            }
          : { status: 200, body: "{}" };
      },
    );

    const result: SourceAlertCloseResult = await close(fake, [
      "de_1",
      "de_stubborn",
    ]);

    expect(result).toMatchObject({ closed: 1, refused: 1, failure: "" });
    // de_1: with, then without the verdict; de_stubborn: the same, refused both times.
    expect(
      fake.calls.map((call: RecordedCall): boolean => {
        return Boolean((call.body["feedback"] as JSONObject)["verdict"]);
      }),
    ).toEqual([true, false, true, false]);
  });

  test("a key that may not update alerts stops the closing, saying which role to grant", async () => {
    const fake: FakeChronicle = fakeChronicle(() => {
      return { status: 403, body: googleError(403, "permission denied") };
    });

    const result: SourceAlertCloseResult = await close(fake, [
      "de_1",
      "de_2",
      "de_3",
    ]);

    expect(result.closed).toBe(0);
    expect(result.notTried).toBe(3);
    expect(result.retryable).toBe(false);
    expect(result.failure).toContain("HTTP 403");
    expect(result.failure).toContain("Chronicle API Editor");
    expect(fake.calls).toHaveLength(1);
  });

  test("a rate limit is tried twice more after a pause, then left for later", async () => {
    const sleeps: Array<number> = [];
    const fake: FakeChronicle = fakeChronicle(() => {
      return { status: 429, body: googleError(429, "quota") };
    });

    const result: SourceAlertCloseResult = await close(
      fake,
      ["de_1", "de_2"],
      CLOSING,
      sleeps,
    );

    expect(fake.calls).toHaveLength(3);
    expect(sleeps).toEqual([...GOOGLE_SECOPS_CLOSE_RETRY_DELAYS_IN_MS]);
    expect(result).toMatchObject({
      closed: 0,
      notTried: 2,
      retryable: true,
    });
    expect(result.failure).toContain("HTTP 429");
  });

  test("a server error that passes is closed on the next try", async () => {
    const fake: FakeChronicle = fakeChronicle(
      (_call: RecordedCall, callIndex: number) => {
        return callIndex === 0
          ? { status: 503, body: "unavailable" }
          : { status: 200, body: "{}" };
      },
    );

    expect(await close(fake, ["de_1"])).toMatchObject({ closed: 1 });
    expect(fake.calls).toHaveLength(2);
  });

  test("no answer at all is tried again, then left for later", async () => {
    const fake: FakeChronicle = fakeChronicle(() => {
      return { status: 0, throws: true };
    });

    const result: SourceAlertCloseResult = await close(fake, ["de_1", "de_2"]);

    expect(result).toEqual({
      closed: 0,
      notFound: 0,
      refused: 0,
      notTried: 2,
      failure: "Could not reach Google SecOps.",
      retryable: true,
    });
  });

  test("a refused token is minted again once", async () => {
    const fake: FakeChronicle = fakeChronicle(
      (_call: RecordedCall, callIndex: number) => {
        return callIndex === 0 ? { status: 401 } : { status: 200, body: "{}" };
      },
    );

    expect(await close(fake, ["de_1"])).toMatchObject({ closed: 1 });
    expect(fake.tokenRequests).toBe(2);
    expect(fake.calls[1]!.authorization).toBe("Bearer token-2");
  });

  test("every failure says what to fix", () => {
    expect(
      describeGoogleSecOpsCloseFailure({ status: 401, errorText: "" }),
    ).toContain("revoked");
    expect(
      describeGoogleSecOpsCloseFailure({ status: 500, errorText: "boom" }),
    ).toBe("Google SecOps did not close the alert (HTTP 500). boom");
  });
});

describe("GoogleSecOpsClient.searchEnterpriseIocMatches", () => {
  function client(fake: FakeChronicle): GoogleSecOpsClient {
    return new GoogleSecOpsClient({
      region: REGION,
      instanceResourceName: INSTANCE,
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImplementation: fake.fetchImplementation,
    });
  }

  test("asks for one window of matches, with Mandiant's attributes", async () => {
    const fake: FakeChronicle = fakeChronicle(() => {
      return {
        status: 200,
        body: JSON.stringify({
          matches: [
            { artifactIndicator: { domain: "evil.example" } },
            "not an object",
          ],
          moreDataAvailable: true,
        }),
      };
    });

    const result: GoogleSecOpsIocMatchesResult = await client(
      fake,
    ).searchEnterpriseIocMatches({
      startTime: new Date("2026-10-21T00:00:00.000Z"),
      endTime: new Date("2026-10-21T01:00:00.000Z"),
      maxMatches: 500,
    });

    expect(result).toEqual({
      matches: [{ artifactIndicator: { domain: "evil.example" } }],
      moreDataAvailable: true,
    });

    const url: URL = new URL(fake.calls[0]!.url);

    expect(`${url.origin}${url.pathname}`).toBe(
      `${API_BASE}/legacy:legacySearchEnterpriseWideIoCs`,
    );
    expect(fake.calls[0]!.method).toBe("GET");
    expect(url.searchParams.get("timestampRange.startTime")).toBe(
      "2026-10-21T00:00:00.000Z",
    );
    expect(url.searchParams.get("timestampRange.endTime")).toBe(
      "2026-10-21T01:00:00.000Z",
    );
    expect(url.searchParams.get("maxMatchesToReturn")).toBe("500");
    expect(url.searchParams.get("addMandiantAttributes")).toBe("true");
  });

  test("an empty answer has no matches", async () => {
    const fake: FakeChronicle = fakeChronicle(() => {
      return { status: 200, body: "{}" };
    });

    expect(
      await client(fake).searchEnterpriseIocMatches({
        startTime: new Date(0),
        endTime: new Date(1000),
        maxMatches: 0,
      }),
    ).toEqual({ matches: [], moreDataAvailable: false });
    expect(
      new URL(fake.calls[0]!.url).searchParams.get("maxMatchesToReturn"),
    ).toBe("1");
  });

  test("a refusal and a body that is not JSON are errors that say so", async () => {
    await expect(
      client(
        fakeChronicle(() => {
          return { status: 403, body: googleError(403, "denied") };
        }),
      ).searchEnterpriseIocMatches({
        startTime: new Date(0),
        endTime: new Date(1000),
        maxMatches: 10,
      }),
    ).rejects.toThrow("Google SecOps IOC matches search failed (HTTP 403)");

    await expect(
      client(
        fakeChronicle(() => {
          return { status: 200, body: "<html>proxy</html>" };
        }),
      ).searchEnterpriseIocMatches({
        startTime: new Date(0),
        endTime: new Date(1000),
        maxMatches: 10,
      }),
    ).rejects.toThrow("returned a non-JSON body");
  });
});
