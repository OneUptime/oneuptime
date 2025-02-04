
import PageComponentProps from "../PageComponentProps";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import URL from "Common/Types/API/URL";
import { SlackAppClientId } from "Common/UI/Config";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {


  const [error, setError] = React.useState<ReactElement | null>(null);


  if(error){
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
              if(SlackAppClientId){
                Navigation.navigate(URL.fromString(`https://slack.com/oauth/v2/authorize?scope=incoming-webhook&client_id=${SlackAppClientId}&redirect_uri=https://google.com`))
              }else{
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
