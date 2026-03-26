import { PUBLIC_DASHBOARD_API_URL } from "../../Utils/Config";
import PublicDashboardUtil from "../../Utils/PublicDashboard";
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
  dashboardName: string;
}

const MasterPasswordPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): JSX.Element => {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();

  const redirectToOverview: () => void = (): void => {
    const path: string = PublicDashboardUtil.isPreviewPage()
      ? `/public-dashboard/${PublicDashboardUtil.getDashboardId()?.toString()}`
      : "/";

    Navigation.navigate(new Route(path), { forceNavigate: true });
  };

  useEffect(() => {
    if (!PublicDashboardUtil.requiresMasterPassword()) {
      redirectToOverview();
      return;
    }

    if (PublicDashboardUtil.isMasterPasswordValidated()) {
      redirectToOverview();
      return;
    }
  }, [dashboardId]);

  if (!dashboardId || !PublicDashboardUtil.requiresMasterPassword()) {
    return <PageLoader isVisible={true} />;
  }

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
      setFormError("Password is required.");
      return;
    }

    if (!dashboardId) {
      throw new BadDataException("Dashboard ID not found");
    }

    const url: URL = URL.fromString(
      PUBLIC_DASHBOARD_API_URL.toString(),
    ).addRoute(`/master-password/${dashboardId.toString()}`);

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

      PublicDashboardUtil.setMasterPasswordValidated(true);

      const redirectUrl: string | null =
        Navigation.getQueryStringByName("redirectUrl");

      if (redirectUrl) {
        Navigation.navigate(new Route(redirectUrl), {
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
        <h2 className="mt-6 text-center text-2xl tracking-tight text-gray-900">
          {props.dashboardName
            ? `Enter ${props.dashboardName} Password`
            : "Enter Password"}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Please enter the password to view this dashboard.
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
                description: "Enter the password to unlock this dashboard.",
                required: true,
                placeholder: "Enter password",
                fieldType: FormFieldSchemaType.Password,
                disableSpellCheck: true,
              },
            ]}
            submitButtonText="Unlock Dashboard"
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
