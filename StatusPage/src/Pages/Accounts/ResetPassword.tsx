import { RESET_PASSWORD_API_URL } from "../../Utils/ApiPaths";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import StatusPageUtil from "../../Utils/StatusPage";
import UserUtil from "../../Utils/User";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import { FILE_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import React, { FunctionComponent, useEffect, useState } from "react";

export interface ComponentProps {
  statusPageName: string;
  logoFileId: ObjectID;
  forceSSO: boolean;
}

const ResetPassword: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
) => {
  const apiUrl: URL = RESET_PASSWORD_API_URL;
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (props.forceSSO) {
      Navigation.navigate(
        !StatusPageUtil.isPreviewPage()
          ? RouteMap[PageMap.SSO]!
          : RouteMap[PageMap.PREVIEW_SSO]!,
      );
    }
  }, [props.forceSSO]);

  if (!StatusPageUtil.getStatusPageId()) {
    return <></>;
  }

  if (
    StatusPageUtil.getStatusPageId() &&
    UserUtil.isLoggedIn(StatusPageUtil.getStatusPageId()!)
  ) {
    Navigation.navigate(
      new Route(
        StatusPageUtil.isPreviewPage()
          ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
          : "/",
      ),
    );
  }

  if (!StatusPageUtil.isPrivateStatusPage()) {
    Navigation.navigate(
      new Route(
        StatusPageUtil.isPreviewPage()
          ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
          : "/",
      ),
    );
  }

  return (
    <div className="flex min-h-full flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {props.logoFileId && props.logoFileId.toString() ? (
          <img
            style={{ height: "70px", margin: "auto" }}
            src={`${URL.fromString(FILE_URL.toString()).addRoute(
              "/image/" + props.logoFileId.toString(),
            )}`}
          />
        ) : (
          <></>
        )}
        <h2 className="mt-6 text-center text-2xl  tracking-tight text-gray-900">
          Create a new password for your {props.statusPageName} account.
        </h2>

        {!isSuccess && (
          <p className="mt-2 text-center text-sm text-gray-600">
            Please enter your new password and we will have it updated.{" "}
          </p>
        )}

        {isSuccess && (
          <p className="mt-2 text-center text-sm text-gray-600">
            Your password has been updated. Please log in.
          </p>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        {!isSuccess && (
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <ModelForm<StatusPagePrivateUser>
              modelType={StatusPagePrivateUser}
              id="register-form"
              name="Status Page > Reset Password"
              onBeforeCreate={(
                item: StatusPagePrivateUser,
              ): Promise<StatusPagePrivateUser> => {
                item.resetPasswordToken =
                  Navigation.getLastParam()
                    ?.toString()
                    .replace("/", "")
                    .toString() || "";

                item.statusPageId = StatusPageUtil.getStatusPageId()!;
                return Promise.resolve(item);
              }}
              showAsColumns={1}
              maxPrimaryButtonWidth={true}
              fields={[
                {
                  field: {
                    password: true,
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  fieldType: FormFieldSchemaType.Password,
                  validation: {
                    minLength: 6,
                  },
                  placeholder: "New Password",
                  title: "New Password",
                  required: true,
                },
                {
                  field: {
                    confirmPassword: true,
                  } as any,
                  validation: {
                    minLength: 6,
                    toMatchField: "password",
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  fieldType: FormFieldSchemaType.Password,
                  placeholder: "Confirm Password",
                  title: "Confirm Password",
                  overrideFieldKey: "confirmPassword",
                  required: true,
                },
              ]}
              createOrUpdateApiUrl={apiUrl}
              formType={FormType.Create}
              submitButtonText={"Reset Password"}
              onSuccess={() => {
                setIsSuccess(true);
              }}
            />
          </div>
        )}
        <div className="mt-10 text-center">
          <p className="text-muted mb-0 text-gray-500">
            Know your password?{" "}
            <Link
              to={
                new Route(
                  StatusPageUtil.isPreviewPage()
                    ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/login`
                    : "/login",
                )
              }
              className="text-indigo-500 hover:text-indigo-900 cursor-pointer"
            >
              Log in.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
