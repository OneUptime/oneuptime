import { FORGOT_PASSWORD_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import User from "Common/Models/DatabaseModels/User";
import React, { useState } from "react";

const ForgotPassword: () => JSX.Element = () => {
  const apiUrl: URL = FORGOT_PASSWORD_API_URL;

  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <img
          className="mx-auto h-10 w-auto sm:h-12"
          src={OneUptimeLogo}
          alt="Your Company"
        />
        <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
          Forgot your password
        </h2>

        {!isSuccess && (
          <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
            Please enter your email and the password reset link will be sent to
            you.
          </p>
        )}

        {isSuccess && (
          <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
            We have emailed you the password reset link. Please do not forget to
            check spam.
          </p>
        )}
      </div>

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        {!isSuccess && (
          <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10">
            <ModelForm<User>
              modelType={User}
              name="Forgot Password"
              id="login-form"
              createOrUpdateApiUrl={apiUrl}
              fields={[
                {
                  field: {
                    email: true,
                  },
                  title: "Email",
                  fieldType: FormFieldSchemaType.Email,
                  required: true,
                  disableSpellCheck: true,
                },
              ]}
              onSuccess={() => {
                setIsSuccess(true);
              }}
              submitButtonText={"Send Password Reset Link"}
              formType={FormType.Create}
              maxPrimaryButtonWidth={true}
              footer={
                <div className="actions pointer text-center mt-4 hover:underline fw-semibold">
                  <p>
                    <Link
                      to={new Route("/accounts/login")}
                      className="text-indigo-500 hover:text-indigo-900 cursor-pointer text-sm"
                    >
                      Return to Sign in.
                    </Link>
                  </p>
                </div>
              }
            />
          </div>
        )}

        <div className="mt-4 sm:mt-5 text-center">
          <p className="text-muted mb-0 text-gray-500 text-sm sm:text-base">
            Remember your password?{" "}
            <Link
              to={new Route("/accounts/login")}
              className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            >
              Login.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
