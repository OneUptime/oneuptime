import React, { ReactElement } from "react";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import DockerDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { DOCKER_EXAMPLE_HOST_NAME } from "../../Pages/Docker/Utils/DocumentationMarkdown";

/*
 * Adding a Docker host: name it, pick how the agent runs and a key, start
 * the agent, and the guide's last step says when it connected. The host
 * registers itself under that name (findOrCreateByHostIdentifier).
 */
const DOCKER_HOST_ONBOARDING: ResourceOnboarding = {
  modelType: DockerHost,
  addTitle: translationKey("Add Docker Host"),
  addDescription: translationKey(
    "Run the OneUptime Docker agent on the host. The host shows up here as soon as the agent connects.",
  ),
  firstRunTitle: translationKey("Getting Started with Docker Monitoring"),
  viewText: translationKey("View host"),
  viewPage: PageMap.DOCKER_HOST_VIEW,
  name: {
    label: translationKey("Host name"),
    field: "hostIdentifier",
    example: DOCKER_EXAMPLE_HOST_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <DockerDocumentationCard
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

export default DOCKER_HOST_ONBOARDING;
