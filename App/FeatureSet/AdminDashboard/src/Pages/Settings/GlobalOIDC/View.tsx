import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "Common/Models/DatabaseModels/GlobalOidcProject";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const GlobalOIDCView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const redirectURI: string = `${HTTP_PROTOCOL}${HOST}/identity/global-oidc-callback/${modelId.toString()}`;

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="name"
      modelType={GlobalOIDC}
      modelAPI={AdminModelAPI}
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
          title: "Global OIDC",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_GLOBAL_OIDC] as Route,
          ),
        },
        {
          title: "View",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_GLOBAL_OIDC_VIEW] as Route,
            { modelId },
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <Fragment>
        <CardModelDetail<GlobalOIDC>
          name="Global OIDC Configuration"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "OIDC SSO Configuration",
            description: "Configuration for this instance-wide OIDC provider.",
          }}
          isEditable={true}
          editButtonText={"Edit Configuration"}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Okta OIDC (Company-wide)",
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
              placeholder: "Sign in with Okta",
            },
            {
              field: {
                discoveryURL: true,
              },
              title: "Discovery URL",
              fieldType: FormFieldSchemaType.URL,
              required: true,
              placeholder:
                "https://accounts.google.com/.well-known/openid-configuration",
            },
            {
              field: {
                issuerURL: true,
              },
              title: "Issuer",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "https://accounts.google.com",
            },
            {
              field: {
                clientId: true,
              },
              title: "Client ID",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "1234567890-abcdefgh.apps.googleusercontent.com",
            },
            {
              field: {
                clientSecret: true,
              },
              title: "Client Secret",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Paste your client secret here.",
            },
            {
              field: {
                scopes: true,
              },
              title: "Scopes",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "openid email profile",
            },
            {
              field: {
                emailClaimName: true,
              },
              title: "Email Claim Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "email",
            },
            {
              field: {
                nameClaimName: true,
              },
              title: "Name Claim Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "name",
            },
            {
              field: {
                disableSignUpWithSso: true,
              },
              title: "Disable Sign Up with SSO",
              fieldType: FormFieldSchemaType.Toggle,
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
            },
          ]}
          modelDetailProps={{
            modelType: GlobalOIDC,
            id: "global-oidc-detail",
            fields: [
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  description: true,
                },
                title: "Description",
                fieldType: FieldType.LongText,
              },
              {
                field: {
                  discoveryURL: true,
                },
                title: "Discovery URL",
                fieldType: FieldType.URL,
              },
              {
                field: {
                  issuerURL: true,
                },
                title: "Issuer",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  clientId: true,
                },
                title: "Client ID",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  scopes: true,
                },
                title: "Scopes",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  emailClaimName: true,
                },
                title: "Email Claim Name",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  nameClaimName: true,
                },
                title: "Name Claim Name",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  disableSignUpWithSso: true,
                },
                title: "Disable Sign Up with SSO",
                fieldType: FieldType.Boolean,
                placeholder: t("common.no"),
              },
              {
                field: {
                  isEnabled: true,
                },
                title: "Enabled",
                fieldType: FieldType.Boolean,
                placeholder: t("common.no"),
              },
              {
                field: {
                  isTested: true,
                },
                title: "Tested",
                fieldType: FieldType.Boolean,
                placeholder: t("common.no"),
              },
            ],
            modelId: modelId,
          }}
        />

        <Card
          title={"Identity Provider URL"}
          description={
            <div>
              <div className="mb-3">
                Register this redirect URI (callback URL) with your OIDC
                identity provider.
              </div>
              <div>
                <div className="font-semibold">
                  Redirect URI (Callback URL):
                </div>
                <div className="break-all">{redirectURI}</div>
              </div>
            </div>
          }
        />

        <ModelTable<GlobalOIDCProject>
          modelType={GlobalOIDCProject}
          userPreferencesKey={"admin-global-oidc-project-table"}
          query={{
            globalOidcId: modelId,
          }}
          onBeforeCreate={(
            item: GlobalOIDCProject,
          ): Promise<GlobalOIDCProject> => {
            item.globalOidcId = modelId;
            return Promise.resolve(item);
          }}
          id="global-oidc-project-table"
          name="Settings > Global OIDC > Attached Projects"
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "Attached Projects",
            description:
              "Attach this provider to specific projects to auto-provision federated users into the selected teams. If no projects are attached, the provider works for all projects a user is already a member of (invite-first).",
          }}
          noItemsMessage={"No projects attached to this provider."}
          showRefreshButton={true}
          formFields={[
            {
              field: {
                project: true,
              },
              title: "Project",
              description:
                "The project federated users are provisioned into for this provider.",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownModal: {
                type: Project,
                labelField: "name",
                valueField: "_id",
              },
              required: true,
              placeholder: "Select Project",
            },
            {
              field: {
                teams: true,
              },
              title: "Teams",
              description: "Add users to these teams when they sign in.",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Team,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
              placeholder: "Select Teams",
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
            },
          ]}
          columns={[
            {
              field: {
                project: {
                  name: true,
                },
              },
              title: "Project",
              type: FieldType.Text,
            },
            {
              field: {
                teams: {
                  name: true,
                },
              },
              title: "Teams",
              type: FieldType.EntityArray,
              getElement: (item: GlobalOIDCProject): ReactElement => {
                return (
                  <span>
                    {(item.teams || [])
                      .map((team: Team) => {
                        return team.name;
                      })
                      .join(", ") || "-"}
                  </span>
                );
              },
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
      </Fragment>
    </ModelPage>
  );
};

export default GlobalOIDCView;
