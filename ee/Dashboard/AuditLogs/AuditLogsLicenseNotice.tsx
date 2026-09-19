import { EnterpriseLicenseMode } from "../SSO/License/EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What Settings > Audit Logs shows above the recording switch when the
 * Enterprise license has lapsed, or is about to.
 *
 * Once the trial or the grace period is over, audit logging stops recording -
 * the Community Edition's behaviour - until a license is activated, whatever
 * "Enable Audit Logs" says. The switch alone would tell an admin that every
 * change is still being recorded, so the page says it is not (and, before the
 * lapse, that it will stop). Entries recorded so far are kept, and recording
 * resumes with these settings when a license is activated.
 *
 * Nothing is shown with a valid license, on OneUptime Cloud (the plan
 * decides there) or while the license state is Unknown: the server keeps
 * recording when it cannot read the license, so the page must not claim it
 * stopped.
 *
 * The strings are plain English, like the rest of these screens. Alert
 * translates them when a locale has an entry under the same English key.
 */

export const AUDIT_LOGS_LAPSED_TITLE: string =
  "Enterprise license required: audit logging is not recording.";

export const AUDIT_LOGS_LAPSED_DESCRIPTION: string =
  "Without a valid Enterprise license nothing is recorded in the audit log, whatever the settings below say. Entries recorded so far are kept. Recording resumes with these settings as soon as a license is activated in the Admin Dashboard.";

export const AUDIT_LOGS_GRACE_TITLE: string =
  "No valid Enterprise license: audit logging stops when the trial or grace period ends.";

export const AUDIT_LOGS_GRACE_DESCRIPTION: string =
  "Audit logging records as configured during the 14-day trial or grace period. When it ends, nothing more is recorded until an Enterprise license is activated in the Admin Dashboard. Entries recorded so far are kept.";

export interface ComponentProps {
  mode: EnterpriseLicenseMode;
}

const AuditLogsLicenseNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.mode === EnterpriseLicenseMode.ReadOnly) {
    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle={AUDIT_LOGS_LAPSED_TITLE}
        title={AUDIT_LOGS_LAPSED_DESCRIPTION}
        dataTestId="audit-logs-license-lapsed-notice"
        className="mb-5"
      />
    );
  }

  if (props.mode === EnterpriseLicenseMode.Grace) {
    return (
      <Alert
        type={AlertType.WARNING}
        strongTitle={AUDIT_LOGS_GRACE_TITLE}
        title={AUDIT_LOGS_GRACE_DESCRIPTION}
        dataTestId="audit-logs-license-grace-notice"
        className="mb-5"
      />
    );
  }

  return <></>;
};

export default AuditLogsLicenseNotice;
