import PageLogo from "../../Components/Logo/PageLogo";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import AuthPage from "Common/UI/Components/AuthPage/AuthPage";
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
import React, { FunctionComponent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
  // The logo made for the dark theme, shown instead while the page is dark.
  darkThemeLogoFileId?: ObjectID | undefined;
}

const MasterPasswordPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): JSX.Element => {
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

  const redirectToOverview: () => void = (): void => {
    const path: string = StatusPageUtil.isPreviewPage()
      ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
      : "/";

    Navigation.navigate(new Route(path), { forceNavigate: true });
  };

  /*
   * Once, as the prompt opens (and again only for another page): a visitor
   * with nothing to enter goes straight to the page. Keyed by the id's value
   * - getStatusPageId() hands back a new ObjectID each render, and keyed by
   * that, this ran again on the render after a right password and sent the
   * visitor to the bare overview, after and so instead of where they were
   * going (as the public dashboard's prompt did).
   */
  const statusPageIdKey: string = statusPageId?.toString() || "";

  useEffect(() => {
    // A page everyone may see asks for no password: on to its overview.
    if (!StatusPageUtil.isPrivateStatusPage()) {
      redirectToOverview();
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
  }, [statusPageIdKey]);

  if (!statusPageId || !StatusPageUtil.requiresMasterPassword()) {
    return <AuthPageSkeleton fields={1} />;
  }

  const privatePageCopy: string = t("accounts.masterPassword.prompt");

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
      setFormError(t("accounts.masterPassword.passwordRequired"));
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

  /*
   * What the visitor is opening, then what to do, once: the title, the
   * sentence under it, the field's description and its placeholder used to
   * say "enter the password" four times over.
   */
  return (
    <AuthPage
      logo={
        <PageLogo
          logoFileId={props.logoFileId}
          darkThemeLogoFileId={props.darkThemeLogoFileId}
          altText={props.statusPageName}
        />
      }
      title={props.statusPageName || t("common.statusPage")}
      titleTestId="master-password-title"
      subtitle={privatePageCopy}
      subtitleTestId="master-password-prompt"
    >
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
            title: t("accounts.masterPassword.passwordLabel"),
            required: true,
            fieldType: FormFieldSchemaType.Password,
            // What unlocks the page: password managers may fill it.
            autoComplete: "current-password",
            isOwnCredential: true,
            disableSpellCheck: true,
          },
        ]}
        submitButtonText={t("accounts.masterPassword.submit")}
        maxPrimaryButtonWidth={true}
        isLoading={isSubmitting}
        error={formError || undefined}
        onSubmit={(values: JSONObject, onSubmitSuccessful?: () => void) => {
          void handleFormSubmit(values, onSubmitSuccessful);
        }}
        footer={<></>}
      />
    </AuthPage>
  );
};

export default MasterPasswordPage;
