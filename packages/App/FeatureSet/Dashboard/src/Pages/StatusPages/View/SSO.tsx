import PageComponentProps from "../../PageComponentProps";
import PlanGatedPage from "../../../Components/Billing/PlanGatedPage";
import { SSO_REQUIRED_PLAN } from "../../../Enterprise/EnterpriseEligibility";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getSamlProviderFormFields } from "Common/UI/Components/Sso/SamlProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  HOST,
  HTTP_PROTOCOL,
  IDENTITY_URL,
  STATUS_PAGE_URL,
} from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Link from "Common/UI/Components/Link/Link";
import ProjectUtil from "Common/UI/Utils/Project";
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
 * Status page > SSO: SAML sign-on for private status page users, the link to
 * test it, and "Force SSO for Login" for the status page.
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
  const testUrl: string = `${STATUS_PAGE_URL.toString()}/${modelId}/sso`;

  const [samlConfigTarget, setSamlConfigTarget] =
    useState<SamlConfigDialogTarget | null>(null);
  const showSingleSignOnUrlId: string = samlConfigTarget?.id || "";

  return (
    <Fragment>
      <>
        <ModelTable<StatusPageSSO>
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
          cardProps={{
            title: "Single Sign On (SSO)",
            description:
              "Single sign-on is an authentication scheme that allows a user to log in with a single ID to any of several related, yet independent, software systems.",
          }}
          videoLink={URL.fromString("https://youtu.be/F_h74p38SU0")}
          noItemsMessage={"No SSO configuration found."}
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

        {/* API Key View  */}
        <CardModelDetail
          name="SSO Settings"
          editButtonText={"Edit Settings"}
          cardProps={{
            title: "SSO Settings",
            description: "Configure settings for SSO.",
          }}
          isEditable={true}
          formFields={[
            {
              field: {
                requireSsoForLogin: true,
              },
              title: "Force SSO for Login",
              description:
                "Please test SSO before you you enable this feature. If SSO is not tested properly then you will be locked out of the project.",
              fieldType: FormFieldSchemaType.Toggle,
            },
          ]}
          modelDetailProps={{
            modelType: StatusPage,
            id: "sso-settings",
            fields: [
              {
                field: {
                  requireSsoForLogin: true,
                },
                fieldType: FieldType.Boolean,
                title: "Force SSO for Login",
                description:
                  "Please test SSO before you enable this feature. If SSO is not tested properly then you will be locked out of the status page.",
              },
            ],
            modelId: modelId,
          }}
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

                  <div>{`${HTTP_PROTOCOL}${HOST}/${modelId.toString()}/${showSingleSignOnUrlId}`}</div>
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
                      `/status-page-idp-login/${modelId.toString()}/${showSingleSignOnUrlId}`,
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
 * Scale plan, so there a project below Scale sees the plan upsell instead.
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
    >
      <SSOSettings {...props} />
    </PlanGatedPage>
  );
};

export default SSOPage;
