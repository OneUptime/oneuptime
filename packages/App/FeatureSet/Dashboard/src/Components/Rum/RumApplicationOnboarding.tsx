import React, { ReactElement } from "react";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import RumDocumentationCard from "./RumDocumentationCard";
import PageMap from "../../Utils/PageMap";

/*
 * The name the guide starts with, for a browser app or a mobile one alike
 * (the guide's own examples name a storefront).
 */
export const RUM_EXAMPLE_APP_NAME: string = "my-app";

/*
 * Adding a RUM application: name it, pick a browser or a mobile app and a
 * key, add the snippet, and the guide's last step says when its first
 * session arrived. The application registers itself under that name, its
 * service.name (findOrCreateByAppIdentifier).
 */
const RUM_APPLICATION_ONBOARDING: ResourceOnboarding = {
  modelType: RumApplication,
  addTitle: translationKey("Add RUM Application"),
  addDescription: translationKey(
    "Add the OpenTelemetry snippet to your web or mobile app. It shows up here as soon as its first data arrives.",
  ),
  firstRunTitle: translationKey("Add your first application"),
  viewText: translationKey("View application"),
  viewPage: PageMap.RUM_APPLICATION_VIEW,
  name: {
    label: translationKey("App name"),
    field: "appIdentifier",
    example: RUM_EXAMPLE_APP_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <RumDocumentationCard
        title={props.title}
        description={props.description}
        appName={props.name}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default RUM_APPLICATION_ONBOARDING;
