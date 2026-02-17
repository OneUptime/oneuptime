import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";

const CalendarConnections: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <>
      <Card
        title="Google Calendar"
        description="Connect your Google Calendar to automatically sync on-call schedules, scheduled maintenance windows, and other events from OneUptime to your personal calendar."
        buttons={[
          {
            title: "Connect",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Calendar,
            disabled: true,
            onClick: () => {},
          },
        ]}
      />
      <Card
        title="Microsoft Outlook Calendar"
        description="Connect your Microsoft Outlook Calendar to automatically sync on-call schedules, scheduled maintenance windows, and other events from OneUptime to your personal calendar."
        buttons={[
          {
            title: "Connect",
            buttonStyle: ButtonStyleType.PRIMARY,
            icon: IconProp.Calendar,
            disabled: true,
            onClick: () => {},
          },
        ]}
      />
    </>
  );
};

export default CalendarConnections;
