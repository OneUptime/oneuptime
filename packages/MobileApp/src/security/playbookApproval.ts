import { getEntityTerm, type SecurityEntityType } from "./caseTerms";

/*
 * A PLAYBOOK RUN WAITING FOR SOMEBODY TO APPROVE ITS NEXT STEP, as the phone
 * shows it: which step, what it would act on, and whether the person reading
 * may approve it.
 *
 * A step marked "needs approval" - every containment step, unless a Security
 * Admin let one run without - holds its run in Waiting for Approval before it
 * does anything (Common/Server/API/SecurityPlaybookRunAPI). The approver sees
 * the users or hosts it would act on, every one ticked, and may leave any out
 * but add none; protected ones are listed and never acted on. Whoever started
 * the run cannot approve its steps - somebody else does - but may reject it.
 *
 * The run's stored steps and results are read defensively: a run written by
 * an older version, or an entry that no longer reads, shows what can be read
 * instead of failing the case's screen.
 */

export const WAITING_FOR_APPROVAL: string = "Waiting for Approval";

// The run statuses, as the server stores them (Common SecurityPlaybookRunStatus).
export const SECURITY_PLAYBOOK_RUN_STATUSES: ReadonlyArray<string> = [
  "Queued",
  "Running",
  WAITING_FOR_APPROVAL,
  "Succeeded",
  "Failed",
  "Cancelled",
];

// What became of a target, as the server stores it (Common SecurityPlaybookTargetState).
export type SecurityPlaybookTargetState =
  | "Proposed"
  | "Left Out"
  | "Protected"
  | "Done"
  | "Already Done"
  | "Not Found"
  | "Failed"
  | "Undone";

export const SECURITY_PLAYBOOK_TARGET_STATES: ReadonlyArray<SecurityPlaybookTargetState> =
  [
    "Proposed",
    "Left Out",
    "Protected",
    "Done",
    "Already Done",
    "Not Found",
    "Failed",
    "Undone",
  ];

// Why a step acts on an entity (Common SecurityPlaybookTargetReason).
export type SecurityPlaybookTargetReason = "Grouped On" | "Threat Intel";

/*
 * Each action a step can take, by the title the step list reads, as the
 * dashboard titles them (Common/Types/SecurityPlaybook/SecurityPlaybookAction).
 * A step of an action this build does not know reads by the action's name.
 */
export const SECURITY_PLAYBOOK_ACTION_TITLES: Readonly<Record<string, string>> =
  {
    "Assign Case": "Assign the case",
    "Set Case Priority": "Set the priority",
    "Set Case Status": "Set the status",
    "Add Case Note": "Add a note",
    "Add Case Labels": "Add labels",
    "Check Threat Intel": "Check entities against threat intel",
    "Look Up Entity Activity": "Look up entity activity",
    "Preserve Evidence": "Preserve the evidence",
    "Email People": "Email people",
    "Notify Data Store Owners": "Notify data store owners",
    "Post to Slack": "Post to Slack",
    "Post to Microsoft Teams": "Post to Microsoft Teams",
    "Post Status Page Announcement": "Post a status page announcement",
    "Page On-Call": "Page on-call",
    "Declare Incident": "Declare an incident",
    "Suspend Okta User": "Suspend the user in Okta",
    "End Okta Sessions": "End the user's Okta sessions",
    "Contain CrowdStrike Host": "Contain the host in CrowdStrike",
    "Isolate Defender Device": "Isolate the device in Microsoft Defender",
    "Unsuspend Okta User": "Unsuspend the user in Okta",
    "Lift CrowdStrike Containment": "Lift containment in CrowdStrike",
    "Release Defender Device": "Release the device in Microsoft Defender",
    "Block Data Store Public Access": "Block public access to data stores",
    "Revoke Data Store Sharing": "Revoke data store sharing",
    "Send Webhook": "Send a webhook",
    "Run Workflow": "Run a workflow",
    "Run Runbook": "Run a runbook",
    "Fix With AI": "Fix the code with AI",
  };

export function getPlaybookActionTitle(action: unknown): string {
  if (typeof action !== "string" || !action) {
    return "";
  }

  return SECURITY_PLAYBOOK_ACTION_TITLES[action] || action;
}

/*
 * How a run started, when nobody started it by hand (Common
 * SecurityPlaybookTrigger), in the words the approval email uses.
 */
const TRIGGER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "Case Opened": "Started on its own when the case opened",
  "Detection Added": "Started on its own for a new detection",
  "Triaged as Likely Malicious":
    "Started on its own when OneUptime AI read the case as likely malicious",
};

export interface PlaybookTarget {
  type: SecurityEntityType;
  value: string;
  reason: SecurityPlaybookTargetReason | null;
  state: SecurityPlaybookTargetState;
  // For a protected one: the protected entry it matches.
  protectedBy?: string | undefined;
}

export interface WaitingPlaybookStep {
  runId: string;
  caseId: string;
  playbookName: string;
  // 1 for the run's first step.
  stepNumber: number;
  stepTitle: string;
  // The users or hosts to tick or untick, every one ticked to start with.
  proposed: Array<PlaybookTarget>;
  // The ones on the project's protected list: shown, never acted on.
  protectedTargets: Array<PlaybookTarget>;
  // Who started the run, or how it started on its own.
  startedBy: string;
  startedByUserId: string | null;
  startedAt: string | null;
}

export interface PlaybookRunRecord {
  _id?: unknown;
  securityCaseId?: unknown;
  playbookName?: unknown;
  status?: unknown;
  trigger?: unknown;
  steps?: unknown;
  stepResults?: unknown;
  currentStepIndex?: unknown;
  triggeredByUserId?: unknown;
  triggeredByUser?: { name?: unknown; email?: unknown } | null;
  startedAt?: unknown;
  createdAt?: unknown;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isTargetState(value: unknown): value is SecurityPlaybookTargetState {
  return (SECURITY_PLAYBOOK_TARGET_STATES as ReadonlyArray<unknown>).includes(
    value,
  );
}

// A step's stored targets: an entry without a value, or in a state this build does not know, is dropped.
export function readPlaybookTargets(value: unknown): Array<PlaybookTarget> {
  if (!Array.isArray(value)) {
    return [];
  }

  const targets: Array<PlaybookTarget> = [];

  for (const item of value) {
    const record: Record<string, unknown> | null = readRecord(item);
    const targetValue: string = record ? readText(record["value"]).trim() : "";

    if (!record || !targetValue || !isTargetState(record["state"])) {
      continue;
    }

    const reason: unknown = record["reason"];
    const protectedBy: string = readText(record["protectedBy"]);

    targets.push({
      type: getEntityTerm(record["type"]).type,
      value: targetValue,
      reason:
        reason === "Grouped On" || reason === "Threat Intel" ? reason : null,
      state: record["state"],
      ...(protectedBy ? { protectedBy } : {}),
    });
  }

  return targets;
}

function readStepIndex(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

/*
 * The step a run waits on, as the approval shows it, or null for a run that
 * is not waiting for an approval. The step is the run's own snapshot, so a
 * playbook edited after the run started still shows what this run would do.
 */
export function readWaitingPlaybookStep(
  run: PlaybookRunRecord,
): WaitingPlaybookStep | null {
  if (run.status !== WAITING_FOR_APPROVAL) {
    return null;
  }

  const runId: string = readText(run._id);

  if (!runId) {
    return null;
  }

  const index: number = readStepIndex(run.currentStepIndex);
  const steps: Array<unknown> = Array.isArray(run.steps) ? run.steps : [];
  const results: Array<unknown> = Array.isArray(run.stepResults)
    ? run.stepResults
    : [];
  const step: Record<string, unknown> | null = readRecord(steps[index]);
  const result: Record<string, unknown> | null = readRecord(results[index]);
  const action: unknown = step?.["action"] ?? result?.["action"];
  const targets: Array<PlaybookTarget> = readPlaybookTargets(
    result?.["targets"],
  );
  const startedByUserId: string = readText(run.triggeredByUserId);
  const starterName: string =
    readText(run.triggeredByUser?.name) || readText(run.triggeredByUser?.email);
  const startedAt: string = readText(run.startedAt) || readText(run.createdAt);

  return {
    runId,
    caseId: readText(run.securityCaseId),
    // "" for a run whose playbook has no name: the card says "The playbook".
    playbookName: readText(run.playbookName).trim(),
    stepNumber: index + 1,
    stepTitle: getPlaybookActionTitle(action) || `Step ${index + 1}`,
    proposed: targets.filter((target: PlaybookTarget): boolean => {
      return target.state === "Proposed";
    }),
    protectedTargets: targets.filter((target: PlaybookTarget): boolean => {
      return target.state === "Protected";
    }),
    startedBy: startedByUserId
      ? starterName
        ? `Run by ${starterName}`
        : "Run by hand"
      : TRIGGER_DESCRIPTIONS[readText(run.trigger)] || "Started by hand",
    startedByUserId: startedByUserId || null,
    startedAt: startedAt || null,
  };
}

/*
 * Whether this person started the run: they cannot approve its steps, which
 * takes a second person. They may still reject them.
 */
export function didStartPlaybookRun(
  step: Pick<WaitingPlaybookStep, "startedByUserId">,
  userId: string | null | undefined,
): boolean {
  return (
    Boolean(step.startedByUserId) &&
    Boolean(userId) &&
    String(step.startedByUserId).toLowerCase() === String(userId).toLowerCase()
  );
}

export const SELF_APPROVAL_SENTENCE: string =
  "You started this run, so someone else must approve its steps.";

/*
 * What a proposed target is to the case, as the approval says it: what puts
 * it on the attacker's side.
 */
export function describePlaybookTarget(target: PlaybookTarget): string {
  if (target.state === "Protected") {
    return target.protectedBy &&
      target.protectedBy.toLowerCase() !== target.value.toLowerCase()
      ? `Protected (matches ${target.protectedBy}): never acted on`
      : "Protected: never acted on";
  }

  return target.reason === "Threat Intel"
    ? "Known to threat intel"
    : "What the case is grouped on";
}

/*
 * The targets an approval keeps, as the server reads them: the values of
 * the ticked ones. Undefined for a step that acts on nobody in particular,
 * which the server reads as every target of the step.
 */
export function getKeptTargetValues(
  step: Pick<WaitingPlaybookStep, "proposed">,
  kept: ReadonlySet<string>,
): Array<string> | undefined {
  if (step.proposed.length === 0) {
    return undefined;
  }

  return step.proposed
    .filter((target: PlaybookTarget): boolean => {
      return kept.has(target.value.toLowerCase());
    })
    .map((target: PlaybookTarget): string => {
      return target.value;
    });
}
