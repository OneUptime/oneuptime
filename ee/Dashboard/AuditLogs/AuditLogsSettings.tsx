import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AuditLogsLicenseNotice from "./AuditLogsLicenseNotice";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
} from "../SSO/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../SSO/License/UseEnterpriseLicenseMode";

/*
 * Settings > Audit Logs (OneUptime Enterprise): the project's recording switch,
 * retention and system events.
 *
 * Core's Pages/Settings/AuditLogsSettings is the page the route renders; it
 * renders this component through the Dashboard plugin (the
 * "SettingsAuditLogsSettings" key), or the audit log upsell card when the
 * project is not eligible or the build has no Enterprise plugin. The
 * eligibility check lives in that shell.
 *
 * Without a valid Enterprise license (after the trial or the grace period)
 * audit logging stops recording, whatever the switch says, and so does a
 * license that does not include audit logs; the notice above the card says
 * so (AuditLogsLicenseNotice).
 */
const AuditLogsSettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.AuditLogs,
  );

  return (
    <Fragment>
      <AuditLogsLicenseNotice mode={licenseMode} />
      <CardModelDetail
        name="Audit Logs"
        cardProps={{
          title: "Audit Logs",
          description:
            "When enabled, every create, update and delete action on your project's resources will be recorded in the audit log.",
        }}
        isEditable={true}
        editButtonText="Edit Audit Log Settings"
        formFields={[
          {
            field: { enableAuditLogs: true },
            title: "Enable Audit Logs",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Turn on to start recording audit log entries for this project.",
          },
          {
            field: { auditLogsRetentionInDays: true },
            title: "Retention (days)",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            description:
              "Number of days to retain audit log entries. Minimum 7, maximum 180.",
            placeholder: "7",
            validation: {
              minValue: 7,
              maxValue: 180,
            },
          },
          {
            field: { storeSystemEventsInAuditLogs: true },
            title: "Store System Events",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When enabled, audit logs will also include events triggered by the system. By default, only events triggered by users are recorded.",
          },
        ]}
        onSaveSuccess={() => {
          Navigation.reload();
        }}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-audit-logs",
          fields: [
            {
              field: { enableAuditLogs: true },
              fieldType: FieldType.Boolean,
              title: "Enabled",
              placeholder: "No",
            },
            {
              field: { auditLogsRetentionInDays: true },
              fieldType: FieldType.Number,
              title: "Retention (days)",
              placeholder: "7",
            },
            {
              field: { storeSystemEventsInAuditLogs: true },
              fieldType: FieldType.Boolean,
              title: "Store System Events",
              placeholder: "No",
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </Fragment>
  );
};

export default AuditLogsSettings;
