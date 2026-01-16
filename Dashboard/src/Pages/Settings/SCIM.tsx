import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import { IDENTITY_URL } from "Common/UI/Config";
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
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import ProjectSCIMLogsTable from "../../Components/SCIMLogs/ProjectSCIMLogsTable";

const SCIMPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [showSCIMUrlId, setShowSCIMUrlId] = useState<string>("");
  const [currentSCIMConfig, setCurrentSCIMConfig] =
    useState<ProjectSCIM | null>(null);
  const [refresher, setRefresher] = useState<boolean>(false);
  const [resetSCIMId, setResetSCIMId] = useState<string>("");
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [isResetLoading, setIsResetLoading] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string>("");
  const [showResetErrorModal, setShowResetErrorModal] =
    useState<boolean>(false);
  const [showResetSuccessModal, setShowResetSuccessModal] =
    useState<boolean>(false);
  const [newBearerToken, setNewBearerToken] = useState<string>("");

  const resetBearerToken: () => Promise<void> = async (): Promise<void> => {
    setIsResetLoading(true);
    try {
      const newToken: ObjectID = ObjectID.generate();
      await ModelAPI.updateById<ProjectSCIM>({
        modelType: ProjectSCIM,
        id: new ObjectID(resetSCIMId),
        data: {
          bearerToken: newToken.toString(),
        },
      });
      setNewBearerToken(newToken.toString());
      setShowResetModal(false);
      setShowResetSuccessModal(true);
      setRefresher(!refresher);
    } catch (err) {
      setResetError(API.getFriendlyMessage(err));
      setShowResetErrorModal(true);
      setShowResetModal(false);
    }
    setIsResetLoading(false);
  };

  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "Configuration",
            children: (
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
          documentationLink={Route.fromString("/docs/identity/scim")}
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
              showIf: (item: FormValues<ProjectSCIM>): boolean => {
                return !item.enablePushGroups;
              },
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
              description:
                "Friendly name to help you remember this SCIM configuration.",
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
              placeholder:
                "SCIM configuration for automatic user provisioning from Okta",
              stepId: "basic",
            },
            {
              field: {
                autoProvisionUsers: true,
              },
              title: "Auto Provision Users",
              fieldType: FormFieldSchemaType.Checkbox,
              required: false,
              description:
                "Automatically create users when they are added in your identity provider.",
              stepId: "configuration",
            },
            {
              field: {
                autoDeprovisionUsers: true,
              },
              title: "Auto Deprovision Users",
              fieldType: FormFieldSchemaType.Checkbox,
              required: false,
              description:
                "Automatically remove users from teams when they are removed from your identity provider.",
              stepId: "configuration",
            },
            {
              field: {
                enablePushGroups: true,
              },
              title: "Enable Push Groups",
              fieldType: FormFieldSchemaType.Checkbox,
              required: false,
              description:
                "Enable push groups provisioning instead of default teams. When enabled, users will not be added to default teams and team membership will be managed via push groups.",
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
              description:
                "New users will be automatically added to these teams.",
              stepId: "teams",
              showIf: (item: FormValues<ProjectSCIM>): boolean => {
                return !item.enablePushGroups;
              },
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
            {
              field: {
                enablePushGroups: true,
              },
              title: "Push Groups",
              type: FieldType.Boolean,
            },
          ]}
          selectMoreFields={{
            bearerToken: true,
            createdAt: true,
            updatedAt: true,
            enablePushGroups: true,
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
                onCompleteAction: () => void,
                _onError: (error: Error) => void,
              ) => {
                onCompleteAction();
                setCurrentSCIMConfig(item);
                setShowSCIMUrlId(item.id?.toString() || "");
              },
            },
            {
              title: "Reset Bearer Token",
              buttonStyleType: ButtonStyleType.OUTLINE,
              icon: IconProp.Refresh,
              onClick: async (
                item: ProjectSCIM,
                onCompleteAction: () => void,
                _onError: (error: Error) => void,
              ) => {
                onCompleteAction();
                setResetSCIMId(item.id?.toString() || "");
                setShowResetModal(true);
              },
            },
          ]}
              />
            ),
          },
          {
            name: "Logs",
            children: <ProjectSCIMLogsTable />,
          },
        ]}
        onTabChange={() => {}}
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
                    <p className="font-medium text-gray-700 mb-1">
                      SCIM Base URL:
                    </p>
                    <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                      {IDENTITY_URL.toString()}/scim/v2/{showSCIMUrlId}
                    </code>
                    <p className="text-xs text-gray-500 mt-1">
                      Use this as the SCIM endpoint URL in your identity
                      provider
                    </p>
                  </div>

                  <div>
                    <p className="font-medium text-gray-700 mb-1">
                      Service Provider Config URL:
                    </p>
                    <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                      {IDENTITY_URL.toString()}/scim/v2/{showSCIMUrlId}
                      /ServiceProviderConfig
                    </code>
                  </div>

                  <div>
                    <p className="font-medium text-gray-700 mb-1">
                      Users Endpoint:
                    </p>
                    <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                      {IDENTITY_URL.toString()}/scim/v2/{showSCIMUrlId}/Users
                    </code>
                  </div>

                  <div>
                    <p className="font-medium text-gray-700 mb-1">
                      Unique identifier field for users:
                    </p>
                    <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                      userName
                    </code>
                    <p className="text-xs text-gray-500 mt-1">
                      Use this field as the unique identifier for users in your
                      identity provider SCIM configuration
                    </p>
                  </div>

                  <div className="border-t pt-4">
                    <p className="font-medium text-gray-700 mb-1">
                      Bearer Token:
                    </p>
                    <div className="mb-2">
                      <HiddenText
                        text={currentSCIMConfig.bearerToken || ""}
                        isCopyable={true}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      Use this bearer token for authentication in your identity
                      provider SCIM configuration.
                    </p>
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

        {/* Reset Bearer Token Modals */}
        {showResetModal && (
          <ConfirmModal
            title="Reset Bearer Token"
            description="Are you sure you want to reset the Bearer Token? You will need to update your identity provider with the new token."
            onSubmit={async () => {
              await resetBearerToken();
            }}
            isLoading={isResetLoading}
            onClose={() => {
              setShowResetModal(false);
              setResetSCIMId("");
            }}
            submitButtonText="Reset"
            submitButtonType={ButtonStyleType.DANGER}
          />
        )}

        {showResetErrorModal && (
          <ConfirmModal
            title="Reset Error"
            description={resetError}
            onSubmit={() => {
              setShowResetErrorModal(false);
              setResetError("");
              setResetSCIMId("");
            }}
            submitButtonText="Close"
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}

        {showResetSuccessModal && (
          <ConfirmModal
            title="New Bearer Token"
            description={
              <div>
                <p className="mb-3">
                  Your new Bearer Token has been generated:
                </p>
                <div className="mb-2">
                  <HiddenText text={newBearerToken} isCopyable={true} />
                </div>
                <p className="text-sm text-gray-500">
                  Please update your identity provider with this new token.
                </p>
              </div>
            }
            onSubmit={() => {
              setShowResetSuccessModal(false);
              setNewBearerToken("");
              setResetSCIMId("");
            }}
            submitButtonText="Close"
            submitButtonType={ButtonStyleType.NORMAL}
          />
        )}
    </Fragment>
  );
};

export default SCIMPage;
