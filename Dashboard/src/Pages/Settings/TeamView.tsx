import LabelsElement from "Common/UI/Components/Label/Labels";
import UserElement from "../../Components/User/User";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../Utils/PageMap";
import ProjectUser from "../../Utils/ProjectUser";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import Banner from "Common/UI/Components/Banner/Banner";
import { FormProps } from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import User from "Common/Models/DatabaseModels/User";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
} from "react";
import TeamComplianceStatusTable, {
  TeamComplianceStatusTableRef,
} from "../../Components/Team/TeamComplianceStatusTable";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const TeamView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const complianceStatusTableRef: React.Ref<TeamComplianceStatusTableRef> =
    React.useRef<TeamComplianceStatusTableRef>(null);

  const [isPushGroupsManaged, setIsPushGroupsManaged] =
    React.useState<boolean>(false);

  React.useEffect(() => {
    const checkScim: () => Promise<void> = async () => {
      if (!props.currentProject || !props.currentProject._id) {
        return;
      }
      try {
        const scimCount: number = await ModelAPI.count<ProjectSCIM>({
          modelType: ProjectSCIM,
          query: {
            projectId: props.currentProject._id,
            enablePushGroups: true,
          },
        });
        setIsPushGroupsManaged(scimCount > 0);
      } catch {
        // ignore
      }
    };
    checkScim();
  }, [props.currentProject]);

  type GetTeamPermissionTable = (data: {
    permissionType: PermissionType;
  }) => ReactElement;

  const getTeamPermissionTable: GetTeamPermissionTable = (data: {
    permissionType: PermissionType;
  }) => {
    const { permissionType } = data;

    const formRef: MutableRefObject<FormProps<FormValues<TeamPermission>>> =
      React.useRef<FormProps<FormValues<TeamPermission>>>() as MutableRefObject<
        FormProps<FormValues<TeamPermission>>
      >;

    let tableTitle: string = "Allow Permissions";

    if (permissionType === PermissionType.BlockPermissions) {
      tableTitle = "Block Permissions";
    }

    let tableDescription: string =
      "Here you can manage allow permissions for this team.";

    if (permissionType === PermissionType.BlockPermissions) {
      tableDescription =
        "Here you can manage block permissions for this team. This will override any allow permissions set for this team.";
    }

    return (
      <ModelTable<TeamPermission>
        modelType={TeamPermission}
        userPreferencesKey={"team-permission-table-" + permissionType}
        id={"table-team-permission-" + permissionType}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        name={"Settings > Team > Permissions-" + permissionType}
        isViewable={false}
        createEditFromRef={formRef}
        query={{
          teamId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
          isBlockPermission: permissionType === PermissionType.BlockPermissions,
        }}
        onBeforeCreate={(item: TeamPermission): Promise<TeamPermission> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.teamId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          item.isBlockPermission =
            permissionType === PermissionType.BlockPermissions;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: tableTitle,
          description: tableDescription,
        }}
        noItemsMessage={"No permisisons created for this team so far."}
        formFields={[
          {
            field: {
              permission: true,
            },
            onChange: async (_value: any): Promise<void> => {
              await formRef.current.setFieldValue("labels", [], true);
            },
            title: "Permission",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Permission",
            dropdownOptions:
              PermissionUtil.projectPermissionsAsDropdownOptions(),
          },
          {
            field: {
              labels: true,
            },
            title: "Restrict to Labels",
            description:
              "If you want to restrict this permission to specific labels, you can select them here. This is an optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            showIf: (values: FormValues<TeamPermission>): boolean => {
              if (!values["permission"]) {
                return false;
              }

              if (
                values["permission"] &&
                !PermissionHelper.isAccessControlPermission(
                  values["permission"] as Permission,
                )
              ) {
                return false;
              }

              return true;
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              permission: true,
            },
            type: FieldType.Text,
            title: "Permission",
          },
          {
            field: {
              labels: {
                name: true,
              },
            },
            type: FieldType.EntityArray,
            title: "Restrict to Labels",
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: {
              permission: true,
            },
            title: "Permission",
            type: FieldType.Text,

            getElement: (item: TeamPermission): ReactElement => {
              return (
                <p>
                  {PermissionHelper.getTitle(item["permission"] as Permission)}
                </p>
              );
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Restrict to Labels",
            type: FieldType.EntityArray,

            getElement: (item: TeamPermission): ReactElement => {
              if (
                item &&
                item["permission"] &&
                !PermissionHelper.isAccessControlPermission(
                  item["permission"] as Permission,
                )
              ) {
                return (
                  <p>
                    Restriction by labels cannot be applied to this permission.
                  </p>
                );
              }

              if (!item["labels"] || item["labels"].length === 0) {
                return (
                  <p>No restrictions has been applied to this permission.</p>
                );
              }

              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />
    );
  };

  return (
    <Fragment>
      {/* API Key View  */}
      <CardModelDetail
        name="Team Details"
        cardProps={{
          title: "Team Details",
          description: "Here are more details for this team.",
        }}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Team Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Team Description",
          },
        ]}
        modelDetailProps={{
          modelType: Team,
          id: "model-detail-team",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Team ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: Navigation.getLastParamAsObjectID(),
        }}
      />

      {/* Team Members Table */}

      {isPushGroupsManaged && (
        <Banner
          title="Team membership is managed by SCIM Push Groups"
          description="Manage team members from your identity provider or disable Push Groups in Settings > SCIM to make changes here."
        />
      )}

      <ModelTable<TeamMember>
        modelType={TeamMember}
        id="table-team-member"
        userPreferencesKey="team-member-table"
        isDeleteable={!isPushGroupsManaged}
        name="Settings > Team > Member"
        createVerb={"Invite"}
        isCreateable={!isPushGroupsManaged}
        isViewable={false}
        query={{
          teamId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot invite users while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.teamId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
        }}
        onBeforeDelete={async (item: TeamMember): Promise<TeamMember> => {
          if (isPushGroupsManaged) {
            throw new BadDataException(
              "Cannot remove team members while SCIM Push Groups is enabled for this project. Disable Push Groups to manage members from OneUptime.",
            );
          }
          return item;
        }}
        cardProps={{
          title: "Team Members",
          description: "See a list of members or invite them to this team. ",
        }}
        noItemsMessage={"No members found for this team."}
        formFields={[
          {
            field: {
              user: true,
            },
            title: "User Email",
            description:
              "Please enter the email of the user you would like to invite. We will send them an email to let them know they have been invited to this team.",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: "member@company.com",
            overrideFieldKey: "email",
          },
        ]}
        showRefreshButton={true}
        deleteButtonText="Remove Member"
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        filters={[
          {
            field: {
              user: true,
            },
            type: FieldType.Entity,
            title: "User",
            filterEntityType: User,
            fetchFilterDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            type: FieldType.Boolean,
            title: "Accepted Invite",
          },
        ]}
        columns={[
          {
            field: {
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Text,
            getElement: (item: TeamMember): ReactElement => {
              if (item["user"]) {
                return <UserElement user={item["user"]} />;
              }

              return <></>;
            },
          },
          {
            field: {
              hasAcceptedInvitation: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: TeamMember): ReactElement => {
              if (item["hasAcceptedInvitation"]) {
                return <Pill text="Member" color={Green} />;
              }
              return <Pill text="Invitation Sent" color={Yellow} />;
            },
          },
        ]}
      />

      {/* Team Compliance Settings Table */}
      <ModelTable<TeamComplianceSetting>
        modelType={TeamComplianceSetting}
        id="table-team-compliance-setting"
        userPreferencesKey="team-compliance-setting-table"
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

      {/* Team Compliance Status Table */}
      <TeamComplianceStatusTable
        ref={complianceStatusTableRef}
        teamId={modelId}
      />

      <Banner
        openInNewTab={true}
        title="Questions about Team Permissions?"
        description="Watch this 5 minute video to learn how team permissions work in OneUptime."
        link={URL.fromString("https://youtu.be/TzmaTe4sbCI")}
        hideOnMobile={true}
      />

      {/* Team Permisison Table */}
      {getTeamPermissionTable({
        permissionType: PermissionType.AllowPermissions,
      })}

      {/* Team Block Permisison Table */}
      {getTeamPermissionTable({
        permissionType: PermissionType.BlockPermissions,
      })}

      {/* Delete Team */}
      <ModelDelete
        modelType={Team}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.SETTINGS_TEAMS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default TeamView;
