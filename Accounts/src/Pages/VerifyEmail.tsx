import { VERIFY_EMAIL_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import React, { useEffect, useState } from "react";

const VerifyEmail: () => JSX.Element = () => {
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
    <div className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md mx-auto">
        <div className="text-center mb-8 sm:mb-10">
          <img
            className="mx-auto h-10 w-auto sm:h-12"
            src={OneUptimeLogo}
            alt="OneUptime"
          />
        </div>

        <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10">
          {!error && (
            <div className="text-center">
              <div className="text-5xl sm:text-6xl mb-4">✅</div>
              <h2 className="text-xl sm:text-2xl tracking-tight text-gray-900">
                Your email is verified.
              </h2>
              <p className="text-gray-600 mt-3 text-sm sm:text-base px-2 sm:px-0">
                Thank you for verifying your email. You can now log in to
                OneUptime.
              </p>
            </div>
          )}

          {error && (
            <div className="text-center">
              <div className="text-5xl sm:text-6xl mb-4">❌</div>
              <h2 className="text-xl sm:text-2xl tracking-tight text-gray-900">
                Sorry, something went wrong!
              </h2>
              <p className="text-gray-600 mt-3 text-sm sm:text-base px-2 sm:px-0">
                {error}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 sm:mt-8 text-center">
          <p className="text-gray-500 text-sm sm:text-base">
            Return to sign in?{" "}
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

export default VerifyEmail;
