import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProfilesOverview from "../../Components/Profiles/ProfilesOverview";
import TelemetryFirstRunShowcase from "../../Components/ProductOnboarding/TelemetryFirstRunShowcase";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const ProfilesPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ResellerPlanNotice project={props.currentProject} product="Profiles" />
    );
  }

  return (
    <Fragment>
      {/*
       * Until the project's first telemetry, while the explorer is empty:
       * what the product does, and its setup guide.
       */}
      <TelemetryFirstRunShowcase product={ProductKey.Profiles}>
        <ProfilesOverview />
      </TelemetryFirstRunShowcase>
    </Fragment>
  );
};

export default ProfilesPage;
