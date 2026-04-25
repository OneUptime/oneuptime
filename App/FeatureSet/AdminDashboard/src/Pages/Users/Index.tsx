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
import { useTranslation } from "react-i18next";

const Users: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  return (
    <Page
      title={t("pages.users.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.users"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
      ]}
    >
      <ModelTable<User>
        modelType={User}
        userPreferencesKey="admin-users-table"
        id="users-table"
        isDeleteable={false}
        isEditable={false}
        showViewIdButton={true}
        isCreateable={true}
        name="Users"
        isViewable={true}
        cardProps={{
          title: t("pages.users.cardTitle"),
          description: t("pages.users.cardDescription"),
        }}
        noItemsMessage={t("pages.users.noItems")}
        formFields={[
          {
            field: {
              email: true,
            },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: "email@company.com",
            disableSpellCheck: true,
          },
          {
            field: {
              password: true,
            },
            title: "Password",
            fieldType: FormFieldSchemaType.Password,
            required: true,
            placeholder: "Password",
            disableSpellCheck: true,
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
            hideOnMobile: true,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created At",
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />
    </Page>
  );
};

export default Users;
