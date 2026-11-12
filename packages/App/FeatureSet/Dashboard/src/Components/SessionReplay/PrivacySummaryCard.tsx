import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  formatList,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import { DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS } from "Common/Types/Rum/SessionReplay";

/*
 * PrivacySummaryCard: what this application's replay policy means for a
 * real person whose screen it records, in five sentences - six while
 * same-origin trace propagation is on.
 *
 * The policy card lists fields; a data-protection reviewer does not read
 * fields, they ask "what page text ends up in a recording, is the person
 * named, where are they, for how long, and did they agree?". Each sentence
 * answers one of those from the stored policy, names the default when the
 * field was never set (the default IS the policy then), and links to the
 * place that changes it.
 *
 * The sixth sentence ("backend-link") exists only while the recorder puts
 * the session id on the page's own requests. That is what lets backend
 * telemetry naming the user lead to a recording, and what carries the id
 * past the customer's backend; with the switch off there is nothing to say.
 *
 * The sentence builder is pure and exported so every combination can be
 * pinned in a test without rendering. Every sentence and Change label is a
 * whole sentence of the Dashboard's locales, looked up with the translator
 * the card hands in; without one they read in English, word for word.
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
  sameOriginTracePropagation?: boolean | null | undefined;
}

export type PrivacySummaryKey =
  | "page-text"
  | "identity"
  | "backend-link"
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
const DEFAULT_SAME_ORIGIN_TRACE_PROPAGATION: boolean = true;

// What the sentences read without a translator: English, as a test reads them.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

function countSelectors(value: Array<string> | null | undefined): number {
  return Array.isArray(value)
    ? value.filter((entry: string): boolean => {
        return typeof entry === "string" && entry.trim().length > 0;
      }).length
    : 0;
}

export function buildPrivacySummary(
  input: PrivacySummaryInput,
  translator: Translator = ENGLISH,
): Array<PrivacySummarySentence> {
  const sentences: Array<PrivacySummarySentence> = [];

  // A fixed line in the reader's language; a line is a string.
  const translateLine: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  /* ---- 1. Page text ---- */
  const maskingIsDefault: boolean =
    input.maskingMode === null || input.maskingMode === undefined;
  const maskingMode: string = maskingIsDefault
    ? DEFAULT_MASKING_MODE
    : (input.maskingMode as string);
  const maskCount: number = countSelectors(input.maskSelectors);
  const blockCount: number = countSelectors(input.blockSelectors);

  /*
   * What the policy adds to its mode, each fact whole in the language of
   * the sentence they are listed in.
   */
  const describeExtras: (sentence: Translator) => Array<string> = (
    sentence: Translator,
  ): Array<string> => {
    const extras: Array<string> = [];

    if (maskCount > 0) {
      extras.push(
        sentence.translatePlural(
          {
            one: "{{count}} extra selector masked",
            other: "{{count}} extra selectors masked",
          },
          maskCount,
        ),
      );
    }

    if (blockCount > 0) {
      extras.push(
        sentence.translatePlural(
          {
            one: "{{count}} selector blocked entirely",
            other: "{{count}} selectors blocked entirely",
          },
          blockCount,
        ),
      );
    }

    if (input.recordCanvas === true) {
      extras.push(
        sentence.translateText("canvas contents recorded") ||
          "canvas contents recorded",
      );
    }

    return extras;
  };

  /*
   * After the mode's sentence, one sentence of its own: the facts listed
   * with the reader's separator ("、" in Japanese and Chinese, "، " in
   * Arabic and Persian) and ended with the reader's full stop, never an
   * English "; " and "." inside a Chinese line.
   */
  const hasExtras: boolean =
    maskCount > 0 || blockCount > 0 || input.recordCanvas === true;
  const extrasSentence: string = hasExtras
    ? translator.translateTemplate("Also: {{facts}}.", {
        facts: composedValue((sentence: Translator): string => {
          return formatList(describeExtras(sentence), sentence);
        }),
      })
    : "";

  let modeText: string;
  let pageTextSensitive: boolean;

  if (maskingMode === SessionReplayMaskingMode.MaskAllText) {
    modeText = translateLine(
      "Page text is never recorded: every text node and every input is replaced before upload, so the replay is a wireframe.",
    );
    pageTextSensitive = false;
  } else if (maskingMode === SessionReplayMaskingMode.MaskInputsOnly) {
    modeText = translateLine(
      "Readable page text is recorded; every input value is masked. An account number in a heading is visible in the replay, one typed into a form is not.",
    );
    pageTextSensitive = true;
  } else if (maskingMode === SessionReplayMaskingMode.MaskSensitiveInputsOnly) {
    modeText = translateLine(
      "Readable page text and most input values are recorded; only passwords and fields your markup declares sensitive (card, one-time code) are masked. This is the least private mode.",
    );
    pageTextSensitive = true;
  } else {
    modeText = translator.translateTemplate(
      'The masking mode "{{mode}}" is not one this dashboard knows; the recorder falls back to masking all text.',
      { mode: maskingMode },
      { setsValuesApart: true },
    );
    pageTextSensitive = false;
  }

  sentences.push({
    key: "page-text",
    text: joinSentences([modeText, extrasSentence]),
    isDefault: maskingIsDefault,
    isSensitive: pageTextSensitive,
    changeLabel: translateLine("Change masking"),
  });

  /* ---- 2. Identity ---- */
  const identityIsDefault: boolean =
    input.captureUserIdentity === null ||
    input.captureUserIdentity === undefined;
  const captureIdentity: boolean = identityIsDefault
    ? DEFAULT_CAPTURE_IDENTITY
    : (input.captureUserIdentity as boolean);

  const backendLinkIsDefault: boolean =
    input.sameOriginTracePropagation === null ||
    input.sameOriginTracePropagation === undefined;
  const backendLink: boolean = backendLinkIsDefault
    ? DEFAULT_SAME_ORIGIN_TRACE_PROPAGATION
    : (input.sameOriginTracePropagation as boolean);

  /*
   * "Cannot be found by who the person was" stops being true once backend
   * telemetry is linked: a span or log naming the user leads to the
   * recording. The pseudonymous sentence says so rather than overpromise.
   */
  let identityText: string;

  if (captureIdentity) {
    identityText = translateLine(
      "Recordings are identified: the user reference and traits your page supplies through identify() are stored with the session and searchable by user:. Erasure requests match on the reference.",
    );
  } else if (backendLink) {
    identityText = translateLine(
      "Recordings are pseudonymous: no user reference or traits are stored with the session. Backend telemetry linked to it by same-origin trace propagation can still name the person, if your backend records who made each request.",
    );
  } else {
    identityText = translateLine(
      "Recordings are pseudonymous: no user reference or traits are stored, so a session cannot be found by who the person was.",
    );
  }

  sentences.push({
    key: "identity",
    text: identityText,
    isDefault: identityIsDefault,
    isSensitive: captureIdentity,
    changeLabel: translateLine("Change identity capture"),
  });

  /* ---- 2b. Backend link (only while it is on) ---- */
  if (backendLink) {
    sentences.push({
      key: "backend-link",
      text: translateLine(
        "Same-origin requests carry this session's id to your backend while the session uploads, and your backend's OpenTelemetry forwards it to the services it calls, third parties included. Backend telemetry that names the user links to the recording. The visitor id is never sent.",
      ),
      isDefault: backendLinkIsDefault,
      isSensitive: true,
      changeLabel: translateLine("Change trace propagation"),
    });
  }

  /* ---- 3. Location ---- */
  const geoIsDefault: boolean =
    input.captureGeo === null || input.captureGeo === undefined;
  const captureGeo: boolean = geoIsDefault
    ? DEFAULT_CAPTURE_GEO
    : (input.captureGeo as boolean);

  sentences.push({
    key: "location",
    text: captureGeo
      ? translateLine(
          "Only a country code is stored. The end user's IP address is never stored with a recording.",
        )
      : translateLine(
          "No location is stored, not even a country. The end user's IP address is never stored with a recording.",
        ),
    isDefault: geoIsDefault,
    isSensitive: false,
    changeLabel: translateLine("Change location capture"),
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
    text: translator.translatePlural(
      {
        one: "Recorded footage is deleted after {{count}} day, and the session row - duration, URLs, counts, device and any identity label - expires with it; only the session's logs, spans and exceptions follow the telemetry retention.",
        other:
          "Recorded footage is deleted after {{count}} days, and the session row - duration, URLs, counts, device and any identity label - expires with it; only the session's logs, spans and exceptions follow the telemetry retention.",
      },
      retentionInDays,
    ),
    isDefault: retentionIsDefault,
    isSensitive: retentionInDays > 30,
    changeLabel: translateLine("Change retention"),
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
    consentText = translateLine(
      "Nothing is uploaded until your page calls OneUptimeReplay.grantConsent(); the recorder buffers in memory until then, and a session that never consents is never stored.",
    );
    consentSensitive = false;
  } else if (consentMode === SessionReplayConsentMode.NotRequired) {
    consentText = translateLine(
      "Recording does not wait for consent: you are asserting a lawful basis that needs no per-session grant, and uploads start on the first page load.",
    );
    consentSensitive = true;
  } else {
    consentText = translator.translateTemplate(
      'The consent mode "{{mode}}" is not one this dashboard knows; check the policy.',
      { mode: consentMode },
      { setsValuesApart: true },
    );
    consentSensitive = true;
  }

  sentences.push({
    key: "consent",
    text: consentText,
    isDefault: consentIsDefault,
    isSensitive: consentSensitive,
    changeLabel: translateLine("Change consent"),
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
  const translator: Translator = useTranslator();
  const sentences: Array<PrivacySummarySentence> = props.policy
    ? buildPrivacySummary(props.policy, translator)
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
            {translator.translateText("Reading the policy…")}
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
                        {translator.translateText(
                          "(default; never set for this application)",
                        )}
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
