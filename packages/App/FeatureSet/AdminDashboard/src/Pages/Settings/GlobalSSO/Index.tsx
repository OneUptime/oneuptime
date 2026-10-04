import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Banner from "Common/UI/Components/Banner/Banner";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import { getSamlProviderFormFields } from "Common/UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();

  const breadcrumbLinks: Array<{ title: string; to: Route }> = [
    {
      title: t("breadcrumbs.adminDashboard"),
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: t("breadcrumbs.settings"),
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS] as Route),
    },
    {
      title: "Global SSO",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_GLOBAL_SSO] as Route,
      ),
    },
  ];

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<DashboardSideMenu />}
    >
      <Banner
        openInNewTab={true}
        title="Instance-wide SAML SSO"
        description="If no projects are attached to a provider, it works for ALL projects a user is already a member of (users must be invited first — they cannot sign up). Open a provider to attach projects and auto-provision users into specific teams."
        link={Route.fromString("/docs/identity/global-sso")}
        hideOnMobile={true}
      />

      <ModelTable<GlobalSSO>
        userPreferencesKey={"admin-global-sso-table"}
        modelType={GlobalSSO}
        id="global-sso-table"
        name="Settings > Global SSO"
        isDeleteable={false}
        isEditable={false}
        isViewable={true}
        isCreateable={true}
        cardProps={{
          title: "Global SAML SSO",
          description:
            "Instance-wide SAML 2.0 identity providers that can be connected to any project on this OneUptime server.",
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={"No Global SSO providers found."}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={getSsoProviderFormSteps<GlobalSSO>()}
        formFields={getSamlProviderFormFields<GlobalSSO>({
          withGlobalAccessSwitches: true,
        })}
        /*
         * A provider is added to be used, and what using it takes - the ACS
         * URL and Entity ID to give the identity provider, the projects to
         * attach and the test link - is on its own page. Landing there beats
         * leaving the admin to find the new row and click through.
         */
        onCreateSuccess={(
          item: GlobalSSO,
          modalType?: ModalType,
        ): Promise<GlobalSSO> => {
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_GLOBAL_SSO_VIEW] as Route,
                { modelId: new ObjectID(item._id.toString()) },
              ),
            );
          }

          return Promise.resolve(item);
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
      />
    </Page>
  );
};

export default Settings;
