import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackContainerClusterLink,
  OpenStackPlacement,
  OpenStackServicePlacement,
} from "Common/Types/OpenStack/OpenStackLinks";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  fetchOpenStackMagnumClusterOfKubernetesCluster,
  fetchOpenStackPlacementOfHost,
  fetchOpenStackPlacementOfKubernetesNode,
  fetchOpenStackPlacementsOfService,
} from "../../../Pages/OpenStack/Utils/OpenStackLinkReads";
import OpenStackPlacementCard, {
  OpenStackMagnumClusterLines,
  OpenStackPlacementLines,
  OpenStackPlacementRow,
} from "./OpenStackPlacementCard";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * The one line each other product's page mounts. A read that fails, or a caller who can't read
 * the cloud, leaves the page as it would be for anything that isn't on OpenStack: this is one
 * more thing to know about a host, and never what its page stands on.
 */

const TITLE: string = translationKey("On OpenStack");

export const OpenStackPlacementOfHost: FunctionComponent<{
  hostId: ObjectID;
}> = (props: { hostId: ObjectID }): ReactElement => {
  const read: OpenStackRead<OpenStackPlacement | null> =
    useOpenStackRead(() => {
      return fetchOpenStackPlacementOfHost(props.hostId);
    }, [props.hostId.toString()]);
  return (
    <OpenStackPlacementCard
      testId="host-openstack-placement"
      title={TITLE}
      description={
        read.data?.kind === "hypervisor"
          ? translationKey(
              "This machine is one of an OpenStack cloud's hypervisors, so what runs on it, and who that belongs to, is on its page there.",
            )
          : translationKey(
              "This host is an OpenStack instance. What it is really doing beside what its flavor promises, and which hypervisor it shares, is on its page there.",
            )
      }
      placement={read.data || null}
    />
  );
};

export const OpenStackPlacementOfKubernetesNode: FunctionComponent<{
  clusterId: ObjectID;
  nodeName: string;
}> = (props: { clusterId: ObjectID; nodeName: string }): ReactElement => {
  const read: OpenStackRead<OpenStackPlacement | null> =
    useOpenStackRead(() => {
      return fetchOpenStackPlacementOfKubernetesNode({
        clusterId: props.clusterId,
        nodeName: props.nodeName,
      });
    }, [props.clusterId.toString(), props.nodeName]);
  return (
    <OpenStackPlacementCard
      testId="kubernetes-node-openstack-placement"
      title={TITLE}
      description={translationKey(
        "This node is an OpenStack instance, from its spec.providerID. If this hypervisor fails, this node goes with it.",
      )}
      placement={read.data || null}
    />
  );
};

export const OpenStackPlacementOfKubernetesCluster: FunctionComponent<{
  clusterId: ObjectID;
}> = (props: { clusterId: ObjectID }): ReactElement => {
  const read: OpenStackRead<OpenStackContainerClusterLink | null> =
    useOpenStackRead(() => {
      return fetchOpenStackMagnumClusterOfKubernetesCluster(props.clusterId);
    }, [props.clusterId.toString()]);
  if (!read.data) {
    return <></>;
  }
  return (
    <div className="mb-6" data-testid="kubernetes-cluster-openstack-placement">
      <Card
        title={TITLE}
        description={translationKey(
          "Magnum built this cluster: its nodes' spec.providerID names servers of its Heat stack. Whose it is and what it was built from are on its page there.",
        )}
      >
        <OpenStackMagnumClusterLines link={read.data} />
      </Card>
    </div>
  );
};

/*
 * One card however many places: one place says everything about it, and several say which
 * instance and hypervisor each is, because that is what tells a shared cause from a coincidence.
 */
export const OpenStackPlacementOfService: FunctionComponent<{
  serviceId: ObjectID;
}> = (props: { serviceId: ObjectID }): ReactElement => {
  const listClassName: string = useCardRuledListClassName();
  const read: OpenStackRead<Array<OpenStackServicePlacement>> =
    useOpenStackRead(() => {
      return fetchOpenStackPlacementsOfService(props.serviceId);
    }, [props.serviceId.toString()]);
  const placements: Array<OpenStackServicePlacement> = read.data || [];
  const first: OpenStackServicePlacement | undefined = placements[0];
  if (!first) {
    return <></>;
  }
  return (
    <div className="mb-6" data-testid="service-openstack-placement">
      <Card
        title={TITLE}
        description={translationKey(
          "Where this service runs, from the hosts and Kubernetes nodes its telemetry names. A slow service on a busy hypervisor is often not the service's fault.",
        )}
      >
        {placements.length === 1 ? (
          <OpenStackPlacementLines placement={first.placement} />
        ) : (
          <ul className={listClassName}>
            {placements.map((one: OpenStackServicePlacement): ReactElement => {
              return (
                <OpenStackPlacementRow
                  key={`${one.kubernetesClusterId || "host"}/${one.hostName}`}
                  placement={one.placement}
                />
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};
