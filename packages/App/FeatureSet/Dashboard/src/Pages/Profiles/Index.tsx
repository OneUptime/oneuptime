import PageComponentProps from "../PageComponentProps";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
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
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  return (
    <Fragment>
      {/* Until the project's first telemetry: what the product does, and its setup guide. */}
      <TelemetryFirstRunShowcase product={ProductKey.Profiles} />
      <ProfilesOverview />
    </Fragment>
  );
};

export default ProfilesPage;
