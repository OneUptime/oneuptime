import React, { ReactElement } from "react";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceGuideProps,
  ResourceOnboarding,
} from "../ResourceOnboarding/AddResourceGuide";
import DockerSwarmDocumentationCard from "./DocumentationCard";
import PageMap from "../../Utils/PageMap";
import { DOCKER_SWARM_EXAMPLE_CLUSTER_NAME } from "../../Pages/DockerSwarm/Utils/DocumentationMarkdown";

/*
 * Adding a Docker Swarm cluster: name it, pick how the agent is deployed
 * and a key, deploy it, and the guide's last step says when it connected.
 * The cluster registers itself under that name (findOrCreateByName).
 */
const DOCKER_SWARM_CLUSTER_ONBOARDING: ResourceOnboarding = {
  modelType: DockerSwarmCluster,
  addTitle: translationKey("Add Docker Swarm Cluster"),
  addDescription: translationKey(
    "Deploy the OneUptime agent to the swarm. The cluster shows up here as soon as the agent connects.",
  ),
  firstRunTitle: translationKey("Getting Started with Docker Swarm Monitoring"),
  viewText: translationKey("View cluster"),
  viewPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW,
  name: {
    label: translationKey("Cluster name"),
    field: "name",
    example: DOCKER_SWARM_EXAMPLE_CLUSTER_NAME,
  },
  renderGuide: (props: ResourceGuideProps): ReactElement => {
    return (
      <DockerSwarmDocumentationCard
        title={props.title}
        description={props.description}
        clusterName={props.name}
        isBare={props.isBare}
        inputs={props.inputs}
        lastStep={props.lastStep}
      />
    );
  },
};

export default DOCKER_SWARM_CLUSTER_ONBOARDING;
