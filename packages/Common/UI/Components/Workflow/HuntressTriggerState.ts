import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * Where a Huntress trigger stands, from what its workflow keeps of the last
 * request Huntress sent (Workflow.isWebhookSigningSecretSet,
 * lastWebhookRequestAt, lastWebhookError, lastWebhookErrorAt), and every
 * sentence its panel in the Builder says (HuntressTriggerPanel).
 *
 * Pure: no React, no DOM, no browser config, so App's tests and the docs
 * suites read it.
 */

export enum HuntressTriggerState {
  // Requests are refused until the endpoint's signing secret is saved.
  NeedsSigningSecret = "needs-signing-secret",
  // Set up, and nothing has arrived yet.
  Waiting = "waiting",
  // Huntress reaches it.
  Receiving = "receiving",
  // The last request was refused, and nothing has been accepted since.
  Failing = "failing",
}

export interface HuntressTriggerFacts {
  isWebhookSigningSecretSet?: boolean | null | undefined;
  lastWebhookRequestAt?: Date | string | null | undefined;
  lastWebhookError?: string | null | undefined;
  lastWebhookErrorAt?: Date | string | null | undefined;
}

// How often the panel reads the workflow again while it waits for Huntress.
export const HUNTRESS_TRIGGER_POLL_INTERVAL_MS: number = 5000;

// And for how long at most, so a dialog left open does not poll forever.
export const HUNTRESS_TRIGGER_POLL_FOR_MS: number = 10 * 60 * 1000;

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return isNaN(time) ? null : time;
}

/*
 * An error newer than the last accepted request means requests are being
 * refused now; an older one was put right since.
 */
export function getHuntressTriggerState(
  facts: HuntressTriggerFacts,
): HuntressTriggerState {
  const lastRequestAt: number | null = toTime(facts.lastWebhookRequestAt);
  const lastErrorAt: number | null = toTime(facts.lastWebhookErrorAt);

  if (
    facts.lastWebhookError &&
    (lastRequestAt === null ||
      (lastErrorAt !== null && lastErrorAt > lastRequestAt))
  ) {
    return HuntressTriggerState.Failing;
  }

  if (!facts.isWebhookSigningSecretSet) {
    return HuntressTriggerState.NeedsSigningSecret;
  }

  if (lastRequestAt !== null) {
    return HuntressTriggerState.Receiving;
  }

  return HuntressTriggerState.Waiting;
}

// Whether the panel reads the workflow again, to see Huntress arrive.
export function isWaitingForHuntress(state: HuntressTriggerState): boolean {
  return state !== HuntressTriggerState.Receiving;
}

// The three things to do in Huntress, in the order Huntress asks for them.
export enum HuntressSetupStep {
  Endpoint = "endpoint",
  Secret = "secret",
  Test = "test",
}

export const HUNTRESS_SETUP_STEPS: Array<HuntressSetupStep> = [
  HuntressSetupStep.Endpoint,
  HuntressSetupStep.Secret,
  HuntressSetupStep.Test,
];

/*
 * Where a step stands: done, the one to do next (current - there is one at
 * most), or one after it (upcoming).
 */
export enum HuntressSetupStepStatus {
  Done = "done",
  Current = "current",
  Upcoming = "upcoming",
}

/*
 * Which steps are done, from what the workflow keeps.
 *
 * - The endpoint is added once Huntress has reached the URL - a request let
 *   in or refused - or once its signing secret is saved: Huntress issues a
 *   secret only for an endpoint it has, so the secret proves the endpoint.
 *   That keeps the step done after a request refused for want of a secret,
 *   when saving the secret clears the refusal (WorkflowService).
 * - The secret is saved once the workflow says so.
 * - The test is done once a request is let in.
 *
 * The first step not done is the one to do next.
 */
export function getHuntressSetupStepStatuses(
  facts: HuntressTriggerFacts,
): Record<HuntressSetupStep, HuntressSetupStepStatus> {
  const isSecretSaved: boolean = Boolean(facts.isWebhookSigningSecretSet);
  const hasReceived: boolean = toTime(facts.lastWebhookRequestAt) !== null;

  const isDone: Record<HuntressSetupStep, boolean> = {
    [HuntressSetupStep.Endpoint]:
      hasReceived || Boolean(facts.lastWebhookError) || isSecretSaved,
    [HuntressSetupStep.Secret]: isSecretSaved,
    [HuntressSetupStep.Test]: hasReceived,
  };

  const next: HuntressSetupStep | undefined = HUNTRESS_SETUP_STEPS.find(
    (step: HuntressSetupStep): boolean => {
      return !isDone[step];
    },
  );

  const statuses: Partial<Record<HuntressSetupStep, HuntressSetupStepStatus>> =
    {};

  for (const step of HUNTRESS_SETUP_STEPS) {
    statuses[step] = isDone[step]
      ? HuntressSetupStepStatus.Done
      : step === next
        ? HuntressSetupStepStatus.Current
        : HuntressSetupStepStatus.Upcoming;
  }

  return statuses as Record<HuntressSetupStep, HuntressSetupStepStatus>;
}

export const HUNTRESS_TRIGGER_STATE_LABELS: Record<
  HuntressTriggerState,
  string
> = {
  [HuntressTriggerState.NeedsSigningSecret]: translationKey(
    "Signing secret needed",
  ),
  [HuntressTriggerState.Waiting]: translationKey("Waiting for Huntress"),
  [HuntressTriggerState.Receiving]: translationKey("Receiving reports"),
  [HuntressTriggerState.Failing]: translationKey("Refusing requests"),
};

/*
 * A first look at a pasted signing secret, before it is sent: Huntress's
 * secrets are "whsec_" and base64. The server checks it properly
 * (WorkflowService.readWebhookSigningSecret); this only catches the usual
 * slips - the webhook URL pasted back, a secret cut short - while the
 * dialog is open.
 */
const SECRET_PATTERN: RegExp = /^(whsec_)?[A-Za-z0-9+/]{16,}={0,2}$/;

// The longest a pasted secret is looked at: Svix secrets are far shorter.
const MAX_SECRET_LENGTH: number = 1100;

export const HUNTRESS_SIGNING_SECRET_PROBLEM: string = translationKey(
  "This is not a signing secret. In Huntress, choose View Signing Secret on the endpoint and copy all of it: it starts with whsec_.",
);

export function getHuntressSigningSecretProblem(
  value: string | null | undefined,
): string | null {
  const secret: string = (value || "").trim();

  if (!secret) {
    return null;
  }

  if (secret.length > MAX_SECRET_LENGTH || !SECRET_PATTERN.test(secret)) {
    return HUNTRESS_SIGNING_SECRET_PROBLEM;
  }

  return null;
}

/*
 * Every sentence the panel shows, in English. Each is looked up whole in the
 * Dashboard's locale files; the buttons, the dialog and the pill translate
 * their own text.
 */
export const HuntressTriggerPanelCopy: {
  readonly title: string;
  readonly stepEndpointTitle: string;
  readonly stepEndpointBody: string;
  readonly stepSecretTitle: string;
  readonly stepSecretBody: string;
  readonly stepTestTitle: string;
  readonly stepTestBody: string;
  readonly stepTurnOnTitle: string;
  readonly stepTurnOnBody: string;
  readonly stepDone: string;
  readonly webhookUrl: string;
  readonly copyUrl: string;
  readonly copyUrlTitle: string;
  readonly copied: string;
  readonly secretSaved: string;
  readonly saveSecret: string;
  readonly replaceSecret: string;
  readonly secretDialogDescription: string;
  readonly secretField: string;
  readonly lastRefused: string;
  readonly lastEvent: string;
  readonly urlStartsNothing: string;
  readonly loadError: string;
  readonly tryAgain: string;
} = {
  title: "Huntress",
  stepEndpointTitle: translationKey("Add a webhook endpoint in Huntress"),
  stepEndpointBody: translationKey(
    "In Huntress, open Integrations, choose Add an Integration, then Webhooks, and Add Endpoint. Paste this URL, and turn on Incident Reports.",
  ),
  stepSecretTitle: translationKey("Save the endpoint's signing secret"),
  stepSecretBody: translationKey(
    "In Huntress, open the endpoint's menu (⋯) and choose View Signing Secret. Requests are refused until it is saved here.",
  ),
  stepTestTitle: translationKey("Send a test"),
  // The panel reads the workflow again every few seconds while it waits.
  stepTestBody: translationKey(
    "In Huntress, choose Send Test on the endpoint. It shows up here within a few seconds.",
  ),
  /*
   * The last step while the workflow is off, as the template creates it:
   * Huntress's test is refused until it is on, so the step says to turn it
   * on first, in the docs' words for the same step. {{switch}} is the
   * switch's own name (WORKFLOW_ENABLED_SWITCH_LABEL), drawn in bold.
   */
  stepTurnOnTitle: translationKey("Turn the workflow on, and send a test"),
  stepTurnOnBody: translationKey(
    "Switch {{switch}} on at the top of the Builder. Then, in Huntress, choose Send Test on the endpoint. It shows up here within a few seconds.",
  ),
  // Read out after a step's title once it is done: its check is drawn only.
  stepDone: translationKey("Done"),
  webhookUrl: translationKey("Webhook URL"),
  copyUrl: translationKey("Copy URL"),
  copyUrlTitle: translationKey("Copy webhook URL"),
  copied: translationKey("Copied!"),
  secretSaved: translationKey("Signing secret saved"),
  saveSecret: "Save Signing Secret",
  replaceSecret: "Replace Signing Secret",
  secretDialogDescription:
    "In Huntress, open the endpoint's menu (⋯), choose View Signing Secret, and paste it here. It is encrypted, and never shown again.",
  secretField: "Signing Secret",
  lastRefused: translationKey("The last request was refused"),
  lastEvent: translationKey("Last event"),
  /*
   * Under the URL, which is shown whole (the Webhook trigger masks its own):
   * the URL is an address, not a password.
   */
  urlStartsNothing: translationKey(
    "Only requests signed with the endpoint's signing secret start this workflow.",
  ),
  // Beside Try again, which reads the workflow again.
  loadError: translationKey("Could not read what Huntress last sent."),
  tryAgain: translationKey("Try again"),
};
