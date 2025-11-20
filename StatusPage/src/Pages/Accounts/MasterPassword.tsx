import { STATUS_PAGE_API_URL } from "../../Utils/Config";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import API from "../../Utils/API";
import Navigation from "Common/UI/Utils/Navigation";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import React, {
  ChangeEvent,
  FormEvent,
  FunctionComponent,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
}

const MasterPasswordPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): JSX.Element => {
  const [password, setPassword] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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

  const privatePageCopy: string = props.statusPageName
    ? `${props.statusPageName} is private. Please enter the master password to continue.`
    : "This status page is private. Please enter the master password to continue.";

  const onSubmit: () => Promise<void> = async (): Promise<void> => {
    if (!password) {
      setError("Master password is required.");
      return;
    }

    if (!statusPageId) {
      throw new BadDataException("Status Page ID not found");
    }

    const url: URL = URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
      `/master-password/${statusPageId.toString()}`,
    );

    setIsSubmitting(true);
    setError(null);

    try {
      await API.post({
        url,
        data: {
          password,
        },
      });

      StatusPageUtil.setMasterPasswordValidated(true);

      const redirectUrl: string | null =
        Navigation.getQueryStringByName("redirectUrl");

      if (redirectUrl) {
        Navigation.navigate(new Route(redirectUrl), { forceNavigate: true });
      } else {
        redirectToOverview();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsSubmitting(false);
      setPassword("");
    }
  };

  const handleSubmit: (event: FormEvent<HTMLFormElement>) => void = (
    event: FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    void onSubmit();
  };

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {logoUrl ? (
          <img style={{ height: "70px", margin: "auto" }} src={logoUrl} />
        ) : null}
        <h2 className="mt-6 text-center text-2xl tracking-tight text-gray-900">
          {props.statusPageName
            ? `Enter ${props.statusPageName} Master Password`
            : "Enter Master Password"}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {privatePageCopy}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error ? (
            <Alert
              className="mb-4"
              strongTitle="Unable to unlock status page"
              title={error}
              type={AlertType.DANGER}
            />
          ) : null}
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="master-password"
                className="block text-sm font-medium text-gray-700"
              >
                Master Password
              </label>
              <div className="mt-1">
                <input
                  id="master-password"
                  name="master-password"
                  type="password"
                  autoComplete="current-password"
                  required={true}
                  value={password}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setPassword(event.target.value);
                  }}
                  className="block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <Button
                buttonStyle={ButtonStyleType.PRIMARY}
                buttonSize={ButtonSize.Large}
                type={ButtonType.Submit}
                title={isSubmitting ? "Unlocking..." : "Unlock Status Page"}
                isLoading={isSubmitting}
                disabled={isSubmitting}
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default MasterPasswordPage;
