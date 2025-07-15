import UserCall from "../../Components/NotificationMethods/Call";
import UserEmail from "../../Components/NotificationMethods/Email";
import UserSMS from "../../Components/NotificationMethods/SMS";
import UserPush from "../../Components/NotificationMethods/Push";
import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <UserEmail />
      <UserSMS />
      <UserCall />
      <UserPush />
    </Fragment>
  );
};

export default Settings;
