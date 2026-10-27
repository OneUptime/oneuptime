import { ThreatIntelIndicatorType } from "Common/Types/SecurityEvent/ThreatIntelConstants";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  INDICATOR_TYPE_DOCS,
  UNSCORED_CONFIDENCE,
} from "./HowItWorks/ThreatIntelGuide";
import RelativeTimeCell from "./RelativeTimeCell";

/*
 * The Indicators table's Type and Confidence, in the words the threat intel
 * guide (and the docs page's "What gets ingested" table) use: "IPv4 address"
 * and "File hash (SHA-256)" rather than the stored ipv4-addr and
 * file-hash-sha256, and "Not scored" rather than a 0 that read as the lowest
 * confidence, while an unscored indicator is treated as Medium.
 */

// The guide's name for a stored type; a type it does not know reads as stored.
export function getIndicatorTypeLabel(type: string | undefined): string {
  if (!type) {
    return "";
  }

  return INDICATOR_TYPE_DOCS[type as ThreatIntelIndicatorType]?.label || type;
}

// Whether a stored confidence is the feed saying nothing (STIX's 0, or none).
export function isIndicatorUnscored(
  confidence: number | null | undefined,
): boolean {
  return (
    confidence === undefined ||
    confidence === null ||
    !Number.isFinite(Number(confidence)) ||
    Number(confidence) <= UNSCORED_CONFIDENCE
  );
}

// The Type filter: one option a type, named as the column names it.
export function getIndicatorTypeFilterOptions(): Array<DropdownOption> {
  return Object.values(ThreatIntelIndicatorType).map(
    (type: ThreatIntelIndicatorType): DropdownOption => {
      return {
        label: INDICATOR_TYPE_DOCS[type].label,
        value: type,
      };
    },
  );
}

export interface IndicatorTypeCellProps {
  type: string | undefined;
}

export const IndicatorTypeCell: FunctionComponent<IndicatorTypeCellProps> = (
  props: IndicatorTypeCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string = getIndicatorTypeLabel(props.type);

  if (!label) {
    return <span className="text-gray-500">-</span>;
  }

  return (
    <span data-testid="threat-intel-indicator-type" title={props.type}>
      {label === props.type ? label : translator.translateText(label)}
    </span>
  );
};

export interface IndicatorConfidenceCellProps {
  confidence: number | null | undefined;
}

export const IndicatorConfidenceCell: FunctionComponent<
  IndicatorConfidenceCellProps
> = (props: IndicatorConfidenceCellProps): ReactElement => {
  const translator: Translator = useTranslator();

  if (isIndicatorUnscored(props.confidence)) {
    return (
      <span
        className="text-gray-500"
        data-testid="threat-intel-indicator-confidence"
      >
        {translator.translateText("Not scored")}
      </span>
    );
  }

  return (
    <span data-testid="threat-intel-indicator-confidence">
      {translator.formatNumber(Number(props.confidence))}
    </span>
  );
};

/*
 * A date the analytics wire hands back - a DateTime64 as a string, or a
 * Date - as a Date, or null when there is none or it does not read as one.
 */
export function toIndicatorDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const millis: number = new Date(value as string | Date).getTime();

  return Number.isFinite(millis) ? new Date(millis) : null;
}

export interface IndicatorValidUntilCellProps {
  validUntil: unknown;
}

/*
 * When an indicator stops matching, as how far off ("in 29 days"), or how
 * long ago for one that expired, with the date and time under the pointer
 * (RelativeTimeCell); none, the quiet dash. A column of full dates ran the
 * Indicators table past its card at 1280.
 */
export const IndicatorValidUntilCell: FunctionComponent<
  IndicatorValidUntilCellProps
> = (props: IndicatorValidUntilCellProps): ReactElement => {
  const validUntil: Date | null = toIndicatorDate(props.validUntil);

  if (!validUntil) {
    return <TableEmptyValue />;
  }

  return <RelativeTimeCell date={validUntil} />;
};
