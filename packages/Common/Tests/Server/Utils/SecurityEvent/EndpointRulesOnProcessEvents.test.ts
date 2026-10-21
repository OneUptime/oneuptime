import { describe, expect, test } from "@jest/globals";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SigmaClickhouseCompiler from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import { JSONObject } from "../../../../Types/JSON";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventFormat from "../../../../Types/SecurityEvent/SecurityEventFormat";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import CrowdStrikeFalconNormalizer from "../../../../Utils/SecurityEvent/Connectors/CrowdStrikeFalconNormalizer";
import ElasticSecurityNormalizer from "../../../../Utils/SecurityEvent/Connectors/ElasticSecurityNormalizer";
import MicrosoftDefenderXdrNormalizer from "../../../../Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer";
import SplunkNormalizer from "../../../../Utils/SecurityEvent/Connectors/SplunkNormalizer";
import GenericNormalizer from "../../../../Utils/SecurityEvent/GenericNormalizer";
import SecurityEventNormalizer from "../../../../Utils/SecurityEvent/SecurityEventNormalizer";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { sigmaRuleMatchesEvent } from "../../../Utils/SecurityEvent/LogParsers/SigmaTestMatcher";
import {
  ATTACK_LAUNCHES,
  ORDINARY_LAUNCHES,
  ProcessLaunch,
  ocsfProcessLaunch,
  udmProcessLaunch,
} from "../../../Utils/SecurityEvent/ProcessEventFixtures";

/*
 * The rule library's endpoint rules read CommandLine. It used to resolve to
 * principalProcess, which OCSF fills with the ACTOR's process name - in a
 * process launch, the parent: "explorer.exe", not the encoded PowerShell it
 * started. So the rules tested the parent's name, and an attack reported by
 * an EDR, Sysmon or auditd went past them.
 *
 * Here every library rule that reads process events meets the attack it is
 * for, launched by an ordinary parent, as an OCSF Process Activity and as a
 * UDM PROCESS_LAUNCH - normalized the way ingest normalizes them, matched
 * the way the engine's query reads the fields (SigmaTestMatcher, through
 * resolveSigmaField) - and fires; and none of them fires on what an
 * endpoint starts all day.
 */

const PROCESS_RULES: Array<DetectionRuleLibraryEntry> =
  DETECTION_RULE_LIBRARY.filter((entry: DetectionRuleLibraryEntry): boolean => {
    return entry.dataSource.startsWith("Process events");
  });

function ruleOf(entry: DetectionRuleLibraryEntry): SigmaRule {
  return SigmaRuleParser.parse(entry.sigmaRuleYaml);
}

function ingest(payload: JSONObject): NormalizedSecurityEvent {
  const event: NormalizedSecurityEvent | null =
    SecurityEventNormalizer.normalize(payload);

  expect(event).not.toBeNull();

  return event!;
}

type Dialect = [string, (launch: ProcessLaunch, uid: string) => JSONObject];

const DIALECTS: Array<Dialect> = [
  ["OCSF Process Activity", ocsfProcessLaunch],
  ["UDM PROCESS_LAUNCH", udmProcessLaunch],
];

// The rules that fire on an event, by title.
function firingRules(event: NormalizedSecurityEvent): Array<string> {
  return PROCESS_RULES.filter((entry: DetectionRuleLibraryEntry): boolean => {
    return sigmaRuleMatchesEvent(ruleOf(entry), event);
  }).map((entry: DetectionRuleLibraryEntry): string => {
    return entry.title;
  });
}

/*
 * The event as the old field mapping read it: CommandLine and Image on
 * principalProcess. Only here to show what the rules used to miss.
 */
function readTheOldWay(
  event: NormalizedSecurityEvent,
): NormalizedSecurityEvent {
  return {
    ...event,
    processCommandLine: event.principalProcess,
    processPath: event.principalProcess,
  };
}

describe("the library's process rules", () => {
  test("are the endpoint rules, and each has an attack written for it here", () => {
    expect(PROCESS_RULES.length).toBeGreaterThanOrEqual(14);

    for (const entry of PROCESS_RULES) {
      expect([entry.title, entry.category]).toEqual([
        entry.title,
        DetectionRuleLibraryCategory.Endpoint,
      ]);
    }

    expect(
      PROCESS_RULES.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.title;
      }).sort(),
    ).toEqual(Object.keys(ATTACK_LAUNCHES).sort());
  });

  test.each(
    PROCESS_RULES.map(
      (
        entry: DetectionRuleLibraryEntry,
      ): [string, DetectionRuleLibraryEntry] => {
        return [entry.title, entry];
      },
    ),
  )(
    "%s compiles to a match on the launched process's command line, never the acting process",
    (_title: string, entry: DetectionRuleLibraryEntry) => {
      const statement: Statement = SigmaClickhouseCompiler.compile(
        ruleOf(entry),
      );

      expect(statement.query).toContain("processCommandLine");
      expect(statement.query).not.toContain("principalProcess");
    },
  );
});

describe.each(DIALECTS)("on a %s", (_dialect: string, write: Dialect[1]) => {
  test.each(Object.keys(ATTACK_LAUNCHES))(
    "%s fires on the attack it is written for",
    (title: string) => {
      const launch: ProcessLaunch = ATTACK_LAUNCHES[title]!;
      const event: NormalizedSecurityEvent = ingest(
        write(launch, `attack-${title}`),
      );

      // The launched process, and its parent, where the rules read them.
      expect(event.processCommandLine).toBe(launch.process.commandLine);
      expect(event.processPath).toBe(launch.process.path);
      expect(event.processName).toBe(launch.process.name);
      expect(event.parentProcessPath).toBe(launch.parent.path);
      expect(event.parentProcessCommandLine).toBe(launch.parent.commandLine);
      expect(event.principalHost.toLowerCase()).toBe(launch.host.toLowerCase());

      expect(firingRules(event)).toContain(title);
    },
  );

  test.each(Object.keys(ORDINARY_LAUNCHES))(
    "no process rule fires on %s",
    (name: string) => {
      const event: NormalizedSecurityEvent = ingest(
        write(ORDINARY_LAUNCHES[name]!, `ordinary-${name}`),
      );

      expect({ name, firing: firingRules(event) }).toEqual({
        name,
        firing: [],
      });
    },
  );
});

describe("what the old field mapping read", () => {
  /*
   * OCSF's principalProcess is the actor's process name - the parent, in a
   * launch. Every attack above was started by a parent whose name says
   * nothing, so read the old way not one of them fires.
   */
  test.each(Object.keys(ATTACK_LAUNCHES))(
    "%s missed its attack when CommandLine read principalProcess",
    (title: string) => {
      const launch: ProcessLaunch = ATTACK_LAUNCHES[title]!;
      const event: NormalizedSecurityEvent = ingest(
        ocsfProcessLaunch(launch, `old-${title}`),
      );

      expect(event.principalProcess).toBe(launch.parent.name);
      expect(firingRules(readTheOldWay(event))).not.toContain(title);
    },
  );

  test("principalProcess keeps what it held, for the rules and searches written against it", () => {
    const launch: ProcessLaunch =
      ATTACK_LAUNCHES["Encoded PowerShell command"]!;

    expect(ingest(ocsfProcessLaunch(launch, "kept")).principalProcess).toBe(
      "WINWORD.EXE",
    );
    expect(ingest(udmProcessLaunch(launch, "kept")).principalProcess).toBe(
      launch.parent.path,
    );
  });
});

describe("the dialects these events arrive in", () => {
  test("each payload is read as the dialect it is written in", () => {
    const launch: ProcessLaunch = ATTACK_LAUNCHES["Reverse shell"]!;

    expect(
      SecurityEventNormalizer.detectFormat(ocsfProcessLaunch(launch, "a")),
    ).toBe(SecurityEventFormat.Ocsf);
    expect(
      SecurityEventNormalizer.detectFormat(udmProcessLaunch(launch, "a")),
    ).toBe(SecurityEventFormat.Udm);
  });

  test("both are Process Activity launches on the endpoint", () => {
    const launch: ProcessLaunch = ATTACK_LAUNCHES["Reverse shell"]!;

    for (const event of [
      ingest(ocsfProcessLaunch(launch, "a")),
      ingest(udmProcessLaunch(launch, "a")),
    ]) {
      expect(event.classUid).toBe(1007);
      expect(event.className).toBe("Process Activity");
      expect(event.activityName).toBe("Launch");
    }
  });
});

/*
 * The products OneUptime connects to name the process an alert is about
 * too, and the endpoint rules read it there the same way.
 */
describe("connector findings that name a process", () => {
  const MIMIKATZ: string =
    'mimikatz.exe "privilege::debug" "sekurlsa::logonpasswords" exit';

  const findings: Array<[string, NormalizedSecurityEvent]> = [
    [
      "CrowdStrike Falcon",
      CrowdStrikeFalconNormalizer.normalize({
        composite_id: "cid:ind:agent:1",
        filename: "mimikatz.exe",
        filepath: "\\Device\\HarddiskVolume3\\Users\\Public\\mimikatz.exe",
        cmdline: MIMIKATZ,
        parent_details: {
          filename: "cmd.exe",
          filepath: "\\Device\\HarddiskVolume3\\Windows\\System32\\cmd.exe",
          cmdline: '"C:\\Windows\\system32\\cmd.exe"',
        },
        device: { hostname: "WKSTN-042" },
      }),
    ],
    [
      "Microsoft Defender XDR",
      MicrosoftDefenderXdrNormalizer.normalize({
        id: "da637",
        createdDateTime: "2026-10-21T09:15:00Z",
        title: "Credential theft tool",
        evidence: [
          {
            "@odata.type": "#microsoft.graph.security.processEvidence",
            roles: [],
            processCommandLine: MIMIKATZ,
            imageFile: {
              fileName: "mimikatz.exe",
              filePath: "C:\\Users\\Public",
            },
            parentProcessImageFile: {
              fileName: "cmd.exe",
              filePath: "C:\\Windows\\System32",
            },
          },
        ],
      }),
    ],
    [
      "Elastic Security",
      ElasticSecurityNormalizer.normalize({
        _id: "a1",
        _source: {
          "kibana.alert.rule.name": "Credential Access",
          process: {
            name: "mimikatz.exe",
            executable: "C:\\Users\\Public\\mimikatz.exe",
            command_line: MIMIKATZ,
            parent: { name: "cmd.exe", command_line: "cmd.exe" },
          },
        },
      }),
    ],
    [
      "Splunk Enterprise Security",
      SplunkNormalizer.normalize({
        _time: "2026-10-21T09:15:00Z",
        rule_name: "Credential dumping",
        process: MIMIKATZ,
        process_name: "mimikatz.exe",
        parent_process: '"C:\\Windows\\system32\\cmd.exe"',
        parent_process_name: "cmd.exe",
      }),
    ],
    [
      "generic JSON",
      GenericNormalizer.normalize({
        message: "process started",
        Image: "C:\\Users\\Public\\mimikatz.exe",
        CommandLine: MIMIKATZ,
        ParentImage: "C:\\Windows\\System32\\cmd.exe",
      }),
    ],
  ];

  test.each(findings)(
    "%s: the credential dumping rule reads the alert's command line",
    (_source: string, event: NormalizedSecurityEvent) => {
      expect(event.processCommandLine).toBe(MIMIKATZ);
      expect(event.processName).toBe("mimikatz.exe");
      expect(event.parentProcessName).toBe("cmd.exe");
      expect(firingRules(event)).toContain("Credential dumping tool");
    },
  );
});
