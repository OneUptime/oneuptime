import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import BackupCodes from "../../../Components/TwoFactorAuth/BackupCodes";
import WebAuthnCredentials from "../../../Components/TwoFactorAuth/WebAuthnCredentials";
import TwoFactorStatus from "../../../Components/TwoFactorAuth/TwoFactorStatus";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import UserUtil from "Common/UI/Utils/User";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Page from "Common/UI/Components/Page/Page";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import QRCodeElement from "Common/UI/Components/QR/QR";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal from "Common/UI/Components/Modal/Modal";
import React, { FunctionComponent, ReactElement } from "react";

const TwoFactorAuth: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [selectedTotpAuth, setSelectedTotpAuth] =
    React.useState<UserTotpAuth | null>(null);
  const [showVerificationModal, setShowVerificationModal] =
    React.useState<boolean>(false);
  const [verificationError, setVerificationError] = React.useState<string>("");
  const [verificationLoading, setVerificationLoading] =
    React.useState<boolean>(false);
  const [setupLoading, setSetupLoading] = React.useState<boolean>(false);
  const [verificationCode, setVerificationCode] = React.useState<string>("");
  const [verificationSuccess, setVerificationSuccess] =
    React.useState<string>("");
  const [tableRefreshToggle, setTableRefreshToggle] =
    React.useState<string>("0");
  const [authenticatorCount, setAuthenticatorCount] = React.useState<
    number | null
  >(null);
  // Enrollment responses contain the only plaintext copy of recovery codes.
  const [enrolmentBackupCodes, setEnrolmentBackupCodes] = React.useState<
    Array<string>
  >([]);
  const verificationInProgress: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  const setupController: React.MutableRefObject<AbortController | null> =
    React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      setupController.current?.abort();
    };
  }, []);

  const readBackupCodesFromResponse: (
    response: HTTPResponse<JSONObject>,
  ) => void = (response: HTTPResponse<JSONObject>): void => {
    const codes: Array<string> = (
      (response.data["backupCodes"] as Array<unknown> | undefined) || []
    ).map((code: unknown) => {
      return String(code);
    });
    if (codes.length > 0) {
      setEnrolmentBackupCodes(codes);
    }
  };

  const openVerification: (item: UserTotpAuth) => Promise<void> = async (
    item: UserTotpAuth,
  ): Promise<void> => {
    setupController.current?.abort();
    const controller: AbortController = new AbortController();
    setupController.current = controller;
    setSelectedTotpAuth(item);
    setVerificationCode("");
    setVerificationError("");
    setVerificationSuccess("");
    setShowVerificationModal(true);

    if (item.twoFactorOtpUrl) {
      setSetupLoading(false);
      return;
    }

    setSetupLoading(true);
    try {
      if (!item.id) {
        throw new Error(
          "This authenticator could not be loaded. Close this window and choose Finish setup to try again.",
        );
      }
      const authenticator: UserTotpAuth | null =
        await ModelAPI.getItem<UserTotpAuth>({
          modelType: UserTotpAuth,
          id: item.id,
          select: { _id: true, name: true, twoFactorOtpUrl: true },
          requestOptions: { apiRequestOptions: { signal: controller.signal } },
        });
      if (!authenticator?.twoFactorOtpUrl) {
        throw new Error(
          "This authenticator could not be loaded. Close this window and choose Finish setup to try again.",
        );
      }
      if (!controller.signal.aborted) {
        setSelectedTotpAuth(authenticator);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setVerificationError(API.getFriendlyMessage(error));
      }
    } finally {
      if (!controller.signal.aborted) {
        setSetupLoading(false);
      }
    }
  };

  const verifyAuthenticator: () => Promise<void> = async (): Promise<void> => {
    if (
      verificationInProgress.current ||
      !selectedTotpAuth?.twoFactorOtpUrl ||
      !selectedTotpAuth.id
    ) {
      return;
    }
    if (!verificationCode.match(/^\d{6}$/)) {
      setVerificationError(
        "Enter the 6-digit code from your authenticator app.",
      );
      return;
    }

    verificationInProgress.current = true;
    setVerificationLoading(true);
    setVerificationError("");
    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/user-totp-auth/validate",
          ),
          data: { code: verificationCode, id: selectedTotpAuth.id.toString() },
        });
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
      // Preserve the codes before refreshing or dismissing setup.
      readBackupCodesFromResponse(response);
      setShowVerificationModal(false);
      setSelectedTotpAuth(null);
      setVerificationCode("");
      setVerificationSuccess(
        "Authenticator app added. It is ready to use for two-factor authentication.",
      );
      setTableRefreshToggle((previous: string) => {
        return String(Number(previous) + 1);
      });
    } catch (error) {
      setVerificationError(API.getFriendlyMessage(error));
    } finally {
      verificationInProgress.current = false;
      setVerificationLoading(false);
    }
  };

  return (
    <Page
      title="User Profile"
      breadcrumbLinks={[
        {
          title: "Home",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "User Profile",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route,
          ),
        },
        {
          title: "Two-factor authentication",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_TWO_FACTOR_AUTH] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenu />}
    >
      <div className="max-w-6xl">
        <TwoFactorStatus />
        <WebAuthnCredentials
          isPasskey={false}
          onBackupCodes={setEnrolmentBackupCodes}
        />
        {verificationSuccess && (
          <div
            role="status"
            className="mb-5 flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            <Icon
              icon={IconProp.CheckCircle}
              className="h-5 w-5 flex-shrink-0"
            />
            <span>{verificationSuccess}</span>
          </div>
        )}
        <ModelTable<UserTotpAuth>
          modelType={UserTotpAuth}
          name="Authenticator apps"
          id="totp-auth-table"
          userPreferencesKey="user-authenticator-apps-table"
          isDeleteable={true}
          refreshToggle={tableRefreshToggle}
          filters={[]}
          query={{ userId: UserUtil.getUserId() }}
          isEditable={true}
          editButtonText="Rename"
          showRefreshButton={false}
          disableColumnCustomization={true}
          disableUrlState={true}
          disablePagination={
            authenticatorCount !== null && authenticatorCount <= 10
          }
          onFetchSuccess={(_items: Array<UserTotpAuth>, totalCount: number) => {
            setAuthenticatorCount(totalCount);
          }}
          isCreateable={true}
          createVerb="Add"
          isViewable={false}
          cardProps={{
            title: "Authenticator apps",
            description:
              "Get a one-time code from an app such as 1Password, Google Authenticator, or Microsoft Authenticator.",
          }}
          noItemsMessage={
            <div className="px-4 py-7 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                <Icon icon={IconProp.DevicePhoneMobile} className="h-6 w-6" />
              </span>
              <p className="mt-3 font-medium text-gray-900">
                No authenticator apps added yet.
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Add an app, scan the QR code, and enter a code to finish setup.
              </p>
            </div>
          }
          singularName="authenticator app"
          pluralName="authenticator apps"
          onCreateSuccess={async (
            item: UserTotpAuth,
          ): Promise<UserTotpAuth> => {
            await openVerification(item);
            return item;
          }}
          actionButtons={[
            {
              title: "Finish setup",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Check,
              isVisible: (item: UserTotpAuth) => {
                return !item.isVerified;
              },
              onClick: async (
                item: UserTotpAuth,
                onCompleteAction: () => void,
              ) => {
                await openVerification(item);
                onCompleteAction();
              },
            },
          ]}
          formFields={[
            {
              field: { name: true },
              title: "App name",
              description:
                "Choose a name that helps you recognize this authenticator.",
              placeholder: "My authenticator app",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              customValidation: (values: FormValues<UserTotpAuth>) => {
                return String(values.name || "").trim()
                  ? null
                  : "Enter a name for your authenticator app.";
              },
            },
          ]}
          selectMoreFields={{ twoFactorOtpUrl: true }}
          columns={[
            {
              field: { name: true },
              title: "Name",
              type: FieldType.Text,
              wrapContent: true,
              getElement: (item: UserTotpAuth): ReactElement => {
                return (
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                      <Icon
                        icon={IconProp.DevicePhoneMobile}
                        className="h-5 w-5"
                      />
                    </span>
                    <span className="font-medium text-gray-900">
                      {item.name}
                    </span>
                  </div>
                );
              },
            },
            {
              field: { isVerified: true },
              title: "Status",
              type: FieldType.Boolean,
              getElement: (item: UserTotpAuth): ReactElement => {
                return (
                  <span
                    className={
                      item.isVerified
                        ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                        : "inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                    }
                  >
                    {item.isVerified ? (
                      <Icon
                        icon={IconProp.CheckCircle}
                        className="h-3.5 w-3.5"
                      />
                    ) : null}
                    {item.isVerified ? "Ready" : "Setup incomplete"}
                  </span>
                );
              },
            },
            {
              field: { createdAt: true },
              title: "Date added",
              type: FieldType.DateTime,
              hideOnMobile: true,
            },
          ]}
        />
        <BackupCodes
          codesFromEnrolment={enrolmentBackupCodes}
          onEnrolmentCodesAcknowledged={() => {
            setEnrolmentBackupCodes([]);
          }}
        />
        {showVerificationModal && selectedTotpAuth && (
          <Modal
            title={`Set up ${selectedTotpAuth.name || "authenticator app"}`}
            description="Scan the QR code with your authenticator app, then enter its 6-digit code to finish setup."
            submitButtonText="Verify and finish"
            isLoading={verificationLoading}
            disableSubmitButton={
              verificationLoading ||
              setupLoading ||
              !selectedTotpAuth.twoFactorOtpUrl
            }
            onClose={
              verificationLoading
                ? undefined
                : () => {
                    setupController.current?.abort();
                    setShowVerificationModal(false);
                    setSelectedTotpAuth(null);
                    setVerificationCode("");
                    setVerificationError("");
                  }
            }
            onSubmit={verifyAuthenticator}
          >
            <div>
              {setupLoading ? (
                <ComponentLoader />
              ) : selectedTotpAuth.twoFactorOtpUrl ? (
                <>
                  <div className="mb-6 flex justify-center rounded-xl border border-gray-200 bg-white p-5">
                    <QRCodeElement text={selectedTotpAuth.twoFactorOtpUrl} />
                  </div>
                  <label
                    htmlFor="authenticator-verification-code"
                    className="mb-2 block text-sm font-medium text-gray-900"
                  >
                    Verification code
                  </label>
                  <input
                    id="authenticator-verification-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    value={verificationCode}
                    disabled={verificationLoading}
                    aria-describedby="authenticator-code-hint"
                    aria-invalid={Boolean(verificationError)}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-3 text-center font-mono text-xl tracking-widest text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setVerificationCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      );
                      setVerificationError("");
                    }}
                    onKeyDown={(
                      event: React.KeyboardEvent<HTMLInputElement>,
                    ) => {
                      if (event.key === "Enter") {
                        void verifyAuthenticator();
                      }
                    }}
                  />
                  <p
                    id="authenticator-code-hint"
                    className="mt-2 text-sm text-gray-500"
                  >
                    Codes refresh every 30 seconds. Use the current code shown
                    in your app.
                  </p>
                </>
              ) : null}
              {verificationError && (
                <Alert
                  title={verificationError}
                  type={AlertType.DANGER}
                  className="mt-4"
                />
              )}
            </div>
          </Modal>
        )}
      </div>
    </Page>
  );
};

export default TwoFactorAuth;
