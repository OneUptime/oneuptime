import { BackupsCopy } from "./BackupsCopy";
import { EnterpriseLicenseMode } from "../../Dashboard/Identity/License/EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Above the Backups page when the Enterprise license has stopped new
 * backups, or is about to. Without a valid license (after the trial or the
 * grace period), or with one that leaves backups out, scheduled backups
 * stop and Back up now is refused - but every backup already made stays at
 * the destination, and restoring and deleting them always work. Nothing is
 * shown with a valid license or while the license state is Unknown.
 */
export interface ComponentProps {
  mode: EnterpriseLicenseMode;
}

const BackupsLicenseNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.mode === EnterpriseLicenseMode.ReadOnly) {
    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle={BackupsCopy.lapsedTitle}
        title={BackupsCopy.lapsedDescription}
        dataTestId="backups-license-lapsed"
        className="mb-5"
      />
    );
  }

  if (props.mode === EnterpriseLicenseMode.NotIncluded) {
    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle={BackupsCopy.notIncludedTitle}
        title={BackupsCopy.notIncludedDescription}
        dataTestId="backups-license-not-included"
        className="mb-5"
      />
    );
  }

  if (props.mode === EnterpriseLicenseMode.Grace) {
    return (
      <Alert
        type={AlertType.WARNING}
        strongTitle={BackupsCopy.graceTitle}
        title={BackupsCopy.graceDescription}
        dataTestId="backups-license-grace"
        className="mb-5"
      />
    );
  }

  return <></>;
};

export default BackupsLicenseNotice;
