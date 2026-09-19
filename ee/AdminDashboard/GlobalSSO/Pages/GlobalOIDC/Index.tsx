import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import PageMap from "@oneuptime/admin-dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/admin-dashboard/Utils/RouteMap";
import DashboardSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import Route from "Common/Types/API/Route";
import Banner from "Common/UI/Components/Banner/Banner";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
/*
 * The license state helpers are shared with the Dashboard's identity
 * screens; they import Common/... only, so either frontend can bundle them.
 */
import EnterpriseLicenseBanner from "../../../../Dashboard/SSO/License/EnterpriseLicenseBanner";
import {
  EnterpriseLicenseMode,
  isEnterpriseConfigurationReadOnly,
} from "../../../../Dashboard/SSO/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../../../../Dashboard/SSO/License/UseEnterpriseLicenseMode";
import ReadOnlyActionsNotice, {
  ReadOnlyActionsKind,
} from "../../../../Dashboard/SSO/TightenOnly/ReadOnlyActionsNotice";
import useDisableProviderAction, {
  DisableProviderAction,
} from "../../../../Dashboard/SSO/TightenOnly/UseDisableProviderAction";

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
      title: "Global OIDC",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_GLOBAL_OIDC] as Route,
      ),
    },
  ];

  /*
   * Without a valid Enterprise license (after the grace period) the server
   * refuses to create or change this configuration, master admins
   * included; say so up front and hide what would fail. Sign-in and
   * deletes keep working.
   */
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode();
  const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(licenseMode);

  /*
   * The one change the server still accepts then: switching an enabled
   * provider off ({ isEnabled: false } and nothing else), so a compromised
   * identity provider can be shut out without waiting for a license.
   */
  const [tableRefreshToggle, setTableRefreshToggle] = useState<number>(0);

  const disableAction: DisableProviderAction<GlobalOIDC> =
    useDisableProviderAction<GlobalOIDC>({
      modelType: GlobalOIDC,
      modelAPI: AdminModelAPI,
      isReadOnly: isReadOnly,
      onDisabled: () => {
        setTableRefreshToggle((toggle: number) => {
          return toggle + 1;
        });
      },
    });

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<DashboardSideMenu />}
    >
      <EnterpriseLicenseBanner mode={licenseMode} />
      <ReadOnlyActionsNotice
        mode={licenseMode}
        kind={ReadOnlyActionsKind.Provider}
      />

      <Banner
        openInNewTab={true}
        title="Instance-wide OpenID Connect (OIDC) SSO"
        description="If no projects are attached to a provider, it works for ALL projects a user is already a member of (users must be invited first — they cannot sign up). Open a provider to attach projects and auto-provision users into specific teams."
        link={Route.fromString("/docs/identity/global-sso")}
        hideOnMobile={true}
      />

      <ModelTable<GlobalOIDC>
        userPreferencesKey={"admin-global-oidc-table"}
        modelType={GlobalOIDC}
        id="global-oidc-table"
        name="Settings > Global OIDC"
        isDeleteable={false}
        isEditable={false}
        isViewable={true}
        isCreateable={!isReadOnly}
        cardProps={{
          title: "Global OIDC SSO",
          description:
            "Instance-wide OpenID Connect identity providers that can be connected to any project on this OneUptime server.",
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={"No Global OIDC providers found."}
        showRefreshButton={true}
        refreshToggle={tableRefreshToggle.toString()}
        actionButtons={[disableAction.actionButton]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic",
          },
          {
            title: "Provider",
            id: "provider",
          },
          {
            title: "Claims",
            id: "claims",
          },
          {
            title: "More",
            id: "more",
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            description: "Friendly name to help you remember.",
            placeholder: "Okta OIDC (Company-wide)",
            stepId: "basic",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            description: "Friendly description to help you remember.",
            placeholder: "Sign in with Okta",
            stepId: "basic",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              discoveryURL: true,
            },
            title: "Discovery URL",
            fieldType: FormFieldSchemaType.URL,
            required: true,
            description:
              "OIDC discovery URL (typically ends in /.well-known/openid-configuration).",
            placeholder:
              "https://accounts.google.com/.well-known/openid-configuration",
            stepId: "provider",
            disableSpellCheck: true,
          },
          {
            field: {
              issuerURL: true,
            },
            title: "Issuer",
            description:
              "Expected OIDC issuer URL. Must match the 'iss' claim in the ID token.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "https://accounts.google.com",
            stepId: "provider",
            disableSpellCheck: true,
          },
          {
            field: {
              clientId: true,
            },
            title: "Client ID",
            description: "OIDC client ID issued by the identity provider.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "1234567890-abcdefgh.apps.googleusercontent.com",
            stepId: "provider",
            disableSpellCheck: true,
          },
          {
            field: {
              clientSecret: true,
            },
            title: "Client Secret",
            description:
              "OIDC client secret issued by the identity provider. Stored encrypted at rest.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Paste your client secret here.",
            stepId: "provider",
          },
          {
            field: {
              scopes: true,
            },
            title: "Scopes",
            description:
              "Space-separated list of OIDC scopes to request. Must include 'openid'.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "openid email profile",
            stepId: "claims",
            disableSpellCheck: true,
          },
          {
            field: {
              emailClaimName: true,
            },
            title: "Email Claim Name",
            description:
              "Claim name in the ID token (or userinfo response) that contains the user's email address.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "email",
            stepId: "claims",
            disableSpellCheck: true,
          },
          {
            field: {
              nameClaimName: true,
            },
            title: "Name Claim Name",
            description:
              "Claim name in the ID token (or userinfo response) that contains the user's display name.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "name",
            stepId: "claims",
            disableSpellCheck: true,
          },
          {
            field: {
              disableSignUpWithSso: true,
            },
            title: "Disable Sign Up with SSO",
            description:
              "When enabled, users must be explicitly invited to a project before they can log in with this provider. Brand new users are never created automatically.",
            fieldType: FormFieldSchemaType.Toggle,
            stepId: "more",
          },
          {
            field: {
              restrictToAttachedProjects: true,
            },
            title: "Restrict to Attached Projects",
            description:
              "Off by default. When off, signing in with this provider satisfies SSO enforcement for every project the user is a member of, and the attached projects below only control provisioning. Turn this on to make the attached projects an access boundary too - note that this NARROWS access for people who are already signed in.",
            fieldType: FormFieldSchemaType.Toggle,
            stepId: "more",
          },
          {
            field: {
              isEnabled: true,
            },
            description:
              "You can test this first, before enabling it. To test, please save the config.",
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            stepId: "more",
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

      {disableAction.modal}
    </Page>
  );
};

export default Settings;
