import TeamsElement from "../../Components/Team/TeamsElement";
import RequireSsoForLoginCard from "../../Components/Project/RequireSsoForLoginCard";
import RequireSsoForLoginLeftover from "../../Components/Project/RequireSsoForLoginLeftover";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import PlanGatedPage from "../../Components/Billing/PlanGatedPage";
import { ProjectSamlProvidersLeftover } from "../../Components/Billing/IdentityPlanLeftovers";
import { SSO_REQUIRED_PLAN } from "../../Enterprise/EnterpriseEligibility";
import { useDefaultSsoTeamsInitialValues } from "../../Components/Sso/UseDefaultSsoTeams";
import { getSsoTeamsGrantNote } from "../../Components/Sso/SsoTeamsGrantNote";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getSamlProviderFormFields } from "Common/UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  DASHBOARD_URL,
  HOST,
  HTTP_PROTOCOL,
  IDENTITY_URL,
} from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
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
interface SamlConfigDialogTarget {
  id: string;
  isEnabled: boolean;
}

/*
 * Settings > SSO: the project's SAML single sign-on providers, the link to
 * test them, and "Require SSO for Login".
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
  const testUrl: string = `${DASHBOARD_URL.toString()}/${ProjectUtil.getCurrentProjectId()?.toString()}/sso`;
  const [samlConfigTarget, setSamlConfigTarget] =
    useState<SamlConfigDialogTarget | null>(null);
  const showSingleSignOnUrlId: string = samlConfigTarget?.id || "";

  const createInitialValues: FormValues<ProjectSSO> | undefined =
    useDefaultSsoTeamsInitialValues<ProjectSSO>();

  return (
    <Fragment>
      <>
        <ModelTable<ProjectSSO>
          modelType={ProjectSSO}
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
          cardProps={{
            title: "Single Sign On (SSO)",
            description:
              "Single sign-on is an authentication scheme that allows a user to log in with a single ID to any of several related, yet independent, software systems.",
          }}
          videoLink={URL.fromString("https://youtu.be/tq4WRgxbIwk")}
          formSteps={getSsoProviderFormSteps<ProjectSSO>()}
          noItemsMessage={"No SSO configuration found."}
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

        <Card
          title={`Test Single Sign On (SSO)`}
          description={
            <span>
              <TranslatedSentence
                template="Here's a link which will help you test SSO integration before you force it on your organization: {{link}}"
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

        {/*
         * Whether everyone has to sign in with SSO to open the project: one
         * switch that saves when flipped, and asks - with a red button -
         * before it locks out everyone not signed in with SSO.
         */}
        <RequireSsoForLoginCard
          projectId={ProjectUtil.getCurrentProjectId()!}
        />

        {showSingleSignOnUrlId && (
          <ConfirmModal
            title={`SSO Configuration`}
            description={
              <div>
                <div>
                  <div className="font-semibold">
                    {translator.translateText("Identifier (Entity ID):")}
                  </div>

                  <div>{`${HTTP_PROTOCOL}${HOST}/${props.currentProject?._id}/${showSingleSignOnUrlId}`}</div>
                  <br />
                </div>
                <div>
                  <div className="font-semibold">
                    {translator.translateText(
                      "Reply URL (Assertion Consumer Service URL):",
                    )}
                  </div>
                  <div>
                    {`${URL.fromString(IDENTITY_URL.toString()).addRoute(
                      `/idp-login/${props.currentProject?._id}/${showSingleSignOnUrlId}`,
                    )}`}
                  </div>
                  <br />
                </div>
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
 * off (RequireSsoForLoginLeftover), and the SAML providers the project
 * still has, which keep signing people in until they are turned off or
 * deleted (ProjectSamlProvidersLeftover).
 */
const SSOPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <PlanGatedPage
      requiredPlan={SSO_REQUIRED_PLAN}
      upsell={{
        title: "Single Sign On (SSO)",
        description: "Configure SAML SSO for your project.",
        featureName: "SAML Single Sign On",
        featureDescription:
          "Let team members authenticate into this project using your SAML identity provider (Okta, Azure AD, OneLogin, JumpCloud and more).",
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
        </>
      }
    >
      <SSOSettings {...props} />
    </PlanGatedPage>
  );
};

export default SSOPage;
