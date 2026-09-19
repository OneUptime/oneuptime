import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED, IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * Whether this server can enforce "Require SSO for Login". SSO login is part
 * of the OneUptime Enterprise Edition (the cloud, billing on, runs it too);
 * IS_ENTERPRISE_EDITION in env.js is the EFFECTIVE edition, true only when the
 * enterprise code is loaded. The Community Edition does not enforce the
 * setting, so it is not offered there as if it did something.
 *
 * On a self-hosted Enterprise Edition it is not enforced either once the
 * Enterprise license has lapsed (after the trial or the grace period): SSO
 * sign-in stops then, and enforcing SSO would lock everybody out. The
 * toggle's description says so.
 */
const isRequireSsoForLoginEnforceable: () => boolean = (): boolean => {
  return IS_ENTERPRISE_EDITION || BILLING_ENABLED;
};

const Settings: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
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
          title: t("breadcrumbs.authentication"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <CardModelDetail
        name="Authentication Settings"
        cardProps={{
          title: t("pages.settings.authentication.authCardTitle"),
          description: t("pages.settings.authentication.authCardDescription"),
        }}
        isEditable={true}
        editButtonText={t("pages.settings.authentication.authEditButton")}
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
              placeholder: t("common.no"),
              description:
                "Should we disable sign up of new users to OneUptime?",
            },
          ],
          modelId: ObjectID.getZeroObjectID(),
        }}
      />

      {isRequireSsoForLoginEnforceable() ? (
        <CardModelDetail
          name="SSO Settings"
          cardProps={{
            title: "Single Sign-On (SSO)",
            description:
              "Control whether users must sign in with SSO across this server.",
          }}
          isEditable={true}
          editButtonText={"Edit SSO Settings"}
          formFields={[
            {
              field: {
                requireSsoForLogin: true,
              },
              title: "Require SSO for Login",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              description:
                "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt so they can always recover from a misconfigured SSO. A project's own SSO settings still apply on top of this. On a self-hosted server this is not enforced while the Enterprise license is missing or expired (after the 14-day trial or grace period), because SSO sign-in stops then too: users sign in with their password until a license is activated.",
            },
          ]}
          modelDetailProps={{
            modelType: GlobalConfig,
            id: "model-detail-sso-settings",
            fields: [
              {
                field: {
                  requireSsoForLogin: true,
                },
                fieldType: FieldType.Boolean,
                title: "Require SSO for Login",
                placeholder: t("common.no"),
                description:
                  "When enabled, all users must sign in with SSO to access any project on this server. Master admins are exempt. Not enforced while the Enterprise license is missing or expired.",
              },
            ],
            modelId: ObjectID.getZeroObjectID(),
          }}
        />
      ) : (
        <Card
          title="Single Sign-On (SSO)"
          description="Requiring SSO for login is part of the OneUptime Enterprise Edition. This server runs the Community Edition, where users sign in with their email and password, so this setting is not enforced here. A value saved earlier is kept and is enforced again if this server runs the Enterprise Edition."
        />
      )}

      <CardModelDetail
        name="Project Creation Settings"
        cardProps={{
          title: t("pages.settings.authentication.projectCreationCardTitle"),
          description: t(
            "pages.settings.authentication.projectCreationCardDescription",
          ),
        }}
        isEditable={true}
        editButtonText={t(
          "pages.settings.authentication.projectCreationEditButton",
        )}
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
              placeholder: t("common.no"),
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
