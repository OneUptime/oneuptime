
import PageComponentProps from "../PageComponentProps";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import { APP_API_URL, HOME_URL, SlackAppClientId } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import PageLoader from "Common/UI/Components/Loader/PageLoader";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {


  const [error, setError] = React.useState<ReactElement | null>(null);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const [manifest, setManifest] = React.useState<JSONObject | null>(null);

  const fetchAppManifest = async () => {
    try {
      setError(null);
      setIsLoading(true);
      const response = await API.get<JSONObject>(URL.fromString("/api/slack/app-manifest"));
      setManifest(response.data);
    } catch (error) {
      setError(
        <div>
          {API.getFriendlyErrorMessage(error as Error)}
        </div>
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAppManifest().catch((error: Exception) => {
      setError(
        <div>
          {API.getFriendlyErrorMessage(error)}
        </div>
      );
    });
  }, []);


  if(isLoading){
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />
  }

  return (
    <Fragment>
      <div>
        <Card
          title={`Connect with Slack`}
          description={`Connect your account with Slack to receive notifications.`}
          buttons={[
            {
              title: `Connect with Slack`,
              buttonStyle: ButtonStyleType.PRIMARY,
              onClick: () => {
                if (SlackAppClientId) {

                  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
                  const userId: ObjectID | null = UserUtil.getUserId();

                  if (!projectId) {
                    setError(
                      <div>
                        Looks like you have not selected any project. Please select a project to continue.
                      </div>);
                    return;
                  }

                  if (!userId) {
                    setError(
                      <div>
                        Looks like you are not logged in. Please login to continue.
                      </div>);
                    return;
                  }


                  const scopes: Array<string> =[]; 

                  if(manifest && manifest["oauth_config"] && ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject) && ((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)["user"] && (((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)["user"] as Array<string>).length > 0){
                    scopes.push(...(((manifest["oauth_config"] as JSONObject)["scopes"] as JSONObject)["user"] as Array<string>));
                  }

                  const redirect_uri: string = `${APP_API_URL}/slack/auth?projectId=${projectId.toString()}&userId=${userId.toString()}`;

                  Navigation.navigate(URL.fromString(`https://slack.com/oauth/v2/authorize?scope=${
                    scopes.join(",")
                  }&client_id=${SlackAppClientId}&redirect_uri=${redirect_uri}`))
                } else {
                  setError(
                    <div>
                      Looks like the Slack App Client ID is not set in the environment variables when you installed OneUptime. For more information, please check this guide to set up Slack App properly: <Link to={new Route("/docs/self-hosted/slack-integration")} openInNewTab={true}>Slack Integration</Link>
                    </div>);
                }
              },
              icon: IconProp.Slack,
            },
          ]}
        />
      </div>
    </Fragment>
  );
};

export default Settings;
