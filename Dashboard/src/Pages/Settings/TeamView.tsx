import LabelsElement from "../../Components/Label/Labels";
import UserElement from "../../Components/User/User";
import DashboardNavigation from "../../Utils/Navigation";
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
import Banner from "CommonUI/src/Components/Banner/Banner";
import { FormProps } from "CommonUI/src/Components/Forms/BasicForm";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "CommonUI/src/Components/Forms/Types/FormValues";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import Pill from "CommonUI/src/Components/Pill/Pill";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import PermissionUtil from "CommonUI/src/Utils/Permission";
import Label from "Model/Models/Label";
import Team from "Model/Models/Team";
import TeamMember from "Model/Models/TeamMember";
import TeamPermission from "Model/Models/TeamPermission";
import User from "Model/Models/User";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
} from "react";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const TeamView: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

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
        id={"table-team-permission-" + permissionType}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        name={"Settings > Team > Permissions-" + permissionType}
        isViewable={false}
        createEditFromRef={formRef}
        query={{
          teamId: modelId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
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
              projectId: DashboardNavigation.getProjectId()?.toString(),
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
            required: true,
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

      <ModelTable<TeamMember>
        modelType={TeamMember}
        id="table-team-member"
        isDeleteable={true}
        name="Settings > Team > Member"
        createVerb={"Invite"}
        isCreateable={true}
        isViewable={false}
        query={{
          teamId: modelId,
          projectId: DashboardNavigation.getProjectId()?.toString(),
        }}
        onBeforeCreate={(item: TeamMember): Promise<TeamPermission> => {
          if (!props.currentProject || !props.currentProject._id) {
            throw new BadDataException("Project ID cannot be null");
          }
          item.teamId = modelId;
          item.projectId = new ObjectID(props.currentProject._id);
          return Promise.resolve(item);
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
                DashboardNavigation.getProjectId()!,
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

      <Banner
        openInNewTab={true}
        title="Questions about Team Permissions?"
        description="Watch this 5 minute video to learn how team permissions work in OneUptime."
        link={URL.fromString("https://youtu.be/TzmaTe4sbCI")}
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
          Navigation.navigate(RouteMap[PageMap.SETTINGS_TEAMS] as Route);
        }}
      />
    </Fragment>
  );
};

export default TeamView;
