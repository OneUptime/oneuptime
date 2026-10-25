import React, { ReactElement } from "react";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import StorageArrayDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { STORAGE_ARRAY_EXAMPLE_NAME } from "../../Pages/StorageArray/Utils/DocumentationMarkdown";

/*
 * Adding a storage array: name it, pick its platform and a key, start the
 * agent, and the guide's last step says when it connected. The array
 * registers itself under that name (findOrCreateByName).
 */
const STORAGE_ARRAY_ONBOARDING: ResourceOnboarding = {
  modelType: StorageArray,
  addTitle: translationKey("Add Storage Array"),
  addDescription: translationKey(
    "Point the OneUptime Storage Array Agent at the array. The array shows up here as soon as the agent connects.",
  ),
  firstRunTitle: translationKey("Add your first storage array"),
  viewText: translationKey("View array"),
  viewPage: PageMap.STORAGE_ARRAY_VIEW,
  name: {
    label: translationKey("Array name"),
    field: "name",
    example: STORAGE_ARRAY_EXAMPLE_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <StorageArrayDocumentationCard
        title={props.title}
        description={props.description}
        arrayName={props.name}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default STORAGE_ARRAY_ONBOARDING;
