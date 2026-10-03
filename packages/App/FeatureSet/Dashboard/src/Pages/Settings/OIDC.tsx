import TeamsElement from "../../Components/Team/TeamsElement";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PlanGatedPage from "../../Components/Billing/PlanGatedPage";
import { SSO_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import { useDefaultSsoTeamsInitialValues } from "../../Components/Sso/UseDefaultSsoTeams";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getOidcProviderFormFields } from "Common/UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  DASHBOARD_URL,
  HOST,
  HTTP_PROTOCOL,
  IDENTITY_URL,
} from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

/*
 * The provider the configuration dialog is open for: its id, and whether it
 * is on, so the dialog can say what is left to do.
 */
interface OidcConfigDialogTarget {
  id: string;
  isEnabled: boolean;
}

/*
 * Settings > OIDC: the project's OpenID Connect sign-on providers and the
 * link to test them.
 *
 * Adding one asks for its name, issuer, client ID and secret, and the teams
 * newcomers join (the members team to start with); everything else is
 * filled in under Advanced (Common/UI/Components/Sso/OidcProviderFormFields).
 * Once it is saved, the dialog with the redirect URI to give the identity
 * provider opens straight away: that is the next thing to do.
 */
const OIDCSettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * The project's sign-in page, which lists its enabled SAML and OIDC
   * providers (Pages/Onboarding/SSO) - the page SSO enforcement sends people
   * to. The link used to end in /oidc, a page the Dashboard does not have.
   */
  const testUrl: string = `${DASHBOARD_URL.toString()}/${ProjectUtil.getCurrentProjectId()?.toString()}/sso`;
  const [oidcConfigTarget, setOidcConfigTarget] =
    useState<OidcConfigDialogTarget | null>(null);
  const showOidcConfigId: string = oidcConfigTarget?.id || "";

  const createInitialValues: FormValues<ProjectOIDC> | undefined =
    useDefaultSsoTeamsInitialValues<ProjectOIDC>();

  return (
    <Fragment>
      <>
        <ModelTable<ProjectOIDC>
          modelType={ProjectOIDC}
          userPreferencesKey={"project-oidc-table"}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="oidc-table"
          name="Settings > Project OIDC"
          saveFilterProps={{
            tableId: "settings-project-oidc-table",
          }}
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          cardProps={{
            title: "OpenID Connect (OIDC)",
            description:
              "Configure OpenID Connect identity providers for single sign-on. Members will be able to sign in using your configured OIDC provider.",
          }}
          formSteps={getSsoProviderFormSteps<ProjectOIDC>()}
          noItemsMessage={"No OIDC configuration found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          formFields={getOidcProviderFormFields<ProjectOIDC>({
            withTeams: true,
          })}
          createInitialValues={createInitialValues}
          onCreateSuccess={(
            item: ProjectOIDC,
            modalType?: ModalType,
          ): Promise<ProjectOIDC> => {
            if (modalType === ModalType.Create && item._id) {
              setOidcConfigTarget({
                id: item._id.toString(),
                isEnabled: Boolean(item.isEnabled),
              });
            }

            return Promise.resolve(item);
          }}
          showRefreshButton={true}
          actionButtons={[
            {
              title: "View OIDC Config",
              icon: IconProp.Settings,
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                item: ProjectOIDC,
                onCompleteAction: VoidFunction,
              ) => {
                setOidcConfigTarget({
                  id: (item["_id"] as string) || "",
                  isEnabled: Boolean(item.isEnabled),
                });
                onCompleteAction();
              },
            },
          ]}
          filters={[
            {
              field: { name: true },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: { description: true },
              title: "Description",
              type: FieldType.Text,
            },
            {
              field: { isEnabled: true },
              title: "Enabled",
              type: FieldType.Boolean,
            },
          ]}
          columns={[
            {
              field: { name: true },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: { description: true },
              title: "Description",
              type: FieldType.Text,
            },
            {
              field: {
                teams: {
                  name: true,
                  _id: true,
                  projectId: true,
                },
              },
              title: "Add User to Team",
              type: FieldType.Text,
              getElement: (item: ProjectOIDC): ReactElement => {
                return <TeamsElement teams={item["teams"] || []} />;
              },
            },
            {
              field: { isEnabled: true },
              title: "Enabled",
              type: FieldType.Boolean,
            },
          ]}
        />

        <Card
          title={`Test OpenID Connect (OIDC)`}
          description={
            <span>
              <TranslatedSentence
                template="Here's a link which will help you test OIDC integration before you force it on your organization: {{link}}"
                slots={{
                  link: (
                    <Link openInNewTab={true} to={URL.fromString(testUrl)}>
                      <span>{testUrl}</span>
                    </Link>
                  ),
                }}
              />
            </span>
          }
        />

        {showOidcConfigId && (
          <ConfirmModal
            title={`OIDC Configuration`}
            description={
              <div>
                <div>
                  <div className="font-semibold">
                    {translator.translateText("Redirect URI (Callback URL):")}
                  </div>
                  <div>
                    {`${URL.fromString(IDENTITY_URL.toString()).addRoute(
                      `/oidc-callback/${ProjectUtil.getCurrentProjectId()?.toString()}/${showOidcConfigId}`,
                    )}`}
                  </div>
                  <br />
                </div>
                <div>
                  <div className="font-semibold">
                    {translator.translateText("Identifier (audience):")}
                  </div>
                  <div>{`${HTTP_PROTOCOL}${HOST}/${ProjectUtil.getCurrentProjectId()?.toString()}/${showOidcConfigId}`}</div>
                  <br />
                </div>
                <div className="text-sm text-gray-500">
                  {translator.translateText(
                    "Configure your identity provider to redirect to the URL above after authentication. The client must be permitted to use the authorization code flow with PKCE.",
                  )}
                </div>
                {!oidcConfigTarget?.isEnabled && (
                  <div
                    className="mt-3 text-sm text-gray-500"
                    data-testid="oidc-config-turn-on-note"
                  >
                    {translator.translateText(
                      "This provider is off. Once your identity provider has the redirect URI above, edit the provider and turn Enabled on.",
                    )}
                  </div>
                )}
              </div>
            }
            submitButtonText={"Close"}
            onSubmit={() => {
              setOidcConfigTarget(null);
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
      </>
    </Fragment>
  );
};

/*
 * Every edition includes single sign-on. OneUptime Cloud sells it on the
 * Scale plan, so there a project below Scale sees the plan upsell instead.
 */
const OIDCPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <PlanGatedPage
      requiredPlan={SSO_REQUIRED_PLAN}
      upsell={{
        title: "OpenID Connect (OIDC)",
        description: "Configure OIDC sign-on for your project.",
        featureName: "OIDC Single Sign On",
        featureDescription:
          "Authenticate team members through any OIDC provider — Google Workspace, Auth0, Keycloak, Microsoft Entra ID and more.",
        benefits: [
          {
            icon: IconProp.Lock,
            title: "Modern OAuth2 flow",
            subtitle:
              "Use any OIDC-compliant identity provider to manage who can sign in.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Enforce SSO",
            subtitle:
              "Require OIDC login for everyone in the project — no shared passwords.",
          },
          {
            icon: IconProp.User,
            title: "Auto team assignment",
            subtitle:
              "Map signed-in users into the right teams the moment they log in.",
          },
          {
            icon: IconProp.ClipboardDocumentList,
            title: "Audit trail",
            subtitle:
              "Every OIDC sign-in is recorded alongside the rest of your audit events.",
          },
        ],
      }}
    >
      <OIDCSettings {...props} />
    </PlanGatedPage>
  );
};

export default OIDCPage;
