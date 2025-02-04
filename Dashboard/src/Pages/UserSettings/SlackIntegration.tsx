
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

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {

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
             Navigation.navigate(URL.fromString("https://slack.com/oauth/v2/authorize?scope=incoming-webhook&client_id=7205733110631.8419643257392&redirect_uri=https://google.com"))
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
