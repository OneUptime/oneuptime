import {
  AuditLogExportProjectCopy,
  AuditLogExportScope,
} from "./AuditLogExportCopy";
import AuditLogExportLicenseNotice from "./AuditLogExportLicenseNotice";
import AuditLogExportTable from "./AuditLogExportTable";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
  isEnterpriseConfigurationReadOnly,
} from "../Identity/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../Identity/License/UseEnterpriseLicenseMode";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Settings > Audit Logs > Export (OneUptime Enterprise): where this
 * project's audit log is sent, as it is recorded.
 *
 * Core's Pages/Settings/AuditLogExport is the page the route renders; it
 * renders this component through the Dashboard plugin (the
 * "SettingsAuditLogExport" key), or the upsell card when the project is not
 * eligible or the build has no Enterprise plugin.
 *
 * Above the exports: what the license says, when it stopped audit logs
 * (AuditLogExportLicenseNotice), and that audit logging is off for the
 * project, when it is - nothing new is recorded then, so nothing new is
 * exported, and an export set up meanwhile would look as if it never sent.
 */
const AuditLogExportSettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.AuditLogs,
  );
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const [isAuditLoggingOff, setIsAuditLoggingOff] = useState<boolean>(false);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let isMounted: boolean = true;

    ModelAPI.getItem<Project>({
      modelType: Project,
      id: projectId,
      select: { enableAuditLogs: true },
    })
      .then((project: Project | null): void => {
        if (isMounted && project) {
          setIsAuditLoggingOff(project.enableAuditLogs !== true);
        }
      })
      .catch((): void => {
        // Nothing is claimed: the exports below say how they are doing.
      });

    return () => {
      isMounted = false;
    };
  }, [projectId?.toString()]);

  return (
    <Fragment>
      <AuditLogExportLicenseNotice mode={licenseMode} />
      {isAuditLoggingOff ? (
        <Alert
          type={AlertType.WARNING}
          strongTitle={AuditLogExportProjectCopy.auditLoggingOffTitle}
          title={AuditLogExportProjectCopy.auditLoggingOffDescription}
          dataTestId="audit-log-export-audit-logging-off"
          className="mb-5"
        />
      ) : (
        <></>
      )}
      <AuditLogExportTable
        scope={AuditLogExportScope.Project}
        modelAPI={ModelAPI}
        projectId={projectId || undefined}
        isLicenseReadOnly={isEnterpriseConfigurationReadOnly(licenseMode)}
      />
    </Fragment>
  );
};

export default AuditLogExportSettings;
