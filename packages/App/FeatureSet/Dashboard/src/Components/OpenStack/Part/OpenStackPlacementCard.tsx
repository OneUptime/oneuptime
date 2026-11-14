import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackContainerClusterLink,
  OpenStackPlacement,
} from "Common/Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import {
  toLabelTerm,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { getOpenStackHostGroupId } from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "./OpenStackPartRoutes";

/*
 * Where something in another product runs on OpenStack, for its own page: a host, a Kubernetes
 * node or a service. Says nothing at all when it runs on no cloud, because most things don't.
 */

const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

function usePlacementRow(): (
  label: string,
  value: ReactElement,
  testId: string,
) => ReactElement {
  const translator: Translator = useTranslator();
  const row: (
    label: string,
    value: ReactElement,
    testId: string,
  ) => ReactElement = (
    label: string,
    value: ReactElement,
    testId: string,
  ): ReactElement => {
    return (
      <div
        key={testId}
        className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm"
        data-testid={testId}
      >
        {/*
         * A label: "OpenStack cloud" is worded for the middle of a sentence
         * in some languages ("nube OpenStack"), and starts with a capital
         * here.
         */}
        <span className="text-gray-500">
          {toLabelTerm(
            translator.translateText(label) || label,
            translator.language,
          )}
        </span>
        <span className="min-w-0">{value}</span>
      </div>
    );
  };
  return row;
}

// The Magnum cluster a Kubernetes cluster is, for that cluster's own page.
export const OpenStackMagnumClusterLines: FunctionComponent<{
  link: OpenStackContainerClusterLink;
}> = (props: { link: OpenStackContainerClusterLink }): ReactElement => {
  const { link } = props;
  const row: ReturnType<typeof usePlacementRow> = usePlacementRow();
  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(
    new ObjectID(link.openStackCloudId),
  );
  return (
    <div>
      {row(
        translationKey("OpenStack cloud"),
        <Link to={routes.cloudRoute} className={LINK_CLASS_NAME}>
          <bdi>{link.cloudName || link.openStackCloudId}</bdi>
        </Link>,
        "openstack-placement-cloud",
      )}
      {row(
        translationKey("Magnum cluster"),
        <Link
          to={routes.getPartRoute(
            OpenStackResourceKind.ContainerCluster,
            link.externalId,
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{link.name || link.externalId}</bdi>
        </Link>,
        "openstack-placement-magnum-cluster",
      )}
      {link.status ? (
        row(
          translationKey("Status"),
          <bdi>{link.status}</bdi>,
          "openstack-placement-magnum-status",
        )
      ) : (
        <></>
      )}
    </div>
  );
};

export const OpenStackPlacementLines: FunctionComponent<{
  placement: OpenStackPlacement;
}> = (props: { placement: OpenStackPlacement }): ReactElement => {
  const { placement } = props;
  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(
    new ObjectID(placement.openStackCloudId),
  );
  const row: ReturnType<typeof usePlacementRow> = usePlacementRow();

  const lines: Array<ReactElement> = [
    row(
      translationKey("OpenStack cloud"),
      <Link to={routes.cloudRoute} className={LINK_CLASS_NAME}>
        <bdi>{placement.cloudName || placement.openStackCloudId}</bdi>
      </Link>,
      "openstack-placement-cloud",
    ),
  ];
  if (placement.kind === "instance") {
    lines.push(
      row(
        translationKey("Instance"),
        <Link
          to={routes.getPartRoute(
            OpenStackResourceKind.Instance,
            placement.externalId,
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{placement.name || placement.externalId}</bdi>
        </Link>,
        "openstack-placement-instance",
      ),
    );
  }
  if (placement.hypervisorName) {
    lines.push(
      row(
        translationKey("Hypervisor"),
        <Link
          to={routes.getHypervisorRoute(
            placement.regionName,
            placement.hypervisorName,
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{placement.hypervisorName}</bdi>
        </Link>,
        "openstack-placement-hypervisor",
      ),
    );
  }
  if (placement.availabilityZone) {
    lines.push(
      row(
        translationKey("Availability Zone"),
        <Link
          to={routes.getZoneRoute(
            getOpenStackHostGroupId(
              placement.regionName,
              placement.availabilityZone,
            ),
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{placement.availabilityZone}</bdi>
        </Link>,
        "openstack-placement-zone",
      ),
    );
  }
  if (placement.openStackProjectId) {
    lines.push(
      row(
        translationKey("Project"),
        <Link
          to={routes.getPartRoute(
            OpenStackResourceKind.Project,
            placement.openStackProjectId,
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>
            {placement.openStackProjectName || placement.openStackProjectId}
          </bdi>
        </Link>,
        "openstack-placement-project",
      ),
    );
  }

  return <div>{lines}</div>;
};

// One of several places a thing runs: which instance, on which hypervisor, in which zone.
export const OpenStackPlacementRow: FunctionComponent<{
  placement: OpenStackPlacement;
}> = (props: { placement: OpenStackPlacement }): ReactElement => {
  const { placement } = props;
  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(
    new ObjectID(placement.openStackCloudId),
  );
  return (
    <li
      data-testid="openstack-placement-row"
      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
    >
      {placement.kind === "instance" ? (
        <Link
          to={routes.getPartRoute(
            OpenStackResourceKind.Instance,
            placement.externalId,
          )}
          className={LINK_CLASS_NAME}
        >
          <bdi>{placement.name || placement.externalId}</bdi>
        </Link>
      ) : (
        <></>
      )}
      <span className="flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
        {placement.hypervisorName ? (
          <Link
            to={routes.getHypervisorRoute(
              placement.regionName,
              placement.hypervisorName,
            )}
            className={LINK_CLASS_NAME}
          >
            <bdi>{placement.hypervisorName}</bdi>
          </Link>
        ) : (
          <></>
        )}
        {placement.availabilityZone ? (
          <bdi>{placement.availabilityZone}</bdi>
        ) : (
          <></>
        )}
      </span>
    </li>
  );
};

const OpenStackPlacementCard: FunctionComponent<{
  testId: string;
  title: string;
  description: string;
  placement: OpenStackPlacement | null;
}> = (props: {
  testId: string;
  title: string;
  description: string;
  placement: OpenStackPlacement | null;
}): ReactElement => {
  if (!props.placement) {
    return <></>;
  }
  return (
    <div className="mb-6" data-testid={props.testId}>
      <Card title={props.title} description={props.description}>
        <OpenStackPlacementLines placement={props.placement} />
      </Card>
    </div>
  );
};

export default OpenStackPlacementCard;
