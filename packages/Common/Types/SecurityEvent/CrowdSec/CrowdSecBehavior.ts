import OcsfSeverity from "../OcsfSeverity";

/*
 * WHAT A CROWDSEC SCENARIO DETECTS (#11158), as the CrowdSec Hub labels
 * every scenario's behaviour ("ssh:bruteforce", "http:exploit",
 * "http:scan"): the part after the service, folded into the families
 * below. A CrowdSec alert carries no severity of its own, so the severity
 * OneUptime gives it is its behaviour's:
 *
 *   High    an exploit of a vulnerability (a CVE, a virtual patch the
 *           AppSec component blocked, an SQL injection), or what an
 *           attacker does once inside (post-exploitation, a local
 *           privilege escalation);
 *   Medium  brute force, denial of service, card fraud, a sign-in that
 *           cannot be (impossible travel), and a scenario OneUptime cannot
 *           place: it fired, and nothing says how serious it is;
 *   Low     scans, probes, crawls, bots, spam, and cloud audit changes
 *           (the CIS benchmark scenarios), which legitimate admins make
 *           every day;
 *   Informational  CrowdSec's own test scenarios.
 *
 * With a connection's Open Cases From left at High and above, CrowdSec's
 * exploits open cases, and its routine bans of scanners and brute forcers
 * stay events for the detection rules to read.
 */
export enum CrowdSecBehavior {
  Exploit = "exploit",
  PostExploitation = "post-exploitation",
  BruteForce = "bruteforce",
  DenialOfService = "dos",
  Fraud = "fraud",
  UnusualActivity = "unusual-activity",
  Audit = "audit",
  Scan = "scan",
  Crawl = "crawl",
  Bot = "bot",
  Spam = "spam",
  Test = "test",
  Unknown = "unknown",
}

export const CROWDSEC_BEHAVIOR_SEVERITY: Readonly<
  Record<CrowdSecBehavior, OcsfSeverity>
> = {
  [CrowdSecBehavior.Exploit]: OcsfSeverity.High,
  [CrowdSecBehavior.PostExploitation]: OcsfSeverity.High,
  [CrowdSecBehavior.BruteForce]: OcsfSeverity.Medium,
  [CrowdSecBehavior.DenialOfService]: OcsfSeverity.Medium,
  [CrowdSecBehavior.Fraud]: OcsfSeverity.Medium,
  [CrowdSecBehavior.UnusualActivity]: OcsfSeverity.Medium,
  [CrowdSecBehavior.Unknown]: OcsfSeverity.Medium,
  [CrowdSecBehavior.Audit]: OcsfSeverity.Low,
  [CrowdSecBehavior.Scan]: OcsfSeverity.Low,
  [CrowdSecBehavior.Crawl]: OcsfSeverity.Low,
  [CrowdSecBehavior.Bot]: OcsfSeverity.Low,
  [CrowdSecBehavior.Spam]: OcsfSeverity.Low,
  [CrowdSecBehavior.Test]: OcsfSeverity.Informational,
};

/*
 * The technique a family stands for when a scenario names none of its own
 * (a community or custom scenario read by its name): the one the Hub gives
 * most of that family's scenarios. None for a family the Hub classifies too
 * many ways to pick one.
 */
export const CROWDSEC_BEHAVIOR_TECHNIQUE: Readonly<
  Partial<Record<CrowdSecBehavior, string>>
> = {
  [CrowdSecBehavior.Exploit]: "T1190",
  [CrowdSecBehavior.PostExploitation]: "T1059",
  [CrowdSecBehavior.BruteForce]: "T1110",
  [CrowdSecBehavior.DenialOfService]: "T1498",
  [CrowdSecBehavior.Scan]: "T1595",
  [CrowdSecBehavior.Crawl]: "T1595",
};
