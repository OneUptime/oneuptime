import PageComponentProps from "../../PageComponentProps";
import PlanGatedPage from "../../../Components/Billing/PlanGatedPage";
import { StatusPageSamlProvidersLeftover } from "../../../Components/Billing/IdentityPlanLeftovers";
import StatusPageRequireSsoCard from "../../../Components/StatusPage/StatusPageRequireSsoCard";
import { SSO_REQUIRED_PLAN } from "../../../Enterprise/EnterpriseEligibility";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CopyableValueList from "Common/UI/Components/CopyableValueList/CopyableValueList";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getSamlProviderFormFields } from "Common/UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import StatusPageSignInTestCard from "../../../Components/StatusPage/StatusPageSignInTestCard";
import { StatusPageSignInCopy } from "../../../Components/StatusPage/StatusPageSignInCopy";

/*
 * The provider the configuration dialog is open for: its id, and whether it
 * is on, so the dialog can say what is left to do.
 */
interface SamlConfigDialogTarget {
  id: string;
  isEnabled: boolean;
}

/*
 * Status page > SSO: SAML sign-on for private status page users, the link to
 * test it, and "Require SSO for Login" for the status page (a switch that
 * saves when flipped: StatusPageRequireSsoCard).
 *
 * Adding one asks for what the identity provider gives - its sign-on URL,
 * issuer and certificate; the signature and digest methods and the
 * description are filled in under Advanced
 * (Common/UI/Components/Sso/SamlProviderFormFields). Once it is saved, the
 * dialog with the Entity ID and Reply URL to give the identity provider
 * opens straight away: that is the next thing to do.
 */
const SSOSettings: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [samlConfigTarget, setSamlConfigTarget] =
    useState<SamlConfigDialogTarget | null>(null);
  // How many providers the list holds: Test Sign-In waits for one.
  const [providerCount, setProviderCount] = useState<number>(0);
  const showSingleSignOnUrlId: string = samlConfigTarget?.id || "";

  return (
    <Fragment>
      <>
        <ModelTable<StatusPageSSO>
          // Enable or Disable in each row's ⋯ menu: the one that changes the row.
          rowSwitch={{ column: "isEnabled" }}
          modelType={StatusPageSSO}
          userPreferencesKey={"status-page-sso-table"}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            statusPageId: modelId.toString(),
          }}
          onBeforeCreate={(item: StatusPageSSO): Promise<StatusPageSSO> => {
            if (!props.currentProject || !props.currentProject._id) {
              throw new BadDataException("Project ID cannot be null");
            }

            item.statusPageId = modelId;
            item.projectId = new ObjectID(props.currentProject._id);

            return Promise.resolve(item);
          }}
          id="sso-table"
          name="Status Pages > Status Page View > Project SSO"
          saveFilterProps={{
            tableId: "status-page-sso-table",
          }}
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          singularName={StatusPageSignInCopy.ssoProvider}
          pluralName={StatusPageSignInCopy.ssoProviders}
          createVerb="Add"
          cardProps={{
            title: "Single Sign On (SSO)",
            description: StatusPageSignInCopy.ssoDescription,
          }}
          videoLink={URL.fromString("https://youtu.be/F_h74p38SU0")}
          onFetchSuccess={(
            _data: Array<StatusPageSSO>,
            totalCount: number,
          ): void => {
            setProviderCount(totalCount);
          }}
          viewPageRoute={Navigation.getCurrentRoute()}
          formSteps={getSsoProviderFormSteps<StatusPageSSO>()}
          formFields={getSamlProviderFormFields<StatusPageSSO>()}
          onCreateSuccess={(
            item: StatusPageSSO,
            modalType?: ModalType,
          ): Promise<StatusPageSSO> => {
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
                item: StatusPageSSO,
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
                isEnabled: true,
              },
              title: "Enabled",
              type: FieldType.Boolean,
              hideOnMobile: true,
            },
          ]}
        />

        {providerCount > 0 ? (
          <StatusPageSignInTestCard statusPageId={modelId} />
        ) : (
          <></>
        )}

        {/*
         * "Require SSO for Login": one switch that saves when flipped, and
         * asks first before it turns off signing in with a password.
         */}
        <StatusPageRequireSsoCard statusPageId={modelId} />

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
                      value: `${HTTP_PROTOCOL}${HOST}/${modelId.toString()}/${showSingleSignOnUrlId}`,
                    },
                    {
                      label: "Reply URL (Assertion Consumer Service URL):",
                      value: `${URL.fromString(
                        IDENTITY_URL.toString(),
                      ).addRoute(
                        `/status-page-idp-login/${modelId.toString()}/${showSingleSignOnUrlId}`,
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
 * Scale plan, so there a project below Scale sees the plan upsell instead,
 * with what a Scale trial left under it: "Require SSO for Login" while the
 * status page still requires SSO, and the SAML providers it still has,
 * which keep signing people in until they are turned off or deleted
 * (StatusPageSamlProvidersLeftover).
 */
const SSOPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <PlanGatedPage
      requiredPlan={SSO_REQUIRED_PLAN}
      upsell={{
        title: "Status Page SSO",
        description: "Configure SAML SSO for this private status page.",
        featureName: "Status Page SAML SSO",
        featureDescription:
          "Restrict access to this status page using your SAML identity provider — Okta, Azure AD, OneLogin and more.",
        benefits: [
          {
            icon: IconProp.Lock,
            title: "Private status pages",
            subtitle:
              "Only signed-in members of your IdP can view this status page.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Centralized control",
            subtitle:
              "Revoke a user in your IdP and they lose access to the status page immediately.",
          },
          {
            icon: IconProp.User,
            title: "Per-status-page identity",
            subtitle:
              "Run distinct identity providers for different audiences (internal vs partner).",
          },
          {
            icon: IconProp.ClipboardDocumentList,
            title: "Audit trail",
            subtitle: "See who signed in to your status page and when.",
          },
        ],
      }}
      belowPlan={<StatusPageSamlProvidersLeftover />}
    >
      <SSOSettings {...props} />
    </PlanGatedPage>
  );
};

export default SSOPage;
