import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackBlastRadius,
  OpenStackBlastRadiusCount,
  OpenStackBlastRadiusOwner,
  OpenStackBlastRadiusProject,
  isOpenStackBlastRadiusEmpty,
} from "Common/Types/OpenStack/OpenStackBlastRadius";
import { isOpenStackReachEmpty } from "Common/Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { fetchOpenStackBlastRadius } from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import { OpenStackReachList } from "./OpenStackInstanceLinksCard";
import { OpenStackPartRoutes } from "./OpenStackPartRoutes";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";

/*
 * "What runs on it, and whose is it?": the first two questions when a part of a cloud
 * fails, answered from the one read Needs attention, an incident and the notices all use
 * (OpenStackResourceService.getBlastRadius), so none of them can count differently.
 *
 * When what was collected cannot say, it says that, and never "0 volumes": the agent's
 * exporter doesn't say which pool a volume is on.
 */

// How many projects the card lists before it says how many more there are.
export const OPENSTACK_BLAST_RADIUS_PROJECTS_SHOWN: number = 10;

export interface ComponentProps {
  testId: string;
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  externalId: string;
  routes: OpenStackPartRoutes;
  description: string;
  // What to say when what was collected cannot tell. Without it, the card is left out.
  unknownText?: string | undefined;
  refreshToken?: number | undefined;
}

const BLAST_RADIUS_TITLE: string = translationKey("What it takes with it");

interface CountWords {
  count: OpenStackBlastRadiusCount;
  key: string;
  words: { one: string; other: string };
}

// How each of what a radius counts reads, each on its own so it is translated whole.
const COUNT_WORDS: ReadonlyArray<CountWords> = [
  {
    count: "instanceCount",
    key: "instances",
    words: { one: "{{count}} instance", other: "{{count}} instances" },
  },
  {
    count: "volumeCount",
    key: "volumes",
    words: { one: "{{count}} volume", other: "{{count}} volumes" },
  },
  {
    count: "routerCount",
    key: "routers",
    words: { one: "{{count}} router", other: "{{count}} routers" },
  },
  {
    count: "floatingIpCount",
    key: "floating-ips",
    words: { one: "{{count}} floating IP", other: "{{count}} floating IPs" },
  },
  {
    count: "stackCount",
    key: "stacks",
    words: { one: "{{count}} stack", other: "{{count}} stacks" },
  },
  {
    count: "containerClusterCount",
    key: "container-clusters",
    words: {
      one: "{{count}} Kubernetes cluster",
      other: "{{count}} Kubernetes clusters",
    },
  },
  {
    count: "shareCount",
    key: "shares",
    words: { one: "{{count}} share", other: "{{count}} shares" },
  },
  {
    count: "loadBalancerCount",
    key: "load-balancers",
    words: {
      one: "{{count}} load balancer",
      other: "{{count}} load balancers",
    },
  },
];

const OpenStackBlastRadiusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listClassName: string = useCardRuledListClassName();

  const radius: OpenStackRead<OpenStackBlastRadius> =
    useOpenStackRead<OpenStackBlastRadius>(() => {
      return fetchOpenStackBlastRadius({
        openStackCloudId: props.openStackCloudId,
        kind: props.kind,
        externalId: props.externalId,
      });
    }, [
      props.openStackCloudId.toString(),
      props.kind,
      props.externalId,
      props.refreshToken,
    ]);

  if (radius.error) {
    return (
      <div className="mb-6" data-testid={`${props.testId}-error`}>
        <Card title={BLAST_RADIUS_TITLE} description={props.description}>
          <ErrorMessage message={radius.error} onRefreshClick={radius.reload} />
        </Card>
      </div>
    );
  }

  const data: OpenStackBlastRadius | null = radius.data;

  if (!data) {
    return <></>;
  }

  if (!data.isKnown) {
    if (!props.unknownText) {
      return <></>;
    }
    return (
      <div className="mb-6" data-testid={props.testId} data-known="false">
        <Card title={BLAST_RADIUS_TITLE} description={props.description}>
          <p className="text-sm text-gray-600">
            {translator.translateText(props.unknownText) || props.unknownText}
          </p>
        </Card>
      </div>
    );
  }

  const counts: Array<{ key: string; text: string }> = [];
  for (const entry of COUNT_WORDS) {
    if (data[entry.count] > 0) {
      counts.push({
        key: entry.key,
        text: translator.translatePlural(entry.words, data[entry.count]),
      });
    }
  }
  if (data.projectCount > 0) {
    counts.push({
      key: "projects",
      text: translator.translatePlural(
        { one: "in {{count}} project", other: "in {{count}} projects" },
        data.projectCount,
      ),
    });
  }

  const shown: Array<OpenStackBlastRadiusProject> = data.projects.slice(
    0,
    OPENSTACK_BLAST_RADIUS_PROJECTS_SHOWN,
  );
  const hidden: number = data.projectCount - shown.length;

  return (
    <div className="mb-6" data-testid={props.testId} data-known="true">
      <Card title={BLAST_RADIUS_TITLE} description={props.description}>
        {isOpenStackBlastRadiusEmpty(data) ? (
          <p
            className="text-sm text-gray-600"
            data-testid={`${props.testId}-empty`}
          >
            {translator.translateText("Nothing depends on it right now.")}
          </p>
        ) : (
          <div>
            <div
              className="flex flex-wrap gap-1.5 pb-4"
              data-testid={`${props.testId}-counts`}
            >
              {counts.map(
                (count: { key: string; text: string }): ReactElement => {
                  return (
                    <span
                      key={count.key}
                      className="inline-flex rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700"
                    >
                      {count.text}
                    </span>
                  );
                },
              )}
            </div>
            {shown.length > 0 ? (
              <ul className={listClassName}>
                {shown.map(
                  (project: OpenStackBlastRadiusProject): ReactElement => {
                    return (
                      <li
                        key={project.projectId}
                        data-testid={`${props.testId}-project`}
                        className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
                      >
                        <Link
                          to={props.routes.getPartRoute(
                            OpenStackResourceKind.Project,
                            project.projectId,
                          )}
                          className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                        >
                          <bdi>{project.name || project.projectId}</bdi>
                        </Link>
                        <span className="text-xs text-gray-500">
                          {COUNT_WORDS.map((entry: CountWords): string => {
                            return project[entry.count] > 0
                              ? translator.translatePlural(
                                  entry.words,
                                  project[entry.count],
                                )
                              : "";
                          })
                            .filter((part: string): boolean => {
                              return Boolean(part);
                            })
                            .join(" · ")}
                        </span>
                      </li>
                    );
                  },
                )}
                {hidden > 0 ? (
                  <li
                    className="px-5 py-3 text-sm text-gray-500 md:px-6"
                    data-testid={`${props.testId}-more`}
                  >
                    {translator.translatePlural(
                      {
                        one: "and {{count}} more project",
                        other: "and {{count}} more projects",
                      },
                      hidden,
                    )}
                  </li>
                ) : (
                  <></>
                )}
              </ul>
            ) : (
              <></>
            )}
          </div>
        )}
        {data.loadBalancers && data.loadBalancers.length > 0 ? (
          <div data-testid={`${props.testId}-load-balancers`}>
            <p className="pt-4 pb-2 text-xs font-medium text-gray-500">
              {translator.translateText("Load balancers with an amphora here")}
            </p>
            <ul className={listClassName}>
              {data.loadBalancers.map(
                (owner: OpenStackBlastRadiusOwner): ReactElement => {
                  return (
                    <li
                      key={owner.externalId}
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
                    >
                      <Link
                        to={props.routes.getPartRoute(
                          OpenStackResourceKind.LoadBalancer,
                          owner.externalId,
                        )}
                        className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        <bdi>{owner.name || owner.externalId}</bdi>
                      </Link>
                      {owner.status ? (
                        <span className="text-xs text-gray-500">
                          <bdi>{owner.status}</bdi>
                        </span>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        ) : (
          <></>
        )}
        {data.magnumClusters && data.magnumClusters.length > 0 ? (
          <div data-testid={`${props.testId}-magnum-clusters`}>
            <p className="pt-4 pb-2 text-xs font-medium text-gray-500">
              {translator.translateText(
                "Kubernetes clusters with a server here",
              )}
            </p>
            <ul className={listClassName}>
              {data.magnumClusters.map(
                (owner: OpenStackBlastRadiusOwner): ReactElement => {
                  return (
                    <li
                      key={owner.externalId}
                      className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm md:px-6"
                    >
                      <Link
                        to={props.routes.getPartRoute(
                          OpenStackResourceKind.ContainerCluster,
                          owner.externalId,
                        )}
                        className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                      >
                        <bdi>{owner.name || owner.externalId}</bdi>
                      </Link>
                      {owner.status ? (
                        <span className="text-xs text-gray-500">
                          <bdi>{owner.status}</bdi>
                        </span>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                },
              )}
            </ul>
          </div>
        ) : (
          <></>
        )}
        {data.acrossProducts && !isOpenStackReachEmpty(data.acrossProducts) ? (
          <div data-testid={`${props.testId}-across-products`}>
            {/* A ruled list runs to the card's edge, so what follows one starts past that. */}
            <p
              className={`${
                !isOpenStackBlastRadiusEmpty(data) && shown.length > 0
                  ? "pt-10"
                  : "pt-4"
              } pb-2 text-xs font-medium text-gray-500`}
            >
              {translator.translateText("Beyond this cloud")}
            </p>
            <OpenStackReachList
              testId={`${props.testId}-across-products-list`}
              reach={data.acrossProducts}
            />
          </div>
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default OpenStackBlastRadiusCard;
