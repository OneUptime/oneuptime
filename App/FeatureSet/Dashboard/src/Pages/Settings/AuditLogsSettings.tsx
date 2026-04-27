import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import AuditLogsEnterpriseUpgrade, {
  isAuditLogsEnterpriseEligible,
} from "../../Components/AuditLogs/AuditLogsEnterpriseUpgrade";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";

const AuditLogsSettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const isEnterpriseEligible: boolean = useMemo(() => {
    return isAuditLogsEnterpriseEligible();
  }, []);

  if (!isEnterpriseEligible) {
    return (
      <AuditLogsEnterpriseUpgrade
        title="Audit Logs Settings"
        description="Configure how long audit logs are retained for this project."
        featureDescription="Toggle audit logging for this project and choose how long we keep the history."
      />
    );
  }

  return (
    <Fragment>
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
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </Fragment>
  );
};

export default AuditLogsSettings;
