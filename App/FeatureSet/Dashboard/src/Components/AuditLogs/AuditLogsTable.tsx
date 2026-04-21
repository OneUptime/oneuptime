import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import AnalyticsModelTable from "Common/UI/Components/ModelTable/AnalyticsModelTable";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import ObjectID from "Common/Types/ObjectID";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
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

export interface ComponentProps {
  title: string;
  description: string;
  resourceType?: string;
  resourceId?: ObjectID;
}

const AuditLogsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
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

  const computedQuery: Query<AuditLog> = useMemo(() => {
    const query: Query<AuditLog> = {};

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (projectId) {
      query.projectId = projectId;
    }

    if (props.resourceType) {
      query.resourceType = props.resourceType;
    }

    if (props.resourceId) {
      query.resourceId = props.resourceId;
    }

    return query;
  }, [props.resourceType, props.resourceId]);

  if (!isEnterpriseEligible) {
    return (
      <Card
        title={props.title}
        description={props.description}
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
            ? "Audit Logs are available on the Enterprise plan. Upgrade to record every change made to your project's resources and retain the history for compliance."
            : "Audit Logs are a OneUptime Enterprise Edition feature. Switch to the Enterprise Edition build to record every change made to your project's resources."}
        </div>
      </Card>
    );
  }

  return (
    <Fragment>
      <AnalyticsModelTable<AuditLog>
        modelType={AuditLog}
        id="audit-logs-table"
        name="Audit Logs"
        singularName="Audit Log"
        pluralName="Audit Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        userPreferencesKey="audit-logs-table"
        cardProps={{
          title: props.title,
          description: props.description,
        }}
        query={computedQuery}
        sortBy="createdAt"
        sortOrder={SortOrder.Descending}
        noItemsMessage="No audit log entries found for this project yet. Changes to your resources will appear here."
        showRefreshButton={true}
        showViewIdButton={false}
        filters={[
          {
            field: { resourceType: true },
            type: FieldType.Text,
            title: "Resource Type",
          },
          {
            field: { action: true },
            type: FieldType.Text,
            title: "Action",
          },
          {
            field: { userEmail: true },
            type: FieldType.Text,
            title: "User Email",
          },
          {
            field: { createdAt: true },
            type: FieldType.DateTime,
            title: "Time",
          },
        ]}
        columns={[
          {
            field: { createdAt: true },
            title: "When",
            type: FieldType.DateTime,
          },
          {
            field: { action: true },
            title: "Action",
            type: FieldType.Text,
          },
          {
            field: { resourceType: true },
            title: "Resource",
            type: FieldType.Text,
          },
          {
            field: { resourceName: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { userEmail: true },
            title: "User",
            type: FieldType.Text,
          },
          {
            field: { userType: true },
            title: "Via",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default AuditLogsTable;
