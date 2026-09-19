import { EnterpriseLicenseMode } from "../SSO/License/EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What Settings > Audit Logs shows above the recording switch when the
 * Enterprise license has lapsed, or is about to.
 *
 * Once the trial or the grace period is over, audit logging stops recording -
 * the Community Edition's behaviour - until a license is activated, whatever
 * "Enable Audit Logs" says. A license whose features leave audit logs out
 * stops it the same way (NotIncluded). The switch alone would tell an admin
 * that every change is still being recorded, so the page says it is not (and,
 * before the lapse, that it will stop). Entries recorded so far are kept, and
 * recording resumes with the same settings when a license is activated.
 *
 * The audit log table (AuditLogsTable.tsx), on the Audit Logs page and on
 * every resource page, says the same through getAuditLogsStoppedCopy, so the
 * copy here must read right there too: it never points "below" or at "these
 * settings".
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
  "Without a valid Enterprise license nothing is recorded in the audit log, whatever the Audit Logs settings say. Entries recorded so far are kept. Recording resumes with the same settings as soon as a license is activated in the Admin Dashboard.";

export const AUDIT_LOGS_NOT_INCLUDED_TITLE: string =
  "Your Enterprise license does not include audit logs: audit logging is not recording.";

export const AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION: string =
  "The installed license leaves audit logs out, so nothing is recorded in the audit log, whatever the Audit Logs settings say. Entries recorded so far are kept. Recording resumes with the same settings as soon as a license that includes audit logs is activated in the Admin Dashboard.";

export const AUDIT_LOGS_GRACE_TITLE: string =
  "No valid Enterprise license: audit logging stops when the trial or grace period ends.";

export const AUDIT_LOGS_GRACE_DESCRIPTION: string =
  "Audit logging records as configured during the 14-day trial or grace period. When it ends, nothing more is recorded until an Enterprise license is activated in the Admin Dashboard. Entries recorded so far are kept.";

export interface AuditLogsStoppedCopy {
  title: string;
  description: string;
}

/*
 * What to say when the license has stopped audit logging, or null when it
 * has not (a valid license, the trial or grace period, OneUptime Cloud, or an
 * unknown license state, where the server keeps recording).
 */
export const getAuditLogsStoppedCopy: (
  mode: EnterpriseLicenseMode,
) => AuditLogsStoppedCopy | null = (
  mode: EnterpriseLicenseMode,
): AuditLogsStoppedCopy | null => {
  if (mode === EnterpriseLicenseMode.ReadOnly) {
    return {
      title: AUDIT_LOGS_LAPSED_TITLE,
      description: AUDIT_LOGS_LAPSED_DESCRIPTION,
    };
  }

  if (mode === EnterpriseLicenseMode.NotIncluded) {
    return {
      title: AUDIT_LOGS_NOT_INCLUDED_TITLE,
      description: AUDIT_LOGS_NOT_INCLUDED_DESCRIPTION,
    };
  }

  return null;
};

export interface ComponentProps {
  mode: EnterpriseLicenseMode;
}

const AuditLogsLicenseNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const stoppedCopy: AuditLogsStoppedCopy | null = getAuditLogsStoppedCopy(
    props.mode,
  );

  if (stoppedCopy) {
    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle={stoppedCopy.title}
        title={stoppedCopy.description}
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
