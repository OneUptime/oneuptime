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
  stepTestBody: translationKey(
    "In Huntress, choose Send Test on the endpoint. This changes as soon as the test arrives.",
  ),
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
  urlStartsNothing: translationKey(
    "The URL starts nothing on its own: Huntress signs every request with the endpoint's signing secret, and a request that is not signed with it is refused.",
  ),
  loadError: translationKey(
    "Could not read what Huntress last sent. Close this dialog and open it again.",
  ),
};
