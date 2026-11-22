import ScrubRuleReadersApi from "./ScrubRuleReadersApi";
import TelemetryFieldReadersList from "./TelemetryFieldReadersList";
import ObjectID from "Common/Types/ObjectID";
import {
  checkScrubRuleCustomRegex,
  SCRUB_RULE_CUSTOM_PATTERN_TYPE,
} from "Common/Types/Telemetry/ScrubRule";
import {
  ScrubRuleReadersRequest,
  TelemetryFieldReaders,
  TelemetryFieldSignal,
} from "Common/Types/Telemetry/TelemetryFieldReaders";
import { normalizeFormValue } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * WHAT A SCRUB RULE BEING WRITTEN, OR TURNED ON, WOULD TAKE AWAY (#10433).
 *
 * The log and trace scrub rule forms draw this under the rule's name, from
 * the form's values as they are now, and a rule's Enable draws it in its
 * question: the monitors, dashboards, saved views, recording rules and SLOs
 * that read what the rule would hide, and what Security Events would lose
 * (TelemetryFieldReadersList) - asked of the server a moment after the
 * values stop changing. It never blocks the save: it says, and the person
 * decides. With nothing that reads those values it draws nothing, and it
 * asks nothing of a rule that could not run (no pattern type, a custom
 * pattern that does not compile).
 */

export const SCRUB_RULE_READERS_UNCHECKED: string = translationKey(
  "What reads the values this rule would hide could not be checked.",
);

// How long the values must stay as they are before the server is asked.
export const SCRUB_RULE_READERS_DELAY_IN_MS: number = 400;

// A rule as the form or a row holds it: values of a form, or a saved rule's columns.
export interface ScrubRuleReadersPreviewRule {
  patternType?: unknown;
  customRegex?: unknown;
  scrubAction?: unknown;
  fieldsToScrub?: unknown;
  // The service picked, as a form or a row holds it: an id, an ObjectID, a service.
  service?: unknown;
  serviceId?: unknown;
}

function readText(value: unknown): string {
  const normalized: unknown = normalizeFormValue(value);

  if (typeof normalized === "string") {
    return normalized.trim();
  }

  return normalized instanceof ObjectID ? normalized.toString() : "";
}

// The service a rule is for, however the form or the row holds it: "" for every service.
export function readRuleServiceId(rule: ScrubRuleReadersPreviewRule): string {
  for (const value of [rule.serviceId, rule.service]) {
    const normalized: unknown = normalizeFormValue(value);
    let id: string = readText(normalized);

    if (!id && normalized && typeof normalized === "object") {
      const record: Record<string, unknown> = normalized as Record<
        string,
        unknown
      >;
      id = readText(record["_id"]) || readText(record["id"]);
    }

    if (ObjectID.isValidUUID(id)) {
      return id;
    }
  }

  return "";
}

/*
 * The question to ask of the server for a rule, or null when there is none
 * to ask: no pattern type picked, or a custom pattern that cannot run.
 */
export function getScrubRuleReadersRequest(
  signal: TelemetryFieldSignal,
  rule: ScrubRuleReadersPreviewRule,
): ScrubRuleReadersRequest | null {
  const patternType: string = readText(rule.patternType);
  const customRegex: string =
    typeof normalizeFormValue(rule.customRegex) === "string"
      ? (normalizeFormValue(rule.customRegex) as string)
      : "";

  if (!patternType) {
    return null;
  }

  if (
    patternType === SCRUB_RULE_CUSTOM_PATTERN_TYPE &&
    checkScrubRuleCustomRegex(customRegex) !== null
  ) {
    return null;
  }

  const request: ScrubRuleReadersRequest = { signal, patternType };
  const scrubAction: string = readText(rule.scrubAction);
  const fieldsToScrub: string = readText(rule.fieldsToScrub);
  const serviceId: string = readRuleServiceId(rule);

  if (patternType === SCRUB_RULE_CUSTOM_PATTERN_TYPE) {
    request.customRegex = customRegex;
  }

  if (scrubAction) {
    request.scrubAction = scrubAction;
  }

  if (fieldsToScrub) {
    request.fieldsToScrub = fieldsToScrub;
  }

  if (serviceId) {
    request.serviceId = serviceId;
  }

  return request;
}

export interface ComponentProps {
  signal: TelemetryFieldSignal;
  rule: ScrubRuleReadersPreviewRule;
  dataTestId?: string | undefined;
}

const ScrubRuleReadersPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const request: ScrubRuleReadersRequest | null = getScrubRuleReadersRequest(
    props.signal,
    props.rule,
  );
  const requestKey: string = request ? JSON.stringify(request) : "";
  const [readers, setReaders] = useState<TelemetryFieldReaders | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!request) {
      setReaders(null);
      setError("");
      return;
    }

    let isCurrent: boolean = true;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      ScrubRuleReadersApi.getReaders(request)
        .then((answer: TelemetryFieldReaders) => {
          if (isCurrent) {
            setReaders(answer);
            setError("");
          }
        })
        .catch((err: unknown) => {
          if (isCurrent) {
            setReaders(null);
            setError(err instanceof Error ? err.message : String(err));
          }
        });
    }, SCRUB_RULE_READERS_DELAY_IN_MS);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [requestKey]);

  if (!request) {
    return <></>;
  }

  if (error) {
    return (
      <p
        className="mt-2 text-sm text-gray-600"
        data-testid={`${props.dataTestId || "scrub-rule-readers"}-unchecked`}
      >
        {translator.translateText(SCRUB_RULE_READERS_UNCHECKED)}
      </p>
    );
  }

  if (!readers) {
    return <></>;
  }

  return (
    <div
      className="mt-2 text-sm text-gray-700"
      data-testid={props.dataTestId || "scrub-rule-readers"}
    >
      <TelemetryFieldReadersList readers={readers} />
    </div>
  );
};

export default ScrubRuleReadersPreview;
