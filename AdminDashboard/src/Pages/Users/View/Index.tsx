import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Navigation from "CommonUI/src/Utils/Navigation";
import User from "Common/AppModels/Models/User";
import React, { FunctionComponent, ReactElement } from "react";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import ModelPage from "CommonUI/src/Components/Page/ModelPage";
import SideMenuComponent from "./SideMenu";

const Users: FunctionComponent = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="email"
      modelType={User}
      title={"User"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Users",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
        {
          title: "User",
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
          cardProps={{
            title: "User",
            description: "User details",
          }}
          isEditable={true}
          editButtonText="Edit User"
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
                fieldType: FieldType.Text,
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
                placeholder: "No",
              },
              {
                field: {
                  enableTwoFactorAuth: true,
                },
                title: "Two Factor Auth Enabled",
                fieldType: FieldType.Boolean,
                placeholder: "No",
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
