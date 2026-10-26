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
import {
  MASTER_PASSWORD_COPY,
  MASTER_PASSWORD_PROMPT_TEST_ID,
  MASTER_PASSWORD_TITLE_TEST_ID,
} from "./MasterPasswordCopy";

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

    // The link's own theme holds on the dashboard too.
    Navigation.navigate(new Route(PublicDashboardUtil.withLinkTheme(path)), {
      forceNavigate: true,
    });
  };

  /*
   * Once, as the prompt opens (and if it is for another dashboard): a
   * visitor with nothing to enter goes straight to the dashboard. Keyed by
   * the id's value - getDashboardId() hands back a new ObjectID each
   * render, and keyed by that, this ran again on the render after a
   * successful unlock and sent the visitor to the bare dashboard address
   * instead of the one they came from, losing its query (a link's own
   * theme, its variables).
   */
  const dashboardIdKey: string = dashboardId?.toString() || "";

  useEffect(() => {
    if (!PublicDashboardUtil.requiresMasterPassword()) {
      redirectToOverview();
      return;
    }

    if (PublicDashboardUtil.isMasterPasswordValidated()) {
      redirectToOverview();
      return;
    }
  }, [dashboardIdKey]);

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
      (
        values["password"] as { toString: () => string } | undefined
      )?.toString() || "";

    if (!submittedPassword.trim()) {
      setFormError(MASTER_PASSWORD_COPY.passwordRequired);
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
        PublicDashboardUtil.getSafeRedirectUrl();

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

  /*
   * What the visitor is opening - the dashboard's name - then what to do,
   * once. The prompt used to say it three times over: "Enter <name>
   * Password", "Please enter the password to view this dashboard." and,
   * under the field, "Enter the password to unlock this dashboard.", with
   * "Enter password" in the field as well.
   */
  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="px-4 sm:mx-auto sm:w-full sm:max-w-md sm:px-0">
        <h2
          className="mt-6 break-words text-center text-2xl tracking-tight text-gray-900"
          data-testid={MASTER_PASSWORD_TITLE_TEST_ID}
        >
          {props.dashboardName || MASTER_PASSWORD_COPY.fallbackTitle}
        </h2>
        <p
          className="mt-2 text-center text-sm text-gray-600"
          data-testid={MASTER_PASSWORD_PROMPT_TEST_ID}
        >
          {MASTER_PASSWORD_COPY.prompt}
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
                title: MASTER_PASSWORD_COPY.passwordLabel,
                required: true,
                fieldType: FormFieldSchemaType.Password,
                // What unlocks the dashboard: password managers may fill it.
                autoComplete: "current-password",
                isOwnCredential: true,
                disableSpellCheck: true,
              },
            ]}
            submitButtonText={MASTER_PASSWORD_COPY.submit}
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
