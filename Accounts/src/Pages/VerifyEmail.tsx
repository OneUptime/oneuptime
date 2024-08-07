import { VERIFY_EMAIL_API_URL } from "../Utils/ApiPaths";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import { FormType } from "Common/UI/src/Components/Forms/ModelForm";
import Link from "Common/UI/src/Components/Link/Link";
import PageLoader from "Common/UI/src/Components/Loader/PageLoader";
import OneUptimeLogo from "Common/UI/src/Images/logos/OneUptimeSVG/3-transparent.svg";
import API from "Common/UI/src/Utils/API/API";
import ModelAPI from "Common/UI/src/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/src/Utils/Navigation";
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
    <div className="auth-page">
      <div className="container-fluid p-0">
        <div className="row g-0">
          <div className="col-xxl-4 col-lg-4 col-md-3"></div>

          <div className="col-xxl-4 col-lg-4 col-md-6">
            <div className="auth-full-page-content d-flex p-sm-5 p-4">
              <div className="w-100">
                <div className="d-flex flex-column h-100">
                  <div className="auth-content my-auto">
                    <div
                      className="mt-4 text-center flex justify-center"
                      style={{ marginBottom: "40px" }}
                    >
                      <img
                        style={{ height: "50px" }}
                        src={`${OneUptimeLogo}`}
                      />
                    </div>
                    {!error && (
                      <div className="text-center">
                        <h5 className="mb-0">Your email is verified.</h5>
                        <p className="text-muted mt-2 mb-0">
                          Thank you for verifying your email. You can now log in
                          to OneUptime.{" "}
                        </p>
                      </div>
                    )}

                    {error && (
                      <div className="text-center">
                        <h5 className="mb-0">Sorry, something went wrong!</h5>
                        <p className="text-muted mt-2 mb-0">{error}</p>
                      </div>
                    )}

                    <div className="mt-5 text-center">
                      <p className="text-muted mb-0">
                        Return to sign in?{" "}
                        <Link
                          to={new Route("/accounts/login")}
                          className="hover:underline text-primary fw-semibold"
                        >
                          Login.
                        </Link>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-xxl-4 col-lg-4 col-md-3"></div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;
