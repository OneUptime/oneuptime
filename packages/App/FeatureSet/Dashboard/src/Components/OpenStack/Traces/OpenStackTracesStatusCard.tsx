import OneUptimeDate from "Common/Types/Date";
import Card from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { OpenStackTracedServices } from "Common/Utils/OpenStack/OpenStackTraces";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Whether tracing works, as far as this cloud's own spans can say: when the last one came,
 * which services have sent one, and which have not. A service that has not is only a fault
 * once a request that uses it was traced, and this says that, because a service goes missing
 * for a reason of its own: its libraries, its config, or an upstream bug.
 */

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
  const notYet: Array<string> = props.canBeTraced.filter(
    (name: string): boolean => {
      return !props.traced.services.includes(name);
    },
  );

  return (
    <Card
      title="Traces from this cloud"
      description="Only requests signed with your key are traced, so this says what has been traced, not how the cloud is doing."
    >
      <div
        className="space-y-3 p-4 text-sm text-gray-700"
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
