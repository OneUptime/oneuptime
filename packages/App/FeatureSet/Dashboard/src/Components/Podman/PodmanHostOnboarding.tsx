import React, { ReactElement } from "react";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import PodmanDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { PODMAN_EXAMPLE_HOST_NAME } from "../../Pages/Podman/Utils/DocumentationMarkdown";

/*
 * Adding a Podman host: name it, pick how the agent runs and a key, start
 * the agent, and the guide's last step says when it connected. The host
 * registers itself under that name (findOrCreateByHostIdentifier).
 */
const PODMAN_HOST_ONBOARDING: ResourceOnboarding = {
  modelType: PodmanHost,
  addTitle: translationKey("Add Podman Host"),
  addDescription: translationKey(
    "Run the OneUptime Podman agent on the host. The host shows up here as soon as the agent connects.",
  ),
  viewText: translationKey("View host"),
  viewPage: PageMap.PODMAN_HOST_VIEW,
  name: {
    label: translationKey("Host name"),
    field: "hostIdentifier",
    example: PODMAN_EXAMPLE_HOST_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <PodmanDocumentationCard
        title={props.title}
        description={props.description}
        hostName={props.name}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default PODMAN_HOST_ONBOARDING;
