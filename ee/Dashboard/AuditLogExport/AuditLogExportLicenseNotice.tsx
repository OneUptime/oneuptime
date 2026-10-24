import { AuditLogExportLicenseCopy } from "./AuditLogExportCopy";
import { EnterpriseLicenseMode } from "../Identity/License/EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Above the exports when the Enterprise license has stopped audit logs, or
 * is about to - self-hosted only: on OneUptime Cloud the license mode is
 * always Editable, and the plan decides (the core shell around the
 * project's page).
 *
 * Without a valid license (after the trial or the grace period), or with
 * one that leaves audit logs out, nothing is recorded and the exporter
 * sends nothing, whatever the exports say. They keep their cursors, so they
 * carry on from where they stopped once a license is activated. Nothing is
 * shown with a valid license or while the license state is Unknown.
 */
export interface ComponentProps {
  mode: EnterpriseLicenseMode;
}

const AuditLogExportLicenseNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.mode === EnterpriseLicenseMode.ReadOnly) {
    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle={AuditLogExportLicenseCopy.lapsedTitle}
        title={AuditLogExportLicenseCopy.lapsedDescription}
        dataTestId="audit-log-export-license-lapsed"
        className="mb-5"
      />
    );
  }

  if (props.mode === EnterpriseLicenseMode.NotIncluded) {
    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle={AuditLogExportLicenseCopy.notIncludedTitle}
        title={AuditLogExportLicenseCopy.notIncludedDescription}
        dataTestId="audit-log-export-license-not-included"
        className="mb-5"
      />
    );
  }

  if (props.mode === EnterpriseLicenseMode.Grace) {
    return (
      <Alert
        type={AlertType.WARNING}
        strongTitle={AuditLogExportLicenseCopy.graceTitle}
        title={AuditLogExportLicenseCopy.graceDescription}
        dataTestId="audit-log-export-license-grace"
        className="mb-5"
      />
    );
  }

  return <></>;
};

export default AuditLogExportLicenseNotice;
