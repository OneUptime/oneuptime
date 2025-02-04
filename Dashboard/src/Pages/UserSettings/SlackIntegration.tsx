
import PageComponentProps from "../PageComponentProps";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

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
              // redirect to slack oauth workflow. 
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
