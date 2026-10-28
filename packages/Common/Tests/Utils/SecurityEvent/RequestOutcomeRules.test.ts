import { describe, expect, test } from "@jest/globals";
import { resolveSigmaField } from "../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { DetectionRuleDataKind } from "../../../Types/SecurityEvent/DetectionRuleDataKind";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import WebAttackLogParser from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import { applyRequestAssessment } from "../../../Utils/SecurityEvent/RequestFollowUp";
import { RequestTraceAssessment } from "../../../Utils/SecurityEvent/RequestOutcome";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { logLine } from "./LogParsers/LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./LogParsers/SigmaTestMatcher";

/*
 * The rules that read how far a request got. "SQL injection attempts" says
 * somebody tried; these say it worked - the injected SQL ran, or the attack
 * broke the app - and they fire on exactly the events the log scan stores
 * after following a request into its trace, and on nothing else.
 */

const PROBE: string = JSON.stringify({
  name: "Error",
  message:
    "Page not found - /sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
  stack: "Error: Page not found",
});

function libraryEntry(title: string): DetectionRuleLibraryEntry {
  const entry: DetectionRuleLibraryEntry | undefined =
    DETECTION_RULE_LIBRARY.find(
      (candidate: DetectionRuleLibraryEntry): boolean => {
        return candidate.title === title;
      },
    );

  expect(entry).toBeDefined();

  return entry!;
}

function rule(title: string): SigmaRule {
  return SigmaRuleParser.parse(libraryEntry(title).sigmaRuleYaml);
}

function followed(
  outcome: SecurityEventRequestOutcome | undefined,
  overrides: Partial<RequestTraceAssessment> = {},
): NormalizedSecurityEvent {
  const [event] = WebAttackLogParser.parse({
    ...logLine(PROBE),
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  });

  applyRequestAssessment(event!, {
    outcome,
    serverSpanId: "server",
    statusCode: 0,
    method: "GET",
    url: "",
    route: "",
    clientAddress: "198.51.100.23",
    userAgent: "",
    userId: "",
    durationMs: 3,
    exception: undefined,
    database: undefined,
    requestedDelaySeconds: 0,
    ...overrides,
  });

  return event!;
}

const REACHED_DATABASE: string = "Injected SQL reached the database";
const BROKE_THE_APP: string = "Attack request broke the app";

describe("the rules that read how far a request got", () => {
  test("both are web rules for followed requests, grouped by the address that sent them, firing on one", () => {
    for (const title of [REACHED_DATABASE, BROKE_THE_APP]) {
      const entry: DetectionRuleLibraryEntry = libraryEntry(title);

      expect(entry.dataKind).toBe(DetectionRuleDataKind.WebRequests);
      expect(entry.groupByField).toBe("principalIp");
      expect(entry.matchCountThreshold).toBe(1);
      expect(rule(title).id).toBe(entry.id);
      expect(rule(title).mitreTechniques).toContain("T1190");
    }

    expect(rule(REACHED_DATABASE).level).toBe("critical");
    expect(rule(BROKE_THE_APP).level).toBe("high");
  });

  test("injected SQL that reached the database fires its rule, and the attempts rule too", () => {
    const event: NormalizedSecurityEvent = followed(
      SecurityEventRequestOutcome.ReachedDatabase,
      {
        statusCode: 200,
        durationMs: 16_020,
        requestedDelaySeconds: 16,
      },
    );

    expect(sigmaRuleMatchesEvent(rule(REACHED_DATABASE), event)).toBe(true);
    expect(sigmaRuleMatchesEvent(rule(BROKE_THE_APP), event)).toBe(false);
    expect(sigmaRuleMatchesEvent(rule("SQL injection attempts"), event)).toBe(
      true,
    );
  });

  test("an attack that broke the app fires its rule", () => {
    const event: NormalizedSecurityEvent = followed(
      SecurityEventRequestOutcome.Errored,
      { statusCode: 500 },
    );

    expect(sigmaRuleMatchesEvent(rule(BROKE_THE_APP), event)).toBe(true);
    expect(sigmaRuleMatchesEvent(rule(REACHED_DATABASE), event)).toBe(false);
  });

  test("a probe the app turned away, or one nobody followed, fires neither", () => {
    for (const event of [
      followed(SecurityEventRequestOutcome.Rejected, { statusCode: 404 }),
      followed(SecurityEventRequestOutcome.ReachedApp, { statusCode: 200 }),
      followed(undefined),
    ]) {
      expect(sigmaRuleMatchesEvent(rule(REACHED_DATABASE), event)).toBe(false);
      expect(sigmaRuleMatchesEvent(rule(BROKE_THE_APP), event)).toBe(false);
    }
  });

  test("an errored request that carried no attack is no attack", () => {
    const event: NormalizedSecurityEvent = {
      ...followed(SecurityEventRequestOutcome.Errored),
      className: "Authentication",
    };

    expect(sigmaRuleMatchesEvent(rule(BROKE_THE_APP), event)).toBe(false);
  });
});

describe("Sigma reads the request columns by name", () => {
  test.each([
    ["requestOutcome", "requestOutcome"],
    ["request_outcome", "requestOutcome"],
    ["traceId", "traceId"],
    ["trace_id", "traceId"],
    ["spanId", "spanId"],
    ["sessionId", "sessionId"],
    ["session_id", "sessionId"],
  ])("%s is the %s column", (field: string, column: string) => {
    expect(resolveSigmaField(field)).toEqual({ kind: "textColumn", column });
  });
});
