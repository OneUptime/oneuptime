import { EnterpriseLicenseMode } from "../Identity/License/EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the retention override cards show above themselves when the
 * Enterprise license has lapsed, or is about to.
 *
 * Once the trial or the grace period is over, the server stops applying
 * retention overrides - the Community Edition's behaviour - and new
 * telemetry is kept for the project's default retention, whatever the cards
 * say. A license whose features leave retention overrides out stops them the
 * same way (NotIncluded). The cards alone would suggest the overrides still
 * apply, so the notice says they do not (and, before the lapse, that they
 * will stop). Telemetry already stored keeps the retention it was written
 * with, and the overrides apply again, unchanged, when a license is
 * activated.
 *
 * Nothing is shown with a valid license, on OneUptime Cloud (the plan
 * decides there) or while the license state is Unknown: the server keeps
 * applying the overrides when it cannot read the license, so the cards must
 * not claim they stopped.
 */

export const TELEMETRY_RETENTION_LAPSED_TITLE: string =
  "Enterprise license required: retention overrides are not applied, and they are read-only.";

export const TELEMETRY_RETENTION_LAPSED_DESCRIPTION: string =
  "Without a valid Enterprise license, new telemetry is kept for the project's default retention, whatever these overrides say. Telemetry already stored keeps the retention it was written with. Nothing configured here is deleted: activate or renew the Enterprise license in the Admin Dashboard and the overrides apply again.";

export const TELEMETRY_RETENTION_NOT_INCLUDED_TITLE: string =
  "Your Enterprise license does not include retention overrides: they are not applied, and they are read-only.";

export const TELEMETRY_RETENTION_NOT_INCLUDED_DESCRIPTION: string =
  "The installed license leaves retention overrides out, so new telemetry is kept for the project's default retention, whatever these overrides say. Nothing configured here is deleted: activate a license that includes retention overrides in the Admin Dashboard and they apply again.";

export const TELEMETRY_RETENTION_GRACE_TITLE: string =
  "No valid Enterprise license: retention overrides stop applying when the trial or grace period ends.";

export const TELEMETRY_RETENTION_GRACE_DESCRIPTION: string = `Retention overrides apply as configured during the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial of an installation with no license, or the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires. When it ends, new telemetry is kept for the project's default retention until an Enterprise license is activated in the Admin Dashboard.`;

export interface TelemetryRetentionNoticeCopy {
  type: AlertType;
  title: string;
  description: string;
  dataTestId: string;
}

/*
 * What to say for a license mode, or null when there is nothing to say (a
 * valid license, OneUptime Cloud, or an unknown license state).
 */
export const getTelemetryRetentionNoticeCopy: (
  mode: EnterpriseLicenseMode,
) => TelemetryRetentionNoticeCopy | null = (
  mode: EnterpriseLicenseMode,
): TelemetryRetentionNoticeCopy | null => {
  if (mode === EnterpriseLicenseMode.ReadOnly) {
    return {
      type: AlertType.DANGER,
      title: TELEMETRY_RETENTION_LAPSED_TITLE,
      description: TELEMETRY_RETENTION_LAPSED_DESCRIPTION,
      dataTestId: "telemetry-retention-license-lapsed-notice",
    };
  }

  if (mode === EnterpriseLicenseMode.NotIncluded) {
    return {
      type: AlertType.DANGER,
      title: TELEMETRY_RETENTION_NOT_INCLUDED_TITLE,
      description: TELEMETRY_RETENTION_NOT_INCLUDED_DESCRIPTION,
      dataTestId: "telemetry-retention-license-not-included-notice",
    };
  }

  if (mode === EnterpriseLicenseMode.Grace) {
    return {
      type: AlertType.WARNING,
      title: TELEMETRY_RETENTION_GRACE_TITLE,
      description: TELEMETRY_RETENTION_GRACE_DESCRIPTION,
      dataTestId: "telemetry-retention-license-grace-notice",
    };
  }

  return null;
};

export interface ComponentProps {
  mode: EnterpriseLicenseMode;
}

const TelemetryRetentionLicenseNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const copy: TelemetryRetentionNoticeCopy | null =
    getTelemetryRetentionNoticeCopy(props.mode);

  if (!copy) {
    return <></>;
  }

  return (
    <Alert
      type={copy.type}
      strongTitle={copy.title}
      title={copy.description}
      dataTestId={copy.dataTestId}
      className="mb-5"
    />
  );
};

export default TelemetryRetentionLicenseNotice;
