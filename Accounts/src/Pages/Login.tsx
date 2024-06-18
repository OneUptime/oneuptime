import { LOGIN_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ModelForm, { FormType } from "CommonUI/src/Components/Forms/ModelForm";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import Link from "CommonUI/src/Components/Link/Link";
import { DASHBOARD_URL } from "CommonUI/src/Config";
import OneUptimeLogo from "CommonUI/src/Images/logos/OneUptimeSVG/3-transparent.svg";
import UiAnalytics from "CommonUI/src/Utils/Analytics";
import LoginUtil from "CommonUI/src/Utils/Login";
import Navigation from "CommonUI/src/Utils/Navigation";
import UserUtil from "CommonUI/src/Utils/User";
import User from "Model/Models/User";
import React from "react";
import useAsyncEffect from "use-async-effect";

const LoginPage: () => JSX.Element = () => {
  const apiUrl: URL = LOGIN_API_URL;

  if (UserUtil.isLoggedIn()) {
    Navigation.navigate(DASHBOARD_URL);
  }

  const [initialValues, setInitialValues] = React.useState<JSONObject>({});

  useAsyncEffect(async () => {
    if (Navigation.getQueryStringByName("email")) {
      setInitialValues({
        email: Navigation.getQueryStringByName("email"),
      });
    }
  }, []);

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="">
        <img
          className="mx-auto h-12 w-auto"
          src={OneUptimeLogo}
          alt="OneUptime"
        />
        <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
          Sign in to your account
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Join thousands of business that use OneUptime to help them stay online
          all the time.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
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
              },
            ]}
            createOrUpdateApiUrl={apiUrl}
            formType={FormType.Create}
            submitButtonText={"Login"}
            onSuccess={(value: User, miscData: JSONObject | undefined) => {
              if (value && value.email) {
                UiAnalytics.userAuth(value.email);
                UiAnalytics.capture("accounts/login");
              }

              LoginUtil.login({
                user: value,
                token: miscData ? miscData["token"] : undefined,
              });
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
        </div>
        <div className="mt-10 text-center">
          <div className="text-muted mb-0 text-gray-500">
            Don&apos;t have an account?{" "}
            <Link
              to={new Route("/accounts/register")}
              className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            >
              Register.
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
