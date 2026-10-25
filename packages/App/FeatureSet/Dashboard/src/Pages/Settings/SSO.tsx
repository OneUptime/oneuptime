import TeamsElement from "../../Components/Team/TeamsElement";
import RequireSsoForLoginCard from "../../Components/Project/RequireSsoForLoginCard";
import RequireSsoForLoginLeftover from "../../Components/Project/RequireSsoForLoginLeftover";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PlanGatedPage from "../../Components/Billing/PlanGatedPage";
import {
  ProjectOidcProvidersLeftover,
  ProjectSamlProvidersLeftover,
} from "../../Components/Billing/IdentityPlanLeftovers";
import ProjectOidcProviders from "../../Components/Sso/ProjectOidcProviders";
import ProjectSignInTestCard from "../../Components/Sso/ProjectSignInTestCard";
import ProjectSsoCopy from "../../Components/Sso/ProjectSsoCopy";
import { SSO_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import { useDefaultSsoTeamsInitialValues } from "../../Components/Sso/UseDefaultSsoTeams";
import { getSsoTeamsGrantNote } from "../../Components/Sso/SsoTeamsGrantNote";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CopyableValueList from "Common/UI/Components/CopyableValueList/CopyableValueList";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getSamlProviderFormFields } from "Common/UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The provider the configuration dialog is open for: its id, and whether it
 * is on, so the dialog can say what is left to do.
 */
interface SamlConfigDialogTarget {
  id: string;
  isEnabled: boolean;
}

/*
 * Settings > SSO: everything single sign-on, on one page - the project's
 * SAML providers, its OpenID Connect providers (Components/Sso/
 * ProjectOidcProviders, which had a page of their own), the link to test
 * them, and "Require SSO for Login", which a sign-in through either kind
 * meets.
 *
 * Adding one asks for what the identity provider gives - its sign-on URL,
 * issuer and certificate - and the teams newcomers join (the members team
 * to start with, and only teams the person could invite someone to: a
 * picked team beyond that is named under Teams, see SsoTeamsGrantNote); the
 * signature and digest methods and the description are filled in under
 * Advanced (Common/UI/Components/Sso/SamlProviderFormFields).
 * Once it is saved, the dialog with the Entity ID and Reply URL to give the
 * identity provider opens straight away: that is the next thing to do.
 */
const SSOSettings: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [samlConfigTarget, setSamlConfigTarget] =
    useState<SamlConfigDialogTarget | null>(null);
  const showSingleSignOnUrlId: string = samlConfigTarget?.id || "";

  /*
   * How many providers of each kind the two lists hold: the test link
   * waits for one to try, as a status page's Test Sign-In does.
   */
  const [samlProviderCount, setSamlProviderCount] = useState<number>(0);
  const [oidcProviderCount, setOidcProviderCount] = useState<number>(0);
  const hasProviderToTest: boolean = samlProviderCount + oidcProviderCount > 0;

  // Looked up once, for the SAML and the OIDC tables alike.
  const createInitialValues: FormValues<ProjectSSO> | undefined =
    useDefaultSsoTeamsInitialValues<ProjectSSO>();

  return (
    <Fragment>
      <>
        <ModelTable<ProjectSSO>
          modelType={ProjectSSO}
          // Enable or Disable in each row's ⋯ menu: the one that changes the row.
          rowSwitch={{ column: "isEnabled" }}
          userPreferencesKey={"project-sso-table"}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="sso-table"
          name="Settings > Project SSO"
          saveFilterProps={{
            tableId: "settings-project-sso-table",
          }}
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          /*
           * "Add SAML Provider", and "No SAML providers yet" while it has
           * none: what the card holds, beside the OIDC providers' card
           * (ProjectSsoCopy).
           */
          singularName={ProjectSsoCopy.samlProvider}
          pluralName={ProjectSsoCopy.samlProviders}
          createVerb="Add"
          cardProps={{
            title: "SAML",
            description:
              "Sign in through a SAML app, such as Okta, Microsoft Entra ID or OneLogin.",
          }}
          videoLink={URL.fromString("https://youtu.be/tq4WRgxbIwk")}
          formSteps={getSsoProviderFormSteps<ProjectSSO>()}
          onFetchSuccess={(
            _data: Array<ProjectSSO>,
            totalCount: number,
          ): void => {
            setSamlProviderCount(totalCount);
          }}
          viewPageRoute={Navigation.getCurrentRoute()}
          formFields={getSamlProviderFormFields<ProjectSSO>({
            withTeams: true,
            getTeamsFooterElement: getSsoTeamsGrantNote,
          })}
          createInitialValues={createInitialValues}
          onCreateSuccess={(
            item: ProjectSSO,
            modalType?: ModalType,
          ): Promise<ProjectSSO> => {
            if (modalType === ModalType.Create && item._id) {
              setSamlConfigTarget({
                id: item._id.toString(),
                isEnabled: Boolean(item.isEnabled),
              });
            }

            return Promise.resolve(item);
          }}
          showRefreshButton={true}
          actionButtons={[
            {
              title: "View SSO Config",
              icon: IconProp.Settings,
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                item: ProjectSSO,
                onCompleteAction: VoidFunction,
              ) => {
                setSamlConfigTarget({
                  id: (item["_id"] as string) || "",
                  isEnabled: Boolean(item.isEnabled),
                });
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
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
              hideOnMobile: true,
            },
            {
              field: {
                teams: {
                  name: true,
                  _id: true,
                  projectId: true,
                },
              },
              // The teams people who sign in for the first time join.
              title: ProjectSsoCopy.teamsColumn,
              type: FieldType.Text,
              getElement: (item: ProjectSSO): ReactElement => {
                return <TeamsElement teams={item["teams"] || []} />;
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

        {/*
         * The project's OpenID Connect providers, which had a page of their
         * own (Settings > OIDC): one place for single sign-on, under one
         * test link and the one Require SSO for Login switch, which counts
         * an OIDC sign-in exactly as a SAML one.
         */}
        <ProjectOidcProviders
          /*
           * The same { teams } a new SAML provider starts on: both kinds
           * keep the teams newcomers join in a column of that name.
           */
          createInitialValues={
            createInitialValues as unknown as
              | FormValues<ProjectOIDC>
              | undefined
          }
          onProviderCountChange={setOidcProviderCount}
        />

        {/*
         * One test link for both: the project's sign-in page lists its
         * SAML and OIDC providers (Pages/Onboarding/SSO). Drawn once there
         * is a provider to try; before that the link opens a page with
         * nothing on it.
         */}
        {hasProviderToTest ? (
          <ProjectSignInTestCard
            projectId={ProjectUtil.getCurrentProjectId()!}
          />
        ) : (
          <></>
        )}

        {/*
         * Whether everyone has to sign in with SSO to open the project: one
         * switch that saves when flipped, and asks - with a red button -
         * before it locks out everyone not signed in with SSO.
         */}
        <RequireSsoForLoginCard
          projectId={ProjectUtil.getCurrentProjectId()!}
          // Its line points at the test link: only while that is drawn.
          isTestLinkShown={hasProviderToTest}
        />

        {showSingleSignOnUrlId && (
          <ConfirmModal
            title={`SSO Configuration`}
            description={
              <div className="space-y-4">
                {/*
                 * The two values to paste into the identity provider, each
                 * with a button that copies it.
                 */}
                <CopyableValueList
                  dataTestId="sso-config-values"
                  values={[
                    {
                      label: "Identifier (Entity ID):",
                      value: `${HTTP_PROTOCOL}${HOST}/${props.currentProject?._id}/${showSingleSignOnUrlId}`,
                    },
                    {
                      label: "Reply URL (Assertion Consumer Service URL):",
                      value: `${URL.fromString(
                        IDENTITY_URL.toString(),
                      ).addRoute(
                        `/idp-login/${props.currentProject?._id}/${showSingleSignOnUrlId}`,
                      )}`,
                    },
                  ]}
                />
                {!samlConfigTarget?.isEnabled && (
                  <div
                    className="text-sm text-gray-500"
                    data-testid="sso-config-turn-on-note"
                  >
                    {translator.translateText(
                      "This provider is off. Once your identity provider has the Entity ID and Reply URL above, edit the provider and turn Enabled on.",
                    )}
                  </div>
                )}
              </div>
            }
            submitButtonText={"Close"}
            onSubmit={() => {
              setSamlConfigTarget(null);
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
 * Scale plan, so there a project below Scale sees the plan upsell instead -
 * with "Require SSO for Login" under it while a Scale trial (or a move down
 * from Scale) left the project requiring SSO, so it can always be turned
 * off (RequireSsoForLoginLeftover), and the SAML and OIDC providers the
 * project still has, which keep signing people in until they are turned
 * off or deleted (ProjectSamlProvidersLeftover,
 * ProjectOidcProvidersLeftover).
 */
const SSOPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <PlanGatedPage
      requiredPlan={SSO_REQUIRED_PLAN}
      upsell={{
        title: "Single Sign On (SSO)",
        description: "Sign in with SAML or OpenID Connect.",
        featureName: "Single Sign-On",
        featureDescription:
          "Let team members sign in to this project with your identity provider, over SAML or OpenID Connect (Okta, Microsoft Entra ID, Google Workspace and more).",
        benefits: [
          {
            icon: IconProp.Lock,
            title: "Centralized auth",
            subtitle:
              "Federate sign-in to your IdP and revoke access from one place.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Enforce SSO",
            subtitle:
              "Require SSO for everyone in the project — no shared passwords.",
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
              "Every SSO sign-in is recorded alongside the rest of your audit events.",
          },
        ],
      }}
      belowPlan={
        <>
          <RequireSsoForLoginLeftover
            projectId={ProjectUtil.getCurrentProjectId()!}
          />
          <ProjectSamlProvidersLeftover />
          <ProjectOidcProvidersLeftover />
        </>
      }
    >
      <SSOSettings {...props} />
    </PlanGatedPage>
  );
};

export default SSOPage;
