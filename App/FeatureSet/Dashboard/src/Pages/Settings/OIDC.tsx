import TeamsElement from "../../Components/Team/TeamsElement";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  DASHBOARD_URL,
  HOST,
  HTTP_PROTOCOL,
  IDENTITY_URL,
} from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import Team from "Common/Models/DatabaseModels/Team";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Link from "Common/UI/Components/Link/Link";

const OIDCPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [showOidcConfigId, setShowOidcConfigId] = useState<string>("");

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
          formSteps={[
            { title: "Basic Info", id: "basic" },
            { title: "Endpoints", id: "endpoints" },
            { title: "Credentials", id: "credentials" },
            { title: "Claims & Teams", id: "more" },
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
              required: true,
              description:
                "Name of the ID token / userinfo claim that contains the user's display name.",
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
            {
              field: { teams: true },
              title: "Teams",
              description: "Add users to these teams when they sign up.",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Team,
                labelField: "name",
                valueField: "_id",
              },
              required: true,
              placeholder: "Select Teams",
              stepId: "more",
            },
          ]}
          showRefreshButton={true}
          actionButtons={[
            {
              title: "View OIDC Config",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                item: ProjectOIDC,
                onCompleteAction: VoidFunction,
              ) => {
                setShowOidcConfigId((item["_id"] as string) || "");
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
              Here&apos;s a link which will help you test OIDC integration
              before you force it on your organization:{" "}
              <Link
                openInNewTab={true}
                to={URL.fromString(
                  `${DASHBOARD_URL.toString()}/${ProjectUtil.getCurrentProjectId()?.toString()}/oidc`,
                )}
              >
                <span>{`${DASHBOARD_URL.toString()}/${ProjectUtil.getCurrentProjectId()?.toString()}/oidc`}</span>
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
                      `/oidc-callback/${ProjectUtil.getCurrentProjectId()?.toString()}/${showOidcConfigId}`,
                    )}`}
                  </div>
                  <br />
                </div>
                <div>
                  <div className="font-semibold">Identifier (audience): </div>
                  <div>{`${HTTP_PROTOCOL}${HOST}/${ProjectUtil.getCurrentProjectId()?.toString()}/${showOidcConfigId}`}</div>
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
      </>
    </Fragment>
  );
};

export default OIDCPage;
