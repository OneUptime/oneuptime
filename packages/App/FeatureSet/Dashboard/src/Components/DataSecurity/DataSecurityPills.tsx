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
import DataSensitivity, {
  DATA_SENSITIVITY_DESCRIPTION,
} from "Common/Types/DataSecurity/DataSensitivity";
import {
  DATA_STORE_EXPOSURE_DESCRIPTION,
  DataStoreExposure,
} from "Common/Types/DataSecurity/DataStorePosture";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import Pill from "Common/UI/Components/Pill/Pill";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
  const translator: Translator = useTranslator();
  const sensitivity: DataSensitivity =
    (props.sensitivity as DataSensitivity | undefined) ||
    DataSensitivity.Public;

  return (
    <Pill
      text={sensitivity}
      color={SENSITIVITY_COLOR[sensitivity] || Gray500}
      tooltip={translator.translateText(
        DATA_SENSITIVITY_DESCRIPTION[sensitivity] || "",
      )}
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

  return (
    <Pill
      text={severity}
      color={SEVERITY_COLOR[severity] || Gray500}
    />
  );
};

export const ExposurePill: FunctionComponent<{
  exposure: DataStoreExposure | string | undefined;
}> = (props: {
  exposure: DataStoreExposure | string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const exposure: DataStoreExposure =
    (props.exposure as DataStoreExposure | undefined) ||
    DataStoreExposure.Unknown;

  return (
    <Pill
      text={exposure}
      color={EXPOSURE_COLOR[exposure] || Gray500}
      tooltip={translator.translateText(
        DATA_STORE_EXPOSURE_DESCRIPTION[exposure] || "",
      )}
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
    <Pill
      text={confidence}
      color={CONFIDENCE_COLOR[confidence] || Gray500}
    />
  );
};

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
      text={status}
      color={ISSUE_STATUS_COLOR[status] || Gray500}
    />
  );
};
