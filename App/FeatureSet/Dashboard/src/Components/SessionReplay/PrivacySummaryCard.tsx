import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import { DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS } from "Common/Types/Rum/SessionReplay";

/*
 * PrivacySummaryCard: what this application's replay policy means for a
 * real person whose screen it records, in five sentences.
 *
 * The policy card lists fields; a data-protection reviewer does not read
 * fields, they ask "what page text ends up in a recording, is the person
 * named, where are they, for how long, and did they agree?". Each sentence
 * answers one of those from the stored policy, names the default when the
 * field was never set (the default IS the policy then), and links to the
 * place that changes it.
 *
 * The sentence builder is pure and exported so every combination can be
 * pinned in a test without rendering.
 */

export interface PrivacySummaryInput {
  maskingMode?: string | null | undefined;
  consentMode?: string | null | undefined;
  captureUserIdentity?: boolean | null | undefined;
  captureGeo?: boolean | null | undefined;
  retentionInDays?: number | null | undefined;
  maskSelectors?: Array<string> | null | undefined;
  blockSelectors?: Array<string> | null | undefined;
  recordCanvas?: boolean | null | undefined;
}

export type PrivacySummaryKey =
  | "page-text"
  | "identity"
  | "location"
  | "retention"
  | "consent";

export interface PrivacySummarySentence {
  key: PrivacySummaryKey;
  /* The sentence itself. */
  text: string;
  /* True when the stored policy has no value and the default applies. */
  isDefault: boolean;
  /* Amber when the sentence describes something a reviewer should look at twice. */
  isSensitive: boolean;
  changeLabel: string;
}

/* Model defaults, mirrored so "never set" reads as what actually happens. */
const DEFAULT_MASKING_MODE: SessionReplayMaskingMode =
  SessionReplayMaskingMode.MaskSensitiveInputsOnly;
const DEFAULT_CONSENT_MODE: SessionReplayConsentMode =
  SessionReplayConsentMode.NotRequired;
const DEFAULT_CAPTURE_IDENTITY: boolean = true;
const DEFAULT_CAPTURE_GEO: boolean = true;

function countSelectors(value: Array<string> | null | undefined): number {
  return Array.isArray(value)
    ? value.filter((entry: string): boolean => {
        return typeof entry === "string" && entry.trim().length > 0;
      }).length
    : 0;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function buildPrivacySummary(
  input: PrivacySummaryInput,
): Array<PrivacySummarySentence> {
  const sentences: Array<PrivacySummarySentence> = [];

  /* ---- 1. Page text ---- */
  const maskingIsDefault: boolean =
    input.maskingMode === null || input.maskingMode === undefined;
  const maskingMode: string = maskingIsDefault
    ? DEFAULT_MASKING_MODE
    : (input.maskingMode as string);
  const maskCount: number = countSelectors(input.maskSelectors);
  const blockCount: number = countSelectors(input.blockSelectors);
  const extras: Array<string> = [];

  if (maskCount > 0) {
    extras.push(`${plural(maskCount, "extra selector")} masked`);
  }

  if (blockCount > 0) {
    extras.push(`${plural(blockCount, "selector")} blocked entirely`);
  }

  if (input.recordCanvas === true) {
    extras.push("canvas contents recorded");
  }

  const extrasCopy: string = extras.length > 0 ? ` ${extras.join("; ")}.` : "";

  let pageText: string;
  let pageTextSensitive: boolean;

  if (maskingMode === SessionReplayMaskingMode.MaskAllText) {
    pageText = `Page text is never recorded: every text node and every input is replaced before upload, so the replay is a wireframe.${extrasCopy}`;
    pageTextSensitive = false;
  } else if (maskingMode === SessionReplayMaskingMode.MaskInputsOnly) {
    pageText = `Readable page text is recorded; every input value is masked. An account number in a heading is visible in the replay, one typed into a form is not.${extrasCopy}`;
    pageTextSensitive = true;
  } else if (maskingMode === SessionReplayMaskingMode.MaskSensitiveInputsOnly) {
    pageText = `Readable page text and most input values are recorded; only passwords and fields your markup declares sensitive (card, one-time code) are masked. This is the least private mode.${extrasCopy}`;
    pageTextSensitive = true;
  } else {
    pageText = `The masking mode "${maskingMode}" is not one this dashboard knows; the recorder falls back to masking all text.${extrasCopy}`;
    pageTextSensitive = false;
  }

  sentences.push({
    key: "page-text",
    text: pageText,
    isDefault: maskingIsDefault,
    isSensitive: pageTextSensitive,
    changeLabel: "Change masking",
  });

  /* ---- 2. Identity ---- */
  const identityIsDefault: boolean =
    input.captureUserIdentity === null ||
    input.captureUserIdentity === undefined;
  const captureIdentity: boolean = identityIsDefault
    ? DEFAULT_CAPTURE_IDENTITY
    : (input.captureUserIdentity as boolean);

  sentences.push({
    key: "identity",
    text: captureIdentity
      ? "Recordings are identified: the user reference and traits your page supplies through identify() are stored with the session and searchable by user:. Erasure requests match on the reference."
      : "Recordings are pseudonymous: no user reference or traits are stored, so a session cannot be found by who the person was.",
    isDefault: identityIsDefault,
    isSensitive: captureIdentity,
    changeLabel: "Change identity capture",
  });

  /* ---- 3. Location ---- */
  const geoIsDefault: boolean =
    input.captureGeo === null || input.captureGeo === undefined;
  const captureGeo: boolean = geoIsDefault
    ? DEFAULT_CAPTURE_GEO
    : (input.captureGeo as boolean);

  sentences.push({
    key: "location",
    text: captureGeo
      ? "Only a country code is stored. The end user's IP address is never stored with a recording."
      : "No location is stored, not even a country. The end user's IP address is never stored with a recording.",
    isDefault: geoIsDefault,
    isSensitive: false,
    changeLabel: "Change location capture",
  });

  /* ---- 4. Retention ---- */
  const retentionIsDefault: boolean =
    input.retentionInDays === null ||
    input.retentionInDays === undefined ||
    !Number.isFinite(input.retentionInDays);
  const retentionInDays: number = retentionIsDefault
    ? DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS
    : (input.retentionInDays as number);

  sentences.push({
    key: "retention",
    text: `Recorded footage is deleted after ${plural(retentionInDays, "day")}; session metadata (duration, URLs, counts) is kept longer so the list stays accurate after playback expires.`,
    isDefault: retentionIsDefault,
    isSensitive: retentionInDays > 30,
    changeLabel: "Change retention",
  });

  /* ---- 5. Consent ---- */
  const consentIsDefault: boolean =
    input.consentMode === null || input.consentMode === undefined;
  const consentMode: string = consentIsDefault
    ? DEFAULT_CONSENT_MODE
    : (input.consentMode as string);

  let consentText: string;
  let consentSensitive: boolean;

  if (consentMode === SessionReplayConsentMode.RequireExplicit) {
    consentText =
      "Nothing is uploaded until your page calls OneUptimeReplay.grantConsent(); the recorder buffers in memory until then, and a session that never consents is never stored.";
    consentSensitive = false;
  } else if (consentMode === SessionReplayConsentMode.NotRequired) {
    consentText =
      "Recording does not wait for consent: you are asserting a lawful basis that needs no per-session grant, and uploads start on the first page load.";
    consentSensitive = true;
  } else {
    consentText = `The consent mode "${consentMode}" is not one this dashboard knows; check the policy.`;
    consentSensitive = true;
  }

  sentences.push({
    key: "consent",
    text: consentText,
    isDefault: consentIsDefault,
    isSensitive: consentSensitive,
    changeLabel: "Change consent",
  });

  return sentences;
}

export interface ComponentProps {
  policy: PrivacySummaryInput | null;
  /*
   * Where "Change" goes: an in-page anchor to the policy card, or a route.
   * A plain href so the card has no dependency on the router.
   */
  changeHref: string;
  /* The policy is still loading; the card says so rather than showing defaults as fact. */
  isLoading?: boolean | undefined;
}

const PrivacySummaryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sentences: Array<PrivacySummarySentence> = props.policy
    ? buildPrivacySummary(props.policy)
    : [];

  return (
    <Card
      title="What a recording contains"
      description="This application's replay policy, read as what it means for the person being recorded."
    >
      <div data-testid="privacy-summary">
        {props.isLoading || !props.policy ? (
          <div
            className="text-sm text-gray-500"
            data-testid="privacy-summary-loading"
          >
            Reading the policy…
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sentences.map((sentence: PrivacySummarySentence): ReactElement => {
              return (
                <li
                  key={sentence.key}
                  className="flex items-start gap-3 py-2.5"
                  data-testid={`privacy-summary-${sentence.key}`}
                  data-default={sentence.isDefault ? "true" : "false"}
                >
                  <Icon
                    icon={
                      sentence.isSensitive
                        ? IconProp.Alert
                        : IconProp.ShieldCheck
                    }
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      sentence.isSensitive
                        ? "text-amber-600"
                        : "text-emerald-600"
                    }`}
                  />
                  <div className="min-w-0 flex-1 text-sm text-gray-800">
                    {sentence.text}
                    {sentence.isDefault && (
                      <span className="ml-1 text-xs text-gray-500">
                        (default; never set for this application)
                      </span>
                    )}
                  </div>
                  <a
                    href={props.changeHref}
                    className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                    data-testid={`privacy-summary-change-${sentence.key}`}
                  >
                    {sentence.changeLabel}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
};

export default PrivacySummaryCard;
