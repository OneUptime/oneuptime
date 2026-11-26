import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import { VoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ShownOnceSecretModal from "Common/UI/Components/ShownOnceSecret/ShownOnceSecretModal";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import { IDENTITY_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import { getDialogWhatFailed } from "Common/UI/Utils/DialogWhatFailed";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import StatusPageSCIMLogsTable from "../../Components/SCIMLogs/StatusPageSCIMLogsTable";
import { getStatusPageScimFormFields } from "../../ScimFormFields";
import EnterpriseLicenseBanner from "../../License/EnterpriseLicenseBanner";
import {
  EnterpriseLicenseMode,
  LicensedFeature,
  isEnterpriseConfigurationReadOnly,
} from "../../License/EnterpriseLicenseMode";
import useEnterpriseLicenseMode from "../../License/UseEnterpriseLicenseMode";
import ReadOnlyActionsNotice from "../../TightenOnly/ReadOnlyActionsNotice";
import ScimOAuthClientCredentials from "../../Components/ScimOAuthClientCredentials";
import {
  buildRotateBearerTokenUpdate,
  generateScimBearerToken,
} from "../../TightenOnly/TightenOnlyUpdates";
import {
  getBearerTokenShownOnCreate,
  SCIM_BEARER_TOKEN_NOT_SHOWN_AGAIN_TEST_ID,
  SCIM_BEARER_TOKEN_SHOWN_ONCE_TEST_ID,
  SCIM_BEARER_TOKEN_SHOWN_ONCE_VALUE_TEST_ID,
  ScimBearerTokenCopy,
} from "../../ScimBearerTokenCopy";

/*
 * Status page > SCIM: the status page's SCIM connections and their logs.
 *
 * Adding one asks for its name; provisioning, deprovisioning and the
 * description wait under Advanced at their defaults (../../ScimFormFields).
 * Once it is saved, its bearer token is shown once - it is kept only as its
 * hash (#9012), so no page shows it again - and then the dialog with the
 * SCIM URLs to give the identity provider opens: that is the next thing to
 * do. Reset Bearer Token makes a new token and shows it once too. The URLs
 * dialog makes the OAuth 2.0 client secret for identity providers that ask
 * for client credentials instead of a bearer token
 * (../../Components/ScimOAuthClientCredentials).
 */
const SCIMPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
  /*
   * A bearer token just made - by adding a connection, or by Reset Bearer
   * Token - shown once, then forgotten (ShownOnceSecretModal). A new
   * connection's URLs dialog opens once it is copied.
   */
  const [shownOnceToken, setShownOnceToken] = useState<string>("");
  const [urlsAfterToken, setUrlsAfterToken] = useState<StatusPageSCIM | null>(
    null,
  );

  /*
   * Without a valid Enterprise license (after the trial or the grace period)
   * the server refuses to create or change this configuration, and refuses
   * the identity provider's SCIM requests until a license is activated; the
   * banner says both up front, and the page hides what would fail. Reads and
   * deletes keep working, and so does "Reset Bearer Token": it writes the
   * bearer token alone, which the server accepts without a license, so a
   * leaked token can be replaced before SCIM resumes.
   */
  const licenseMode: EnterpriseLicenseMode = useEnterpriseLicenseMode(
    LicensedFeature.SCIM,
  );
  const isReadOnly: boolean = isEnterpriseConfigurationReadOnly(licenseMode);

  const resetBearerToken: () => Promise<void> = async (): Promise<void> => {
    setIsResetLoading(true);
    try {
      /*
       * The bearer token alone, 256 bits from the browser's secure random
       * number generator (never Math.random), so the server accepts it with
       * or without a license (see TightenOnlyUpdates).
       */
      const newToken: string = generateScimBearerToken();
      await ModelAPI.updateById<StatusPageSCIM>({
        modelType: StatusPageSCIM,
        id: new ObjectID(resetSCIMId),
        data: buildRotateBearerTokenUpdate(newToken),
      });
      setShownOnceToken(newToken);
      setShowResetModal(false);
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
      <EnterpriseLicenseBanner
        mode={licenseMode}
        feature={LicensedFeature.SCIM}
      />
      <ReadOnlyActionsNotice mode={licenseMode} />
      <Tabs
        label="SCIM"
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
                isEditable={!isReadOnly}
                isCreateable={!isReadOnly}
                cardProps={{
                  title: "SCIM (System for Cross-domain Identity Management)",
                  description:
                    "Let your identity provider add and remove the people who can see this private status page.",
                }}
                documentationLink={Route.fromString("/docs/identity/scim")}
                onBeforeCreate={(scim: StatusPageSCIM) => {
                  scim.statusPageId = modelId;
                  return Promise.resolve(scim);
                }}
                noItemsMessage={"No SCIM configurations yet."}
                viewPageRoute={Navigation.getCurrentRoute()}
                formFields={getStatusPageScimFormFields()}
                onCreateSuccess={(
                  item: StatusPageSCIM,
                  modalType?: ModalType,
                ): Promise<StatusPageSCIM> => {
                  if (modalType === ModalType.Create && item.id) {
                    const token: string | null = getBearerTokenShownOnCreate(
                      item.bearerToken,
                    );

                    // The token first, once; the URLs once it is copied.
                    if (token) {
                      setShownOnceToken(token);
                      setUrlsAfterToken(item);
                    } else {
                      setCurrentSCIMConfig(item);
                      setShowSCIMUrlId(item.id.toString());
                    }
                  }

                  return Promise.resolve(item);
                }}
                showRefreshButton={true}
                selectMoreFields={{
                  // Nobody reads the bearer token: it is kept as its hash.
                  oauthClientSecretExpiresAt: true,
                  oauthPreviousClientSecretExpiresAt: true,
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
          title={translator.translateTemplate(
            "SCIM URLs - {{name}}",
            { name: currentSCIMConfig.name || "" },
            { setsValuesApart: true },
          )}
          isTitleTranslated={true}
          description={
            <div>
              <p>
                {translator.translateText(
                  "Configure your identity provider with these SCIM endpoint URLs:",
                )}
              </p>
              <br />
              <div>
                <strong>{translator.translateText("SCIM Base URL:")}</strong>
                <br />
                <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                  {IDENTITY_URL.toString()}/status-page-scim/v2/
                  {showSCIMUrlId}
                </code>
              </div>
              <br />
              <div>
                <p className="font-medium text-gray-700 mb-1">
                  {translator.translateText(
                    "Unique identifier field for users:",
                  )}
                </p>
                <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                  userName
                </code>
                <p className="text-xs text-gray-500 mt-1">
                  {translator.translateText(
                    "Use this field as the unique identifier for users in your identity provider SCIM configuration",
                  )}
                </p>
              </div>
              <br />
              <div>
                <strong>{translator.translateText("Users Endpoint:")}</strong>
                <br />
                <code className="block p-2 bg-gray-100 rounded text-sm break-all">
                  {IDENTITY_URL.toString()}/status-page-scim/v2/
                  {showSCIMUrlId}/Users
                </code>
              </div>
              <br />
              <div>
                <strong>{translator.translateText("Bearer Token:")}</strong>
                <br />
                <span data-testid={SCIM_BEARER_TOKEN_NOT_SHOWN_AGAIN_TEST_ID}>
                  {translator.translateText(ScimBearerTokenCopy.notShownAgain)}
                </span>
              </div>
              <br />
              {/*
               * One sentence with its lead, so each language words it
               * whole - and no locale holds a bare "Note:".
               */}
              <p>
                {translator.translateText(
                  "Note: Make sure to use this bearer token in the Authorization header when making SCIM API requests.",
                )}
              </p>
              <br />
              <ScimOAuthClientCredentials
                key={showSCIMUrlId}
                connectionType="status-page"
                connectionId={showSCIMUrlId}
                clientSecretExpiresAt={
                  currentSCIMConfig.oauthClientSecretExpiresAt
                }
                previousClientSecretExpiresAt={
                  currentSCIMConfig.oauthPreviousClientSecretExpiresAt
                }
                canChange={!isReadOnly}
                onChange={() => {
                  setRefresher((value: boolean) => {
                    return !value;
                  });
                }}
              />
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
            "The current token stops working at once. Update your identity provider with the new token."
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
          // What failed is the Reset Bearer Token the person pressed (#7680).
          errorWhatFailed={getDialogWhatFailed(
            translator,
            translator.translateText("Reset Bearer Token") ||
              "Reset Bearer Token",
          )}
          submitButtonText={"Close"}
          onSubmit={() => {
            setShowResetErrorModal(false);
          }}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}

      {shownOnceToken ? (
        <ShownOnceSecretModal
          title={ScimBearerTokenCopy.shownOnceTitle}
          description={ScimBearerTokenCopy.shownOnceDescription}
          doneButtonText={ScimBearerTokenCopy.done}
          secret={shownOnceToken}
          onDone={() => {
            const created: StatusPageSCIM | null = urlsAfterToken;

            setShownOnceToken("");
            setUrlsAfterToken(null);

            if (created?.id) {
              setCurrentSCIMConfig(created);
              setShowSCIMUrlId(created.id.toString());
            }
          }}
          dataTestId={SCIM_BEARER_TOKEN_SHOWN_ONCE_TEST_ID}
          valueTestId={SCIM_BEARER_TOKEN_SHOWN_ONCE_VALUE_TEST_ID}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default SCIMPage;
