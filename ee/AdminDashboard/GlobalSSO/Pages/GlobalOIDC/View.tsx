import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import PageMap from "@oneuptime/admin-dashboard/Utils/PageMap";
import RouteMap, { RouteUtil } from "@oneuptime/admin-dashboard/Utils/RouteMap";
import DashboardSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import GlobalOIDC from "Common/Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "Common/Models/DatabaseModels/GlobalOidcProject";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import ProjectScopedTeamsPicker, {
  resolveProjectIdFromFormValue,
  selectedTeamIdsFromFormValue,
} from "@oneuptime/admin-dashboard/Components/GlobalProvider/ProjectScopedTeamsPicker";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
/*
 * The license state helpers are shared with the Dashboard's identity
 * screens; they import Common/... only, so either frontend can bundle them.
 */
import EnterpriseLicenseBanner from "../../../../Dashboard/SSO/License/EnterpriseLicenseBanner";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
  isEnterpriseConfigurationReadOnly,
} from "../../../../Dashboard/SSO/License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../../../../Dashboard/SSO/License/UseEnterpriseLicenseMode";
import ReadOnlyActionsNotice, {
  ReadOnlyActionsKind,
} from "../../../../Dashboard/SSO/TightenOnly/ReadOnlyActionsNotice";
import DisableProviderCard from "../../../../Dashboard/SSO/TightenOnly/DisableProviderCard";
import useDisableProviderAction, {
  DISABLE_PROJECT_ATTACHMENT_CONFIRMATION,
  DisableProviderAction,
} from "../../../../Dashboard/SSO/TightenOnly/UseDisableProviderAction";

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

  /*
   * Without a valid Enterprise license (after the trial or the grace period)
   * the server refuses to create or change this configuration, master
   * admins included, and sign-in through these providers is off until a
   * license is activated; the banner says both up front, and the page hides
   * what would fail. Reads and deletes keep working.
   */
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.SSO,
  );
  const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(licenseMode);

  /*
   * The one change the server still accepts then: switching the provider,
   * or one of its project attachments, off ({ isEnabled: false } and
   * nothing else), so a compromised identity provider can be shut out
   * without waiting for a license. Whether the provider is on comes from
   * the configuration card below, which reloads once it has been switched
   * off.
   */
  const [isProviderEnabled, setIsProviderEnabled] = useState<boolean>(false);
  const [providerRefresher, setProviderRefresher] = useState<boolean>(false);
  const [attachmentsRefreshToggle, setAttachmentsRefreshToggle] =
    useState<number>(0);

  const providerDisableAction: DisableProviderAction<GlobalOIDC> =
    useDisableProviderAction<GlobalOIDC>({
      modelType: GlobalOIDC,
      modelAPI: AdminModelAPI,
      isReadOnly: isReadOnly,
      onDisabled: () => {
        setIsProviderEnabled(false);
        setProviderRefresher((refresher: boolean) => {
          return !refresher;
        });
      },
    });

  const attachmentDisableAction: DisableProviderAction<GlobalOIDCProject> =
    useDisableProviderAction<GlobalOIDCProject>({
      modelType: GlobalOIDCProject,
      modelAPI: AdminModelAPI,
      isReadOnly: isReadOnly,
      confirmation: DISABLE_PROJECT_ATTACHMENT_CONFIRMATION,
      onDisabled: () => {
        setAttachmentsRefreshToggle((toggle: number) => {
          return toggle + 1;
        });
      },
    });

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
        <EnterpriseLicenseBanner
          mode={licenseMode}
          feature={LicensedFeature.SSO}
        />
        <ReadOnlyActionsNotice
          mode={licenseMode}
          kind={ReadOnlyActionsKind.Provider}
        />

        {isReadOnly && isProviderEnabled ? (
          <DisableProviderCard
            onDisable={() => {
              providerDisableAction.requestDisable(modelId);
            }}
          />
        ) : (
          <></>
        )}

        <CardModelDetail<GlobalOIDC>
          name="Global OIDC Configuration"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "OIDC SSO Configuration",
            description: "Configuration for this instance-wide OIDC provider.",
          }}
          isEditable={!isReadOnly}
          refresher={providerRefresher}
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
                restrictToAttachedProjects: true,
              },
              title: "Restrict to Attached Projects",
              description:
                "When on, this provider only satisfies SSO enforcement for the projects attached below. Off by default, where attachments control provisioning only.",
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
            onItemLoaded: (item: GlobalOIDC) => {
              setIsProviderEnabled(item.isEnabled === true);
            },
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
          isCreateable={!isReadOnly}
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "Attached Projects",
            description:
              "Attach this provider to a project and pick that project's default teams. Add one project + teams at a time to build the list. If no projects are attached, the provider works for all projects a user is already a member of (invite-first). To change an attachment, delete it and add it again.",
          }}
          noItemsMessage={"No projects attached to this provider."}
          showRefreshButton={true}
          refreshToggle={attachmentsRefreshToggle.toString()}
          actionButtons={[attachmentDisableAction.actionButton]}
          filters={[]}
          formSteps={
            [
              {
                id: "project",
                title: "Select Project",
              },
              {
                id: "teams",
                title: "Select Teams",
              },
            ] as Array<FormStep<GlobalOIDCProject>>
          }
          formFields={[
            {
              field: {
                project: true,
              },
              stepId: "project",
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
              stepId: "teams",
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

        {providerDisableAction.modal}
        {attachmentDisableAction.modal}
      </Fragment>
    </ModelPage>
  );
};

export default GlobalOIDCView;
