import {
  Blue500,
  Gray500,
  Green500,
  Orange500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import DataConfidence from "Common/Types/DataSecurity/DataConfidence";
import DataSecurityIssueStatus from "Common/Types/DataSecurity/DataSecurityIssueStatus";
import DataSecurityIssueResolution, {
  isDataSecurityIssueResolution,
} from "Common/Types/DataSecurity/DataSecurityIssueResolution";
import {
  RESOLUTION_LABELS,
  RESOLUTION_TOOLTIPS,
  ResolutionTone,
  getResolutionTone,
} from "./IssueResolutionCopy";
import DataSensitivity, {
  DATA_SENSITIVITY_DESCRIPTION,
} from "Common/Types/DataSecurity/DataSensitivity";
import {
  DATA_STORE_EXPOSURE_DESCRIPTION,
  DataStoreExposure,
} from "Common/Types/DataSecurity/DataStorePosture";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Pill from "Common/UI/Components/Pill/Pill";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The few badges every Data Security page shows, one colour meaning one
 * thing everywhere: red is "harm follows" (Restricted data, a Critical
 * issue, a public store), orange the next step down, green "fine". Each
 * badge says its meaning on hover, from the same catalog line the docs
 * use. Pill translates the value it is handed; the hover text is
 * translated here.
 */

export const SENSITIVITY_COLOR: Readonly<Record<DataSensitivity, Color>> = {
  [DataSensitivity.Restricted]: Red500,
  [DataSensitivity.Confidential]: Orange500,
  [DataSensitivity.Internal]: Blue500,
  [DataSensitivity.Public]: Gray500,
};

export const SEVERITY_COLOR: Readonly<Record<SecuritySeverity, Color>> = {
  [SecuritySeverity.Critical]: Red500,
  [SecuritySeverity.High]: Orange500,
  [SecuritySeverity.Medium]: Yellow500,
  [SecuritySeverity.Low]: Blue500,
};

export const EXPOSURE_COLOR: Readonly<Record<DataStoreExposure, Color>> = {
  [DataStoreExposure.Public]: Red500,
  [DataStoreExposure.OtherAccounts]: Orange500,
  [DataStoreExposure.InternetReachable]: Yellow500,
  [DataStoreExposure.Private]: Green500,
  [DataStoreExposure.Unknown]: Gray500,
};

export const CONFIDENCE_COLOR: Readonly<Record<DataConfidence, Color>> = {
  [DataConfidence.High]: Green500,
  [DataConfidence.Medium]: Yellow500,
  [DataConfidence.Low]: Gray500,
};

export const ISSUE_STATUS_COLOR: Readonly<
  Record<DataSecurityIssueStatus, Color>
> = {
  [DataSecurityIssueStatus.Open]: Red500,
  [DataSecurityIssueStatus.Accepted]: Yellow500,
  [DataSecurityIssueStatus.Resolved]: Green500,
  [DataSecurityIssueStatus.NotAnIssue]: Gray500,
};

export const SensitivityPill: FunctionComponent<{
  sensitivity: DataSensitivity | string | undefined;
}> = (props: {
  sensitivity: DataSensitivity | string | undefined;
}): ReactElement => {
  const sensitivity: DataSensitivity =
    (props.sensitivity as DataSensitivity | undefined) ||
    DataSensitivity.Public;

  return (
    <Pill
      text={sensitivity}
      color={SENSITIVITY_COLOR[sensitivity] || Gray500}
      // In English: the badge looks its hover tip up, once (#8067).
      tooltip={DATA_SENSITIVITY_DESCRIPTION[sensitivity] || undefined}
    />
  );
};

export const SeverityPill: FunctionComponent<{
  severity: SecuritySeverity | string | undefined;
}> = (props: {
  severity: SecuritySeverity | string | undefined;
}): ReactElement => {
  const severity: SecuritySeverity =
    (props.severity as SecuritySeverity | undefined) || SecuritySeverity.Low;

  return <Pill text={severity} color={SEVERITY_COLOR[severity] || Gray500} />;
};

export const ExposurePill: FunctionComponent<{
  exposure: DataStoreExposure | string | undefined;
}> = (props: {
  exposure: DataStoreExposure | string | undefined;
}): ReactElement => {
  const exposure: DataStoreExposure =
    (props.exposure as DataStoreExposure | undefined) ||
    DataStoreExposure.Unknown;

  return (
    <Pill
      text={exposure}
      color={EXPOSURE_COLOR[exposure] || Gray500}
      // In English: the badge looks its hover tip up, once (#8067).
      tooltip={DATA_STORE_EXPOSURE_DESCRIPTION[exposure] || undefined}
    />
  );
};

export const ConfidencePill: FunctionComponent<{
  confidence: DataConfidence | string | undefined;
}> = (props: {
  confidence: DataConfidence | string | undefined;
}): ReactElement => {
  const confidence: DataConfidence =
    (props.confidence as DataConfidence | undefined) || DataConfidence.Low;

  return (
    <Pill text={confidence} color={CONFIDENCE_COLOR[confidence] || Gray500} />
  );
};

/*
 * The words of the Open status. An open issue reads "Open" in English, but
 * "Open" alone is every Open button's verb, and every language words it so
 * ("Öffnen", "Ouvrir", "Abrir"). So the status has a key of its own, "Open
 * (status)", worded as the state ("Offen"), which English - and a language
 * with no wording of its own - reads "Open" (Common/Types/MeaningKeys). The
 * other statuses are words of their own.
 */
export const OPEN_STATUS_TERM: string = translationKey("Open (status)");

// Every status's key, as its pill and a filter's option look it up.
export const ISSUE_STATUS_LABELS: Readonly<
  Record<DataSecurityIssueStatus, string>
> = {
  [DataSecurityIssueStatus.Open]: OPEN_STATUS_TERM,
  [DataSecurityIssueStatus.Accepted]: translationKey("Accepted"),
  [DataSecurityIssueStatus.Resolved]: translationKey("Resolved"),
  [DataSecurityIssueStatus.NotAnIssue]: translationKey("Not an issue"),
};

/*
 * A status's key, for the pill or the filter to look up once, where it is
 * drawn. One a newer server added reads as it is stored.
 */
export function getIssueStatusLabel(
  status: DataSecurityIssueStatus | string,
): string {
  return ISSUE_STATUS_LABELS[status as DataSecurityIssueStatus] || status;
}

/*
 * The statuses as a list's filter offers them, in the words of the pill:
 * each the status's key, which the menu and the chip look up alike.
 */
export function getIssueStatusOptions(
  statuses: ReadonlyArray<DataSecurityIssueStatus>,
): Array<DropdownOption> {
  return statuses.map((status: DataSecurityIssueStatus): DropdownOption => {
    return {
      value: status,
      label: getIssueStatusLabel(status),
    };
  });
}

export const IssueStatusPill: FunctionComponent<{
  status: DataSecurityIssueStatus | string | undefined;
}> = (props: {
  status: DataSecurityIssueStatus | string | undefined;
}): ReactElement => {
  const status: DataSecurityIssueStatus =
    (props.status as DataSecurityIssueStatus | undefined) ||
    DataSecurityIssueStatus.Open;

  return (
    <Pill
      text={getIssueStatusLabel(status)}
      color={ISSUE_STATUS_COLOR[status] || Gray500}
    />
  );
};

// How a resolution looks: fixed green, only contained amber, closed another way grey.
const RESOLUTION_TONE_COLOR: Readonly<Record<ResolutionTone, Color>> = {
  [ResolutionTone.Fixed]: Green500,
  [ResolutionTone.Contained]: Yellow500,
  [ResolutionTone.Closed]: Gray500,
  [ResolutionTone.CameBack]: Red500,
};

/*
 * Where an issue stands, and for a resolved one how it was resolved
 * (#10368): "Fixed in code", "Contained at ingest" - never fixed - or
 * "Resolved by a person". One resolved before its resolution was recorded
 * reads Resolved, as it did.
 */
export const IssueResolutionPill: FunctionComponent<{
  status: DataSecurityIssueStatus | string | undefined;
  resolution: DataSecurityIssueResolution | string | undefined | null;
}> = (props: {
  status: DataSecurityIssueStatus | string | undefined;
  resolution: DataSecurityIssueResolution | string | undefined | null;
}): ReactElement => {
  if (
    props.status !== DataSecurityIssueStatus.Resolved ||
    !isDataSecurityIssueResolution(props.resolution)
  ) {
    return <IssueStatusPill status={props.status} />;
  }

  return (
    <Pill
      text={RESOLUTION_LABELS[props.resolution]}
      color={RESOLUTION_TONE_COLOR[getResolutionTone(props.resolution)]}
      tooltip={RESOLUTION_TOOLTIPS[props.resolution]}
    />
  );
};
