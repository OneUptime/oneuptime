import {
  FormSignInTarget,
  getFormSsoSignInUrl,
  loadFormSignInMethods,
  resetFormPassword,
  sendFormPasswordReset,
  signInToForm,
} from "../../Utils/FormSignIn";
import {
  FormSignInMethods,
  FormSignInProvider,
} from "Common/Types/Form/FormPrivateUserSignIn";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import LabelledDivider from "Common/UI/Components/Divider/LabelledDivider";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import SignInOptionLink from "Common/UI/Components/SignInOption/SignInOptionLink";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * A FORM'S SIGN-IN (#10249), drawn in the form's page while the form asks
 * its visitors to sign in and nobody has on this host: an email and a
 * password, Forgot password, and a button per single sign-on provider -
 * or, opened from an invitation or a reset link, the new password it
 * chooses. Every refusal is the server's one sentence: the page says
 * nothing of who is invited.
 */

export enum FormSignInStep {
  SignIn = "SignIn",
  ForgotPassword = "ForgotPassword",
  ResetPassword = "ResetPassword",
}

export const FORM_SIGN_IN_TEST_ID: string = "form-sign-in";
export const FORM_SIGN_IN_PROVIDERS_TEST_ID: string = "form-sign-in-providers";
export const FORM_FORGOT_PASSWORD_SENT_TEST_ID: string =
  "form-forgot-password-sent";
export const FORM_RESET_PASSWORD_DONE_TEST_ID: string =
  "form-reset-password-done";

export interface ComponentProps {
  target: FormSignInTarget;
  // From an invitation or a reset link: the token it carried.
  resetToken?: string | null | undefined;
  // What went wrong exchanging a single sign-on code, if anything did.
  initialError?: string | null | undefined;
  onSignedIn: (email: string) => void;
}

interface SignInProviderLink {
  provider: FormSignInProvider;
  protocol: "saml" | "oidc";
}

const FormSignInView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  const [step, setStep] = useState<FormSignInStep>(
    props.resetToken ? FormSignInStep.ResetPassword : FormSignInStep.SignIn,
  );
  const [methods, setMethods] = useState<FormSignInMethods | null>(null);
  const [error, setError] = useState<string | null>(props.initialError || null);
  const [isWorking, setIsWorking] = useState<boolean>(false);
  const [isResetSent, setIsResetSent] = useState<boolean>(false);
  const [isPasswordSaved, setIsPasswordSaved] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    loadFormSignInMethods(props.target)
      .then((loaded: FormSignInMethods) => {
        if (isCurrent) {
          setMethods(loaded);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.target.formId]);

  const run: (work: () => Promise<void>) => Promise<void> = async (
    work: () => Promise<void>,
  ): Promise<void> => {
    if (isWorking) {
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      await work();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsWorking(false);
  };

  const errorAlert: ReactElement = error ? (
    <div className="mb-5">
      <Alert type={AlertType.DANGER} title={error} />
    </div>
  ) : (
    <></>
  );

  if (step === FormSignInStep.ResetPassword) {
    return (
      <div data-testid={FORM_SIGN_IN_TEST_ID}>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          {t("formSignIn.resetTitle")}
        </h2>
        {isPasswordSaved ? (
          <div data-testid={FORM_RESET_PASSWORD_DONE_TEST_ID}>
            <p className="mb-5 text-sm text-gray-700">
              {t("formSignIn.resetDone")}
            </p>
            <Button
              title={t("formSignIn.signIn")}
              isTitleTranslated={true}
              buttonStyle={ButtonStyleType.PRIMARY}
              onClick={() => {
                setError(null);
                setStep(FormSignInStep.SignIn);
              }}
            />
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm text-gray-600">
              {t("formSignIn.resetPrompt")}
            </p>
            {errorAlert}
            <BasicForm
              id="form-reset-password-form"
              name="Form Reset Password"
              initialValues={{ password: "" }}
              fields={[
                {
                  field: { password: true },
                  title: t("formSignIn.newPassword"),
                  fieldType: FormFieldSchemaType.Password,
                  required: true,
                  autoComplete: "new-password",
                  isOwnCredential: true,
                  disableSpellCheck: true,
                },
              ]}
              submitButtonText={t("formSignIn.savePassword")}
              maxPrimaryButtonWidth={true}
              isLoading={isWorking}
              onSubmit={(values: JSONObject) => {
                void run(async () => {
                  await resetFormPassword(props.target, {
                    token: props.resetToken || "",
                    password: String(values["password"] || ""),
                  });
                  setIsPasswordSaved(true);
                });
              }}
              footer={<></>}
            />
          </>
        )}
      </div>
    );
  }

  if (step === FormSignInStep.ForgotPassword) {
    return (
      <div data-testid={FORM_SIGN_IN_TEST_ID}>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          {t("formSignIn.forgotTitle")}
        </h2>
        {isResetSent ? (
          <p
            className="mb-5 text-sm text-gray-700"
            data-testid={FORM_FORGOT_PASSWORD_SENT_TEST_ID}
          >
            {t("formSignIn.forgotSent")}
          </p>
        ) : (
          <>
            <p className="mb-5 text-sm text-gray-600">
              {t("formSignIn.forgotPrompt")}
            </p>
            {errorAlert}
            <BasicForm
              id="form-forgot-password-form"
              name="Form Forgot Password"
              initialValues={{ email: "" }}
              fields={[
                {
                  field: { email: true },
                  title: t("formSignIn.email"),
                  fieldType: FormFieldSchemaType.Email,
                  required: true,
                  disableSpellCheck: true,
                },
              ]}
              submitButtonText={t("formSignIn.sendLink")}
              maxPrimaryButtonWidth={true}
              isLoading={isWorking}
              onSubmit={(values: JSONObject) => {
                void run(async () => {
                  await sendFormPasswordReset(
                    props.target,
                    String(values["email"] || "").trim(),
                  );
                  setIsResetSent(true);
                });
              }}
              footer={<></>}
            />
          </>
        )}
        <div className="mt-5 text-center">
          <Button
            title={t("formSignIn.backToSignIn")}
            isTitleTranslated={true}
            buttonStyle={ButtonStyleType.LINK}
            onClick={() => {
              setError(null);
              setIsResetSent(false);
              setStep(FormSignInStep.SignIn);
            }}
          />
        </div>
      </div>
    );
  }

  const providerLinks: Array<SignInProviderLink> = methods
    ? [
        ...methods.samlProviders.map(
          (provider: FormSignInProvider): SignInProviderLink => {
            return { provider, protocol: "saml" };
          },
        ),
        ...methods.oidcProviders.map(
          (provider: FormSignInProvider): SignInProviderLink => {
            return { provider, protocol: "oidc" };
          },
        ),
      ]
    : [];

  const isPasswordSignInAllowed: boolean = Boolean(
    methods && methods.isPasswordSignInAllowed,
  );

  return (
    <div data-testid={FORM_SIGN_IN_TEST_ID}>
      <p className="mb-5 text-center text-sm text-gray-600">
        {isPasswordSignInAllowed || !methods
          ? t("formSignIn.prompt")
          : t("formSignIn.ssoOnlyPrompt")}
      </p>
      {errorAlert}
      {methods && !isPasswordSignInAllowed && providerLinks.length === 0 ? (
        <p className="text-center text-sm text-gray-600">
          {t("formSignIn.noWayIn")}
        </p>
      ) : (
        <></>
      )}
      {isPasswordSignInAllowed ? (
        <>
          <BasicForm
            id="form-sign-in-form"
            name="Form Sign In"
            initialValues={{ email: "", password: "" }}
            fields={[
              {
                field: { email: true },
                title: t("formSignIn.email"),
                fieldType: FormFieldSchemaType.Email,
                required: true,
                disableSpellCheck: true,
              },
              {
                field: { password: true },
                title: t("formSignIn.password"),
                fieldType: FormFieldSchemaType.Password,
                required: true,
                autoComplete: "current-password",
                isOwnCredential: true,
                disableSpellCheck: true,
              },
            ]}
            submitButtonText={t("formSignIn.signIn")}
            maxPrimaryButtonWidth={true}
            isLoading={isWorking}
            onSubmit={(values: JSONObject) => {
              void run(async () => {
                const email: string = await signInToForm(props.target, {
                  email: String(values["email"] || "").trim(),
                  password: String(values["password"] || ""),
                });
                props.onSignedIn(email);
              });
            }}
            footer={<></>}
          />
          <div className="mt-3 text-center">
            <Button
              title={t("formSignIn.forgotPassword")}
              isTitleTranslated={true}
              buttonStyle={ButtonStyleType.LINK}
              onClick={() => {
                setError(null);
                setStep(FormSignInStep.ForgotPassword);
              }}
            />
          </div>
        </>
      ) : (
        <></>
      )}
      {providerLinks.length > 0 ? (
        <div data-testid={FORM_SIGN_IN_PROVIDERS_TEST_ID}>
          {isPasswordSignInAllowed ? (
            <LabelledDivider label={t("formSignIn.or")} className="my-5" />
          ) : (
            <></>
          )}
          <div className="space-y-3">
            {providerLinks.map((link: SignInProviderLink) => {
              return (
                <SignInOptionLink
                  key={link.provider._id}
                  to={getFormSsoSignInUrl({
                    formId: props.target.formId,
                    providerId: link.provider._id,
                    protocol: link.protocol,
                  })}
                  icon={IconProp.ShieldCheck}
                  dataTestId={`form-sign-in-provider-${link.provider._id}`}
                  title={t("formSignIn.signInWithProvider", {
                    provider: link.provider.name,
                  })}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default FormSignInView;
