import React, { ReactElement } from "react";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import ServerlessDocumentationCard from "./ServerlessDocumentationCard";
import PageMap from "../../Utils/PageMap";

/*
 * Adding a serverless function: pick where it runs and a key, instrument
 * it, and the guide's last step says when its first data arrived. A
 * function names itself (faas.name), so the guide asks for no name.
 */
const SERVERLESS_FUNCTION_ONBOARDING: ResourceOnboarding = {
  modelType: ServerlessFunction,
  addTitle: translationKey("Add Serverless Function"),
  addDescription: translationKey(
    "Instrument the function with OpenTelemetry. It shows up here as soon as its first data arrives.",
  ),
  viewText: translationKey("View function"),
  viewPage: PageMap.SERVERLESS_FUNCTION_VIEW,
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <ServerlessDocumentationCard
        title={props.title}
        description={props.description}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default SERVERLESS_FUNCTION_ONBOARDING;
