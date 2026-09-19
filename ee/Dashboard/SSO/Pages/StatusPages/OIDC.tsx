import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import { VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  HOST,
  HTTP_PROTOCOL,
  IDENTITY_URL,
  STATUS_PAGE_URL,
} from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageOIDC from "Common/Models/DatabaseModels/StatusPageOidc";
import EnterpriseLicenseBanner from "../../License/EnterpriseLicenseBanner";
import {
  EnterpriseLicenseMode,
  isEnterpriseConfigurationReadOnly,
} from "../../License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../../License/UseEnterpriseLicenseMode";
import ReadOnlyActionsNotice, {
  ReadOnlyActionsKind,
} from "../../TightenOnly/ReadOnlyActionsNotice";
import useDisableProviderAction, {
  DisableProviderAction,
} from "../../TightenOnly/UseDisableProviderAction";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Link from "Common/UI/Components/Link/Link";
import ProjectUtil from "Common/UI/Utils/Project";

const OIDCPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [showOidcConfigId, setShowOidcConfigId] = useState<string>("");

  /*
   * Without a valid Enterprise license (after the trial or the grace period)
   * the server refuses to create or change this configuration, and sign-in
   * through these providers is off until a license is activated; the banner
   * says both up front, and the page hides what would fail. Reads and
   * deletes keep working.
   */
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode();
  const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(licenseMode);

  /*
   * The one change the server still accepts then: switching an enabled
   * provider off ({ isEnabled: false } and nothing else), so a compromised
   * identity provider can be shut out without waiting for a license.
   */
  const [tableRefreshToggle, setTableRefreshToggle] = useState<number>(0);

  const disableAction: DisableProviderAction<StatusPageOIDC> =
    useDisableProviderAction<StatusPageOIDC>({
      modelType: StatusPageOIDC,
      isReadOnly: isReadOnly,
      onDisabled: () => {
        setTableRefreshToggle((toggle: number) => {
          return toggle + 1;
        });
      },
    });

  return (
    <Fragment>
      <EnterpriseLicenseBanner mode={licenseMode} />
      <ReadOnlyActionsNotice
        mode={licenseMode}
        kind={ReadOnlyActionsKind.Provider}
      />
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
          isEditable={!isReadOnly}
          isCreateable={!isReadOnly}
          cardProps={{
            title: "OpenID Connect (OIDC)",
            description:
              "Configure OpenID Connect identity providers for status page authentication. Private users will be able to sign in using your configured OIDC provider.",
          }}
          formSteps={[
            { title: "Basic Info", id: "basic" },
            { title: "Endpoints", id: "endpoints" },
            { title: "Credentials", id: "credentials" },
            { title: "Claims", id: "more" },
          ]}
          noItemsMessage={"No OIDC configuration found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          formFields={[
            {
              field: { name: true },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description: "Friendly name to help you remember.",
              placeholder: "Okta OIDC",
              validation: { minLength: 2 },
              stepId: "basic",
            },
            {
              field: { description: true },
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              description: "Friendly description to help you remember.",
              placeholder: "Sign in with Okta via OpenID Connect",
              validation: { minLength: 2 },
              stepId: "basic",
            },
            {
              field: { discoveryURL: true },
              title: "Discovery URL",
              fieldType: FormFieldSchemaType.URL,
              required: true,
              description:
                "OIDC discovery document URL — usually ends in /.well-known/openid-configuration.",
              placeholder:
                "https://accounts.example.com/.well-known/openid-configuration",
              stepId: "endpoints",
              disableSpellCheck: true,
            },
            {
              field: { issuerURL: true },
              title: "Issuer URL",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description:
                "Expected issuer (the 'iss' claim in the ID token). Must match exactly what the IdP returns",
              placeholder: "https://accounts.example.com",
              stepId: "endpoints",
              disableSpellCheck: true,
            },
            {
              field: { clientId: true },
              title: "Client ID",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description: "OIDC client ID issued by your identity provider.",
              placeholder: "abc123-client-id",
              stepId: "credentials",
              disableSpellCheck: true,
            },
            {
              field: { clientSecret: true },
              title: "Client Secret",
              fieldType: FormFieldSchemaType.EncryptedText,
              required: true,
              description:
                "OIDC client secret issued by your identity provider. Stored encrypted at rest.",
              placeholder: "client-secret-value",
              stepId: "credentials",
            },
            {
              field: { scopes: true },
              title: "Scopes",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description:
                "Space-separated list of OIDC scopes to request. Must include 'openid'.",
              placeholder: "openid email profile",
              stepId: "credentials",
              defaultValue: "openid email profile",
            },
            {
              field: { emailClaimName: true },
              title: "Email Claim Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description:
                "Name of the ID token / userinfo claim that contains the user's email address.",
              placeholder: "email",
              stepId: "more",
              defaultValue: "email",
            },
            {
              field: { nameClaimName: true },
              title: "Name Claim Name",
              fieldType: FormFieldSchemaType.Text,
              required: false,
              description:
                "Name of the ID token / userinfo claim that contains the user's display name. Optional.",
              placeholder: "name",
              stepId: "more",
              defaultValue: "name",
            },
            {
              field: { isEnabled: true },
              description:
                "You can test this first, before enabling it. To test, please save the config.",
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
              stepId: "more",
            },
          ]}
          showRefreshButton={true}
          refreshToggle={tableRefreshToggle.toString()}
          actionButtons={[
            {
              title: "View OIDC Config",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                item: StatusPageOIDC,
                onCompleteAction: VoidFunction,
              ) => {
                setShowOidcConfigId((item["_id"] as string) || "");
                onCompleteAction();
              },
            },
            disableAction.actionButton,
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
              Here&apos;s a link which will help you test OIDC integration
              before you force it on your organization:{" "}
              <Link
                openInNewTab={true}
                to={URL.fromString(
                  `${STATUS_PAGE_URL.toString()}/${modelId}/sso`,
                )}
              >
                <span>{`${STATUS_PAGE_URL.toString()}/${modelId}/sso`}</span>
              </Link>
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
                    Redirect URI (Callback URL):
                  </div>
                  <div>
                    {`${URL.fromString(IDENTITY_URL.toString()).addRoute(
                      `/status-page-oidc-callback/${modelId.toString()}/${showOidcConfigId}`,
                    )}`}
                  </div>
                  <br />
                </div>
                <div>
                  <div className="font-semibold">Identifier (audience): </div>
                  <div>{`${HTTP_PROTOCOL}${HOST}/${modelId.toString()}/${showOidcConfigId}`}</div>
                  <br />
                </div>
                <div className="text-sm text-gray-500">
                  Configure your identity provider to redirect to the URL above
                  after authentication. The client must be permitted to use the
                  authorization code flow with PKCE.
                </div>
              </div>
            }
            submitButtonText={"Close"}
            onSubmit={() => {
              setShowOidcConfigId("");
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}

        {disableAction.modal}
      </>
    </Fragment>
  );
};

export default OIDCPage;
