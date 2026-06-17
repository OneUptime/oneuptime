import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import DashboardSideMenu from "../SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import DigestMethod from "Common/Types/SSO/DigestMethod";
import SignatureMethod from "Common/Types/SSO/SignatureMethod";
import GlobalSSO from "Common/Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "Common/Models/DatabaseModels/GlobalSsoProject";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

const GlobalSSOView: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const acsURL: string = `${HTTP_PROTOCOL}${HOST}/identity/global-idp-login/${modelId.toString()}`;
  const issuerURL: string = `${HTTP_PROTOCOL}${HOST}/global-sso/${modelId.toString()}`;

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="name"
      modelType={GlobalSSO}
      modelAPI={AdminModelAPI}
      title={t("pages.settings.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.settings"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Global SSO",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_GLOBAL_SSO] as Route,
          ),
        },
        {
          title: "View",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_GLOBAL_SSO_VIEW] as Route,
            { modelId },
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <Fragment>
        <CardModelDetail<GlobalSSO>
          name="Global SSO Configuration"
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "SAML SSO Configuration",
            description: "Configuration for this instance-wide SAML provider.",
          }}
          isEditable={true}
          editButtonText={"Edit Configuration"}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "Okta SAML (Company-wide)",
              validation: {
                minLength: 2,
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              placeholder: "Sign in with Okta",
            },
            {
              field: {
                signOnURL: true,
              },
              title: "Sign On URL",
              fieldType: FormFieldSchemaType.URL,
              required: true,
              placeholder: "https://yourapp.example.com/apps/appId",
            },
            {
              field: {
                issuerURL: true,
              },
              title: "Issuer",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "https://example.com",
            },
            {
              field: {
                publicCertificate: true,
              },
              title: "Public Certificate",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              placeholder: "Paste in your x509 certificate here.",
            },
            {
              field: {
                signatureMethod: true,
              },
              title: "Signature Method",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(SignatureMethod),
              required: true,
              placeholder: "RSA-SHA256",
            },
            {
              field: {
                digestMethod: true,
              },
              title: "Digest Method",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(DigestMethod),
              required: true,
              placeholder: "SHA256",
            },
            {
              field: {
                disableSignUpWithSso: true,
              },
              title: "Disable Sign Up with SSO",
              fieldType: FormFieldSchemaType.Toggle,
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
            },
          ]}
          modelDetailProps={{
            modelType: GlobalSSO,
            id: "global-sso-detail",
            fields: [
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  description: true,
                },
                title: "Description",
                fieldType: FieldType.LongText,
              },
              {
                field: {
                  signOnURL: true,
                },
                title: "Sign On URL",
                fieldType: FieldType.URL,
              },
              {
                field: {
                  issuerURL: true,
                },
                title: "Issuer",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  signatureMethod: true,
                },
                title: "Signature Method",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  digestMethod: true,
                },
                title: "Digest Method",
                fieldType: FieldType.Text,
              },
              {
                field: {
                  disableSignUpWithSso: true,
                },
                title: "Disable Sign Up with SSO",
                fieldType: FieldType.Boolean,
                placeholder: t("common.no"),
              },
              {
                field: {
                  isEnabled: true,
                },
                title: "Enabled",
                fieldType: FieldType.Boolean,
                placeholder: t("common.no"),
              },
              {
                field: {
                  isTested: true,
                },
                title: "Tested",
                fieldType: FieldType.Boolean,
                placeholder: t("common.no"),
              },
            ],
            modelId: modelId,
          }}
        />

        <Card
          title={"Identity Provider URLs"}
          description={
            <div>
              <div className="mb-3">
                Paste these values into your SAML identity provider (Okta, Azure
                AD, OneLogin, JumpCloud and more).
              </div>
              <div className="mb-3">
                <div className="font-semibold">
                  ACS URL (Assertion Consumer Service / Reply URL):
                </div>
                <div className="break-all">{acsURL}</div>
              </div>
              <div>
                <div className="font-semibold">Issuer (Entity ID):</div>
                <div className="break-all">{issuerURL}</div>
              </div>
            </div>
          }
        />

        <ModelTable<GlobalSSOProject>
          modelType={GlobalSSOProject}
          userPreferencesKey={"admin-global-sso-project-table"}
          query={{
            globalSsoId: modelId,
          }}
          onBeforeCreate={(
            item: GlobalSSOProject,
          ): Promise<GlobalSSOProject> => {
            item.globalSsoId = modelId;
            return Promise.resolve(item);
          }}
          id="global-sso-project-table"
          name="Settings > Global SSO > Attached Projects"
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          modelAPI={AdminModelAPI}
          cardProps={{
            title: "Attached Projects",
            description:
              "Attach this provider to specific projects to auto-provision federated users into the selected teams. If no projects are attached, the provider works for all projects a user is already a member of (invite-first).",
          }}
          noItemsMessage={"No projects attached to this provider."}
          showRefreshButton={true}
          formFields={[
            {
              field: {
                project: true,
              },
              title: "Project",
              description:
                "The project federated users are provisioned into for this provider.",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownModal: {
                type: Project,
                labelField: "name",
                valueField: "_id",
              },
              required: true,
              placeholder: "Select Project",
            },
            {
              field: {
                teams: true,
              },
              title: "Teams",
              description: "Add users to these teams when they sign in.",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Team,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
              placeholder: "Select Teams",
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
            },
          ]}
          columns={[
            {
              field: {
                project: {
                  name: true,
                },
              },
              title: "Project",
              type: FieldType.Text,
            },
            {
              field: {
                teams: {
                  name: true,
                },
              },
              title: "Teams",
              type: FieldType.EntityArray,
              getElement: (item: GlobalSSOProject): ReactElement => {
                return (
                  <span>
                    {(item.teams || [])
                      .map((team: Team) => {
                        return team.name;
                      })
                      .join(", ") || "-"}
                  </span>
                );
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
      </Fragment>
    </ModelPage>
  );
};

export default GlobalSSOView;
