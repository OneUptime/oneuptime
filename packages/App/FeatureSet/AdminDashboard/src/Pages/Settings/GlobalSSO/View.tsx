import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import Card from "Common/UI/Components/Card/Card";
import CopyableValueList from "Common/UI/Components/CopyableValueList/CopyableValueList";
import Link from "Common/UI/Components/Link/Link";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import { getSamlProviderFormFields } from "Common/UI/Components/Sso/SamlProviderFormFields";
import {
  getSsoGlobalReachAnswerTitle,
  getSsoGlobalSignUpAnswerTitle,
  getSsoProviderFormSteps,
  SSO_GLOBAL_REACH_TITLE,
  SSO_GLOBAL_SIGN_UP_TITLE,
} from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "Common/Models/DatabaseModels/GlobalSsoProject";
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

const GlobalSSOView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const acsURL: string = `${HTTP_PROTOCOL}${HOST}/identity/global-idp-login/${modelId.toString()}`;
  const issuerURL: string = `${HTTP_PROTOCOL}${HOST}/global-sso/${modelId.toString()}`;

  /*
   * Service-provider initiated login endpoint (same base the Accounts login
   * page uses). Visiting it redirects the browser to the configured IdP and
   * runs the full Global SSO login, so it doubles as the end-to-end "test"
   * link. It does not depend on any attached project (in default-all mode the
   * tester is signed into the projects they already belong to).
   */
  const testLoginURL: URL = URL.fromURL(IDENTITY_URL).addRoute(
    new Route(`/global-sso/${modelId.toString()}`),
  );

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="name"
      modelType={GlobalSSO}
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
          // The page that lists it, with the OIDC providers and Require SSO.
          title: t("breadcrumbs.singleSignOn"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_SSO] as Route,
          ),
        },
        {
          title: "View",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_GLOBAL_SSO_VIEW] as Route,
            { modelId },
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <Fragment>
        <CardModelDetail<GlobalSSO>
          name="Global SSO Configuration"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "SAML SSO Configuration",
            description: "Configuration for this instance-wide SAML provider.",
          }}
          isEditable={true}
          editButtonText={"Edit Configuration"}
          formSteps={getSsoProviderFormSteps<GlobalSSO>()}
          formFields={getSamlProviderFormFields<GlobalSSO>({
            withGlobalAccessSwitches: true,
          })}
          modelDetailProps={{
            modelType: GlobalSSO,
            id: "global-sso-detail",
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
                  signOnURL: true,
                },
                title: "Sign On URL",
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
                  signatureMethod: true,
                },
                title: "Signature Method",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  digestMethod: true,
                },
                title: "Digest Method",
                fieldType: FieldType.Text,
              },
              /*
               * The two questions the edit form asks, answered in its
               * words (SSO_GLOBAL_SIGN_UP_CHOICES, SSO_GLOBAL_REACH_CHOICES)
               * rather than as two Yes/No switches.
               */
              {
                field: {
                  disableSignUpWithSso: true,
                },
                title: SSO_GLOBAL_SIGN_UP_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: GlobalSSO): ReactElement => {
                  return <span>{t(getSsoGlobalSignUpAnswerTitle(item))}</span>;
                },
              },
              {
                field: {
                  restrictToAttachedProjects: true,
                },
                title: SSO_GLOBAL_REACH_TITLE,
                fieldType: FieldType.Element,
                getElement: (item: GlobalSSO): ReactElement => {
                  return <span>{t(getSsoGlobalReachAnswerTitle(item))}</span>;
                },
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

        {/*
         * The values in the card's body, the line saying what to do with
         * them as its description: a description is drawn inside a <p>,
         * which may hold no block element (React warned of the divs), and
         * it is a line, not a page.
         */}
        <Card
          title={"Identity Provider URLs"}
          description={
            "Paste these values into your SAML identity provider (Okta, Microsoft Entra ID, OneLogin, JumpCloud and more)."
          }
        >
          {/* Each value, with a button that copies it. */}
          <CopyableValueList
            dataTestId="global-sso-values"
            values={[
              {
                label: "ACS URL (Assertion Consumer Service / Reply URL):",
                value: acsURL,
              },
              {
                label: "Issuer (Entity ID):",
                value: issuerURL,
              },
            ]}
          />
        </Card>

        {/*
         * The sentence and the link are the card's body, not its
         * description: a card's description is hidden on a phone, and the
         * link is what the card is for. Drawn as a link, as the Dashboard's
         * test links are.
         */}
        <Card title={"Test this SSO provider"}>
          <div
            className="space-y-2 text-sm text-gray-600"
            data-testid="global-sso-test-link"
          >
            <p>
              Open this link to test the provider. It must be enabled, which
              only adds a &quot;Sign in with SSO&quot; option and locks no one
              out.
            </p>
            <p>
              <Link
                openInNewTab={true}
                to={testLoginURL}
                className="break-all text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
              >
                <span className="font-mono">{testLoginURL.toString()}</span>
              </Link>
            </p>
          </div>
        </Card>

        <ModelTable<GlobalSSOProject>
          modelType={GlobalSSOProject}
          userPreferencesKey={"admin-global-sso-project-table"}
          query={{
            globalSsoId: modelId,
          }}
          onBeforeCreate={(
            item: GlobalSSOProject,
          ): Promise<GlobalSSOProject> => {
            item.globalSsoId = modelId;
            return Promise.resolve(item);
          }}
          id="global-sso-project-table"
          name="Settings > Global SSO > Attached Projects"
          isDeleteable={true}
          isEditable={false}
          isCreateable={true}
          /*
           * A project is attached to the provider, not created: the button
           * read "Create Global SSO Project", after the join table's name.
           */
          createVerb="Attach"
          singularName="Project"
          pluralName="Projects"
          createFormTitle="Attach a Project"
          createFormSubmitButtonText="Attach Project"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "Attached Projects",
            description:
              "The projects this provider signs people in to, and the teams newcomers join. With none attached, it works for every project a person already belongs to.",
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
                "People who sign in for the first time join this project.",
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
              description: "The teams of that project they join.",
              fieldType: FormFieldSchemaType.CustomComponent,
              getCustomElement: (
                values: FormValues<GlobalSSOProject>,
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
              getElement: (item: GlobalSSOProject): ReactElement => {
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
          modelType={GlobalSSO}
          modelId={modelId}
          modelAPI={AdminModelAPI}
          onDeleteSuccess={() => {
            Navigation.navigate(RouteMap[PageMap.SETTINGS_SSO] as Route);
          }}
        />
      </Fragment>
    </ModelPage>
  );
};

export default GlobalSSOView;
