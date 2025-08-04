import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import URL from "Common/Types/API/URL";
import Banner from "Common/UI/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Button from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import {
  IDENTITY_URL,
} from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import ObjectID from "Common/Types/ObjectID";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const SCIMPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [showSCIMUrlId, setShowSCIMUrlId] = useState<string>("");
  const [currentSCIMConfig, setCurrentSCIMConfig] = useState<ProjectSCIM | null>(null);
  const [refresher, setRefresher] = useState<boolean>(false);
  const [resetSCIMId, setResetSCIMId] = useState<string>("");

  return (
    <Fragment>
      <>
        <Banner
          openInNewTab={true}
          title="Need help with configuring SCIM?"
          description="Learn more about SCIM (System for Cross-domain Identity Management) setup and configuration"
          link={URL.fromString("https://oneuptime.com/docs/scim")}
          hideOnMobile={true}
        />

        <ModelTable<ProjectSCIM>
          key={refresher.toString()}
          modelType={ProjectSCIM}
          userPreferencesKey={"project-scim-table"}
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="scim-table"
          name="Settings > Project SCIM"
          isDeleteable={true}
          isEditable={true}
          isCreateable={true}
          cardProps={{
            title: "SCIM (System for Cross-domain Identity Management)",
            description:
              "SCIM is an open standard for automating the exchange of user identity information between identity domains, or IT systems. Use SCIM to automatically provision and deprovision users from your identity provider.",
          }}
          formSteps={[
            {
              title: "Basic Info",
              id: "basic",
            },
            {
              title: "Configuration",
              id: "configuration",
            },
            {
              title: "Teams",
              id: "teams",
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
              placeholder: "Okta SCIM",
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
              required: false,
              description: "Optional description for this SCIM configuration.",
              placeholder: "SCIM configuration for automatic user provisioning from Okta",
              stepId: "basic",
            },
            {
              field: {
                autoProvisionUsers: true,
              },
              title: "Auto Provision Users",
              fieldType: FormFieldSchemaType.Checkbox,
              required: false,
              description: "Automatically create users when they are added in your identity provider.",
              stepId: "configuration",
            },
            {
              field: {
                autoDeprovisionUsers: true,
              },
              title: "Auto Deprovision Users",
              fieldType: FormFieldSchemaType.Checkbox,
              required: false,
              description: "Automatically remove users from teams when they are removed from your identity provider.",
              stepId: "configuration",
            },
            {
              field: {
                teams: true,
              },
              title: "Default Teams",
              fieldType: FormFieldSchemaType.MultiSelectDropdown,
              dropdownModal: {
                type: Team,
                labelField: "name",
                valueField: "_id",
              },
              required: false,
              description: "New users will be automatically added to these teams.",
              stepId: "teams",
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
          ]}
          selectMoreFields={{
            bearerToken: true,
            createdAt: true,
            updatedAt: true,
            teams: {
              name: true,
              _id: true,
            },
          }}
          filters={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
          ]}
          actionButtons={[
            {
              title: "View SCIM URLs",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (
                item: ProjectSCIM,
                onCompleteAction: Function,
                _onError: Function,
              ) => {
                onCompleteAction();
                setCurrentSCIMConfig(item);
                setShowSCIMUrlId(item.id?.toString() || "");
              },
            },
          ]}
        />

        {showSCIMUrlId && currentSCIMConfig && (
          <ConfirmModal
            title={`SCIM Configuration URLs`}
            description={
              <div>
                <p className="text-gray-500 mb-4">
                  Use these URLs to configure SCIM in your identity provider:
                </p>
                
                <div className="space-y-4">
                  <div>
                    <p className="font-medium text-gray-700 mb-1">SCIM Base URL:</p>
                    <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                      {IDENTITY_URL.toString()}/scim/v2/{showSCIMUrlId}
                    </code>
                    <p className="text-xs text-gray-500 mt-1">
                      Use this as the SCIM endpoint URL in your identity provider
                    </p>
                  </div>

                  <div>
                    <p className="font-medium text-gray-700 mb-1">Service Provider Config URL:</p>
                    <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                      {IDENTITY_URL.toString()}/scim/v2/{showSCIMUrlId}/ServiceProviderConfig
                    </code>
                  </div>

                  <div>
                    <p className="font-medium text-gray-700 mb-1">Users Endpoint:</p>
                    <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                      {IDENTITY_URL.toString()}/scim/v2/{showSCIMUrlId}/Users
                    </code>
                  </div>

                  <div>
                    <p className="font-medium text-gray-700 mb-1">Groups Endpoint:</p>
                    <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                      {IDENTITY_URL.toString()}/scim/v2/{showSCIMUrlId}/Groups
                    </code>
                  </div>

                  <div className="border-t pt-4">
                    <p className="font-medium text-gray-700 mb-1">Bearer Token:</p>
                    <div className="mb-2">
                      <HiddenText
                        text={currentSCIMConfig.bearerToken || ""}
                        isCopyable={true}
                      />
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      Use this bearer token for authentication in your identity provider SCIM configuration.
                    </p>
                    
                    <Button
                      title="Reset Bearer Token"
                      buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                      onClick={() => {
                        // Store the ID for reset
                        setResetSCIMId(showSCIMUrlId);
                      }}
                    />
                  </div>
                </div>
              </div>
            }
            submitButtonText={"Close"}
            onSubmit={() => {
              setShowSCIMUrlId("");
              setCurrentSCIMConfig(null);
            }}
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}

        {/* Reset Bearer Token Component - Only render when we have an ID */}
        {resetSCIMId && (
          <ResetObjectID<ProjectSCIM>
            modelType={ProjectSCIM}
            fieldName={"bearerToken"}
            title={"Reset Bearer Token"}
            description={"Reset the Bearer Token to a new value. You will need to update your identity provider with the new token."}
            modelId={new ObjectID(resetSCIMId)}
            onUpdateComplete={() => {
              setRefresher(!refresher);
              setResetSCIMId("");
            }}
          />
        )}
      </>
    </Fragment>
  );
};

export default SCIMPage;
