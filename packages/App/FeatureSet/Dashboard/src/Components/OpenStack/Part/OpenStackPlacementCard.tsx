import ObjectID from "Common/Types/ObjectID";
import { OpenStackPlacement } from "Common/Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
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

export const OpenStackPlacementLines: FunctionComponent<{
  placement: OpenStackPlacement;
}> = (props: { placement: OpenStackPlacement }): ReactElement => {
  const translator: Translator = useTranslator();
  const { placement } = props;
  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(
    new ObjectID(placement.openStackCloudId),
  );

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
        <span className="text-gray-500">{translator.translateText(label)}</span>
        <span className="min-w-0">{value}</span>
      </div>
    );
  };

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
