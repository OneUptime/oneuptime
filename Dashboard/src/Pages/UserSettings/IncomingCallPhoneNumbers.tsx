import IncomingCallNumber from "../../Components/NotificationMethods/IncomingCallNumber";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const IncomingCallPhoneNumbers: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <IncomingCallNumber />;
};

export default IncomingCallPhoneNumbers;
