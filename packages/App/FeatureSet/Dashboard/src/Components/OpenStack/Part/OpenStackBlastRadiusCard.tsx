import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackBlastRadius,
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
  if (data.instanceCount > 0) {
    counts.push({
      key: "instances",
      text: translator.translatePlural(
        { one: "{{count}} instance", other: "{{count}} instances" },
        data.instanceCount,
      ),
    });
  }
  if (data.volumeCount > 0) {
    counts.push({
      key: "volumes",
      text: translator.translatePlural(
        { one: "{{count}} volume", other: "{{count}} volumes" },
        data.volumeCount,
      ),
    });
  }
  if (data.routerCount > 0) {
    counts.push({
      key: "routers",
      text: translator.translatePlural(
        { one: "{{count}} router", other: "{{count}} routers" },
        data.routerCount,
      ),
    });
  }
  if (data.floatingIpCount > 0) {
    counts.push({
      key: "floating-ips",
      text: translator.translatePlural(
        { one: "{{count}} floating IP", other: "{{count}} floating IPs" },
        data.floatingIpCount,
      ),
    });
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
                          {[
                            project.instanceCount > 0
                              ? translator.translatePlural(
                                  {
                                    one: "{{count}} instance",
                                    other: "{{count}} instances",
                                  },
                                  project.instanceCount,
                                )
                              : "",
                            project.volumeCount > 0
                              ? translator.translatePlural(
                                  {
                                    one: "{{count}} volume",
                                    other: "{{count}} volumes",
                                  },
                                  project.volumeCount,
                                )
                              : "",
                            project.routerCount > 0
                              ? translator.translatePlural(
                                  {
                                    one: "{{count}} router",
                                    other: "{{count}} routers",
                                  },
                                  project.routerCount,
                                )
                              : "",
                            project.floatingIpCount > 0
                              ? translator.translatePlural(
                                  {
                                    one: "{{count}} floating IP",
                                    other: "{{count}} floating IPs",
                                  },
                                  project.floatingIpCount,
                                )
                              : "",
                          ]
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
        {data.acrossProducts && !isOpenStackReachEmpty(data.acrossProducts) ? (
          <div data-testid={`${props.testId}-across-products`}>
            <p className="pt-4 pb-2 text-xs font-medium text-gray-500">
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
