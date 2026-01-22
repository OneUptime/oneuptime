import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { JSONObject } from "Common/Types/JSON";
import API from "../../Utils/API";
import Navigation from "Common/UI/Utils/Navigation";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import React, { FunctionComponent, useEffect, useState } from "react";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
}

const MasterPasswordPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): JSX.Element => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

  const redirectToOverview: () => void = (): void => {
    const path: string = StatusPageUtil.isPreviewPage()
      ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
      : "/";

    Navigation.navigate(new Route(path), { forceNavigate: true });
  };

  useEffect(() => {
    if (!StatusPageUtil.isPrivateStatusPage()) {
      Navigation.navigate(new Route("/"), { forceNavigate: true });
      return;
    }

    if (!StatusPageUtil.requiresMasterPassword()) {
      redirectToOverview();
      return;
    }

    if (statusPageId && UserUtil.isLoggedIn(statusPageId)) {
      redirectToOverview();
      return;
    }

    if (StatusPageUtil.isMasterPasswordValidated()) {
      redirectToOverview();
      return;
    }
  }, [statusPageId]);

  if (!statusPageId || !StatusPageUtil.requiresMasterPassword()) {
    return <PageLoader isVisible={true} />;
  }

  const logoUrl: string | null =
    props.logoFileId && props.logoFileId.toString()
      ? URL.fromString(STATUS_PAGE_API_URL.toString())
          .addRoute(`/logo/${statusPageId.toString()}`)
          .toString()
      : null;

  const privatePageCopy: string = "Please enter the password to continue.";

  const handleFormSubmit: (
    values: JSONObject,
    onSubmitSuccessful?: () => void,
  ) => Promise<void> = async (
    values: JSONObject,
    onSubmitSuccessful?: () => void,
  ): Promise<void> => {
    const submittedPassword: string =
      (values["password"] as { toString: () => string } | undefined)
        ?.toString()
        .trim() || "";

    if (!submittedPassword) {
      setFormError("password is required.");
      return;
    }

    if (!statusPageId) {
      throw new BadDataException("Status Page ID not found");
    }

    const url: URL = URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
      `/master-password/${statusPageId.toString()}`,
    );

    setIsSubmitting(true);
    setFormError(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url,
          data: {
            password: submittedPassword,
          },
        });

      if (response.isFailure()) {
        throw response;
      }

      StatusPageUtil.setMasterPasswordValidated(true);

      const safeRedirectUrl: string | null =
        StatusPageUtil.getSafeRedirectUrl();

      if (safeRedirectUrl) {
        Navigation.navigate(new Route(safeRedirectUrl), {
          forceNavigate: true,
        });
      } else {
        redirectToOverview();
      }

      onSubmitSuccessful?.();
    } catch (err) {
      setFormError(API.getFriendlyMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {logoUrl ? (
          <img style={{ height: "70px", margin: "auto" }} src={logoUrl} />
        ) : null}
        <h2 className="mt-6 text-center text-2xl tracking-tight text-gray-900">
          {props.statusPageName
            ? `Enter ${props.statusPageName} Password`
            : "Enter Password"}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {privatePageCopy}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <BasicForm
            id="master-password-form"
            name="Password Unlock"
            initialValues={{
              password: "",
            }}
            fields={[
              {
                field: {
                  password: true,
                },
                title: "Password",
                description: "Enter the password to unlock this page.",
                required: true,
                placeholder: "Enter password",
                fieldType: FormFieldSchemaType.Password,
                disableSpellCheck: true,
              },
            ]}
            submitButtonText="Unlock Status Page"
            maxPrimaryButtonWidth={true}
            isLoading={isSubmitting}
            error={formError || undefined}
            onSubmit={(values: JSONObject, onSubmitSuccessful?: () => void) => {
              void handleFormSubmit(values, onSubmitSuccessful);
            }}
            footer={<></>}
          />
        </div>
      </div>
    </div>
  );
};

export default MasterPasswordPage;
