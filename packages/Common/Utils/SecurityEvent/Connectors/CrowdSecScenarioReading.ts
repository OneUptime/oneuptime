import {
  CROWDSEC_BEHAVIOR_SEVERITY,
  CROWDSEC_BEHAVIOR_TECHNIQUE,
  CrowdSecBehavior,
} from "../../../Types/SecurityEvent/CrowdSec/CrowdSecBehavior";
import {
  CROWDSEC_HUB_SCENARIOS,
  CrowdSecHubScenario,
} from "../../../Types/SecurityEvent/CrowdSec/CrowdSecHubScenarios";
import {
  MitreTechnique,
  getMitreTechnique,
} from "../../../Types/SecurityEvent/MitreAttack";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";

/*
 * WHAT A CROWDSEC SCENARIO IS (#11158): its behaviour, severity, MITRE
 * ATT&CK techniques and tactics, and its name as people read it.
 *
 * A scenario of CrowdSec's own (crowdsecurity/*) is read from the Hub's
 * labels (CrowdSecHubScenarios). Any other - from the Hub's community, or a
 * team's own - is read by its name, the way the Hub names scenarios:
 * "-bf" is a brute force, "cve-2021-41773" an exploit, "http-probing" a
 * scan. Measured against the whole Hub index, the name reads a community
 * scenario's behaviour right four times in five; when it reads nothing, the
 * scenario is Unknown, which is Medium: it fired, and nothing says more.
 * The rules are tried in order, first match wins, so a "post-exploit" name
 * is never read as an exploit, nor a "spam" one as a scan. Pure.
 */

export interface CrowdSecScenarioReading {
  scenario: string;
  behavior: CrowdSecBehavior;
  severity: OcsfSeverity;
  // T1110, T1595.003: the Hub's own, or the family's (CROWDSEC_BEHAVIOR_TECHNIQUE).
  techniques: Array<string>;
  // The tactics the techniques serve, in matrix order: TA0006.
  tactics: Array<string>;
  // The Hub's name for it ("SSH Bruteforce"); '' for a scenario the Hub does not label.
  label: string;
  // Whether the Hub's own labels said all this, rather than the scenario's name.
  isFromHub: boolean;
}

// Read by the scenario's name, lower cased; first match wins.
const NAME_RULES: ReadonlyArray<{
  behavior: CrowdSecBehavior;
  pattern: RegExp;
}> = [
  {
    behavior: CrowdSecBehavior.Test,
    pattern: /(^|[-_/])(generic-)?test($|[-_])/,
  },
  {
    behavior: CrowdSecBehavior.PostExploitation,
    pattern: /post-?exploit|postexploit/,
  },
  {
    behavior: CrowdSecBehavior.Exploit,
    pattern:
      /cve[-_]?\d{4}|vpatch|exploit|(^|[-_/])rce($|[-_])|sqli|xss|xxe|csrf|open-redirect|(^|[-_/])lfi($|[-_])|(^|[-_/])rfi($|[-_])|traversal|log4j|shellshock|spring4shell|injection|(^|[-_/])crs[-_]|modsecurity|naxsi/,
  },
  {
    behavior: CrowdSecBehavior.DenialOfService,
    pattern: /(^|[-_/])d?dos($|[-_])|req-limit|rate-?limit|flood/,
  },
  {
    behavior: CrowdSecBehavior.BruteForce,
    pattern:
      /(^|[-_/])bf($|[-_])|[-_]bf$|bruteforce|brute-force|brute_force|user[-_]enum|password-spray|spray|credential-stuffing|auth-?fail|failed-?auth|login-?fail/,
  },
  { behavior: CrowdSecBehavior.Crawl, pattern: /crawl/ },
  { behavior: CrowdSecBehavior.Spam, pattern: /spam/ },
  {
    behavior: CrowdSecBehavior.Bot,
    pattern: /(^|[-_/])bots?($|[-_])|likely-bot/,
  },
  {
    behavior: CrowdSecBehavior.Scan,
    pattern:
      /(^|[-_/])(port-?)?scan(ner|ning)?($|[-_])|prob(e|ing)|bad-user-agent|sensitive-files|backdoor|(^|[-_/])enum($|[-_])|admin-interface/,
  },
];

// A scenario's behaviour as its name says it, or Unknown.
export function readCrowdSecBehaviorFromName(
  scenario: string,
): CrowdSecBehavior {
  const name: string = (scenario || "").trim().toLowerCase();

  if (!name) {
    return CrowdSecBehavior.Unknown;
  }

  for (const rule of NAME_RULES) {
    if (rule.pattern.test(name)) {
      return rule.behavior;
    }
  }

  return CrowdSecBehavior.Unknown;
}

// The tactics techniques serve, each once, in the order the techniques name them.
export function getCrowdSecTactics(
  techniques: ReadonlyArray<string>,
): Array<string> {
  const tactics: Array<string> = [];

  for (const id of techniques) {
    const technique: MitreTechnique | undefined = getMitreTechnique(id);

    for (const tacticId of technique?.tacticIds || []) {
      if (!tactics.includes(tacticId)) {
        tactics.push(tacticId);
      }
    }
  }

  return tactics;
}

export function readCrowdSecScenario(
  scenario: string | undefined | null,
): CrowdSecScenarioReading {
  const name: string = (scenario || "").trim();
  const hub: CrowdSecHubScenario | undefined = CROWDSEC_HUB_SCENARIOS.get(name);

  if (hub) {
    const techniques: Array<string> = [...hub.techniques];

    return {
      scenario: name,
      behavior: hub.behavior,
      severity: CROWDSEC_BEHAVIOR_SEVERITY[hub.behavior],
      techniques,
      tactics: getCrowdSecTactics(techniques),
      label: hub.label,
      isFromHub: true,
    };
  }

  const behavior: CrowdSecBehavior = readCrowdSecBehaviorFromName(name);
  const technique: string | undefined = CROWDSEC_BEHAVIOR_TECHNIQUE[behavior];
  const techniques: Array<string> = technique ? [technique] : [];

  return {
    scenario: name,
    behavior,
    severity: CROWDSEC_BEHAVIOR_SEVERITY[behavior],
    techniques,
    tactics: getCrowdSecTactics(techniques),
    label: "",
    isFromHub: false,
  };
}
