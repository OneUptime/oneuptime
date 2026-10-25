import PageComponentProps from "../../PageComponentProps";
import PlanGatedPage from "../../../Components/Billing/PlanGatedPage";
import { StatusPageOidcProvidersLeftover } from "../../../Components/Billing/IdentityPlanLeftovers";
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
import { getOidcProviderFormFields } from "Common/UI/Components/Sso/OidcProviderFormFields";
import { getSsoProviderFormSteps } from "Common/UI/Components/Sso/SsoProviderFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import { HOST, HTTP_PROTOCOL, IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
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

  const [oidcConfigTarget, setOidcConfigTarget] =
    useState<OidcConfigDialogTarget | null>(null);
  // How many providers the list holds: Test Sign-In waits for one.
  const [providerCount, setProviderCount] = useState<number>(0);
  const showOidcConfigId: string = oidcConfigTarget?.id || "";

  return (
    <Fragment>
      <>
        <ModelTable<StatusPageOIDC>
          modelType={StatusPageOIDC}
          // Enable or Disable in each row's ⋯ menu: the one that changes the row.
          rowSwitch={{ column: "isEnabled" }}
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
          singularName={StatusPageSignInCopy.oidcProvider}
          pluralName={StatusPageSignInCopy.oidcProviders}
          createVerb="Add"
          cardProps={{
            title: "OpenID Connect (OIDC)",
            description: StatusPageSignInCopy.oidcDescription,
          }}
          onFetchSuccess={(
            _data: Array<StatusPageOIDC>,
            totalCount: number,
          ): void => {
            setProviderCount(totalCount);
          }}
          formSteps={getSsoProviderFormSteps<StatusPageOIDC>()}
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

        {providerCount > 0 ? (
          <StatusPageSignInTestCard statusPageId={modelId} />
        ) : (
          <></>
        )}

        {showOidcConfigId && (
          <ConfirmModal
            title={`OIDC Configuration`}
            description={
              <div className="space-y-4">
                {/*
                 * The values to give the identity provider, each with a
                 * button that copies it.
                 */}
                <CopyableValueList
                  dataTestId="oidc-config-values"
                  values={[
                    {
                      label: "Redirect URI (Callback URL):",
                      value: `${URL.fromString(
                        IDENTITY_URL.toString(),
                      ).addRoute(
                        `/status-page-oidc-callback/${modelId.toString()}/${showOidcConfigId}`,
                      )}`,
                    },
                    {
                      label: "Identifier (audience):",
                      value: `${HTTP_PROTOCOL}${HOST}/${modelId.toString()}/${showOidcConfigId}`,
                    },
                  ]}
                />
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
 * Scale plan, so there a project below Scale sees the plan upsell instead,
 * with the OIDC providers the status page still has under it: they keep
 * signing people in until they are turned off or deleted
 * (StatusPageOidcProvidersLeftover).
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
      belowPlan={<StatusPageOidcProvidersLeftover />}
    >
      <OIDCSettings {...props} />
    </PlanGatedPage>
  );
};

export default OIDCPage;
