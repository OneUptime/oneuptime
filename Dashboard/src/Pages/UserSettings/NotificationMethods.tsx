import UserCall from "../../Components/NotificationMethods/Call";
import UserEmail from "../../Components/NotificationMethods/Email";
import UserSMS from "../../Components/NotificationMethods/SMS";
import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <UserEmail />
      <UserSMS />
      <UserCall />
    </Fragment>
  );
};

export default Settings;
