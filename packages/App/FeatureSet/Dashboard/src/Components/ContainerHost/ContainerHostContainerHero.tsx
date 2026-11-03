import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ResourcePartHero from "../ResourcePart/ResourcePartHero";
import {
  ResourcePartChip,
  ResourcePartStatus,
} from "../ResourcePart/ResourcePartTypes";
import {
  ContainerHostAssessment,
  ContainerHostContainer,
  assessContainer,
  getContainerComposeProject,
  getContainerComposeService,
} from "./ContainerHostHealth";

/*
 * The top of a Docker or Podman container's page, above its tabs: its name,
 * its state by the host's rules (ContainerHostHealth) - Running, Restart
 * loop, Stopped reporting, Not reporting - the host it runs on (a link),
 * when it last reported once it stopped, and the image and the Compose
 * project and service it runs as.
 */

export const CONTAINER_HOST_CONTAINER_HERO_TEST_ID: string =
  "container-host-container-hero";

const LINK_CLASS_NAME: string =
  "text-indigo-600 hover:text-indigo-700 hover:underline";

export interface ComponentProps {
  containerName: string;
  // Null while the container is unknown: nothing reported it yet.
  container: ContainerHostContainer | null;
  hostLatestReadingAt: Date | null;
  hostName: string;
  hostRoute: Route;
}

const ContainerHostContainerHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const container: ContainerHostContainer | null = props.container;

  const assessment: ContainerHostAssessment | null = container
    ? assessContainer(container, props.hostLatestReadingAt)
    : null;
  const status: ResourcePartStatus | undefined = assessment
    ? assessment.status
    : undefined;
  const isQuiet: boolean = Boolean(
    assessment &&
      (assessment.state === "stopped" || assessment.state === "not-reporting"),
  );

  const chips: Array<ResourcePartChip> = [];

  if (container?.image) {
    chips.push({
      key: "image",
      icon: IconProp.Layers,
      label: container.image,
    });
  }

  const composeProject: string = container
    ? getContainerComposeProject(container)
    : "";
  const composeService: string = container
    ? getContainerComposeService(container)
    : "";

  if (composeProject) {
    chips.push({
      key: "compose",
      icon: IconProp.Square2Stack,
      label: composeService
        ? `${composeProject} / ${composeService}`
        : composeProject,
    });
  }

  return (
    <ResourcePartHero
      testId={CONTAINER_HOST_CONTAINER_HERO_TEST_ID}
      icon={IconProp.Cube}
      accent="sky"
      name={props.containerName}
      status={status}
      location={
        <TranslatedSentence
          template="Container on {{host}}"
          slots={{
            host: (
              <Link to={props.hostRoute} className={LINK_CLASS_NAME}>
                <bdi>{props.hostName}</bdi>
              </Link>
            ),
          }}
        />
      }
      lastReportAt={isQuiet ? container?.lastReadingAt : undefined}
      chips={chips}
    />
  );
};

export default ContainerHostContainerHero;
