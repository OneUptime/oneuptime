import PageComponentProps from "../PageComponentProps";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MobileApps: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <Fragment>
      <Card
        title="OneUptime On-Call - iOS"
        description="Download the OneUptime On-Call app for iOS to receive push notifications and manage on-call schedules from your iPhone or iPad."
        buttons={[
          {
            title: "Download on the App Store",
            icon: IconProp.Download,
            onClick: () => {
              window.open(
                "https://apps.apple.com/us/app/oneuptime-on-call/id6759615391",
                "_blank",
              );
            },
          },
        ]}
      />

      <Card
        title="OneUptime On-Call - Android"
        description="Download the OneUptime On-Call app for Android to receive push notifications and manage on-call schedules from your Android device."
        buttons={[
          {
            title: "Download on Google Play",
            icon: IconProp.Download,
            onClick: () => {
              window.open(
                "https://play.google.com/store/apps/details?id=com.oneuptime.oncall",
                "_blank",
              );
            },
          },
          {
            title: "Download APK",
            icon: IconProp.Download,
            onClick: () => {
              window.open(
                "https://github.com/OneUptime/oneuptime/releases/latest/download/oneuptime-on-call-android-app.apk",
                "_blank",
              );
            },
          },
        ]}
      />
    </Fragment>
  );
};

export default MobileApps;
