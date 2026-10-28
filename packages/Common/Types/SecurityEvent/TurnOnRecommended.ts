/*
 * Turn on recommended - Security Events > Overview, and the Rule Library's
 * Add Recommended Rules: what it did, and what it could not do and why, as
 * POST /security-case/setup/turn-on-recommended answers it
 * (Server/Utils/SecurityEvent/SecuritySetup.ts) and the Dashboard reads it.
 *
 * Every part is done on its own - your logs, each recommended rule, the
 * Enrich New Cases playbook - so one that cannot be done leaves the others
 * done, and the answer names it with the reason. Running it again does only
 * what is still missing: nothing is added twice.
 */

export enum TurnOnRecommendedPart {
  // Find security events in your logs.
  Logs = "logs",
  /*
   * Find security events in the rest of your OneUptime data: traces,
   * network flows, the audit log, session replays. The problem's name is
   * the kind (SecurityTelemetrySourceKind); empty when none could be read.
   */
  TelemetrySources = "telemetry-sources",
  // A recommended detection rule; with no name, the recommended rules as a whole.
  Rule = "rule",
  // The Enrich New Cases playbook.
  Playbook = "playbook",
}

export enum TurnOnRecommendedAction {
  // It was not there, and adding it failed.
  Add = "add",
  // It was there but off, and turning it back on failed.
  TurnOn = "turn-on",
  // What the project already has could not be read, so nothing was added.
  Check = "check",
}

export enum TurnOnRecommendedReason {
  // The person's role does not allow it.
  NotAllowed = "not-allowed",
  // The project's plan does not include it.
  Plan = "plan",
  // OneUptime would not save it as it is; the detail says why.
  Refused = "refused",
  // Something failed on OneUptime's side: trying again may work.
  Failed = "failed",
}

export interface TurnOnRecommendedProblem {
  part: TurnOnRecommendedPart;
  action: TurnOnRecommendedAction;
  // The rule's or the playbook's name as lists show it; empty for your logs.
  name: string;
  reason: TurnOnRecommendedReason;
  // The server's own sentence, for Refused and Plan; empty otherwise.
  detail: string;
}

export interface TurnOnRecommendedResult {
  rulesAdded: number;
  rulesTurnedOn: number;
  logsTurnedOn: boolean;
  // The kinds of your OneUptime data beside logs added or turned back on.
  telemetrySourcesTurnedOn: number;
  playbookAdded: boolean;
  // Enrich New Cases was there but switched off, and is on again.
  playbookTurnedOn: boolean;
  // What could not be done, in the order it was tried; empty when all of it was.
  problems: Array<TurnOnRecommendedProblem>;
}

export const TURN_ON_RECOMMENDED_PARTS: ReadonlyArray<TurnOnRecommendedPart> = [
  TurnOnRecommendedPart.Logs,
  TurnOnRecommendedPart.TelemetrySources,
  TurnOnRecommendedPart.Rule,
  TurnOnRecommendedPart.Playbook,
];

export const TURN_ON_RECOMMENDED_ACTIONS: ReadonlyArray<TurnOnRecommendedAction> =
  [
    TurnOnRecommendedAction.Add,
    TurnOnRecommendedAction.TurnOn,
    TurnOnRecommendedAction.Check,
  ];

export const TURN_ON_RECOMMENDED_REASONS: ReadonlyArray<TurnOnRecommendedReason> =
  [
    TurnOnRecommendedReason.NotAllowed,
    TurnOnRecommendedReason.Plan,
    TurnOnRecommendedReason.Refused,
    TurnOnRecommendedReason.Failed,
  ];
