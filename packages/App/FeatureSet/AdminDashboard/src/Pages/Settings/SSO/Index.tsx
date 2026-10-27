import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import {
  MASTER_ADMIN_SIGN_IN_TEST_ID,
  OIDC_PROVIDERS_TABLE_ID,
  REQUIRE_SSO_COPY,
  REQUIRE_SSO_SWITCH_TEST_ID,
  SAML_PROVIDERS_TABLE_ID,
  SSO_PAGE_COPY,
} from "./SsoSettingsCopy";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { MASTER_ADMIN_SIGN_IN_PATH } from "Common/Types/SSO/SignInMethods";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import CopyableValueList from "Common/UI/Components/CopyableValueList/CopyableValueList";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import Page from "Common/UI/Components/Page/Page";
import { getOidcProviderFormFields } from "Common/UI/Components/Sso/OidcProviderFormFields";
import { getSamlProviderFormFields } from "Common/UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Settings > Single Sign-On: everything about signing in to this server with
 * an identity provider, on one page, in the order it is set up - the
 * instance-wide SAML providers, the OpenID Connect ones, and Require SSO for
 * Login under them.
 *
 * They were three pages: "Global SSO" (the SAML providers) and "Global OIDC"
 * in a folded menu section that was also called Authentication, and the
 * Require SSO switch on Settings > Authentication, away from the providers
 * it depends on. The old list addresses open this page (App.tsx); each
 * provider keeps its own page - its URLs for the identity provider, the
 * projects attached to it, its test link.
 *
 * A provider is turned on and off on its own page, as before: turning one
 * off ends every sign-in it gave, in every project on the server, so it is
 * no one-click row action (RowActionsAudit). Test Sign-in in its row starts
 * a sign-in with it in a new tab: the step to take before requiring SSO,
 * which the Require SSO card says.
 * The card also names the master admins' way in, /accounts/admin-login:
 * while SSO is required the sign-in page offers only SSO, and only master
 * admins sign in with a password (SsoRequiredSignIn).
 */

// A provider's sign-in, started on the identity server (its test link).
export const getProviderTestSignInUrl: (data: {
  kind: "saml" | "oidc";
  providerId: string;
}) => URL = (data: { kind: "saml" | "oidc"; providerId: string }): URL => {
  return URL.fromURL(IDENTITY_URL).addRoute(
    new Route(
      `/${data.kind === "saml" ? "global-sso" : "global-oidc"}/${data.providerId}`,
    ),
  );
};

// Where master admins sign in with their password: this server's address.
export const getMasterAdminSignInUrl: () => string = (): string => {
  return `${HTTP_PROTOCOL}${HOST}${MASTER_ADMIN_SIGN_IN_PATH}`;
};

export const getRequireSsoConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: REQUIRE_SSO_COPY.confirmTitle,
    description: REQUIRE_SSO_COPY.confirmDescription,
    submitButtonText: REQUIRE_SSO_COPY.confirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const SsoSettings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();

  const globalConfigId: ObjectID = ObjectID.getZeroObjectID();

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
          title: t("breadcrumbs.singleSignOn"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_SSO] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <Banner
        openInNewTab={true}
        title={SSO_PAGE_COPY.bannerTitle}
        description={SSO_PAGE_COPY.bannerDescription}
        link={Route.fromString("/docs/identity/global-sso")}
        hideOnMobile={true}
      />

      <ModelTable<GlobalSSO>
        userPreferencesKey={"admin-global-sso-table"}
        modelType={GlobalSSO}
        id={SAML_PROVIDERS_TABLE_ID}
        name="Settings > Single Sign-On > SAML"
        isDeleteable={false}
        isEditable={false}
        isViewable={true}
        isCreateable={true}
        /*
         * "Add SAML Provider", and "No SAML providers yet" while it has
         * none: what the card holds, beside the OIDC providers' card - as a
         * project's SSO page names them.
         */
        singularName={SSO_PAGE_COPY.samlProvider}
        pluralName={SSO_PAGE_COPY.samlProviders}
        createVerb="Add"
        cardProps={{
          title: SSO_PAGE_COPY.samlCardTitle,
          description: SSO_PAGE_COPY.samlCardDescription,
        }}
        modelAPI={AdminModelAPI}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_GLOBAL_SSO] as Route,
        )}
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
        actionButtons={[
          {
            title: SSO_PAGE_COPY.testSignIn,
            icon: IconProp.ExternalLink,
            buttonStyleType: ButtonStyleType.NORMAL,
            // A provider that is off signs nobody in.
            isVisible: (item: GlobalSSO): boolean => {
              return Boolean(item.isEnabled);
            },
            onClick: async (
              item: GlobalSSO,
              onCompleteAction: VoidFunction,
            ): Promise<void> => {
              Navigation.navigate(
                getProviderTestSignInUrl({
                  kind: "saml",
                  providerId: item._id?.toString() || "",
                }),
                { openInNewTab: true },
              );
              onCompleteAction();
            },
          },
        ]}
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

      <ModelTable<GlobalOIDC>
        userPreferencesKey={"admin-global-oidc-table"}
        modelType={GlobalOIDC}
        id={OIDC_PROVIDERS_TABLE_ID}
        name="Settings > Single Sign-On > OpenID Connect"
        isDeleteable={false}
        isEditable={false}
        isViewable={true}
        isCreateable={true}
        singularName={SSO_PAGE_COPY.oidcProvider}
        pluralName={SSO_PAGE_COPY.oidcProviders}
        createVerb="Add"
        cardProps={{
          title: SSO_PAGE_COPY.oidcCardTitle,
          description: SSO_PAGE_COPY.oidcCardDescription,
        }}
        modelAPI={AdminModelAPI}
        showRefreshButton={true}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_GLOBAL_OIDC] as Route,
        )}
        formSteps={getSsoProviderFormSteps<GlobalOIDC>()}
        formFields={getOidcProviderFormFields<GlobalOIDC>({
          withGlobalAccessSwitches: true,
        })}
        /*
         * As for SAML: the new provider's page holds its redirect URI, the
         * projects to attach and the test link.
         */
        onCreateSuccess={(
          item: GlobalOIDC,
          modalType?: ModalType,
        ): Promise<GlobalOIDC> => {
          if (modalType === ModalType.Create && item._id) {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_GLOBAL_OIDC_VIEW] as Route,
                { modelId: new ObjectID(item._id.toString()) },
              ),
            );
          }

          return Promise.resolve(item);
        }}
        actionButtons={[
          {
            title: SSO_PAGE_COPY.testSignIn,
            icon: IconProp.ExternalLink,
            buttonStyleType: ButtonStyleType.NORMAL,
            isVisible: (item: GlobalOIDC): boolean => {
              return Boolean(item.isEnabled);
            },
            onClick: async (
              item: GlobalOIDC,
              onCompleteAction: VoidFunction,
            ): Promise<void> => {
              Navigation.navigate(
                getProviderTestSignInUrl({
                  kind: "oidc",
                  providerId: item._id?.toString() || "",
                }),
                { openInNewTab: true },
              );
              onCompleteAction();
            },
          },
        ]}
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

      {/*
       * Require SSO for Login, for the whole server: one switch that saves
       * when flipped, and asks - with a red button - before everyone but
       * master admins has to sign in with SSO. Under it, whichever way it is
       * set, the master admins' way in: the address to keep.
       */}
      <ModelSwitchCard<GlobalConfig>
        modelType={GlobalConfig}
        modelId={globalConfigId}
        column="requireSsoForLogin"
        modelAPI={AdminModelAPI}
        cardTitle={REQUIRE_SSO_COPY.cardTitle}
        cardDescription={REQUIRE_SSO_COPY.cardDescription}
        title={REQUIRE_SSO_COPY.switchTitle}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? REQUIRE_SSO_COPY.switchOnDescription
            : REQUIRE_SSO_COPY.switchOffDescription;
        }}
        getConfirmation={getRequireSsoConfirmation}
        getDetails={(): ReactElement => {
          return (
            <div
              className="space-y-3"
              data-testid={MASTER_ADMIN_SIGN_IN_TEST_ID}
            >
              <p className="text-sm text-gray-600">
                {translator.translateText(REQUIRE_SSO_COPY.masterAdminSentence)}
              </p>
              <CopyableValueList
                values={[
                  {
                    label: REQUIRE_SSO_COPY.masterAdminAddressLabel,
                    value: getMasterAdminSignInUrl(),
                  },
                ]}
              />
            </div>
          );
        }}
        dataTestId={REQUIRE_SSO_SWITCH_TEST_ID}
      />
    </Page>
  );
};

export default SsoSettings;
