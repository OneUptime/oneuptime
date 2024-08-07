import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";

const Users: FunctionComponent = (): ReactElement => {
  return (
    <Page
      title={"Users"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Users",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
      ]}
    >
      <ModelTable<User>
        modelType={User}
        id="users-table"
        isDeleteable={false}
        isEditable={false}
        showViewIdButton={true}
        isCreateable={true}
        name="Users"
        isViewable={true}
        cardProps={{
          title: "Users",
          description: "Here is a list of users in OneUptime.",
        }}
        noItemsMessage={"No users found."}
        formFields={[
          {
            field: {
              email: true,
            },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: "email@company.com",
          },
          {
            field: {
              password: true,
            },
            title: "Password",
            fieldType: FormFieldSchemaType.Password,
            required: true,
            placeholder: "Password",
          },
          {
            field: {
              name: true,
            },
            title: "Full Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "John Smith",
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Full Name",
            type: FieldType.Text,
          },
          {
            field: {
              email: true,
            },
            title: "Email",
            type: FieldType.Email,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Full Name",
            type: FieldType.Text,
          },
          {
            field: {
              email: true,
            },
            title: "Email",
            type: FieldType.Email,
          },
          {
            field: {
              isEmailVerified: true,
            },
            title: "Email Verified",
            type: FieldType.Boolean,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Page>
  );
};

export default Users;
