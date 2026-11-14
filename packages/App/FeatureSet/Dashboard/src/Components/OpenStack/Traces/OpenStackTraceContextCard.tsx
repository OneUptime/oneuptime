import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  OpenStackTraceRequest,
  OpenStackTraceRequestMatch,
} from "Common/Utils/OpenStack/OpenStackTraceLogs";
import { OpenStackTraceSource } from "Common/Utils/OpenStack/OpenStackTraces";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import {
  OpenStackTraceContext,
  OpenStackTracePart,
  OpenStackTraceService,
  fetchOpenStackTraceContext,
} from "../../../Pages/OpenStack/Utils/OpenStackTraceContext";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getOpenStackRequestRoute } from "../OpenStackRequestTrail";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "../Part/OpenStackPartRoutes";
import useOpenStackRead, { OpenStackRead } from "../Part/UseOpenStackRead";

/*
 * Above a trace from an OpenStack cloud: what it crossed and what it touched, each one step
 * from its page, and the requests in the logs that go with it, saying how sure each is. For
 * any other trace, nothing: this looks once and draws nothing, whatever that look answers,
 * because the trace below does not depend on it.
 */

const LINK_CLASS_NAME: string =
  "text-indigo-600 hover:text-indigo-700 hover:underline";

const KIND_LABELS: Partial<Record<OpenStackResourceKind, string>> = {
  [OpenStackResourceKind.Instance]: translationKey("Instance"),
  [OpenStackResourceKind.Volume]: translationKey("Volume"),
  [OpenStackResourceKind.Snapshot]: translationKey("Snapshot"),
  [OpenStackResourceKind.Backup]: translationKey("Backup"),
  [OpenStackResourceKind.Network]: translationKey("Network"),
  [OpenStackResourceKind.Subnet]: translationKey("Subnet"),
  [OpenStackResourceKind.Router]: translationKey("Router"),
  [OpenStackResourceKind.FloatingIp]: translationKey("Floating IP"),
  [OpenStackResourceKind.Image]: translationKey("Image"),
  [OpenStackResourceKind.Project]: translationKey("Project"),
};

const NATIVE_OVER_RPC_WORDS: string = translationKey(
  "OpenStack's own tracing, with nothing signed. A trace follows a request over RPC and stops at an HTTP call to another service, so what Neutron, Glance or Keystone did for this request is not in it.",
);
const NATIVE_OVER_HTTP_WORDS: string = translationKey(
  "OpenStack's own tracing, with nothing signed. This trace goes on across HTTP calls, because this cloud has the guide's line in keystoneauth.",
);
const REQUESTS_NAMED_WORDS: string = translationKey(
  "This trace's spans name their requests, so nothing here is a guess.",
);
const REQUESTS_GUESSED_WORDS: string = translationKey(
  "No span holds a request ID and no log line holds a trace's, so these are found by what the two have in common.",
);

const MATCH_WORDS: Record<OpenStackTraceRequestMatch, string> = {
  [OpenStackTraceRequestMatch.NamedBySpan]: translationKey(
    "A span in this trace holds this request's ID.",
  ),
  [OpenStackTraceRequestMatch.NamesInstance]: translationKey(
    "Its lines name an instance this trace touched.",
  ),
  [OpenStackTraceRequestMatch.SameCall]: translationKey(
    "An API logged the same call at the same moment.",
  ),
  [OpenStackTraceRequestMatch.SameMoment]: translationKey(
    "Only the same services at the same moment, so it may be someone else's.",
  ),
};

const Row: FunctionComponent<{
  title: string;
  testId: string;
  children: ReactNode;
}> = (props: {
  title: string;
  testId: string;
  children: ReactNode;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:gap-4"
      data-testid={props.testId}
    >
      <div className="w-32 flex-none text-gray-500">
        {translator.translateText(props.title)}
      </div>
      <div className="min-w-0 flex-1 text-gray-800">{props.children}</div>
    </div>
  );
};

export interface ComponentProps {
  traceId: string;
}

const OpenStackTraceContextCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const read: OpenStackRead<OpenStackTraceContext | null> =
    useOpenStackRead<OpenStackTraceContext | null>(() => {
      return fetchOpenStackTraceContext(props.traceId);
    }, [props.traceId]);

  const context: OpenStackTraceContext | null = read.data;

  if (!context) {
    return <></>;
  }

  const cloudId: ObjectID | null = context.cloud?.id || null;
  const routes: OpenStackPartRoutes | null = cloudId
    ? getOpenStackPartRoutes(cloudId)
    : null;

  const serviceLink: (service: OpenStackTraceService) => ReactElement = (
    service: OpenStackTraceService,
  ): ReactElement => {
    const route: Route | undefined =
      routes && service.row?.kind && service.row.externalId
        ? routes.getPartRoute(
            service.row.kind as OpenStackResourceKind,
            service.row.externalId,
          )
        : undefined;
    const name: ReactElement = (
      <bdi className="font-mono text-xs">
        {service.service}
        {service.host ? ` · ${service.host}` : ""}
      </bdi>
    );

    return (
      <li key={`${service.service}/${service.host}`}>
        {route ? (
          <Link className={LINK_CLASS_NAME} to={route}>
            {name}
          </Link>
        ) : (
          name
        )}
      </li>
    );
  };

  const partLink: (part: OpenStackTracePart) => ReactElement = (
    part: OpenStackTracePart,
  ): ReactElement => {
    const route: Route | undefined =
      routes && part.row
        ? routes.getPartRoute(part.resource.kind, part.resource.id)
        : undefined;
    const words: string = KIND_LABELS[part.resource.kind] || part.resource.kind;
    const label: string = translator.translateText(words) || words;

    return (
      <li key={`${part.resource.kind}/${part.resource.id}`}>
        <span className="text-gray-500">{label}: </span>
        {route ? (
          <Link className={LINK_CLASS_NAME} to={route}>
            <bdi>{part.row?.name || part.resource.id}</bdi>
          </Link>
        ) : (
          <>
            <bdi className="font-mono text-xs">{part.resource.id}</bdi>
            <span className="ms-2 text-gray-500">
              {translator.translateText(
                "Not in the inventory: it has gone, or has not been collected yet.",
              )}
            </span>
          </>
        )}
      </li>
    );
  };

  return (
    <Card
      title="From OpenStack"
      description="What this trace crossed and touched, each one step from its page."
    >
      <div
        className="divide-y divide-gray-100"
        data-testid="openstack-trace-context"
      >
        {cloudId ? (
          <Row title="Cloud" testId="openstack-trace-cloud">
            <Link
              className={LINK_CLASS_NAME}
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_TRACES] as Route,
                { modelId: cloudId },
              )}
            >
              <bdi>{context.cloudName}</bdi>
            </Link>
          </Row>
        ) : context.cloudName ? (
          <Row title="Cloud" testId="openstack-trace-cloud">
            <bdi>{context.cloudName}</bdi>
          </Row>
        ) : (
          <Row title="Cloud" testId="openstack-trace-no-cloud">
            {translator.translateText(
              "These spans say no cloud, so nothing joins them to one. Send them through the agent's traces collector, which says which.",
            )}
          </Row>
        )}

        {context.services.length > 0 ? (
          <Row title="Services" testId="openstack-trace-services">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {context.services.map(serviceLink)}
            </ul>
          </Row>
        ) : (
          <></>
        )}

        {context.parts.length > 0 ? (
          <Row title="Touched" testId="openstack-trace-parts">
            <ul className="space-y-1">{context.parts.map(partLink)}</ul>
          </Row>
        ) : (
          <></>
        )}

        {context.sources.includes(OpenStackTraceSource.Native) ? (
          <Row title="Sent by" testId="openstack-trace-source">
            {translator.translateText(
              context.carriedOverHttp
                ? NATIVE_OVER_HTTP_WORDS
                : NATIVE_OVER_RPC_WORDS,
            )}
          </Row>
        ) : (
          <></>
        )}

        {context.leftOut.length > 0 ? (
          <Row title="Not in this trace" testId="openstack-trace-left-out">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {context.leftOut.map((service: string): ReactElement => {
                return (
                  <li key={service}>
                    <bdi className="font-mono text-xs">{service}</bdi>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-gray-500">
              {translator.translateText(
                "A request reaches these, and on a stock cloud they can send nothing, depending on the release. That is why a span below can name a parent that never arrived: it was called by one of them. Their lines are still in the logs of this request.",
              )}
            </p>
          </Row>
        ) : (
          <></>
        )}

        {cloudId && context.requests.length > 0 ? (
          <Row title="In the logs" testId="openstack-trace-requests">
            <p className="text-gray-500">
              {translator.translateText(
                context.requests.some(
                  (request: OpenStackTraceRequest): boolean => {
                    return (
                      request.match === OpenStackTraceRequestMatch.NamedBySpan
                    );
                  },
                )
                  ? REQUESTS_NAMED_WORDS
                  : REQUESTS_GUESSED_WORDS,
              )}
            </p>
            <ul className="mt-1 space-y-1">
              {context.requests.map(
                (request: OpenStackTraceRequest): ReactElement => {
                  return (
                    <li key={request.rootId}>
                      <Link
                        className={`font-mono text-xs ${LINK_CLASS_NAME}`}
                        to={getOpenStackRequestRoute({
                          openStackCloudId: cloudId,
                          rootId: request.rootId,
                          at: request.at,
                        })}
                      >
                        <bdi>{request.rootId}</bdi>
                      </Link>
                      <span className="ms-2 text-gray-500">
                        {translator.translateText(MATCH_WORDS[request.match])}
                      </span>
                    </li>
                  );
                },
              )}
            </ul>
          </Row>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default OpenStackTraceContextCard;
