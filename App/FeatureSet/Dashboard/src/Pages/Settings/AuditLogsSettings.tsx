import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import {
  BILLING_ENABLED,
  IS_ENTERPRISE_EDITION,
} from "Common/UI/Config";
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
    if (IS_ENTERPRISE_EDITION) {
      return true;
    }
    if (BILLING_ENABLED) {
      return ProjectUtil.getCurrentPlan() === PlanType.Enterprise;
    }
    return false;
  }, []);

  if (!isEnterpriseEligible) {
    return (
      <Card
        title="Audit Logs Settings"
        description="Configure how long audit logs are retained for this project."
        rightElement={
          BILLING_ENABLED ? (
            <Button
              title="Upgrade to Enterprise"
              buttonStyle={ButtonStyleType.PRIMARY}
              icon={IconProp.Billing}
              onClick={() => {
                window.open("https://oneuptime.com/pricing", "_blank");
              }}
            />
          ) : (
            <Button
              title="Learn about Enterprise Edition"
              buttonStyle={ButtonStyleType.PRIMARY}
              icon={IconProp.Info}
              onClick={() => {
                window.open(
                  "https://oneuptime.com/enterprise",
                  "_blank",
                );
              }}
            />
          )
        }
      >
        <div className="p-4 text-sm text-gray-600">
          {BILLING_ENABLED
            ? "Audit Logs are available on the Enterprise plan. Upgrade to configure audit logging for your project."
            : "Audit Logs are a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to enable audit logging for your project."}
        </div>
      </Card>
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
