import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent = (): ReactElement => {
  return (
    <Page
      title={"Admin Settings"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Authentication",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {/* Project Settings View  */}
      <CardModelDetail
        name="Authentication Settings"
        cardProps={{
          title: "Authentication Settings",
          description:
            "Authentication Settings for this OneUptime Server instance.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              disableSignup: true,
            },
            title: "Disable Sign Up",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Should we disable sign up of new users to OneUptime?",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config",
          fields: [
            {
              field: {
                disableSignup: true,
              },
              fieldType: FieldType.Boolean,
              title: "Disable Sign Up",
              placeholder: "No",
              description:
                "Should we disable sign up of new users to OneUptime?",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      <CardModelDetail
        name="Project Creation Settings"
        cardProps={{
          title: "Project Creation",
          description:
            "Control who can create new projects on this OneUptime Server.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              disableUserProjectCreation: true,
            },
            title: "Restrict Project Creation to Admins Only",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When enabled, only master admin users can create new projects.",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-project-creation",
          fields: [
            {
              field: {
                disableUserProjectCreation: true,
              },
              fieldType: FieldType.Boolean,
              title: "Restrict Project Creation to Admins Only",
              placeholder: "No",
              description:
                "When enabled, only master admin users can create new projects.",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
