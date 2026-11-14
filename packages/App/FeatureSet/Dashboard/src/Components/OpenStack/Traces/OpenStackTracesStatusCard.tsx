import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  OpenStackTraceGap,
  OpenStackTraceSource,
  OpenStackTracedServices,
  getOpenStackTraceGap,
} from "Common/Utils/OpenStack/OpenStackTraces";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Whether tracing works, as far as this cloud's own spans can say: when the last one came,
 * which services have sent one, and which have not. Some send nothing on a stock cloud, for
 * reasons of OSProfiler's and their own, and each says so here, because a trace with no
 * scheduler in it reads as if nothing was scheduled. Any other that has not sent one is only
 * a fault once a request that uses it was traced, and this says that too.
 */

const OWN_TRACING_DOCS: Route = new Route(
  "/docs/telemetry/openstack#openstacks-own-tracing",
);
const SIGNED_ONLY_WORDS: string = translationKey(
  "Only requests signed with your key are traced, so this says what has been traced, not how the cloud is doing.",
);
const NATIVE_WORDS: string = translationKey(
  "OpenStack's own tracing is on, so every API request is traced with nothing signed. This says what has been traced, not how the cloud is doing.",
);
const NATIVE_OVER_RPC_WORDS: string = translationKey(
  "A trace follows a request over RPC, from nova-api to nova-conductor, nova-scheduler and nova-compute. It does not cross an HTTP call: when Nova asks Neutron something, that is a trace of its own. One line in keystoneauth joins them, in the guide.",
);
const NATIVE_OVER_HTTP_WORDS: string = translationKey(
  "A trace follows a request over RPC and over HTTP calls between services. Work a service does later on a thread of its own, as nova-compute does to build an instance, starts new traces under the same request ID.",
);

const GAP_WORDS: Record<OpenStackTraceGap, string> = {
  [OpenStackTraceGap.DriverCannotStart]: translationKey(
    "OSProfiler's driver cannot start here as OpenStack ships it, so this sends nothing. One line fixes it: Placement, in the guide below.",
  ),
  [OpenStackTraceGap.ForkedWorkers]: translationKey(
    "On 2025.2 these send nothing while they run more than one worker, because nothing a forked worker made arrived. One worker each brings them into a trace, and costs what it costs: Nova's conductor and scheduler, in the guide below. On 2026.2 they send spans as they are.",
  ),
  [OpenStackTraceGap.AlwaysForks]: translationKey(
    "This always runs in a forked worker, so it sends nothing, and there is no setting for that.",
  ),
};

const GAP_ORDER: ReadonlyArray<OpenStackTraceGap> = [
  OpenStackTraceGap.DriverCannotStart,
  OpenStackTraceGap.ForkedWorkers,
  OpenStackTraceGap.AlwaysForks,
];

const ServiceNames: FunctionComponent<{
  names: Array<string>;
  className: string;
  testId: string;
}> = (props: {
  names: Array<string>;
  className: string;
  testId: string;
}): ReactElement => {
  return (
    <ul className="mt-1 flex flex-wrap gap-1.5" data-testid={props.testId}>
      {props.names.map((name: string): ReactElement => {
        return (
          <li
            key={name}
            className={`rounded px-2 py-0.5 font-mono text-xs ${props.className}`}
          >
            <bdi>{name}</bdi>
          </li>
        );
      })}
    </ul>
  );
};

export interface ComponentProps {
  traced: OpenStackTracedServices;
  // What this cloud runs that a trace could cross.
  canBeTraced: Array<string>;
}

const OpenStackTracesStatusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const notSeen: Array<string> = props.canBeTraced.filter(
    (name: string): boolean => {
      return !props.traced.services.includes(name);
    },
  );
  const notYet: Array<string> = notSeen.filter((name: string): boolean => {
    return !getOpenStackTraceGap(name);
  });
  const isNative: boolean = props.traced.sources.includes(
    OpenStackTraceSource.Native,
  );

  return (
    <Card
      title="Traces from this cloud"
      description={isNative ? NATIVE_WORDS : SIGNED_ONLY_WORDS}
    >
      <div
        className="space-y-3 text-sm text-gray-700"
        data-testid="openstack-traces-status"
      >
        {props.traced.lastSpanAt ? (
          <p data-testid="openstack-traces-last-span">
            {translator.translateTemplate("The last span arrived {{time}}.", {
              time: OneUptimeDate.fromNow(props.traced.lastSpanAt),
            })}
          </p>
        ) : (
          <></>
        )}
        {props.traced.services.length > 0 ? (
          <div>
            <p>{translator.translateText("In a trace so far:")}</p>
            <ServiceNames
              names={props.traced.services}
              className="bg-green-50 text-green-800"
              testId="openstack-traces-services-seen"
            />
          </div>
        ) : (
          <></>
        )}
        {isNative ? (
          <p data-testid="openstack-traces-native">
            {translator.translateText(
              props.traced.carriedOverHttp
                ? NATIVE_OVER_HTTP_WORDS
                : NATIVE_OVER_RPC_WORDS,
            )}
          </p>
        ) : (
          <p
            className="text-gray-500"
            data-testid="openstack-traces-own-tracing"
          >
            {translator.translateText(
              "On 2026.2, OpenStack's own tracing can trace every API request with nothing signed.",
            )}{" "}
            <Link
              className="text-indigo-600 hover:text-indigo-700 hover:underline"
              to={OWN_TRACING_DOCS}
              openInNewTab={true}
            >
              {translator.translateText("How to turn it on")}
            </Link>
          </p>
        )}
        {GAP_ORDER.map((gap: OpenStackTraceGap): ReactElement => {
          const names: Array<string> = notSeen.filter(
            (name: string): boolean => {
              return getOpenStackTraceGap(name) === gap;
            },
          );

          return names.length > 0 ? (
            <div key={gap} data-testid={`openstack-traces-gap-${gap}`}>
              <ServiceNames
                names={names}
                className="bg-amber-50 text-amber-800"
                testId={`openstack-traces-gap-services-${gap}`}
              />
              <p className="mt-1 text-gray-500">
                {translator.translateText(GAP_WORDS[gap])}
              </p>
            </div>
          ) : (
            <React.Fragment key={gap}></React.Fragment>
          );
        })}
        {notYet.length > 0 ? (
          <div>
            <p>{translator.translateText("Not in a trace yet:")}</p>
            <ServiceNames
              names={notYet}
              className="bg-gray-100 text-gray-700"
              testId="openstack-traces-services-not-seen"
            />
            <p className="mt-1 text-gray-500">
              {translator.translateText(
                "A request only reaches some services, so this is no fault until a request that uses one has been traced. If one stays away after that, its own log says why: look for osprofiler in it.",
              )}
            </p>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default OpenStackTracesStatusCard;
