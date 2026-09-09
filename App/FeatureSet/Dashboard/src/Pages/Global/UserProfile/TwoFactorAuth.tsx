import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement } from "react";
import UserUtil from "Common/UI/Utils/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import QRCodeElement from "Common/UI/Components/QR/QR";
import { JSONObject } from "Common/Types/JSON";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import API from "Common/UI/Utils/API/API";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import User from "Common/Models/DatabaseModels/User";
import WebAuthn from "Common/UI/Utils/WebAuthn";
import BackupCodes from "../../../Components/TwoFactorAuth/BackupCodes";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FieldLabel from "Common/UI/Components/Forms/Fields/FieldLabel";
import Input from "Common/UI/Components/Input/Input";
import Modal from "Common/UI/Components/Modal/Modal";

type RegistrationStep = "preparing" | "prompt" | "saving";

const Home: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [selectedTotpAuth, setSelectedTotpAuth] =
    React.useState<UserTotpAuth | null>(null);
  const [showVerificationModal, setShowVerificationModal] =
    React.useState<boolean>(false);
  const [verificationError, setVerificationError] = React.useState<
    string | null
  >(null);
  const [verificationLoading, setVerificationLoading] =
    React.useState<boolean>(false);

  const [tableRefreshToggle, setTableRefreshToggle] =
    React.useState<string>("0");

  const [showWebAuthnRegistrationModal, setShowWebAuthnRegistrationModal] =
    React.useState<boolean>(false);
  const [webAuthnRegistrationError, setWebAuthnRegistrationError] =
    React.useState<string | null>(null);
  const [webAuthnRegistrationStep, setWebAuthnRegistrationStep] =
    React.useState<RegistrationStep | null>(null);
  const [webAuthnRegistrationName, setWebAuthnRegistrationName] =
    React.useState<string>("");
  const [webAuthnRegistrationNameError, setWebAuthnRegistrationNameError] =
    React.useState<string | undefined>(undefined);
  const [webAuthnRegistrationSuccess, setWebAuthnRegistrationSuccess] =
    React.useState<string | null>(null);

  const [isRegisteringPasskey, setIsRegisteringPasskey] =
    React.useState<boolean>(true);
  const registrationInProgress: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  const registrationSaving: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  const registrationController: React.MutableRefObject<AbortController | null> =
    React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      registrationController.current?.abort();
      registrationController.current = null;
    };
  }, []);

  /*
   * Recovery codes the server minted for this account while the user was
   * setting a factor up, on their way down to the Backup Codes card.
   *
   * Both enrolment routes -- validating a TOTP secret and registering a
   * security key -- now mint a set when the account has none, and the response
   * carries the ONLY copy of the plaintext. So it is held here for exactly as
   * long as it takes the card to raise its acknowledge-before-closing modal,
   * and dropped the moment the user confirms they have saved it. Nothing
   * re-fetches it, because nothing can.
   *
   * An empty array is the normal outcome for a SECOND factor: the account
   * already has codes and the server left them alone.
   */
  const [enrolmentBackupCodes, setEnrolmentBackupCodes] = React.useState<
    Array<string>
  >([]);

  type ReadBackupCodesFunction = (response: HTTPResponse<JSONObject>) => void;

  const readBackupCodesFromResponse: ReadBackupCodesFunction = (
    response: HTTPResponse<JSONObject>,
  ): void => {
    const codes: Array<string> = (
      (response.data["backupCodes"] as Array<unknown> | undefined) || []
    ).map((code: unknown) => {
      return String(code);
    });

    if (codes.length > 0) {
      setEnrolmentBackupCodes(codes);
    }
  };

  const openRegistration: (isPasskey: boolean) => void = (
    isPasskey: boolean,
  ): void => {
    setIsRegisteringPasskey(isPasskey);
    setWebAuthnRegistrationName("");
    setWebAuthnRegistrationNameError(undefined);
    setWebAuthnRegistrationError(null);
    setWebAuthnRegistrationSuccess(null);
    setShowWebAuthnRegistrationModal(true);
  };

  const closeRegistration: () => void = (): void => {
    // Once verification starts, the server may already have saved the key.
    if (registrationSaving.current) {
      return;
    }
    registrationController.current?.abort();
    registrationController.current = null;
    registrationInProgress.current = false;
    setShowWebAuthnRegistrationModal(false);
    setWebAuthnRegistrationStep(null);
    setWebAuthnRegistrationError(null);
  };

  const registerWebAuthn: () => Promise<void> = async (): Promise<void> => {
    if (registrationInProgress.current) {
      return;
    }

    const name: string = webAuthnRegistrationName.trim();
    if (!name) {
      setWebAuthnRegistrationNameError("Enter a name to recognize this key.");
      return;
    }

    const controller: AbortController = new AbortController();
    registrationController.current = controller;
    registrationInProgress.current = true;
    setWebAuthnRegistrationName(name);
    setWebAuthnRegistrationNameError(undefined);
    setWebAuthnRegistrationError(null);
    setWebAuthnRegistrationStep("preparing");

    try {
      WebAuthn.ensureSupported();
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/user-webauthn/generate-registration-options`,
          ),
          data: { isPasskey: isRegisteringPasskey },
          options: { signal: controller.signal },
        });

      if (controller.signal.aborted) {
        return;
      }
      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setWebAuthnRegistrationStep("prompt");
      const credential: JSONObject = await WebAuthn.register(
        response.data["options"] as JSONObject,
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      registrationSaving.current = true;
      setWebAuthnRegistrationStep("saving");
      const verifyResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/user-webauthn/verify-registration`,
          ),
          data: { name: name, credential: credential },
        });

      if (controller.signal.aborted) {
        return;
      }
      if (verifyResponse instanceof HTTPErrorResponse) {
        throw verifyResponse;
      }

      /* The only plaintext copy -- see the recovery-code note above. */
      readBackupCodesFromResponse(verifyResponse);
      setShowWebAuthnRegistrationModal(false);
      setWebAuthnRegistrationSuccess(
        isRegisteringPasskey
          ? "Passkey added. Use it the next time you sign in."
          : "Security key added. It is ready to use for two factor authentication.",
      );
      setTableRefreshToggle((previous: string) => {
        return String(Number(previous) + 1);
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        setWebAuthnRegistrationError(
          WebAuthn.getErrorMessage(err, "registration"),
        );
      }
    } finally {
      if (registrationController.current === controller) {
        registrationController.current = null;
        registrationInProgress.current = false;
        registrationSaving.current = false;
        setWebAuthnRegistrationStep(null);
      }
    }
  };

  return (
    <Page
      title={"User Profile"}
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
          title: "Passkeys and Two Factor Authentication",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_TWO_FACTOR_AUTH] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenu />}
    >
      <div>
        {webAuthnRegistrationSuccess && (
          <Alert
            type={AlertType.SUCCESS}
            title={webAuthnRegistrationSuccess}
            className="mb-5"
            dataTestId="passkey-registration-success"
          />
        )}
        <div>
          <ModelTable<UserWebAuthn>
            modelType={UserWebAuthn}
            name="Passkeys and Security Keys"
            id="webauthn-table"
            userPreferencesKey="user-webauthn-table"
            isDeleteable={true}
            refreshToggle={tableRefreshToggle}
            filters={[]}
            query={{
              userId: UserUtil.getUserId(),
            }}
            isEditable={true}
            editButtonText="Rename"
            showRefreshButton={true}
            isCreateable={false}
            isViewable={false}
            cardProps={{
              title: "Passkeys",
              description:
                "Use your fingerprint, face, screen lock, or security key to sign in.",
              rightElement: (
                <Button
                  title="Add Passkey"
                  dataTestId="add-passkey"
                  buttonStyle={ButtonStyleType.PRIMARY}
                  icon={IconProp.Add}
                  style={{ marginLeft: 0 }}
                  onClick={() => {
                    openRegistration(true);
                  }}
                />
              ),
            }}
            topContent={
              <p className="mt-3 mb-4 text-sm text-gray-600">
                Passkeys let you sign in without a password, whether two factor
                authentication is on or off. Existing security keys are also
                listed here.
              </p>
            }
            noItemsMessage={
              <div className="py-6 text-center">
                <p className="font-medium text-gray-900">
                  Add your first passkey
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
                  Save it on your device, in a password manager, or on a
                  security key. Next time, choose &quot;Sign in with a
                  passkey&quot; on the login screen.
                </p>
              </div>
            }
            singularName="Passkey or Security Key"
            pluralName="Passkeys and Security Keys"
            formFields={[
              {
                field: { name: true },
                title: "Name",
                description: "Choose a name that helps you recognize this key.",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                customValidation: (values: FormValues<UserWebAuthn>) => {
                  return String(values.name || "").trim()
                    ? null
                    : "Enter a name to recognize this key.";
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
                  createdAt: true,
                },
                title: "Date added",
                type: FieldType.DateTime,
              },
            ]}
          />
        </div>

        <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4 md:px-6">
          <h3 className="text-sm font-medium text-gray-900">
            Keep another way to sign in
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            Add a passkey on another device or keep your password available in
            case you lose access to a passkey. If you use two factor
            authentication, save your backup codes below before you need them.
          </p>
          <div className="mt-4 border-t border-gray-200 pt-4">
            <h3 className="text-sm font-medium text-gray-900">
              Security keys for two factor authentication
            </h3>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              Use a security key as a second step after your password. To sign
              in without a password using a compatible security key, choose Add
              Passkey.
            </p>
            <Button
              title="Add Security Key"
              buttonStyle={ButtonStyleType.SECONDARY_LINK}
              style={{ marginLeft: 0 }}
              className="mt-2"
              onClick={() => {
                openRegistration(false);
              }}
            />
          </div>
        </div>

        <ModelTable<UserTotpAuth>
          modelType={UserTotpAuth}
          name="Authenticator Based TOTP Authentication"
          id="totp-auth-table"
          userPreferencesKey="user-totp-auth-table"
          isDeleteable={true}
          refreshToggle={tableRefreshToggle}
          filters={[]}
          query={{
            userId: UserUtil.getUserId(),
          }}
          isEditable={true}
          showRefreshButton={true}
          isCreateable={true}
          isViewable={false}
          cardProps={{
            title: "Authenticator Based Two Factor Authentication",
            description:
              "Manage your authenticator based two factor authentication settings here.",
          }}
          noItemsMessage={
            "No authenticator based two factor authentication found."
          }
          singularName="Authenticator Based Two Factor Authentication"
          pluralName="Authenticator Based Two Factor Authentications"
          actionButtons={[
            {
              title: "Verify",
              buttonStyleType: ButtonStyleType.NORMAL,
              icon: IconProp.Check,
              isVisible: (item: UserTotpAuth) => {
                return !item.isVerified;
              },
              onClick: async (
                item: UserTotpAuth,
                onCompleteAction: () => void,
              ) => {
                setSelectedTotpAuth(item);
                setShowVerificationModal(true);
                onCompleteAction();
              },
            },
          ]}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              placeholder: "Google Authenticator",
              fieldType: FormFieldSchemaType.Text,
              required: true,
            },
          ]}
          selectMoreFields={{
            twoFactorOtpUrl: true,
          }}
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
                isVerified: true,
              },
              title: "Is Verified?",
              type: FieldType.Boolean,
            },
          ]}
        />

        {/*
         * Placed after the two factor methods rather than before them,
         * because it is the answer to "what happens when one of those stops
         * working" and only makes sense once the reader has seen them.
         */}
        <BackupCodes
          codesFromEnrolment={enrolmentBackupCodes}
          onEnrolmentCodesAcknowledged={() => {
            setEnrolmentBackupCodes([]);
          }}
        />

        {showVerificationModal && selectedTotpAuth ? (
          <BasicFormModal
            title={`Verify ${selectedTotpAuth.name}`}
            description={`Please scan this QR code with your authenticator app and enter the code below. This code works with Google Authenticator.`}
            formProps={{
              error: verificationError || undefined,
              fields: [
                {
                  field: {
                    qr: true,
                  },
                  title: "",
                  required: true,
                  fieldType: FormFieldSchemaType.CustomComponent,
                  getCustomElement: (
                    value: FormValues<JSONObject>,
                    props: CustomElementProps,
                  ) => {
                    if (value && !value["qr"]) {
                      if (props?.onChange) {
                        props.onChange("code"); // set temporary value to trigger validation. This is a hack to make the form valid.
                      }
                    }
                    return (
                      <QRCodeElement
                        text={selectedTotpAuth.twoFactorOtpUrl || ""}
                      />
                    );
                  },
                },
                {
                  field: {
                    code: true,
                  },
                  title: "Code",
                  description:
                    "Please enter the code from your authenticator app.",
                  fieldType: FormFieldSchemaType.Text,
                  required: true,
                },
              ],
            }}
            submitButtonText={"Validate"}
            onClose={() => {
              setShowVerificationModal(false);
              setVerificationError(null);
              setSelectedTotpAuth(null);
            }}
            isLoading={verificationLoading}
            onSubmit={async (values: JSONObject) => {
              try {
                setVerificationLoading(true);
                setVerificationError("");

                const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
                  await API.post<JSONObject>({
                    url: URL.fromString(APP_API_URL.toString()).addRoute(
                      `/user-totp-auth/validate`,
                    ),
                    data: {
                      code: values["code"],
                      id: selectedTotpAuth.id?.toString(),
                    },
                  });
                if (response.isSuccess()) {
                  setShowVerificationModal(false);
                  setVerificationError(null);
                  setSelectedTotpAuth(null);
                  setVerificationLoading(false);
                }

                if (response instanceof HTTPErrorResponse) {
                  throw response;
                }

                /*
                 * Read BEFORE the table refresh, and unconditionally. This is
                 * the only moment these strings exist anywhere -- they are
                 * stored as keyed digests and cannot be produced again by
                 * anybody, this page included -- so dropping the response here
                 * would leave the account holding ten codes it has never been
                 * shown, which reads on the card as "you are covered".
                 */
                readBackupCodesFromResponse(response);

                setTableRefreshToggle((previous: string) => {
                  return String(Number(previous) + 1);
                });
              } catch (err) {
                setVerificationError(API.getFriendlyMessage(err));
                setVerificationLoading(false);
              }

              setVerificationLoading(false);
            }}
          />
        ) : (
          <></>
        )}

        {showWebAuthnRegistrationModal && (
          <Modal
            title={isRegisteringPasskey ? "Add Passkey" : "Add Security Key"}
            description={
              isRegisteringPasskey
                ? "Name your passkey, then follow your browser's instructions to save it."
                : "Name your security key, then follow your browser's instructions to register it."
            }
            submitButtonText={
              isRegisteringPasskey ? "Create Passkey" : "Register Security Key"
            }
            onClose={
              webAuthnRegistrationStep === "saving"
                ? undefined
                : closeRegistration
            }
            isLoading={webAuthnRegistrationStep !== null}
            disableSubmitButton={webAuthnRegistrationStep !== null}
            onSubmit={registerWebAuthn}
          >
            <div>
              <FieldLabel
                title={
                  isRegisteringPasskey ? "Passkey name" : "Security key name"
                }
                htmlFor="passkey-registration-name"
                required={true}
              />
              <Input
                id="passkey-registration-name"
                dataTestId="passkey-name"
                placeholder={
                  isRegisteringPasskey ? "My laptop" : "My security key"
                }
                value={webAuthnRegistrationName}
                onChange={(value: string) => {
                  setWebAuthnRegistrationName(value);
                  setWebAuthnRegistrationNameError(undefined);
                }}
                onEnterPress={registerWebAuthn}
                disabled={webAuthnRegistrationStep !== null}
                error={webAuthnRegistrationNameError}
                ariaDescribedby="passkey-name-hint"
                autoComplete="off"
              />
              <p id="passkey-name-hint" className="mt-2 text-sm text-gray-500">
                Choose a name you will recognize later, such as your device or
                password manager.
              </p>
              {webAuthnRegistrationError && (
                <Alert
                  title={webAuthnRegistrationError}
                  type={AlertType.DANGER}
                  className="mt-4"
                />
              )}
              {webAuthnRegistrationStep && (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-4 rounded-md bg-indigo-50 p-3 text-sm text-indigo-800"
                >
                  {webAuthnRegistrationStep === "preparing"
                    ? "Preparing registration…"
                    : webAuthnRegistrationStep === "prompt"
                      ? "Follow the prompt from your browser or device. You can cancel and try again."
                      : "Saving your key. Keep this window open for a moment…"}
                </p>
              )}
            </div>
          </Modal>
        )}
      </div>
      <CardModelDetail<User>
        cardProps={{
          title: "Enable Two Factor Authentication",
          description: "Enable two factor authentication for your account.",
        }}
        name="User Profile > Enable Two Factor Authentication"
        isEditable={true}
        editButtonText="Edit"
        formFields={[
          {
            field: {
              enableTwoFactorAuth: true,
            },
            fieldType: FormFieldSchemaType.Toggle,
            placeholder: "No",
            required: true,
            title: "Enable Two Factor Authentication",
            description: "Enable two factor authentication for your account.",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: User,
          id: "user-profile",
          fields: [
            {
              field: {
                enableTwoFactorAuth: true,
              },
              fieldType: FieldType.Boolean,
              title: "Enable Two Factor Authentication",
              placeholder: "No",
            },
          ],

          modelId: UserUtil.getUserId(),
        }}
      />
    </Page>
  );
};

export default Home;
