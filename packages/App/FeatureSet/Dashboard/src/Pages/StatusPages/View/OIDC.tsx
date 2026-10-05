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
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { getOidcProviderFormFields } from "Common/UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  HOST,
  HTTP_PROTOCOL,
  IDENTITY_URL,
  STATUS_PAGE_URL,
} from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
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
interface OidcConfigDialogTarget {
  id: string;
  isEnabled: boolean;
}

/*
 * Status page > OIDC: OpenID Connect sign-on for private status page users,
 * and the link to test it.
 *
 * Adding one asks for its name, issuer, client ID and secret; everything
 * else is filled in under Advanced
 * (Common/UI/Components/Sso/OidcProviderFormFields). Once it is saved, the
 * dialog with the redirect URI to give the identity provider opens straight
 * away: that is the next thing to do.
 */
const OIDCSettings: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const testUrl: string = `${STATUS_PAGE_URL.toString()}/${modelId}/sso`;

  const [oidcConfigTarget, setOidcConfigTarget] =
    useState<OidcConfigDialogTarget | null>(null);
  const showOidcConfigId: string = oidcConfigTarget?.id || "";

  return (
    <Fragment>
      <>
        <ModelTable<StatusPageOIDC>
          modelType={StatusPageOIDC}
          userPreferencesKey={"status-page-oidc-table"}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
            statusPageId: modelId.toString(),
          }}
          onBeforeCreate={(item: StatusPageOIDC): Promise<StatusPageOIDC> => {
            if (!props.currentProject || !props.currentProject._id) {
              throw new BadDataException("Project ID cannot be null");
            }

            item.statusPageId = modelId;
            item.projectId = new ObjectID(props.currentProject._id);

            return Promise.resolve(item);
          }}
          id="oidc-table"
          name="Status Pages > Status Page View > Status Page OIDC"
          saveFilterProps={{
            tableId: "status-page-oidc-table",
          }}
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          cardProps={{
            title: "OpenID Connect (OIDC)",
            description:
              "Configure OpenID Connect identity providers for status page authentication. Private users will be able to sign in using your configured OIDC provider.",
          }}
          formSteps={getSsoProviderFormSteps<StatusPageOIDC>()}
          noItemsMessage={"No OIDC configuration found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          formFields={getOidcProviderFormFields<StatusPageOIDC>()}
          onCreateSuccess={(
            item: StatusPageOIDC,
            modalType?: ModalType,
          ): Promise<StatusPageOIDC> => {
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
                item: StatusPageOIDC,
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
              hideOnMobile: true,
            },
            {
              field: { isEnabled: true },
              title: "Enabled",
              type: FieldType.Boolean,
              hideOnMobile: true,
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
                      `/status-page-oidc-callback/${modelId.toString()}/${showOidcConfigId}`,
                    )}`}
                  </div>
                  <br />
                </div>
                <div>
                  <div className="font-semibold">
                    {translator.translateText("Identifier (audience):")}
                  </div>
                  <div>{`${HTTP_PROTOCOL}${HOST}/${modelId.toString()}/${showOidcConfigId}`}</div>
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
        title: "Status Page OIDC",
        description: "Configure OIDC sign-on for this private status page.",
        featureName: "Status Page OIDC SSO",
        featureDescription:
          "Restrict access to this status page using any OIDC provider — Google Workspace, Auth0, Keycloak and more.",
        benefits: [
          {
            icon: IconProp.Lock,
            title: "Private status pages",
            subtitle:
              "Only OIDC-authenticated users can view this status page.",
          },
          {
            icon: IconProp.ShieldCheck,
            title: "Centralized control",
            subtitle:
              "Revoke a user in your IdP and they lose access immediately.",
          },
          {
            icon: IconProp.User,
            title: "Per-status-page identity",
            subtitle:
              "Run distinct IdPs for different audiences (internal vs partner).",
          },
          {
            icon: IconProp.ClipboardDocumentList,
            title: "Audit trail",
            subtitle: "See who signed in to your status page and when.",
          },
        ],
      }}
    >
      <OIDCSettings {...props} />
    </PlanGatedPage>
  );
};

export default OIDCPage;
