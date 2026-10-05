import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { getOidcProviderFormFields } from "Common/UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "Common/Models/DatabaseModels/GlobalOidcProject";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import ProjectScopedTeamsPicker, {
  resolveProjectIdFromFormValue,
  selectedTeamIdsFromFormValue,
} from "../../../Components/GlobalProvider/ProjectScopedTeamsPicker";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const GlobalOIDCView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const redirectURI: string = `${HTTP_PROTOCOL}${HOST}/identity/global-oidc-callback/${modelId.toString()}`;

  /*
   * Service-provider initiated login endpoint (same base the Accounts login
   * page uses). Visiting it redirects the browser to the configured OIDC
   * provider and runs the full Global OIDC login, so it doubles as the
   * end-to-end "test" link. It does not depend on any attached project (in
   * default-all mode the tester is signed into the projects they already
   * belong to).
   */
  const testLoginURL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route(`/global-oidc/${modelId.toString()}`),
  );

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
          formSteps={getSsoProviderFormSteps<GlobalOIDC>()}
          formFields={getOidcProviderFormFields<GlobalOIDC>({
            withGlobalAccessSwitches: true,
          })}
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
                  restrictToAttachedProjects: true,
                },
                title: "Restrict to Attached Projects",
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

        <Card
          title={"Test this OIDC provider"}
          description={
            <span>
              Use this link to test the OIDC login end-to-end. You do not need
              to attach any projects first — it signs you in through the
              identity provider and into the projects you already belong to. The
              provider must be enabled for the link to work; enabling a global
              provider only adds a &quot;Sign in with SSO&quot; option and never
              forces SSO or locks anyone out, so it is safe to enable, test, and
              disable again if needed.{" "}
              <Link openInNewTab={true} to={testLoginURL}>
                <span>{testLoginURL.toString()}</span>
              </Link>
            </span>
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
          isEditable={false}
          isCreateable={true}
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "Attached Projects",
            description:
              "Attach this provider to a project and pick that project's default teams. Add one project + teams at a time to build the list. If no projects are attached, the provider works for all projects a user is already a member of (invite-first). To change an attachment, delete it and add it again.",
          }}
          noItemsMessage={"No projects attached to this provider."}
          showRefreshButton={true}
          filters={[]}
          /*
           * One page: the project, then its teams under it. The teams picker
           * lists the teams of the project picked above it and starts on that
           * project's members team, so people who sign in for the first time
           * join the project as members unless other teams are picked.
           */
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
              description:
                "Users are added to these teams (from the project selected above) when they sign in.",
              fieldType: FormFieldSchemaType.CustomComponent,
              getCustomElement: (
                values: FormValues<GlobalOIDCProject>,
                elementProps: CustomElementProps,
              ): ReactElement => {
                return (
                  <ProjectScopedTeamsPicker
                    projectId={resolveProjectIdFromFormValue(
                      (values as { project?: unknown }).project,
                    )}
                    selectedTeamIds={selectedTeamIdsFromFormValue(
                      (values as { teams?: unknown }).teams,
                    )}
                    onChange={(teamIds: Array<string>) => {
                      elementProps.onChange?.(teamIds);
                    }}
                  />
                );
              },
              required: false,
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

        <ModelDelete
          modelType={GlobalOIDC}
          modelId={modelId}
          modelAPI={AdminModelAPI}
          onDeleteSuccess={() => {
            Navigation.navigate(
              RouteMap[PageMap.SETTINGS_GLOBAL_OIDC] as Route,
            );
          }}
        />
      </Fragment>
    </ModelPage>
  );
};

export default GlobalOIDCView;
