import TeamsElement from "@oneuptime/dashboard/Components/Team/TeamsElement";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import URL from "Common/Types/API/URL";
import DigestMethod from "Common/Types/SSO/DigestMethod";
import SignatureMethod from "Common/Types/SSO/SignatureMethod";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import {
  DASHBOARD_URL,
  HOST,
  HTTP_PROTOCOL,
  IDENTITY_URL,
} from "Common/UI/Config";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import Team from "Common/Models/DatabaseModels/Team";
import EnterpriseLicenseBanner from "../../License/EnterpriseLicenseBanner";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
  isEnterpriseConfigurationReadOnly,
} from "../../License/EnterpriseLicenseMode";
import { getForceSsoDescription } from "../../License/ForceSsoSetting";
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

const SSOPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const [showSingleSignOnUrlId, setShowSingleSignOnUrlId] =
    useState<string>("");

  /*
   * Without a valid Enterprise license (after the trial or the grace period)
   * the server refuses to create or change this configuration, and sign-in
   * through these providers is off until a license is activated; the banner
   * says both up front, and the page hides what would fail. Reads and
   * deletes keep working. A license that does not include single sign-on
   * stops it the same way (NotIncluded).
   *
   * "Force SSO for Login" is not enforced then, and the server reports it as
   * No whatever is saved, so its card is not editable either: saving the
   * reported No would overwrite the saved requirement (ForceSsoSetting.ts).
   */
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.SSO,
  );
  const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(licenseMode);

  /*
   * The one change the server still accepts then: switching an enabled
   * provider off ({ isEnabled: false } and nothing else), so a compromised
   * identity provider can be shut out without waiting for a license.
   */
  const [tableRefreshToggle, setTableRefreshToggle] = useState<number>(0);

  const disableAction: DisableProviderAction<ProjectSSO> =
    useDisableProviderAction<ProjectSSO>({
      modelType: ProjectSSO,
      isReadOnly: isReadOnly,
      onDisabled: () => {
        setTableRefreshToggle((toggle: number) => {
          return toggle + 1;
        });
      },
    });

  return (
    <Fragment>
      <EnterpriseLicenseBanner
        mode={licenseMode}
        feature={LicensedFeature.SSO}
      />
      <ReadOnlyActionsNotice
        mode={licenseMode}
        kind={ReadOnlyActionsKind.Provider}
      />
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
          isEditable={!isReadOnly}
          isCreateable={!isReadOnly}
          cardProps={{
            title: "Single Sign On (SSO)",
            description:
              "Single sign-on is an authentication scheme that allows a user to log in with a single ID to any of several related, yet independent, software systems.",
          }}
          videoLink={URL.fromString("https://youtu.be/tq4WRgxbIwk")}
          formSteps={[
            {
              title: "Basic Info",
              id: "basic",
            },
            {
              title: "Sign On",
              id: "sign-on",
            },
            {
              title: "Certificate",
              id: "certificate",
            },
            {
              title: "More",
              id: "more",
            },
          ]}
          noItemsMessage={"No SSO configuration found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description: "Friendly name to help you remember.",
              placeholder: "Okta",
              validation: {
                minLength: 2,
              },
              stepId: "basic",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              description: "Friendly description to help you remember.",
              placeholder: "Sign in with Okta",
              validation: {
                minLength: 2,
              },
              stepId: "basic",
            },
            {
              field: {
                signOnURL: true,
              },
              title: "Sign On URL",
              fieldType: FormFieldSchemaType.URL,
              required: true,
              description:
                "Members will be forwarded here when signing in to your organization",
              placeholder: "https://yourapp.example.com/apps/appId",
              stepId: "sign-on",
              disableSpellCheck: true,
            },
            {
              field: {
                issuerURL: true,
              },
              title: "Issuer",
              description:
                "Typically a unique identifier (often a URL) generated by your SAML identity provider.",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "https://example.com",
              stepId: "sign-on",
              disableSpellCheck: true,
            },
            {
              field: {
                publicCertificate: true,
              },
              title: "Public Certificate",
              description: "Paste in your x509 certificate here.",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              placeholder: "Paste in your x509 certificate here.",
              stepId: "certificate",
            },
            {
              field: {
                signatureMethod: true,
              },
              title: "Signature Method",
              description:
                "If you do not know what this is, please leave this to RSA-SHA256",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(SignatureMethod),
              required: true,
              placeholder: "RSA-SHA256",
              stepId: "certificate",
            },
            {
              field: {
                digestMethod: true,
              },
              title: "Digest Method",
              description:
                "If you do not know what this is, please leave this to SHA256",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(DigestMethod),
              required: true,
              placeholder: "SHA256",
              stepId: "certificate",
            },
            {
              field: {
                isEnabled: true,
              },
              description:
                "You can test this first, before enabling it. To test, please save the config.",
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
              stepId: "more",
            },
            {
              field: {
                teams: true,
              },
              title: "Teams",
              description: "Add users to these teams when they sign up",
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
          refreshToggle={tableRefreshToggle.toString()}
          actionButtons={[
            {
              title: "View SSO Config",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                item: ProjectSSO,
                onCompleteAction: VoidFunction,
              ) => {
                setShowSingleSignOnUrlId((item["_id"] as string) || "");
                onCompleteAction();
              },
            },
            disableAction.actionButton,
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
              Here&apos;s a link which will help you test SSO integration before
              you force it on your organization:{" "}
              <Link
                openInNewTab={true}
                to={URL.fromString(
                  `${DASHBOARD_URL.toString()}/${ProjectUtil.getCurrentProjectId()?.toString()}/sso`,
                )}
              >
                <span>{`${DASHBOARD_URL.toString()}/${ProjectUtil.getCurrentProjectId()?.toString()}/sso`}</span>
              </Link>
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
          isEditable={!isReadOnly}
          formFields={[
            {
              field: {
                requireSsoForLogin: true,
              },
              title: "Force SSO for Login",
              description: getForceSsoDescription(
                licenseMode,
                "Please test SSO before you you enable this feature. If SSO is not tested properly then you will be locked out of the project.",
              ),
              fieldType: FormFieldSchemaType.Toggle,
            },
          ]}
          modelDetailProps={{
            modelType: Project,
            id: "sso-settings",
            fields: [
              {
                field: {
                  requireSsoForLogin: true,
                },
                fieldType: FieldType.Boolean,
                title: "Force SSO for Login",
                description: getForceSsoDescription(
                  licenseMode,
                  "Please test SSO before you enable this feature. If SSO is not tested properly then you will be locked out of the project.",
                ),
              },
            ],
            modelId: ProjectUtil.getCurrentProjectId()!,
          }}
        />

        {showSingleSignOnUrlId && (
          <ConfirmModal
            title={`SSO Configuration`}
            description={
              <div>
                <div>
                  <div className="font-semibold">Identifier (Entity ID): </div>

                  <div>{`${HTTP_PROTOCOL}${HOST}/${props.currentProject?._id}/${showSingleSignOnUrlId}`}</div>
                  <br />
                </div>
                <div>
                  <div className="font-semibold">
                    Reply URL (Assertion Consumer Service URL):
                  </div>
                  <div>
                    {`${URL.fromString(IDENTITY_URL.toString()).addRoute(
                      `/idp-login/${props.currentProject?._id}/${showSingleSignOnUrlId}`,
                    )}`}
                  </div>
                  <br />
                </div>
              </div>
            }
            submitButtonText={"Close"}
            onSubmit={() => {
              setShowSingleSignOnUrlId("");
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}

        {disableAction.modal}
      </>
    </Fragment>
  );
};

export default SSOPage;
