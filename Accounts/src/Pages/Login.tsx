import {
  LOGIN_API_URL,
  VERIFY_TWO_FACTOR_AUTH_API_URL,
  GENERATE_WEBAUTHN_AUTH_OPTIONS_API_URL,
  VERIFY_WEBAUTHN_AUTH_API_URL,
} from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import { DASHBOARD_URL } from "Common/UI/Config";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import UiAnalytics from "Common/UI/Utils/Analytics";
import LoginUtil from "Common/UI/Utils/Login";
import UserTwoFactorAuth from "Common/Models/DatabaseModels/UserTwoFactorAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import User from "Common/Models/DatabaseModels/User";
import React from "react";
import useAsyncEffect from "use-async-effect";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";

const LoginPage: () => JSX.Element = () => {
  const apiUrl: URL = LOGIN_API_URL;

  if (UserUtil.isLoggedIn()) {
    Navigation.navigate(DASHBOARD_URL);
  }

  const [initialValues, setInitialValues] = React.useState<JSONObject>({});

  const [showTwoFactorAuth, setShowTwoFactorAuth] =
    React.useState<boolean>(false);

  const [twoFactorAuthList, setTwoFactorAuthList] = React.useState<
    UserTwoFactorAuth[]
  >([]);

  const [webAuthnList, setWebAuthnList] = React.useState<
    UserWebAuthn[]
  >([]);

  const [selectedTwoFactorAuth, setSelectedTwoFactorAuth] = React.useState<
    UserTwoFactorAuth | undefined
  >(undefined);

  const [selectedWebAuthn, setSelectedWebAuthn] = React.useState<
    UserWebAuthn | undefined
  >(undefined);

  type TwoFactorMethod = {
    type: "totp" | "webauthn";
    item: UserTwoFactorAuth | UserWebAuthn;
  };

  const twoFactorMethods: TwoFactorMethod[] = [
    ...twoFactorAuthList.map(item => ({ type: "totp" as const, item })),
    ...webAuthnList.map(item => ({ type: "webauthn" as const, item })),
  ];

  const [isTwoFactorAuthLoading, setIsTwoFactorAuthLoading] =
    React.useState<boolean>(false);
  const [twofactorAuthError, setTwoFactorAuthError] =
    React.useState<string>("");

  useAsyncEffect(async () => {
    if (Navigation.getQueryStringByName("email")) {
      setInitialValues({
        email: Navigation.getQueryStringByName("email"),
      });
    }
  }, []);

  useAsyncEffect(async () => {
    if (selectedWebAuthn) {
      setIsTwoFactorAuthLoading(true);
      try {
        const result = await API.post({
          url: GENERATE_WEBAUTHN_AUTH_OPTIONS_API_URL,
          data: {
            email: initialValues["email"],
          },
        });

        if (result instanceof HTTPErrorResponse) {
          throw result;
        }

        const data = result.data as any;

        // Use WebAuthn API
        const credential = await navigator.credentials.get({
          publicKey: data.options,
        }) as PublicKeyCredential;

        const assertionResponse = credential.response as AuthenticatorAssertionResponse;

        // Verify
        const verifyResult = await API.post({
          url: VERIFY_WEBAUTHN_AUTH_API_URL,
          data: {
            userId: data.userId,
            challenge: data.challenge,
            credential: {
              id: credential.id,
              rawId: Array.from(new Uint8Array(credential.rawId)),
              response: {
                authenticatorData: Array.from(new Uint8Array(assertionResponse.authenticatorData)),
                clientDataJSON: Array.from(new Uint8Array(assertionResponse.clientDataJSON)),
                signature: Array.from(new Uint8Array(assertionResponse.signature)),
                userHandle: assertionResponse.userHandle ? Array.from(new Uint8Array(assertionResponse.userHandle)) : null,
              },
              type: credential.type,
            },
          },
        });

        if (verifyResult instanceof HTTPErrorResponse) {
          throw verifyResult;
        }

        const user: User = User.fromJSON(
          verifyResult.data as JSONObject,
          User,
        ) as User;
        const miscData: JSONObject = (verifyResult.data as JSONObject)[
          "miscData"
        ] as JSONObject;

        login(user as User, miscData as JSONObject);
      } catch (error) {
        setTwoFactorAuthError(
          API.getFriendlyErrorMessage(error as Error),
        );
      }
      setIsTwoFactorAuthLoading(false);
    }
  }, [selectedWebAuthn]);

  type LoginFunction = (user: User, miscData: JSONObject) => void;

  const login: LoginFunction = (user: User, miscData: JSONObject): void => {
    if (user instanceof User && user && user.email) {
      UiAnalytics.userAuth(user.email);
      UiAnalytics.capture("accounts/login");
    }

    LoginUtil.login({
      user: user,
      token: miscData ? miscData["token"] : undefined,
    });
  };

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="">
        <img
          className="mx-auto h-12 w-auto"
          src={OneUptimeLogo}
          alt="OneUptime"
        />
        {!showTwoFactorAuth && (
          <>
            <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
              Sign in to your account
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              Join thousands of business that use OneUptime to help them stay
              online all the time.
            </p>
          </>
        )}

        {showTwoFactorAuth && (
          <>
            <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
              Two Factor Authentication
            </h2>
            <p className="mt-2 text-center text-sm text-gray-600">
              Select two factor authentication method. You will be asked to
              enter a code from the selected method.
            </p>
          </>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {!showTwoFactorAuth && (
            <ModelForm<User>
              modelType={User}
              id="login-form"
              name="Login"
              fields={[
                {
                  field: {
                    email: true,
                  },
                  fieldType: FormFieldSchemaType.Email,
                  placeholder: "jeff@example.com",
                  required: true,
                  disabled: Boolean(initialValues && initialValues["email"]),
                  title: "Email",
                  dataTestId: "email",
                  disableSpellCheck: true,
                },
                {
                  field: {
                    password: true,
                  },
                  title: "Password",
                  required: true,
                  validation: {
                    minLength: 6,
                  },
                  fieldType: FormFieldSchemaType.Password,
                  sideLink: {
                    text: "Forgot password?",
                    url: new Route("/accounts/forgot-password"),
                    openLinkInNewTab: false,
                  },
                  dataTestId: "password",
                  disableSpellCheck: true,
                },
              ]}
              createOrUpdateApiUrl={apiUrl}
              formType={FormType.Create}
              submitButtonText={"Login"}
              onBeforeCreate={(data: User) => {
                setInitialValues(User.toJSON(data, User));
                return Promise.resolve(data);
              }}
              onSuccess={(
                value: User | JSONObject,
                miscData: JSONObject | undefined,
              ) => {
                if (
                  miscData &&
                  (miscData as JSONObject)["twoFactorAuth"] === true
                ) {
                  const twoFactorAuthList: Array<UserTwoFactorAuth> =
                    UserTwoFactorAuth.fromJSONArray(
                      (miscData as JSONObject)[
                        "twoFactorAuthList"
                      ] as JSONArray,
                      UserTwoFactorAuth,
                    );
                  const webAuthnList: Array<UserWebAuthn> =
                    UserWebAuthn.fromJSONArray(
                      (miscData as JSONObject)[
                        "webAuthnList"
                      ] as JSONArray,
                      UserWebAuthn,
                    );
                  setTwoFactorAuthList(twoFactorAuthList);
                  setWebAuthnList(webAuthnList);
                  setShowTwoFactorAuth(true);
                  return;
                }

                login(value as User, miscData as JSONObject);
              }}
              maxPrimaryButtonWidth={true}
              footer={
                <div className="actions text-center mt-4 hover:underline fw-semibold">
                  <div>
                    <Link to={new Route("/accounts/sso")}>
                      <div className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm">
                        Use single sign-on (SSO) instead
                      </div>
                    </Link>
                  </div>
                </div>
              }
            />
          )}

          {showTwoFactorAuth && !selectedTwoFactorAuth && !selectedWebAuthn && (
            <div className="space-y-4">
              {twoFactorMethods.map((method, index) => (
                <div
                  key={index}
                  className="cursor-pointer p-4 border border-gray-300 rounded-lg hover:bg-gray-50"
                  onClick={() => {
                    if (method.type === "totp") {
                      setSelectedTwoFactorAuth(method.item as UserTwoFactorAuth);
                    } else {
                      setSelectedWebAuthn(method.item as UserWebAuthn);
                    }
                  }}
                >
                  <div className="font-medium">{(method.item as any).name}</div>
                  <div className="text-sm text-gray-500">
                    {method.type === "totp" ? "Authenticator App" : "Security Key"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showTwoFactorAuth && selectedWebAuthn && (
            <div className="text-center">
              <div className="text-lg font-medium mb-4">Authenticating with Security Key</div>
              <div className="text-sm text-gray-500 mb-4">
                Please follow the instructions on your security key device.
              </div>
              {isTwoFactorAuthLoading && (
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
              )}
              {twofactorAuthError && (
                <div className="text-red-500 text-sm mt-4">{twofactorAuthError}</div>
              )}
            </div>
          )}

          {showTwoFactorAuth && selectedTwoFactorAuth && (
            <BasicForm
              id="two-factor-auth-form"
              name="Two Factor Auth"
              fields={[
                {
                  field: {
                    code: true,
                  },
                  title: "Code",
                  description: "Enter the code from your authenticator app",
                  required: true,
                  dataTestId: "code",
                  fieldType: FormFieldSchemaType.Text,
                },
              ]}
              submitButtonText={"Login"}
              maxPrimaryButtonWidth={true}
              isLoading={isTwoFactorAuthLoading}
              error={twofactorAuthError}
              onSubmit={async (data: JSONObject) => {
                setIsTwoFactorAuthLoading(true);

                try {
                  const code: string = data["code"] as string;
                  const twoFactorAuthId: string =
                    selectedTwoFactorAuth!.id?.toString() as string;

                  const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
                    await API.post({
                      url: VERIFY_TWO_FACTOR_AUTH_API_URL,
                      data: {
                        ...initialValues,
                        code: code,
                        twoFactorAuthId: twoFactorAuthId,
                      },
                    });

                  if (result instanceof HTTPErrorResponse) {
                    throw result;
                  }

                  const user: User = User.fromJSON(
                    result["data"] as JSONObject,
                    User,
                  ) as User;
                  const miscData: JSONObject = (result["data"] as JSONObject)[
                    "miscData"
                  ] as JSONObject;

                  login(user as User, miscData as JSONObject);
                } catch (error) {
                  setTwoFactorAuthError(
                    API.getFriendlyErrorMessage(error as Error),
                  );
                }

                setIsTwoFactorAuthLoading(false);
              }}
            />
          )}
        </div>
        <div className="mt-10 text-center">
          {!selectedTwoFactorAuth && !selectedWebAuthn && (
            <div className="text-muted mb-0 text-gray-500">
              Don&apos;t have an account?{" "}
              <Link
                to={new Route("/accounts/register")}
                className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
              >
                Register.
              </Link>
            </div>
          )}
          {(selectedTwoFactorAuth || selectedWebAuthn) ? (
            <div className="text-muted mb-0 text-gray-500">
              <Link
                onClick={() => {
                  setSelectedTwoFactorAuth(undefined);
                  setSelectedWebAuthn(undefined);
                }}
                className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
              >
                Select a different two factor authentication method
              </Link>
            </div>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
