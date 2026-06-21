import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import Banner from "Common/UI/Components/Banner/Banner";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import EnterpriseFeatureUpgrade from "../../../Components/EnterpriseEdition/EnterpriseFeatureUpgrade";
import { IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import IconProp from "Common/Types/Icon/IconProp";
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
      title: "Global OIDC",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_GLOBAL_OIDC] as Route,
      ),
    },
  ];

  // Global OIDC is a OneUptime Enterprise Edition feature, just like project SSO.
  if (!IS_ENTERPRISE_EDITION) {
    return (
      <Page
        title={t("pages.settings.title")}
        breadcrumbLinks={breadcrumbLinks}
        sideMenu={<DashboardSideMenu />}
      >
        <EnterpriseFeatureUpgrade
          title="Global OIDC"
          description="Instance-wide OpenID Connect identity providers that can be connected to any project on this OneUptime server."
          featureName="Global OIDC"
          featureDescription="Configure an OpenID Connect identity provider once at the instance level and connect it to any project on this OneUptime server."
          benefits={[
            {
              icon: IconProp.Lock,
              title: "Instance-wide auth",
              subtitle:
                "Configure one identity provider and connect it to any project on the server.",
            },
            {
              icon: IconProp.ShieldCheck,
              title: "Enforce SSO",
              subtitle:
                "Require SSO across the whole instance — no shared passwords.",
            },
            {
              icon: IconProp.User,
              title: "Auto provisioning",
              subtitle:
                "Attach projects and place signed-in users into the right teams automatically.",
            },
            {
              icon: IconProp.ClipboardDocumentList,
              title: "Audit trail",
              subtitle:
                "Every SSO sign-in is recorded alongside the rest of your audit events.",
            },
          ]}
        />
      </Page>
    );
  }

  return (
    <Page
      title={t("pages.settings.title")}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={<DashboardSideMenu />}
    >
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
        isCreateable={true}
        cardProps={{
          title: "Global OIDC SSO",
          description:
            "Instance-wide OpenID Connect identity providers that can be connected to any project on this OneUptime server.",
        }}
        modelAPI={AdminModelAPI}
        noItemsMessage={"No Global OIDC providers found."}
        showRefreshButton={true}
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
    </Page>
  );
};

export default Settings;
