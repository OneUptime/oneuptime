import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Color from "Common/Types/Color";

const IncidentRoles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentRole>
        modelType={IncidentRole}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="incident-roles-table"
        name="Settings > Incident Roles"
        userPreferencesKey="incident-roles-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Incident Roles",
          description:
            "Define roles that can be assigned to users during incident response (e.g., Incident Commander, Responder).",
        }}
        noItemsMessage={"No incident roles found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Incident Commander",
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
            placeholder: "Primary decision maker during an incident.",
          },
          {
            field: {
              color: true,
            },
            title: "Role Color",
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: "Please select color for this role.",
          },
          {
            field: {
              order: true,
            },
            title: "Order",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "1",
          },
        ]}
        showRefreshButton={true}
        selectMoreFields={{
          color: true,
        }}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Name",
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: "Description",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
            getElement: (item: IncidentRole): ReactElement => {
              return (
                <Pill
                  text={item.name || ""}
                  color={item.color || Color.fromString("#000000")}
                />
              );
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
            type: FieldType.LongText,
          },
          {
            field: {
              order: true,
            },
            title: "Order",
            type: FieldType.Number,
          },
        ]}
      />
    </Fragment>
  );
};

export default IncidentRoles;
