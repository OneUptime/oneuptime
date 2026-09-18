import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TeamComplianceStatusTable, {
  TeamComplianceStatusTableRef,
} from "./TeamComplianceStatusTable";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";

/*
 * Teams > View > Compliance (OneUptime Enterprise): the team's compliance
 * rules and who on the team satisfies them.
 *
 * Core's Pages/Teams/View/Compliance is the page the route renders; it renders
 * this component through the Dashboard plugin (the "TeamCompliance" key), or
 * the team compliance upsell card when the project is not eligible or the
 * build has no Enterprise plugin. The eligibility check lives in that shell.
 *
 * The status table is imported from this directory, never through core's
 * Components/Team/TeamComplianceStatusTable shell: the shell reads the
 * plugins, and importing it back from here would close the import cycle that
 * crashes the Enterprise bundle (see src/Enterprise/Plugins.ts).
 */
const TeamViewCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const complianceStatusTableRef: React.Ref<TeamComplianceStatusTableRef> =
    React.useRef<TeamComplianceStatusTableRef>(null);

  return (
    <Fragment>
      <ModelTable<TeamComplianceSetting>
        modelType={TeamComplianceSetting}
        id="table-team-compliance-setting"
        userPreferencesKey="team-compliance-setting-table"
        saveFilterProps={{
          tableId: "settings-team-compliance-setting-table",
        }}
        isDeleteable={true}
        name="Settings > Team > Compliance Settings"
        isCreateable={true}
        isEditable={true}
        isViewable={false}
        query={{
          teamId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: TeamComplianceSetting,
        ): Promise<TeamComplianceSetting> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.teamId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        onCreateSuccess={async (
          item: TeamComplianceSetting,
        ): Promise<TeamComplianceSetting> => {
          complianceStatusTableRef.current?.refresh();
          return item;
        }}
        onItemDeleted={(_item: TeamComplianceSetting): void => {
          complianceStatusTableRef.current?.refresh();
        }}
        cardProps={{
          title: "Compliance Settings",
          description:
            "Configure compliance rules for this team. These rules ensure team members have the required notification methods and on-call configurations.",
        }}
        noItemsMessage={"No compliance settings configured for this team."}
        formFields={[
          {
            field: {
              ruleType: true,
            },
            title: "Rule Type",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            dropdownOptions: [
              {
                value: ComplianceRuleType.HasNotificationEmailMethod,
                label: "User has Email Notification Method",
              },
              {
                value: ComplianceRuleType.HasNotificationSMSMethod,
                label: "User has SMS Notification Method",
              },
              {
                value: ComplianceRuleType.HasNotificationCallMethod,
                label: "User has Call Notification Method",
              },
              {
                value: ComplianceRuleType.HasNotificationPushMethod,
                label: "User has Push Notification Method",
              },
              {
                value: ComplianceRuleType.HasIncidentOnCallRules,
                label: "User has Incident On-Call Rules",
              },
              {
                value: ComplianceRuleType.HasAlertOnCallRules,
                label: "User has Alert On-Call Rules",
              },
            ],
            description:
              "Select the type of compliance rule to enforce for team members.",
          },
          {
            field: {
              enabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this compliance rule.",
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              ruleType: true,
            },
            type: FieldType.Text,
            title: "Rule Type",
          },
          {
            field: {
              enabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        columns={[
          {
            field: {
              ruleType: true,
            },
            title: "Rule Type",
            type: FieldType.Text,
            getElement: (item: TeamComplianceSetting): ReactElement => {
              const ruleTypeLabels: Record<string, string> = {
                [ComplianceRuleType.HasNotificationEmailMethod]:
                  "Email Notification Method Required for Users",
                [ComplianceRuleType.HasNotificationSMSMethod]:
                  "SMS Notification Method Required for Users",
                [ComplianceRuleType.HasNotificationCallMethod]:
                  "Call Notification Method Required for Users",
                [ComplianceRuleType.HasNotificationPushMethod]:
                  "Push Notification Method Required for Users",
                [ComplianceRuleType.HasIncidentOnCallRules]:
                  "Incident On-Call Rules Required for Users",
                [ComplianceRuleType.HasAlertOnCallRules]:
                  "Alert On-Call Rules Required for Users",
              };
              return (
                <span>{ruleTypeLabels[item.ruleType!] || item.ruleType}</span>
              );
            },
          },
          {
            field: {
              enabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: TeamComplianceSetting): ReactElement => {
              if (item.enabled) {
                return <Pill text="Enabled" color={Green} />;
              }
              return <Pill text="Disabled" color={Yellow} />;
            },
          },
        ]}
      />

      <TeamComplianceStatusTable
        ref={complianceStatusTableRef}
        teamId={modelId}
      />
    </Fragment>
  );
};

export default TeamViewCompliance;
