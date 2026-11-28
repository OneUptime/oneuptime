import { describe, expect, test } from "@jest/globals";
import {
  CROWDSEC_BEHAVIOR_SEVERITY,
  CROWDSEC_BEHAVIOR_TECHNIQUE,
  CrowdSecBehavior,
} from "../../../../Types/SecurityEvent/CrowdSec/CrowdSecBehavior";
import {
  CROWDSEC_HUB_INDEX_COMMIT,
  CROWDSEC_HUB_SCENARIOS,
  CrowdSecHubScenario,
} from "../../../../Types/SecurityEvent/CrowdSec/CrowdSecHubScenarios";
import { resolveMitreTechniqueId } from "../../../../Types/SecurityEvent/MitreAttack";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  CrowdSecScenarioReading,
  getCrowdSecTactics,
  readCrowdSecBehaviorFromName,
  readCrowdSecScenario,
} from "../../../../Utils/SecurityEvent/Connectors/CrowdSecScenarioReading";

/*
 * What a CrowdSec scenario is (#11158): CrowdSec's own scenarios as the
 * Hub labels them, and anyone else's by its name. The severity of every
 * CrowdSec alert follows from this, and so does whether it opens a case at
 * a connection's Open Cases From, so the table is held to the Hub's labels
 * and the name rules to the names the Hub's community actually uses.
 */

function read(scenario: string): CrowdSecScenarioReading {
  return readCrowdSecScenario(scenario);
}

describe("the Hub's own scenarios", () => {
  test("the table holds CrowdSec's official scenarios, from a named Hub commit", () => {
    expect(CROWDSEC_HUB_INDEX_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(CROWDSEC_HUB_SCENARIOS.size).toBeGreaterThan(150);

    for (const name of CROWDSEC_HUB_SCENARIOS.keys()) {
      expect(name.startsWith("crowdsecurity/")).toBe(true);
    }
  });

  test("every technique the table names is one of the ATT&CK matrix's", () => {
    for (const [name, scenario] of CROWDSEC_HUB_SCENARIOS) {
      for (const technique of scenario.techniques) {
        expect({
          name,
          technique,
          known: Boolean(resolveMitreTechniqueId(technique)),
        }).toEqual({
          name,
          technique,
          known: true,
        });
        expect(technique).toBe(technique.toUpperCase());
      }
    }
  });

  test("every behaviour the table names has a severity", () => {
    for (const scenario of CROWDSEC_HUB_SCENARIOS.values()) {
      expect(CROWDSEC_BEHAVIOR_SEVERITY[scenario.behavior]).toBeDefined();
    }
  });

  test("the Hub's labels win over what a name would say", () => {
    // Named like a brute force; the Hub says it catches scanners in a tarpit.
    expect(read("crowdsecurity/endlessh-bf").behavior).toBe(
      CrowdSecBehavior.Scan,
    );
    // Named like a probe; the Hub says each is an exploit attempt.
    expect(read("crowdsecurity/http-sqli-probing").behavior).toBe(
      CrowdSecBehavior.Exploit,
    );
    expect(read("crowdsecurity/http-xss-probing").severity).toBe(
      OcsfSeverity.High,
    );
    // Named after CVEs; the Hub says it only probes for them.
    expect(read("crowdsecurity/http-cve-probing").behavior).toBe(
      CrowdSecBehavior.Scan,
    );
  });

  test("the scenarios nearly every installation runs", () => {
    const sshBf: CrowdSecScenarioReading = read("crowdsecurity/ssh-bf");
    expect(sshBf).toEqual({
      scenario: "crowdsecurity/ssh-bf",
      behavior: CrowdSecBehavior.BruteForce,
      severity: OcsfSeverity.Medium,
      techniques: ["T1110"],
      tactics: ["TA0006"],
      label: "SSH Bruteforce",
      isFromHub: true,
    });

    const probing: CrowdSecScenarioReading = read("crowdsecurity/http-probing");
    expect(probing.severity).toBe(OcsfSeverity.Low);
    expect(probing.techniques).toEqual(["T1595"]);
    expect(probing.tactics).toEqual(["TA0043"]);

    expect(read("crowdsecurity/http-sensitive-files").techniques).toEqual([
      "T1595.003",
    ]);
    expect(read("crowdsecurity/crowdsec-appsec-inband").severity).toBe(
      OcsfSeverity.High,
    );
    expect(read("crowdsecurity/appsec-vpatch").label).toBe(
      "Blocked by CrowdSec AppSec",
    );
    expect(read("crowdsecurity/auditd-sus-exec").behavior).toBe(
      CrowdSecBehavior.PostExploitation,
    );
    expect(read("crowdsecurity/impossible-travel").severity).toBe(
      OcsfSeverity.Medium,
    );
    expect(read("crowdsecurity/http-dos-random-uri").behavior).toBe(
      CrowdSecBehavior.DenialOfService,
    );
    expect(
      read("crowdsecurity/aws-cis-benchmark-security-group-change").severity,
    ).toBe(OcsfSeverity.Low);
    expect(read("crowdsecurity/http-generic-test").severity).toBe(
      OcsfSeverity.Informational,
    );
  });

  test("a scenario is looked up exactly as it is named", () => {
    expect(read(" crowdsecurity/ssh-bf ").isFromHub).toBe(true);
    expect(read("CROWDSECURITY/SSH-BF").isFromHub).toBe(false);
  });
});

describe("a scenario read by its name", () => {
  const cases: Array<[string, CrowdSecBehavior]> = [
    ["LePresidente/http-generic-401-bf", CrowdSecBehavior.BruteForce],
    ["acme/gitea_bf", CrowdSecBehavior.BruteForce],
    ["acme/nextcloud-bruteforce", CrowdSecBehavior.BruteForce],
    ["acme/keycloak-user-enum", CrowdSecBehavior.BruteForce],
    ["acme/http-cve-2099-12345", CrowdSecBehavior.Exploit],
    ["acme/vpatch-cve-2024-1", CrowdSecBehavior.Exploit],
    ["acme/http-xxe", CrowdSecBehavior.Exploit],
    ["acme/owasp-crs-anomaly", CrowdSecBehavior.Exploit],
    ["acme/postexploit-reverse-shell", CrowdSecBehavior.PostExploitation],
    ["acme/post-exploitation-download", CrowdSecBehavior.PostExploitation],
    ["acme/http-dos", CrowdSecBehavior.DenialOfService],
    ["acme/nginx-rate-limit", CrowdSecBehavior.DenialOfService],
    ["acme/wordpress-crawl", CrowdSecBehavior.Crawl],
    ["acme/http-probing", CrowdSecBehavior.Scan],
    ["acme/port-scan", CrowdSecBehavior.Scan],
    ["acme/http-backdoor-attempts", CrowdSecBehavior.Scan],
    ["cbrandlehner/mailscanner-highscore-spam", CrowdSecBehavior.Spam],
    ["openappsec/openappsec-bot-protection", CrowdSecBehavior.Bot],
    ["acme/test", CrowdSecBehavior.Test],
    ["acme/generic-test-scenario", CrowdSecBehavior.Test],
    ["acme/contested-thing", CrowdSecBehavior.Unknown],
    ["acme/odd-thing", CrowdSecBehavior.Unknown],
    ["", CrowdSecBehavior.Unknown],
  ];

  test.each(cases)("%s is %s", (name: string, behavior: CrowdSecBehavior) => {
    expect(readCrowdSecBehaviorFromName(name)).toBe(behavior);
  });

  test("a post-exploitation name is never read as an exploit", () => {
    expect(readCrowdSecBehaviorFromName("acme/postexploit-cve-2024-1")).toBe(
      CrowdSecBehavior.PostExploitation,
    );
  });

  test("a name gets its family's technique and tactic, and no label", () => {
    const reading: CrowdSecScenarioReading = read("acme/gitea_bf");

    expect(reading).toEqual({
      scenario: "acme/gitea_bf",
      behavior: CrowdSecBehavior.BruteForce,
      severity: OcsfSeverity.Medium,
      techniques: ["T1110"],
      tactics: ["TA0006"],
      label: "",
      isFromHub: false,
    });
    expect(read("acme/odd-thing").techniques).toEqual([]);
    expect(read("acme/odd-thing").tactics).toEqual([]);
  });

  test("every family's technique is one of the matrix's", () => {
    for (const technique of Object.values(CROWDSEC_BEHAVIOR_TECHNIQUE)) {
      expect(resolveMitreTechniqueId(technique as string)).toBeDefined();
    }
  });
});

describe("severities", () => {
  test("exploits are High, brute force Medium, scans Low, tests Informational", () => {
    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.Exploit]).toBe(
      OcsfSeverity.High,
    );
    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.PostExploitation]).toBe(
      OcsfSeverity.High,
    );
    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.BruteForce]).toBe(
      OcsfSeverity.Medium,
    );
    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.Unknown]).toBe(
      OcsfSeverity.Medium,
    );
    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.Scan]).toBe(
      OcsfSeverity.Low,
    );
    expect(CROWDSEC_BEHAVIOR_SEVERITY[CrowdSecBehavior.Test]).toBe(
      OcsfSeverity.Informational,
    );

    // Nothing CrowdSec detects is Critical: an attempt, not a breach.
    for (const severity of Object.values(CROWDSEC_BEHAVIOR_SEVERITY)) {
      expect(severity).not.toBe(OcsfSeverity.Critical);
    }
  });
});

describe("tactics", () => {
  test("each tactic once, in the order the techniques name them", () => {
    expect(getCrowdSecTactics(["T1110", "T1110.001", "T1595"])).toEqual([
      "TA0006",
      "TA0043",
    ]);
    expect(getCrowdSecTactics(["T9999"])).toEqual([]);
  });

  test("a Hub scenario's tactics are its techniques'", () => {
    const scenario: CrowdSecHubScenario = CROWDSEC_HUB_SCENARIOS.get(
      "crowdsecurity/asterisk_user_enum",
    )!;

    expect(read("crowdsecurity/asterisk_user_enum").tactics).toEqual(
      getCrowdSecTactics(scenario.techniques),
    );
  });
});
