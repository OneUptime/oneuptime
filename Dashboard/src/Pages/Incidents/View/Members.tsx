import UserElement from "../../../Components/User/User";
import ProjectUser from "../../../Utils/ProjectUser";
import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import User from "Common/Models/DatabaseModels/User";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Color from "Common/Types/Color";

const IncidentMembers: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ModelTable<IncidentMember>
        modelType={IncidentMember}
        id="table-incident-members"
        name="Incident > Members"
        userPreferencesKey="incident-members-table"
        singularName="Member"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        isEditable={true}
        showViewIdButton={true}
        query={{
          incidentId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: IncidentMember): Promise<IncidentMember> => {
          item.incidentId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Members",
          description:
            "Assign users to this incident with specific roles like Incident Commander or Responder.",
        }}
        noItemsMessage={"No members assigned to this incident yet."}
        formFields={[
          {
            field: {
              user: true,
            },
            title: "User",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select User",
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
          },
          {
            field: {
              incidentRole: true,
            },
            title: "Role",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Role",
            dropdownModal: {
              type: IncidentRole,
              labelField: "name",
              valueField: "_id",
            },
          },
          {
            field: {
              notes: true,
            },
            title: "Notes",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Any additional context for this assignment",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              incidentRole: {
                name: true,
              },
            },
            title: "Role",
            type: FieldType.Entity,
            filterEntityType: IncidentRole,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: {
              user: true,
            },
            title: "User",
            type: FieldType.Entity,
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
              createdAt: true,
            },
            title: "Assigned On",
            type: FieldType.Date,
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
            type: FieldType.Entity,

            getElement: (item: IncidentMember): ReactElement => {
              if (!item["user"]) {
                throw new BadDataException("User not found");
              }

              return <UserElement user={item["user"] as User} />;
            },
          },
          {
            field: {
              incidentRole: {
                name: true,
                color: true,
              },
            },
            title: "Role",
            type: FieldType.Entity,
            getElement: (item: IncidentMember): ReactElement => {
              if (!item["incidentRole"]) {
                return <span>-</span>;
              }

              const role: IncidentRole = item["incidentRole"] as IncidentRole;
              return (
                <Pill
                  text={role.name || ""}
                  color={role.color || Color.fromString("#000000")}
                />
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Assigned On",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default IncidentMembers;
