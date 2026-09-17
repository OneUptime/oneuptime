import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import IconProp from "Common/Types/Icon/IconProp";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import TeamComplianceStatusTable, {
  TeamComplianceStatusTableRef,
} from "../../../Components/Team/TeamComplianceStatusTable";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import EnterpriseFeatureUpgrade, {
  isEnterpriseFeatureEligible,
} from "../../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";

const TeamViewCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const complianceStatusTableRef: React.Ref<TeamComplianceStatusTableRef> =
    React.useRef<TeamComplianceStatusTableRef>(null);

  const isComplianceEnterpriseEligible: boolean = useMemo(() => {
    return isEnterpriseFeatureEligible();
  }, []);

  return (
    <Fragment>
      {!isComplianceEnterpriseEligible ? (
        <EnterpriseFeatureUpgrade
          title="Compliance Settings"
          description="Enforce compliance rules on this team."
          featureName="Team Compliance Rules"
          featureDescription="Require team members to have the notification methods and on-call configurations needed for SOC 2, ISO 27001, HIPAA and internal reviews."
          benefits={[
            {
              icon: IconProp.ShieldCheck,
              title: "Notification method rules",
              subtitle:
                "Require members to keep email, SMS, push or voice methods configured.",
            },
            {
              icon: IconProp.Bell,
              title: "On-call coverage",
              subtitle:
                "Make sure every team has on-call policies and schedules in place.",
            },
            {
              icon: IconProp.ClipboardDocumentList,
              title: "Compliance dashboard",
              subtitle:
                "See which members satisfy each rule and which need attention.",
            },
            {
              icon: IconProp.Settings,
              title: "Configurable per team",
              subtitle:
                "Apply stricter rules to oncall teams and lighter rules elsewhere.",
            },
          ]}
        />
      ) : null}

      {isComplianceEnterpriseEligible ? (
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
      ) : null}

      {isComplianceEnterpriseEligible ? (
        <TeamComplianceStatusTable
          ref={complianceStatusTableRef}
          teamId={modelId}
        />
      ) : null}
    </Fragment>
  );
};

export default TeamViewCompliance;
