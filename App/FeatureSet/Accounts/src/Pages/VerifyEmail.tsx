import { VERIFY_EMAIL_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon, { IconType, ThickProp } from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const VerifyEmail: () => JSX.Element = () => {
  const { t } = useTranslation();
  const apiUrl: URL = VERIFY_EMAIL_API_URL;
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const init: PromiseVoidFunction = async (): Promise<void> => {
    // Ping an API here.
    setError("");
    setIsLoading(true);

    try {
      // strip data.
      const emailverificationToken: EmailVerificationToken =
        new EmailVerificationToken();
      emailverificationToken.token = new ObjectID(
        Navigation.getLastParam()?.toString().replace("/", "") || "",
      );

      await ModelAPI.createOrUpdate<EmailVerificationToken>({
        model: emailverificationToken,
        modelType: EmailVerificationToken,
        formType: FormType.Create,
        miscDataProps: {},
        requestOptions: {
          overrideRequestUrl: apiUrl,
        },
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    init().catch((err: Error) => {
      setError(err.toString());
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <div className="flex w-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center sm:mb-10">
          <img
            className="mx-auto h-10 w-auto sm:h-12"
            src={OneUptimeLogo}
            alt="OneUptime"
          />
        </div>

        <div className="rounded-xl bg-white px-6 py-8 shadow-sm ring-1 ring-gray-100 sm:px-10 sm:py-10">
          {!error && (
            <div className="text-center">
              <div className="mb-6 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50">
                  <Icon
                    icon={IconProp.Check}
                    type={IconType.Success}
                    thick={ThickProp.Thick}
                    className="h-10 w-10"
                  />
                </div>
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
                {t("verifyEmail.successTitle")}
              </h2>
              <p className="mt-3 px-2 text-sm leading-relaxed text-gray-600 sm:px-0 sm:text-base">
                {t("verifyEmail.successDescription")}
              </p>
            </div>
          )}

          {error && (
            <div className="text-center">
              <div className="mb-6 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100 ring-8 ring-red-50">
                  <Icon
                    icon={IconProp.Close}
                    type={IconType.Danger}
                    thick={ThickProp.Thick}
                    className="h-10 w-10"
                  />
                </div>
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
                {t("verifyEmail.errorTitle")}
              </h2>
              <p className="mt-3 px-2 text-sm leading-relaxed text-gray-600 sm:px-0 sm:text-base">
                {error}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 text-center sm:mt-8">
          <p className="text-sm text-gray-500 sm:text-base">
            {t("verifyEmail.returnToSignIn")}{" "}
            <Link
              to={new Route("/accounts/login")}
              className="cursor-pointer font-medium text-indigo-500 hover:text-indigo-700"
            >
              {t("verifyEmail.loginLink")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
