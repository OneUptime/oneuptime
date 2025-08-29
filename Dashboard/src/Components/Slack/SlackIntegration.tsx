import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import Button, { ButtonStyleType as SharedButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import { APP_API_URL, HOME_URL, SlackAppClientId } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import SlackIntegrationDocumentation from "./SlackIntegrationDocumentation";
import Link from "Common/UI/Components/Link/Link";
import Steps from "Common/UI/Components/Forms/Steps/Steps";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";

export interface ComponentProps {
  onConnected: VoidFunction;
  onDisconnected: VoidFunction;
}

const SlackIntegration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [error, setError] = React.useState<ReactElement | null>(null);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [manifest, setManifest] = React.useState<JSONObject | null>(null);
  const [isUserAccountConnected, setIsUserAccountConnected] =
    React.useState<boolean>(false);
  const [userAuthTokenId, setWorkspaceUserAuthTokenId] =
    React.useState<ObjectID | null>(null);
  const [projectAuthTokenId, setWorkspaceProjectAuthTokenId] =
    React.useState<ObjectID | null>(null);
  const [isProjectAccountConnected, setIsProjectAccountConnected] =
    React.useState<boolean>(false);
  const [slackTeamName, setSlackTeamName] = React.useState<string | null>(null);
  const [currentStep, setCurrentStep] = React.useState<string>("install-app");
  const [isFinished, setIsFinished] = React.useState<boolean>(false);
  const [showUninstallConfirm, setShowUninstallConfirm] = React.useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = React.useState<boolean>(false);

  useEffect(() => {
    if (isProjectAccountConnected) {
      props.onConnected();
    } else {
      props.onDisconnected();
    }
  }, [isProjectAccountConnected, props]);

  const loadItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setError(null);
      setIsLoading(true);

      // check if the project is already connected with slack.
      const projectAuth: ListResult<WorkspaceProjectAuthToken> =
        await ModelAPI.getList<WorkspaceProjectAuthToken>({
          modelType: WorkspaceProjectAuthToken,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            workspaceType: WorkspaceType.Slack,
          },
          select: {
            _id: true,
            miscData: true,
          },
          limit: 1,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      if (projectAuth.data.length > 0) {
        setIsProjectAccountConnected(true);
        const slackTeamName: string | undefined = (
          projectAuth.data[0]!.miscData! as SlackMiscData
        ).teamName;
        setWorkspaceProjectAuthTokenId(projectAuth.data[0]!.id);
        setSlackTeamName(slackTeamName || null);
      }

      // fetch user auth token.

      const userAuth: ListResult<WorkspaceUserAuthToken> =
        await ModelAPI.getList<WorkspaceUserAuthToken>({
          modelType: WorkspaceUserAuthToken,
          query: {
            userId: UserUtil.getUserId()!,
            workspaceType: WorkspaceType.Slack,
          },
          select: {
            _id: true,
          },
          limit: 1,
          skip: 0,
          sort: {
            createdAt: SortOrder.Descending,
          },
        });

      if (userAuth.data.length > 0) {
        setIsUserAccountConnected(true);
        setWorkspaceUserAuthTokenId(userAuth.data[0]!.id);
      }

  if (!isUserAccountConnected || !isProjectAccountConnected) {
        // if any of this is not connected then fetch the app manifest, so we can connect with slack.

        // fetch app manifest.
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get<JSONObject>(
            URL.fromString(`${HOME_URL.toString()}/api/slack/app-manifest`),
          );

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setManifest(response.data);
      }
    } catch (error) {
      setError(<div>{API.getFriendlyErrorMessage(error as Error)}</div>);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // if this page has aqueryn param with error, then there was the error in authentication.
    const error: string | null = Navigation.getQueryStringByName("error");

    if (error) {
      setError(
        <div>
          There was an error while connecting with Slack. Please try again.
        </div>,
      );
      return;
    }

    loadItems().catch((error: Exception) => {
      setError(<div>{API.getFriendlyErrorMessage(error)}</div>);
    });
  }, []);

  const connectWithSlack: VoidFunction = (): void => {
    if (SlackAppClientId) {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      const userId: ObjectID | null = UserUtil.getUserId();

      if (!projectId) {
        setError(
          <div>
            Looks like you have not selected any project. Please select a
            project to continue.
          </div>,
        );
        return;
      }

      if (!userId) {
        setError(
          <div>
            Looks like you are not logged in. Please login to continue.
          </div>,
        );
        return;
      }

      const userScopes: Array<string> = [];

      if (
        manifest &&
        manifest["oauth_config"] &&
        ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject) &&
        ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)[
          "user"
        ] &&
        (
          ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)[
            "user"
          ] as Array<string>
        ).length > 0
      ) {
        userScopes.push(
          ...((
            (manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject
          )["user"] as Array<string>),
        );
      }

      const botScopes: Array<string> = [];

      if (
        manifest &&
        manifest["oauth_config"] &&
        ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject) &&
        ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)[
          "bot"
        ] &&
        (
          ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)[
            "bot"
          ] as Array<string>
        ).length > 0
      ) {
        botScopes.push(
          ...((
            (manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject
          )["bot"] as Array<string>),
        );
      }

      // if any of the user or bot scopes length = = then error.
      if (userScopes.length === 0 || botScopes.length === 0) {
        setError(
          <div>
            Looks like the Slack App scopes are not set properly. For more
            information, please check this guide to set up Slack App properly:{" "}
            <Link
              to={new Route("/docs/self-hosted/slack-integration")}
              openInNewTab={true}
            >
              Slack Integration
            </Link>
          </div>,
        );
        return;
      }

      const project_install_redirect_uri: string = `${APP_API_URL}/slack/auth/${projectId.toString()}/${userId.toString()}`;
      const user_signin_redirect_uri: string = `${APP_API_URL}/slack/auth/${projectId.toString()}/${userId.toString()}/user`;

      if (!isProjectAccountConnected) {
        Navigation.navigate(
          URL.fromString(
            `https://slack.com/oauth/v2/authorize?scope=${botScopes.join(
              ",",
            )}&user_scope=${userScopes.join(
              ",",
            )}&client_id=${SlackAppClientId}&redirect_uri=${project_install_redirect_uri}`,
          ),
        );
      } else {
        // if project account is not connected then we just need to sign in with slack and not install the app.
        Navigation.navigate(
          URL.fromString(
            `https://slack.com/openid/connect/authorize?response_type=code&scope=openid%20profile%20email&client_id=${SlackAppClientId}&redirect_uri=${user_signin_redirect_uri}`,
          ),
        );
      }
    } else {
      setError(
        <div>
          Looks like the Slack App Client ID is not set in the environment
          variables when you installed OneUptime. For more information, please
          check this guide to set up Slack App properly:{" "}
          <Link
            to={new Route("/docs/self-hosted/slack-integration")}
            openInNewTab={true}
          >
            Slack Integration
          </Link>
        </div>,
      );
    }
  };

  // Steps definition (no team selection step for Slack)
  const integrationSteps: Array<FormStep<FormValues<unknown>>> = [
    { id: 'install-app', title: 'Step 1: Install & Authorize Workspace' },
    { id: 'user-account', title: 'Step 2: Connect User Account' },
    { id: 'finish', title: 'Step 3: Finish' },
  ];

  const getCurrentStep = (): string => {
    if (!isProjectAccountConnected) { return 'install-app'; }
    if (!isUserAccountConnected) { return 'user-account'; }
    if (isFinished) { return 'finish'; }
    return 'user-account';
  };

  useEffect(() => {
    setCurrentStep(getCurrentStep());
  }, [isProjectAccountConnected, isUserAccountConnected, isFinished]);

  // Auto-finish if both tokens present on load (refresh persistence)
  useEffect(() => {
    if (!isFinished && isProjectAccountConnected && isUserAccountConnected) {
      setIsFinished(true);
      setCurrentStep('finish');
    }
  }, [isFinished, isProjectAccountConnected, isUserAccountConnected]);

  const logoutUser = async (): Promise<void> => {
    if (!userAuthTokenId) { return; }
    try {
      setIsActionLoading(true);
      await ModelAPI.deleteItem({ modelType: WorkspaceUserAuthToken, id: userAuthTokenId });
      setIsUserAccountConnected(false);
      setWorkspaceUserAuthTokenId(null);
      setIsFinished(false);
      setCurrentStep('user-account');
    } catch (err) {
      setError(<div>{API.getFriendlyErrorMessage(err as Exception)}</div>);
    } finally {
      setIsActionLoading(false);
    }
  };

  const uninstallIntegration = async (): Promise<void> => {
    try {
      setIsActionLoading(true);
      // Delete user token first (ignore errors)
      if (userAuthTokenId) {
        try { await ModelAPI.deleteItem({ modelType: WorkspaceUserAuthToken, id: userAuthTokenId }); } catch { /* ignore */ }
        setWorkspaceUserAuthTokenId(null);
        setIsUserAccountConnected(false);
      }
      if (projectAuthTokenId) {
        try { await ModelAPI.deleteItem({ modelType: WorkspaceProjectAuthToken, id: projectAuthTokenId }); } catch { /* ignore */ }
        setWorkspaceProjectAuthTokenId(null);
        setIsProjectAccountConnected(false);
      }
      setIsFinished(false);
      setCurrentStep('install-app');
    } catch (err) {
      setError(<div>{API.getFriendlyErrorMessage(err as Exception)}</div>);
    } finally {
      setIsActionLoading(false);
    }
  };

  if (!SlackAppClientId) {
    return <SlackIntegrationDocumentation manifest={manifest as JSONObject} />;
  }

  if (isLoading) { return <PageLoader isVisible={true} />; }
  if (error) { return <ErrorMessage message={error} />; }

  // Finished management card
  if (isFinished && isProjectAccountConnected && isUserAccountConnected) {
    return (
      <Fragment>
        <div className="w-full">
          <Card
            title={`Slack Integration Active (${slackTeamName || 'Workspace'})`}
            description="Manage or uninstall your Slack integration."
          >
            <div className="space-y-6">
              <div className="border rounded-md p-4 bg-gray-50">
                <h4 className="text-sm font-medium text-gray-800 mb-2">User Session</h4>
                <p className="text-xs text-gray-600 mb-3">Log out your personal Slack user. Workspace installation remains until you uninstall.</p>
                <Button
                  title="Log Out of Slack"
                  className="-ml-3"
                  buttonStyle={SharedButtonStyleType.NORMAL}
                  icon={IconProp.Logout}
                  onClick={() => { void logoutUser(); }}
                  isLoading={isActionLoading}
                  disabled={isActionLoading}
                />
              </div>
              <div className="border rounded-md p-4 bg-red-50">
                <h4 className="text-sm font-medium text-red-800 mb-2">Uninstall Slack App</h4>
                <p className="text-xs text-red-700 mb-3">Removes stored tokens in OneUptime. (Remove the app in Slack admin to fully revoke.)</p>
                <Button
                 className="-ml-3"
                  title="Uninstall Integration"
                  buttonStyle={SharedButtonStyleType.DANGER}
                  icon={IconProp.Trash}
                  onClick={() => setShowUninstallConfirm(true)}
                  isLoading={isActionLoading}
                  disabled={isActionLoading}
                />
              </div>
            </div>
          </Card>
        </div>
        {showUninstallConfirm && (
          <ConfirmModal
            title="Uninstall Slack Integration"
            description={<div className="space-y-3 text-sm"><p>This will delete both workspace-level and user-level Slack tokens stored in OneUptime.</p><p className="text-red-600 font-medium">This action cannot be undone here.</p><p className="text-xs text-gray-500">To fully revoke in Slack, remove the installed app from your Slack admin dashboard after uninstalling.</p></div>}
            submitButtonText="Uninstall"
            submitButtonType={SharedButtonStyleType.DANGER}
            onSubmit={async () => { await uninstallIntegration(); setShowUninstallConfirm(false); }}
            onClose={() => setShowUninstallConfirm(false)}
            disableSubmitButton={isActionLoading}
            isLoading={isActionLoading}
          />
        )}
      </Fragment>
    );
  }

  const renderStepContent = (): ReactElement => {
    switch (currentStep) {
      case 'install-app':
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">Step 1: Install & Authorize Slack App</h3>
              <p className="mt-2 text-sm text-gray-600">Install OneUptime in your Slack workspace to enable incident notifications and commands.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
               className="-ml-3"
                title={isProjectAccountConnected ? 'Workspace Connected' : 'Install Slack App'}
                icon={IconProp.Slack}
                onClick={() => connectWithSlack()}
                disabled={isProjectAccountConnected}
                buttonStyle={isProjectAccountConnected ? SharedButtonStyleType.SUCCESS : SharedButtonStyleType.PRIMARY}
              />
            </div>
          </div>
        );
      case 'user-account':
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">Step 2: Connect Your Slack User</h3>
              <p className="mt-2 text-sm text-gray-600">Authorize your personal user so OneUptime can attribute actions and send you direct messages where applicable.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
               className="-ml-3"
                title={isUserAccountConnected ? 'User Connected' : 'Connect User'}
                icon={isUserAccountConnected ? IconProp.Check : IconProp.User}
                onClick={() => connectWithSlack()}
                disabled={isUserAccountConnected || !isProjectAccountConnected}
                buttonStyle={isUserAccountConnected ? SharedButtonStyleType.SUCCESS : SharedButtonStyleType.PRIMARY}
              />
              {isUserAccountConnected && (
                <Button
                  title="Log Out User"
                  icon={IconProp.Logout}
                  buttonStyle={SharedButtonStyleType.OUTLINE}
                  onClick={() => { void logoutUser(); }}
                  disabled={isActionLoading}
                  isLoading={isActionLoading}
                />
              )}
              {isProjectAccountConnected && isUserAccountConnected && !isFinished && (
                <Button
                  title="Finish"
                  icon={IconProp.Check}
                  buttonStyle={SharedButtonStyleType.SUCCESS}
                  onClick={() => { setIsFinished(true); setCurrentStep('finish'); }}
                />
              )}
            </div>
          </div>
        );
      case 'finish':
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-medium text-gray-900">Setup Complete</h3>
              <p className="mt-2 text-sm text-gray-600">Slack integration is fully configured for workspace <strong>{slackTeamName || 'your Slack Workspace'}</strong>. You can now receive notifications and use Slack commands.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
               className="-ml-3"
                title="Manage Integration"
                icon={IconProp.Settings}
                buttonStyle={SharedButtonStyleType.OUTLINE}
                onClick={() => { setCurrentStep('user-account'); setIsFinished(false); }}
              />
              <Button
                title="Uninstall"
                icon={IconProp.Trash}
                buttonStyle={SharedButtonStyleType.DANGER_OUTLINE}
                onClick={() => setShowUninstallConfirm(true)}
              />
            </div>
          </div>
        );
      default:
        return <div>Unknown step</div>;
    }
  };

  return (
    <Fragment>
      <div className="w-full">
        <Card
          title="Slack Integration Setup"
          description="Follow these steps to connect your Slack workspace with OneUptime."
        >
          <div className="lg:grid lg:grid-cols-12 lg:gap-x-8">
            <aside className="lg:col-span-4 mb-8 lg:mb-0">
              <div className="bg-gray-50 rounded-lg p-6 ring ring-1 ring-gray-200">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Setup Progress</h3>
                <Steps
                  steps={integrationSteps}
                  currentFormStepId={currentStep}
                  onClick={(step: FormStep<FormValues<unknown>>) => {
                    const targetIndex = integrationSteps.findIndex(s => s.id === step.id);
                    const currentIndex = integrationSteps.findIndex(s => s.id === currentStep);
                    if (targetIndex <= currentIndex) { setCurrentStep(step.id); }
                  }}
                  formValues={{} as FormValues<unknown>}
                />
              </div>
            </aside>
            <div className="lg:col-span-8">
              {renderStepContent()}
            </div>
          </div>
        </Card>
      </div>
        {showUninstallConfirm && (
          <ConfirmModal
            title="Uninstall Slack Integration"
            description={<div className="space-y-3 text-sm"><p>This will delete both workspace-level and user-level Slack tokens stored in OneUptime.</p><p className="text-red-600 font-medium">This action cannot be undone here.</p><p className="text-xs text-gray-500">To fully revoke in Slack, remove the installed app from your Slack admin dashboard after uninstalling.</p></div>}
            submitButtonText="Uninstall"
            submitButtonType={SharedButtonStyleType.DANGER}
            onSubmit={async () => { await uninstallIntegration(); setShowUninstallConfirm(false); }}
            onClose={() => setShowUninstallConfirm(false)}
            disableSubmitButton={isActionLoading}
            isLoading={isActionLoading}
          />
        )}
    </Fragment>
  );
};

export default SlackIntegration;
