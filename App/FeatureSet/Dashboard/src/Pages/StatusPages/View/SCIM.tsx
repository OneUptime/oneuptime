import PageComponentProps from "../../PageComponentProps";
import { VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import HiddenText from "Common/UI/Components/HiddenText/HiddenText";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import { IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import StatusPageSCIMLogsTable from "../../../Components/SCIMLogs/StatusPageSCIMLogsTable";

const SCIMPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showSCIMUrlId, setShowSCIMUrlId] = useState<string>("");
  const [currentSCIMConfig, setCurrentSCIMConfig] =
    useState<StatusPageSCIM | null>(null);
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
      await ModelAPI.updateById<StatusPageSCIM>({
        modelType: StatusPageSCIM,
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
              <ModelTable<StatusPageSCIM>
                key={refresher.toString()}
                modelType={StatusPageSCIM}
                userPreferencesKey={"status-page-scim-table"}
                query={{
                  statusPageId: modelId,
                }}
                id="status-page-scim-table"
                name="Status Page > SCIM"
                isDeleteable={true}
                isEditable={true}
                isCreateable={true}
                cardProps={{
                  title: "SCIM (System for Cross-domain Identity Management)",
                  description:
                    "SCIM is an open standard for automating the exchange of user identity information between identity domains, or IT systems. Use SCIM to automatically provision and deprovision users with access to your private Status Page.",
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
                ]}
                onBeforeCreate={(scim: StatusPageSCIM) => {
                  scim.statusPageId = modelId;
                  return Promise.resolve(scim);
                }}
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
                    placeholder: "Okta SCIM for Status Page",
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
                    description:
                      "Optional description for this SCIM configuration.",
                    placeholder:
                      "SCIM configuration for automatic user provisioning to the Status Page from Okta",
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
                      "Automatically remove users when they are removed from your identity provider.",
                    stepId: "configuration",
                  },
                ]}
                showRefreshButton={true}
                selectMoreFields={{
                  bearerToken: true,
                }}
                filters={[]}
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
                    title: "Auto Provision Users",
                    type: FieldType.Boolean,
                  },
                  {
                    field: {
                      autoDeprovisionUsers: true,
                    },
                    title: "Auto Deprovision Users",
                    type: FieldType.Boolean,
                  },
                ]}
                actionButtons={[
                  {
                    title: "Show SCIM Endpoint URLs",
                    buttonStyleType: ButtonStyleType.NORMAL,
                    icon: IconProp.List,
                    onClick: async (
                      item: StatusPageSCIM,
                      onCompleteAction: VoidFunction,
                      onError: (err: Error) => void,
                    ) => {
                      try {
                        setCurrentSCIMConfig(item);
                        setShowSCIMUrlId(item["_id"] as string);
                        onCompleteAction();
                      } catch (err) {
                        onError(err as Error);
                      }
                    },
                  },
                  {
                    title: "Reset Bearer Token",
                    buttonStyleType: ButtonStyleType.OUTLINE,
                    icon: IconProp.Refresh,
                    onClick: async (
                      item: StatusPageSCIM,
                      onCompleteAction: VoidFunction,
                      onError: (err: Error) => void,
                    ) => {
                      try {
                        setResetSCIMId(item["_id"] as string);
                        setShowResetModal(true);
                        onCompleteAction();
                      } catch (err) {
                        onError(err as Error);
                      }
                    },
                  },
                ]}
              />
            ),
          },
          {
            name: "Logs",
            children: (
              <StatusPageSCIMLogsTable query={{ statusPageId: modelId }} />
            ),
          },
        ]}
        onTabChange={() => {}}
      />

      {showSCIMUrlId && currentSCIMConfig ? (
        <ConfirmModal
          title={`SCIM URLs - ${currentSCIMConfig.name}`}
          description={
            <div>
              <p>
                Configure your identity provider with these SCIM endpoint URLs:
              </p>
              <br />
              <div>
                <strong>SCIM Base URL:</strong>
                <br />
                <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                  {IDENTITY_URL.toString()}/status-page-scim/v2/
                  {showSCIMUrlId}
                </code>
              </div>
              <br />
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
              <br />
              <div>
                <strong>Users Endpoint:</strong>
                <br />
                <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                  {IDENTITY_URL.toString()}/status-page-scim/v2/
                  {showSCIMUrlId}/Users
                </code>
              </div>
              <br />
              <div>
                <strong>Bearer Token:</strong>
                <br />
                <HiddenText
                  text={currentSCIMConfig.bearerToken as string}
                  isCopyable={true}
                />
              </div>
              <br />
              <p>
                <strong>Note:</strong> Make sure to use this bearer token in the
                Authorization header when making SCIM API requests.
              </p>
            </div>
          }
          submitButtonText={"Close"}
          onSubmit={() => {
            setShowSCIMUrlId("");
            setCurrentSCIMConfig(null);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}

      {showResetModal ? (
        <ConfirmModal
          title={"Reset Bearer Token"}
          description={
            "Are you sure you want to reset the bearer token? This will invalidate the current token and you will need to update your identity provider with the new token."
          }
          submitButtonText={"Reset"}
          onSubmit={resetBearerToken}
          isLoading={isResetLoading}
          submitButtonType={ButtonStyleType.DANGER}
          onClose={() => {
            setShowResetModal(false);
          }}
        />
      ) : (
        <></>
      )}

      {showResetErrorModal ? (
        <ConfirmModal
          title={"Error"}
          description={resetError}
          submitButtonText={"Close"}
          onSubmit={() => {
            setShowResetErrorModal(false);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}

      {showResetSuccessModal ? (
        <ConfirmModal
          title={"Bearer Token Reset"}
          description={
            <div>
              <p>Bearer token has been reset successfully.</p>
              <br />
              <div>
                <strong>New Bearer Token:</strong>
                <br />
                <HiddenText text={newBearerToken} isCopyable={true} />
              </div>
              <br />
              <p>
                <strong>Important:</strong> Make sure to update your identity
                provider with this new bearer token.
              </p>
            </div>
          }
          submitButtonText={"Close"}
          onSubmit={() => {
            setShowResetSuccessModal(false);
            setNewBearerToken("");
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default SCIMPage;
