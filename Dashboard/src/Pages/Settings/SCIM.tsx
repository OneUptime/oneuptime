import TeamsElement from "../../Components/Team/TeamsElement";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectScim";
import Team from "Common/Models/DatabaseModels/Team";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const SCIMPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showSCIMConfigId, setShowSCIMConfigId] = useState<string>("");

  return (
    <Fragment>
      <>
        <Banner
          openInNewTab={true}
          title="Need help with configuring SCIM?"
          description="Watch this guide to understand SCIM user provisioning"
          link={URL.fromString("https://docs.oneuptime.com/scim")}
          hideOnMobile={true}
        />

        <ModelTable<ProjectSCIM>
          modelType={ProjectSCIM}
          userPreferencesKey={"project-scim-table"}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="scim-table"
          name="Settings > SCIM Provisioning"
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          cardProps={{
            title: "SCIM (System for Cross-domain Identity Management)",
            description:
              "SCIM is a standard for automating the exchange of user identity information between systems. It enables automatic user provisioning and deprovisioning.",
          }}
          formSteps={[
            {
              title: "Basic Info",
              id: "basic",
            },
            {
              title: "SCIM Configuration",
              id: "scim-config",
            },
            {
              title: "Provisioning Settings",
              id: "provisioning",
            },
          ]}
          noItemsMessage={"No SCIM configuration found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              description: "Friendly name to help you remember this SCIM configuration.",
              placeholder: "Company SCIM",
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
              placeholder: "SCIM integration for user provisioning",
              validation: {
                minLength: 2,
              },
              stepId: "basic",
            },
            {
              field: {
                scimBaseUrl: true,
              },
              title: "SCIM Base URL",
              fieldType: FormFieldSchemaType.URL,
              required: true,
              description:
                "Base URL for your SCIM server endpoint (e.g., https://yourapp.scim.com/v2)",
              placeholder: "https://yourapp.scim.com/v2",
              stepId: "scim-config",
              disableSpellCheck: true,
            },
            {
              field: {
                bearerToken: true,
              },
              title: "Bearer Token",
              fieldType: FormFieldSchemaType.Password,
              required: true,
              description:
                "Bearer token for authenticating with your SCIM server",
              placeholder: "Enter your SCIM bearer token",
              stepId: "scim-config",
            },
            {
              field: {
                autoProvisionUsers: true,
              },
              title: "Auto Provision Users",
              description:
                "Automatically create users in OneUptime when they are provisioned via SCIM",
              fieldType: FormFieldSchemaType.Toggle,
              stepId: "provisioning",
            },
            {
              field: {
                autoDeprovisionUsers: true,
              },
              title: "Auto Deprovision Users",
              description:
                "Automatically remove users from OneUptime when they are deprovisioned via SCIM",
              fieldType: FormFieldSchemaType.Toggle,
              stepId: "provisioning",
            },
            {
              field: {
                isEnabled: true,
              },
              description:
                "You can test this first, before enabling it. To test, please save the config.",
              title: "Enabled",
              fieldType: FormFieldSchemaType.Toggle,
              stepId: "provisioning",
            },
            {
              field: {
                teams: true,
              },
              title: "Default Teams",
              description: "Add users to these teams when they are provisioned via SCIM",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Team,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
              placeholder: "Select Teams",
              stepId: "provisioning",
            },
          ]}
          showRefreshButton={true}
          actionButtons={[
            {
              title: "Test Connection",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                item: ProjectSCIM,
                onCompleteAction: VoidFunction,
              ) => {
                setShowSCIMConfigId((item["_id"] as string) || "");
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
            {
              field: {
                isTested: true,
              },
              title: "Tested",
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
              title: "Default Teams",
              type: FieldType.Text,
              getElement: (item: ProjectSCIM): ReactElement => {
                return <TeamsElement teams={item["teams"] || []} />;
              },
            },
            {
              field: {
                autoProvisionUsers: true,
              },
              title: "Auto Provision",
              type: FieldType.Boolean,
            },
            {
              field: {
                autoDeprovisionUsers: true,
              },
              title: "Auto Deprovision",
              type: FieldType.Boolean,
            },
            {
              field: {
                isEnabled: true,
              },
              title: "Enabled",
              type: FieldType.Boolean,
            },
            {
              field: {
                isTested: true,
              },
              title: "Tested",
              type: FieldType.Boolean,
            },
          ]}
        />

        <Card
          title={`Test SCIM Integration`}
          description={
            <span>
              Before enabling SCIM for your organization, make sure to test the connection. 
              You can use the "Test Connection" button above to verify your SCIM configuration is working properly.
            </span>
          }
        />

        {showSCIMConfigId && (
          <ConfirmModal
            title={`SCIM Configuration Test`}
            description={
              <div>
                <div>
                  Use this to test your SCIM configuration before enabling it for your organization.
                  The test will verify that OneUptime can connect to your SCIM server and retrieve user information.
                </div>
                <br />
                <div>
                  <strong>Note:</strong> Make sure your SCIM server is accessible and the bearer token is valid.
                </div>
              </div>
            }
            submitButtonText={"Test Connection"}
            onSubmit={() => {
              // TODO: Implement actual SCIM connection test
              setShowSCIMConfigId("");
            }}
            submitButtonType={ButtonStyleType.PRIMARY}
          />
        )}
      </>
    </Fragment>
  );
};

export default SCIMPage;