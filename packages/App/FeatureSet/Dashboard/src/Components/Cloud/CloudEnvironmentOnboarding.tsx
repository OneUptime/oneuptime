import React, { ReactElement } from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Query from "Common/Types/BaseDatabase/Query";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import CloudDocumentationCard from "./CloudDocumentationCard";
import PageMap from "../../Utils/PageMap";

/*
 * Adding a cloud environment: pick where the app runs and a key, point its
 * OpenTelemetry at OneUptime with a cloud resource detector, and the
 * guide's last step says when the environment's first data arrived. An
 * environment is named by its platform, account and region, which the
 * detector reports, so the guide asks for no name.
 */
const CLOUD_ENVIRONMENT_ONBOARDING: ResourceOnboarding = {
  modelType: CloudResource,
  addTitle: translationKey("Add Cloud Environment"),
  addDescription: translationKey(
    "Point your app's OpenTelemetry at OneUptime with a cloud resource detector. The environment shows up here as soon as its first data arrives.",
  ),
  firstRunTitle: translationKey("Add your first cloud environment"),
  viewText: translationKey("View environment"),
  viewPage: PageMap.CLOUD_RESOURCE_VIEW,
  // The resources the cloud's monitoring API reports are listed elsewhere.
  query: {
    cloudResourceKind: CloudResourceKind.Environment,
  } as Query<BaseModel>,
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <CloudDocumentationCard
        title={props.title}
        description={props.description}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default CLOUD_ENVIRONMENT_ONBOARDING;
