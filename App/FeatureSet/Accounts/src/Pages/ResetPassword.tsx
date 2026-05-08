import { RESET_PASSWORD_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/Models/DatabaseModels/User";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

const ResetPasswordPage: () => JSX.Element = () => {
  const { t } = useTranslation();
  const apiUrl: URL = RESET_PASSWORD_API_URL;
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  return (
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <img
          className="mx-auto h-10 w-auto sm:h-12"
          src={OneUptimeLogo}
          alt={t("common.yourCompany")}
        />
        <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
          {t("resetPassword.title")}
        </h2>

        {!isSuccess && (
          <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
            {t("resetPassword.subtitle")}{" "}
          </p>
        )}

        {isSuccess && (
          <p className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0">
            {t("resetPassword.successMessage")}
          </p>
        )}
      </div>

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        {!isSuccess && (
          <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10">
            <ModelForm<User>
              modelType={User}
              id="register-form"
              name="Reset Password"
              onBeforeCreate={(item: User): Promise<User> => {
                item.resetPasswordToken =
                  Navigation.getLastParam()
                    ?.toString()
                    .replace("/", "")
                    .toString() || "";
                return Promise.resolve(item);
              }}
              showAsColumns={1}
              maxPrimaryButtonWidth={true}
              fields={[
                {
                  field: {
                    password: true,
                  },
                  fieldType: FormFieldSchemaType.Password,
                  validation: {
                    minLength: 6,
                  },
                  placeholder: t("common.newPassword"),
                  title: t("common.newPassword"),
                  required: true,
                  showEvenIfPermissionDoesNotExist: true,
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
                  placeholder: t("common.confirmPassword"),
                  title: t("common.confirmPassword"),
                  overrideFieldKey: "confirmPassword",
                  required: true,
                  showEvenIfPermissionDoesNotExist: true,
                  disableSpellCheck: true,
                },
              ]}
              createOrUpdateApiUrl={apiUrl}
              formType={FormType.Create}
              submitButtonText={t("resetPassword.submitButton")}
              onSuccess={() => {
                setIsSuccess(true);
              }}
            />
          </div>
        )}

        <div className="mt-4 sm:mt-5 text-center">
          <p className="text-muted mb-0 text-gray-500 text-sm sm:text-base">
            {t("resetPassword.knowPasswordPrompt")}{" "}
            <Link
              to={new Route("/accounts/login")}
              className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            >
              {t("resetPassword.loginLink")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
