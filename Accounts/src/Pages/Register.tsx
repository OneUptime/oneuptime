import { SIGNUP_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelForm, {
  FormType,
  ModelField,
} from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Captcha from "Common/UI/Components/Captcha/Captcha";
import {
  BILLING_ENABLED,
  DASHBOARD_URL,
  CAPTCHA_ENABLED,
  CAPTCHA_SITE_KEY,
} from "Common/UI/Config";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import BaseAPI from "Common/UI/Utils/API/API";
import UiAnalytics from "Common/UI/Utils/Analytics";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import LoginUtil from "Common/UI/Utils/Login";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import Reseller from "Common/Models/DatabaseModels/Reseller";
import User from "Common/Models/DatabaseModels/User";
import React, { useState } from "react";
import useAsyncEffect from "use-async-effect";

const RegisterPage: () => JSX.Element = () => {
  const apiUrl: URL = SIGNUP_API_URL;

  const [initialValues, setInitialValues] = React.useState<JSONObject>({});

  const [error, setError] = useState<string>("");

  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  const [reseller, setResller] = React.useState<Reseller | undefined>(
    undefined,
  );

  const isCaptchaEnabled: boolean =
    CAPTCHA_ENABLED && Boolean(CAPTCHA_SITE_KEY);

  const [shouldResetCaptcha, setShouldResetCaptcha] =
    React.useState<boolean>(false);
  const [captchaResetSignal, setCaptchaResetSignal] = React.useState<number>(0);

  const handleCaptchaReset: () => void = React.useCallback(() => {
    setCaptchaResetSignal((current: number) => {
      return current + 1;
    });
  }, []);

  if (UserUtil.isLoggedIn()) {
    Navigation.navigate(DASHBOARD_URL);
  }

  type FetchResellerFunction = (resellerId: string) => Promise<void>;

  const fetchReseller: FetchResellerFunction = async (
    resellerId: string,
  ): Promise<void> => {
    setIsLoading(true);

    try {
      const reseller: ListResult<Reseller> = await ModelAPI.getList<Reseller>({
        modelType: Reseller,
        query: {
          resellerId: resellerId,
        },
        limit: 1,
        skip: 0,
        select: {
          hidePhoneNumberOnSignup: true,
        },
        sort: {},
        requestOptions: {},
      });

      if (reseller.data.length > 0) {
        setResller(reseller.data[0]);
      }
    } catch (err) {
      setError(BaseAPI.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useAsyncEffect(async () => {
    // if promo code is found, please save it in localstorage.
    if (Navigation.getQueryStringByName("promoCode")) {
      LocalStorage.setItem(
        "promoCode",
        Navigation.getQueryStringByName("promoCode"),
      );
    }

    if (Navigation.getQueryStringByName("email")) {
      setInitialValues({
        email: Navigation.getQueryStringByName("email"),
      });
    }

    // if promo code is found, please save it in localstorage.
    if (Navigation.getQueryStringByName("partnerId")) {
      await fetchReseller(Navigation.getQueryStringByName("partnerId")!);
    }
  }, []);

  let formFields: Array<ModelField<User>> = [
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
        name: true,
      },
      fieldType: FormFieldSchemaType.Text,
      placeholder: "Jeff Smith",
      required: true,
      title: "Full Name",
      dataTestId: "name",
      disableSpellCheck: true,
    },
  ];

  if (BILLING_ENABLED) {
    formFields = formFields.concat([
      {
        field: {
          companyName: true,
        },
        fieldType: FormFieldSchemaType.Text,
        placeholder: "Acme, Inc.",
        required: true,
        title: "Company Name",
        dataTestId: "companyName",
        disableSpellCheck: true,
      },
    ]);

    // If reseller wants to hide phone number on sign up, we hide it.
    if (!reseller || !reseller.hidePhoneNumberOnSignup) {
      formFields.push({
        field: {
          companyPhoneNumber: true,
        },
        fieldType: FormFieldSchemaType.Phone,
        required: true,
        placeholder: "+11234567890",
        title: "Phone Number",
        dataTestId: "companyPhoneNumber",
      });
    }
  }

  formFields = formFields.concat([
    {
      field: {
        password: true,
      },
      fieldType: FormFieldSchemaType.Password,
      validation: {
        minLength: 6,
      },
      placeholder: "Password",
      title: "Password",
      required: true,
      dataTestId: "password",
      disableSpellCheck: true,
    },
    {
      field: {
        confirmPassword: true,
      } as any,
      validation: {
        minLength: 6,
        toMatchField: "password",
      },
      fieldType: FormFieldSchemaType.Password,
      placeholder: "Confirm Password",
      title: "Confirm Password",
      overrideFieldKey: "confirmPassword",
      required: true,
      showEvenIfPermissionDoesNotExist: true,
      dataTestId: "confirmPassword",
      disableSpellCheck: true,
    },
  ]);

  if (isCaptchaEnabled) {
    formFields = formFields.concat([
      {
        overrideField: {
          captchaToken: true,
        },
        overrideFieldKey: "captchaToken",
        fieldType: FormFieldSchemaType.CustomComponent,
        title: "Human Verification",
        description:
          "Complete the captcha challenge so we know you're not a bot.",
        required: true,
        showEvenIfPermissionDoesNotExist: true,
        getCustomElement: (
          _values: FormValues<User>,
          customProps: CustomElementProps,
        ) => {
          return (
            <Captcha
              siteKey={CAPTCHA_SITE_KEY}
              resetSignal={captchaResetSignal}
              error={customProps.error}
              onTokenChange={(token: string) => {
                customProps.onChange?.(token);
              }}
              onBlur={customProps.onBlur}
            />
          );
        },
      },
    ]);
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <img
          className="mx-auto h-12 w-auto"
          src={OneUptimeLogo}
          alt="OneUptime"
        />
        <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
          Create your OneUptime account
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Join thousands of business that use OneUptime to help them stay online
          all the time.
        </p>
        <p className="mt-2 text-center text-sm text-gray-600">
          No credit card required.
        </p>
      </div>

      <div className="mt-8 lg:mx-auto lg:w-full lg:max-w-2xl">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <ModelForm<User>
            modelType={User}
            id="register-form"
            showAsColumns={reseller ? 1 : 2}
            name="Register"
            initialValues={initialValues}
            maxPrimaryButtonWidth={true}
            fields={formFields}
            createOrUpdateApiUrl={apiUrl}
            onBeforeCreate={(
              item: User,
              miscDataProps: JSONObject,
            ): Promise<User> => {
              if (isCaptchaEnabled) {
                const captchaToken: string | undefined = (
                  miscDataProps["captchaToken"] as string | undefined
                )
                  ?.toString()
                  .trim();

                if (!captchaToken) {
                  throw new Error(
                    "Please complete the captcha challenge before signing up.",
                  );
                }

                miscDataProps["captchaToken"] = captchaToken;
                setShouldResetCaptcha(true);
              }

              const utmParams: Dictionary<string> = UserUtil.getUtmParams();

              if (utmParams && Object.keys(utmParams).length > 0) {
                item.utmSource = utmParams["utmSource"] || "";
                item.utmMedium = utmParams["utmMedium"] || "";
                item.utmCampaign = utmParams["utmCampaign"] || "";
                item.utmTerm = utmParams["utmTerm"] || "";
                item.utmContent = utmParams["utmContent"] || "";
                item.utmUrl = utmParams["utmUrl"] || "";

                UiAnalytics.capture("utm_event", utmParams);
              }

              return Promise.resolve(item);
            }}
            formType={FormType.Create}
            submitButtonText={"Sign Up"}
            onLoadingChange={(loading: boolean) => {
              if (!isCaptchaEnabled) {
                return;
              }

              if (!loading && shouldResetCaptcha) {
                setShouldResetCaptcha(false);
                handleCaptchaReset();
              }
            }}
            onSuccess={(value: User, miscData: JSONObject | undefined) => {
              if (value && value.email) {
                UiAnalytics.userAuth(value.email);
                UiAnalytics.capture("accounts/register");
              }

              LoginUtil.login({
                user: value,
                token: miscData ? miscData["token"] : undefined,
              });
            }}
          />
        </div>
        <div className="mt-5 text-center text-gray-500">
          <p className="text-muted mb-0">
            Already have an account?{" "}
            <Link
              to={new Route("/accounts/login")}
              className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            >
              Log in.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
