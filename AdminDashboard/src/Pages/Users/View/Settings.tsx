import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import SideMenuComponent from "./SideMenu";
import User from "Common/Models/DatabaseModels/User";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";

const UserSettings: FunctionComponent = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelPage<User>
      modelId={modelId}
      modelNameField="email"
      modelType={User}
      modelAPI={AdminModelAPI}
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
            {
              modelId: modelId,
            },
          ),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_SETTINGS] as Route,
            {
              modelId: modelId,
            },
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <CardModelDetail<User>
        name="user-master-admin-settings"
        modelAPI={AdminModelAPI}
        cardProps={{
          title: "Master Admin Access",
          description:
            "Grant or revoke master admin access for this user. Master admins can manage every project and workspace.",
        }}
        isEditable={true}
        editButtonText="Update Access"
        formFields={[
          {
            field: {
              isMasterAdmin: true,
            },
            title: "Master Admin",
            description:
              "Enable to give this user full access to the entire platform.",
            fieldType: FormFieldSchemaType.Toggle,
            required: true,
          },
        ]}
        modelDetailProps={{
          modelType: User,
          id: "user-master-admin-settings-detail",
          fields: [
            {
              field: {
                isMasterAdmin: true,
              },
              title: "Master Admin",
              fieldType: FieldType.Boolean,
              placeholder: "No",
            },
          ],
          modelId: modelId,
        }}
      />
    </ModelPage>
  );
};

export default UserSettings;
