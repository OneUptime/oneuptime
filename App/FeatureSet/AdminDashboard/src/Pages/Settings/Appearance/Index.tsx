import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [resetError, setResetError] = useState<string>("");

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.appearance"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_APPEARANCE] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      {resetError ? <ErrorMessage message={resetError} /> : <></>}
      <CardModelDetail
        name="Appearance"
        cardProps={{
          title: "Default Project Color",
          description:
            "Used to mark projects that have not chosen a color of their own. Any project can override it in its own settings.",
          buttons: [
            {
              title: "Reset Default Value",
              icon: IconProp.Refresh,
              buttonStyle: ButtonStyleType.NORMAL,
              tooltip:
                "Clear the default. Projects without a color of their own will show none.",
              onClick: async () => {
                try {
                  await ModelAPI.updateById({
                    modelType: GlobalConfig,
                    id: ObjectID.getZeroObjectID(),
                    data: {
                      defaultProjectColor: null,
                    },
                  });

                  Navigation.reload();
                } catch (err) {
                  setResetError(API.getFriendlyMessage(err));
                }
              },
            },
          ],
        }}
        isEditable={true}
        editButtonText="Edit Default Project Color"
        formFields={[
          {
            field: {
              defaultProjectColor: true,
            },
            title: "Default Project Color",
            fieldType: FormFieldSchemaType.Color,
            required: false,
            description:
              "Give every project on this instance a starting color. Leave it empty for no color.",
          },
        ]}
        modelDetailProps={{
          modelType: GlobalConfig,
          id: "model-detail-global-config-appearance",
          fields: [
            {
              field: {
                defaultProjectColor: true,
              },
              fieldType: FieldType.Color,
              title: "Default Project Color",
              placeholder: "No default color.",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />
    </Page>
  );
};

export default Settings;
