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
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import DigestMethod from "Common/Types/SSO/DigestMethod";
import SignatureMethod from "Common/Types/SSO/SignatureMethod";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
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
      title: "Global SSO",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.SETTINGS_GLOBAL_SSO] as Route,
      ),
    },
  ];

  // Global SSO is a OneUptime Enterprise Edition feature, just like project SSO.
  if (!IS_ENTERPRISE_EDITION) {
    return (
      <Page
        title={t("pages.settings.title")}
        breadcrumbLinks={breadcrumbLinks}
        sideMenu={<DashboardSideMenu />}
      >
        <EnterpriseFeatureUpgrade
          title="Global SSO"
          description="Instance-wide SAML 2.0 identity providers that can be connected to any project on this OneUptime server."
          featureName="Global SSO"
          featureDescription="Configure a SAML identity provider once at the instance level and connect it to any project on this OneUptime server."
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
        formSteps={[
          {
            title: "Basic Info",
            id: "basic",
          },
          {
            title: "Sign On",
            id: "sign-on",
          },
          {
            title: "Certificate",
            id: "certificate",
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
            placeholder: "Okta SAML (Company-wide)",
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
              signOnURL: true,
            },
            title: "Sign On URL",
            fieldType: FormFieldSchemaType.URL,
            required: true,
            description:
              "Users will be forwarded here when signing in to your organization.",
            placeholder: "https://yourapp.example.com/apps/appId",
            stepId: "sign-on",
            disableSpellCheck: true,
          },
          {
            field: {
              issuerURL: true,
            },
            title: "Issuer",
            description:
              "Typically a unique identifier (often a URL) generated by your SAML identity provider.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "https://example.com",
            stepId: "sign-on",
            disableSpellCheck: true,
          },
          {
            field: {
              publicCertificate: true,
            },
            title: "Public Certificate",
            description: "Paste in your x509 certificate here.",
            fieldType: FormFieldSchemaType.LongText,
            required: true,
            placeholder: "Paste in your x509 certificate here.",
            stepId: "certificate",
          },
          {
            field: {
              signatureMethod: true,
            },
            title: "Signature Method",
            description:
              "If you do not know what this is, please leave this to RSA-SHA256",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(SignatureMethod),
            required: true,
            placeholder: "RSA-SHA256",
            stepId: "certificate",
          },
          {
            field: {
              digestMethod: true,
            },
            title: "Digest Method",
            description:
              "If you do not know what this is, please leave this to SHA256",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(DigestMethod),
            required: true,
            placeholder: "SHA256",
            stepId: "certificate",
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
