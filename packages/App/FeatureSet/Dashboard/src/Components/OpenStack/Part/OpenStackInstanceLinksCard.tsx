import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackLinkedHost,
  OpenStackLinkedKubernetesNode,
  OpenStackLinkedService,
  OpenStackReachAcrossProducts,
  isOpenStackReachEmpty,
} from "Common/Types/OpenStack/OpenStackLinks";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Link from "Common/UI/Components/Link/Link";
import {
  toLabelTerm,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { getKubernetesPartRoute } from "../../../Pages/Kubernetes/Utils/KubernetesPartRoutes";
import { fetchOpenStackReachOfInstance } from "../../../Pages/OpenStack/Utils/OpenStackLinkReads";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * What in the rest of OneUptime this part of a cloud is: the same list a blast radius names,
 * as links. Shared by an instance's own card and a hypervisor's blast radius, so one word
 * means one thing.
 */

export function getOpenStackHostRoute(hostId: string): Route {
  return RouteUtil.populateRouteParams(RouteMap[PageMap.HOST_VIEW] as Route, {
    modelId: new ObjectID(hostId),
  }) as Route;
}

export function getOpenStackServiceRoute(serviceId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SERVICE_VIEW] as Route,
    {
      modelId: new ObjectID(serviceId),
    },
  ) as Route;
}

export function getOpenStackKubernetesClusterRoute(clusterId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route,
    { modelId: new ObjectID(clusterId) },
  ) as Route;
}

const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";

export const OpenStackReachList: FunctionComponent<{
  testId: string;
  reach: OpenStackReachAcrossProducts;
}> = (props: {
  testId: string;
  reach: OpenStackReachAcrossProducts;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();
  const { reach } = props;
  const row: (data: {
    key: string;
    label: string;
    to: Route;
    name: string;
    detail?: string | undefined;
  }) => ReactElement = (data: {
    key: string;
    label: string;
    to: Route;
    name: string;
    detail?: string | undefined;
  }): ReactElement => {
    return (
      <li
        key={data.key}
        data-testid={`${props.testId}-item`}
        className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
      >
        <span className="flex min-w-0 items-center gap-2">
          {/*
           * What the link is, as a label: "Kubernetes cluster" is worded
           * for the middle of a sentence in some languages ("clúster de
           * Kubernetes"), and starts with a capital here.
           */}
          <span className="text-xs text-gray-500">
            {toLabelTerm(
              translator.translateText(data.label) || data.label,
              translator.language,
            )}
          </span>
          <Link to={data.to} className={LINK_CLASS_NAME}>
            <bdi>{data.name}</bdi>
          </Link>
        </span>
        {data.detail ? (
          <span className="text-xs text-gray-500">{data.detail}</span>
        ) : (
          <></>
        )}
      </li>
    );
  };

  return (
    <ul className={listClassName} data-testid={props.testId}>
      {reach.hosts.map((host: OpenStackLinkedHost): ReactElement => {
        return row({
          key: `host-${host.id}`,
          label: host.isHypervisor
            ? translationKey("This machine")
            : translationKey("Host"),
          to: getOpenStackHostRoute(host.id),
          name: host.name,
        });
      })}
      {reach.kubernetesClusters.map(
        (cluster: {
          id: string;
          name: string;
          nodeCount: number;
        }): ReactElement => {
          return row({
            key: `cluster-${cluster.id}`,
            label: translationKey("Kubernetes cluster"),
            to: getOpenStackKubernetesClusterRoute(cluster.id),
            name: cluster.name,
            detail: translator.translatePlural(
              { one: "{{count}} node", other: "{{count}} nodes" },
              cluster.nodeCount,
            ),
          });
        },
      )}
      {reach.kubernetesNodes.length <= 10
        ? reach.kubernetesNodes.map(
            (node: OpenStackLinkedKubernetesNode): ReactElement => {
              return row({
                key: `node-${node.clusterId}-${node.nodeName}`,
                label: translationKey("Kubernetes node"),
                to:
                  getKubernetesPartRoute(new ObjectID(node.clusterId), {
                    kind: "Node",
                    name: node.nodeName,
                  }) || getOpenStackKubernetesClusterRoute(node.clusterId),
                name: node.nodeName,
                detail: node.clusterName,
              });
            },
          )
        : []}
      {reach.services.map((service: OpenStackLinkedService): ReactElement => {
        return row({
          key: `service-${service.id}`,
          label: translationKey("Service"),
          to: getOpenStackServiceRoute(service.id),
          name: service.name,
        });
      })}
    </ul>
  );
};

const OpenStackInstanceLinksCard: FunctionComponent<{
  openStackCloudId: ObjectID;
  instanceId: string;
  refreshToken?: number | undefined;
}> = (props: {
  openStackCloudId: ObjectID;
  instanceId: string;
  refreshToken?: number | undefined;
}): ReactElement => {
  const read: OpenStackRead<OpenStackReachAcrossProducts> =
    useOpenStackRead(() => {
      return fetchOpenStackReachOfInstance({
        openStackCloudId: props.openStackCloudId,
        instanceId: props.instanceId,
      });
    }, [
      props.openStackCloudId.toString(),
      props.instanceId,
      props.refreshToken,
    ]);

  if (!read.data || isOpenStackReachEmpty(read.data)) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="openstack-instance-links">
      <Card
        title="Elsewhere in OneUptime"
        description="What this instance also is: a host running OneUptime's agent, a Kubernetes node, and the services they run."
      >
        <OpenStackReachList
          testId="openstack-instance-links-list"
          reach={read.data}
        />
      </Card>
    </div>
  );
};

export default OpenStackInstanceLinksCard;
