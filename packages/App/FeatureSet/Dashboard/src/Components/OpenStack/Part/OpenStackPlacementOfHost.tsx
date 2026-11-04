import ObjectID from "Common/Types/ObjectID";
import { OpenStackPlacement } from "Common/Types/OpenStack/OpenStackLinks";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";
import {
  OpenStackServicePlacement,
  fetchOpenStackPlacementOfHost,
  fetchOpenStackPlacementOfKubernetesNode,
  fetchOpenStackPlacementsOfService,
} from "../../../Pages/OpenStack/Utils/OpenStackUsageReads";
import OpenStackPlacementCard from "./OpenStackPlacementCard";
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
  const read: OpenStackRead<OpenStackPlacement | null> = useOpenStackRead(
    () => {
      return fetchOpenStackPlacementOfHost(props.hostId);
    },
    [props.hostId.toString()],
  );
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
  const read: OpenStackRead<OpenStackPlacement | null> = useOpenStackRead(
    () => {
      return fetchOpenStackPlacementOfKubernetesNode({
        clusterId: props.clusterId,
        nodeName: props.nodeName,
      });
    },
    [props.clusterId.toString(), props.nodeName],
  );
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

export const OpenStackPlacementOfService: FunctionComponent<{
  serviceId: ObjectID;
}> = (props: { serviceId: ObjectID }): ReactElement => {
  const read: OpenStackRead<Array<OpenStackServicePlacement>> =
    useOpenStackRead(() => {
      return fetchOpenStackPlacementsOfService(props.serviceId);
    }, [props.serviceId.toString()]);
  const placements: Array<OpenStackServicePlacement> = read.data || [];
  return (
    <>
      {placements.slice(0, 3).map(
        (one: OpenStackServicePlacement): ReactElement => {
          return (
            <OpenStackPlacementCard
              key={one.hostName}
              testId="service-openstack-placement"
              title={TITLE}
              description={translationKey(
                "Where this service runs, from the host its telemetry names. A slow service on a busy hypervisor is often not the service's fault.",
              )}
              placement={one.placement}
            />
          );
        },
      )}
    </>
  );
};
