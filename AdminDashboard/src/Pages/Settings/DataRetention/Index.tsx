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
          title: "Data Retention",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_DATA_RETENTION] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail
        name="Monitor Log Retention Settings"
        cardProps={{
          title: "Monitor Log Retention",
          description:
            "Configure how long monitor logs are retained before being automatically deleted.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              monitorLogRetentionInDays: true,
            },
            title: "Monitor Log Retention (Days)",
            fieldType: FormFieldSchemaType.PositiveNumber,
            required: false,
            description:
              "Number of days to retain monitor logs. Monitor logs older than this will be automatically deleted. Default is 1 day if not set. Minimum: 1 day, Maximum: 365 days.",
            validation: {
              minValue: 1,
              maxValue: 365,
            },
            placeholder: "1",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-data-retention",
          fields: [
            {
              field: {
                monitorLogRetentionInDays: true,
              },
              fieldType: FieldType.Number,
              title: "Monitor Log Retention (Days)",
              placeholder: "1 (default)",
              description:
                "Number of days to retain monitor logs. Monitor logs older than this will be automatically deleted.",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
