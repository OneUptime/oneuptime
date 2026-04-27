import AdminModelAPI from "../../../Utils/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import SideMenuComponent from "./SideMenu";

const Users: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="email"
      modelType={User}
      modelAPI={AdminModelAPI}
      title={t("pages.userView.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.users"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
        {
          title: t("breadcrumbs.user"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_VIEW] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <div>
        <CardModelDetail<User>
          name="User"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: t("pages.userView.cardTitle"),
            description: t("pages.userView.cardDescription"),
          }}
          isEditable={true}
          editButtonText={t("pages.userView.editButton")}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
            },
            {
              field: {
                email: true,
              },
              title: "Email",
              fieldType: FormFieldSchemaType.Email,
              required: true,
            },
            {
              field: {
                isEmailVerified: true,
              },
              title: "Email Verified",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
            {
              field: {
                enableTwoFactorAuth: true,
              },
              title: "Two Factor Auth Enabled",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
          ]}
          modelDetailProps={{
            modelType: User,
            id: "model-detail-user",
            fields: [
              {
                field: {
                  _id: true,
                },
                title: "User ID",
                fieldType: FieldType.ObjectID,
                placeholder: "-",
              },
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  email: true,
                },
                title: "Email",
                fieldType: FieldType.Email,
                placeholder: "-",
              },
              {
                field: {
                  isEmailVerified: true,
                },
                title: "Email Verified",
                fieldType: FieldType.Boolean,
                placeholder: t("common.no"),
              },
              {
                field: {
                  enableTwoFactorAuth: true,
                },
                title: "Two Factor Auth Enabled",
                fieldType: FieldType.Boolean,
                placeholder: t("common.no"),
              },
            ],
            modelId: modelId,
          }}
        />
      </div>
    </ModelPage>
  );
};

export default Users;
