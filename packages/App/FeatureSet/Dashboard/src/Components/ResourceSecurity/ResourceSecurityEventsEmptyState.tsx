import AppLink from "../AppLink/AppLink";
import { readProjectSecurityLogSource } from "../SecurityEvents/SecurityLogsSourceCard";
import {
  SecurityEventsLogsState,
  getSecurityEventsLogsState,
} from "../SecurityEvents/SecurityEventsEmptyState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "Common/Models/DatabaseModels/SecurityTelemetrySource";
import Route from "Common/Types/API/Route";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import { SecurityTelemetrySourceKind } from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export const RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID: string =
  "resource-security-events-empty-state";

/*
 * A record's Security Events page before anything has named it (#9547,
 * #9628). The project's setup guide would be the wrong answer here: what
 * puts events on this page is a source that names this host, cluster or
 * cloud, or the record's own logs read for them - a container host's being
 * its containers' logs, a service's its logs and traces. So it says what
 * lands here, and the steps that bring it: a cluster's audit log or a
 * cloud's audit trail first, then Your logs, which reads the project's logs
 * for security events, and for a service Traces, each saying where it
 * stands as the Events page's empty state does: a project whose logs are
 * read already is told so, not asked to turn on what is on.
 *
 * A cloud resource's (#9779) comes first from its account's audit log, read
 * with no pipeline once Cloud audit logs is on; then its own logs, for a
 * kind that has some; and for an AWS resource its data events, from a
 * CloudTrail trail its account streams. One kept by a readable stand-in no
 * audit record names comes from its own logs, and from the names and
 * addresses it answers on, alone. A serverless function's (#9780)
 * comes from its own logs and traces, and from its cloud's audit log once
 * its telemetry says the ID the log names it by - or, until it does, what
 * to set so it does.
 */

const HOST_TITLE: string = translationKey(
  "No security events about this host yet",
);

// The page's title, naming the kind of record.
export const RESOURCE_SECURITY_EVENTS_EMPTY_TITLES: Readonly<
  Partial<Record<SecurityConnectionKind, string>>
> = {
  [SecurityConnectionKind.KubernetesCluster]: translationKey(
    "No security events about this cluster yet",
  ),
  [SecurityConnectionKind.Host]: HOST_TITLE,
  [SecurityConnectionKind.DockerHost]: HOST_TITLE,
  [SecurityConnectionKind.PodmanHost]: HOST_TITLE,
  [SecurityConnectionKind.OpenStackCloud]: translationKey(
    "No security events about this cloud yet",
  ),
  [SecurityConnectionKind.Service]: translationKey(
    "No security events about this service yet",
  ),
  [SecurityConnectionKind.CloudResource]: translationKey(
    "No security events about this cloud resource yet",
  ),
  [SecurityConnectionKind.ServerlessFunction]: translationKey(
    "No security events about this function yet",
  ),
};

const TITLE_OTHERWISE: string = translationKey(
  "No security events about this record yet",
);

const CONTAINER_HOST_LANDS_HERE: string = translationKey(
  "They appear here when OneUptime reads them in the logs of this host's containers - an attack in a web server's access log, a failed sign-in - or when a source names this host by its name.",
);

// What lands on each kind of record's page, in a sentence.
export const RESOURCE_SECURITY_EVENTS_WHAT_LANDS_HERE: Readonly<
  Partial<Record<SecurityConnectionKind, string>>
> = {
  [SecurityConnectionKind.KubernetesCluster]: translationKey(
    "They appear here when OneUptime reads them in this cluster's audit log - a shell opened in a pod, a secret read, a role changed, a privileged pod created - or when events from any other source name this cluster.",
  ),
  [SecurityConnectionKind.Host]: translationKey(
    "They appear here when a source names this host, by its name or one of its own public addresses - a sign-in, a blocked connection, an endpoint alert - or when OneUptime reads them in the logs it sends.",
  ),
  // A container's logs are filed under its service; they are read here by the host they ran on.
  [SecurityConnectionKind.DockerHost]: CONTAINER_HOST_LANDS_HERE,
  [SecurityConnectionKind.PodmanHost]: CONTAINER_HOST_LANDS_HERE,
  [SecurityConnectionKind.OpenStackCloud]: translationKey(
    "They appear here when OneUptime reads them in this cloud's own logs - a failed sign-in, a role granted, a security group rule open to the world, an image made public - or when events from any other source name this cloud.",
  ),
  [SecurityConnectionKind.Service]: translationKey(
    "They appear here when OneUptime reads them in this service's own logs and traces - an attack in a request it answers, a failed sign-in, a prompt injection.",
  ),
  [SecurityConnectionKind.CloudResource]: translationKey(
    "They appear here when its cloud's audit log names it - a change made to it, a call refused on it, its access opened to others - or when OneUptime reads them in its own logs, or another source names it by its ID.",
  ),
  // A function's logs are filed under the service of its name; they are read here by its faas.name.
  [SecurityConnectionKind.ServerlessFunction]: translationKey(
    "They appear here when OneUptime reads them in this function's own logs and traces - an attack in a request it answered, a failed sign-in - whatever service they are filed under, or when its cloud's audit log names it.",
  ),
};

const WHAT_LANDS_HERE_OTHERWISE: string = translationKey(
  "They appear here when events from any source Security Events reads name this record.",
);

/*
 * A cloud resource its audit log cannot name - kept by a readable stand-in
 * its metrics give it - reached by its own logs, or by a name or address
 * it answers on.
 */
export const CLOUD_RESOURCE_WITHOUT_ID_LANDS_HERE: string = translationKey(
  "They appear here when OneUptime reads them in its own logs, or when a source names it by a name or address it answers on.",
);

export const OPENSTACK_AUDIT_TRAIL_STEP: string = translationKey(
  "Turn on this cloud's audit trail: Keystone's notifications and the audit filter on its APIs, written to the services' own logs, which the OneUptime OpenStack agent sends.",
);

// A cloud resource's and a function's account's audit log, read with no pipeline (#9779).
export const CLOUD_AUDIT_LOGS_ON_STEP: string = translationKey(
  "Cloud audit logs is on: each read of its cloud account keeps the account's audit log as security events - what changed, and the calls refused. See the Security Events {{connections}} page.",
);

export const CLOUD_AUDIT_LOGS_OFF_STEP: string = translationKey(
  "Turn on Cloud audit logs, on the Security Events {{connections}} page. Each read of its cloud account, connected under Cloud, then keeps the account's audit log as security events - what changed, and the calls refused.",
);

// An AWS resource's data events: what an account's own read of CloudTrail does not return.
export const CLOUDTRAIL_DATA_EVENTS_STEP: string = translationKey(
  "For its data events too - an object read, a function invoked - deliver a CloudTrail trail to CloudWatch Logs and add its log group to the account's stream, on the Cloud {{connect}} page.",
);

export const FUNCTION_TRACES_OFF_STEP: string = translationKey(
  "Turn on Traces, on the Security Events {{connections}} page, to read the requests this function answers.",
);

/*
 * A function its cloud's audit log names by an ID OneUptime does not know
 * yet: its telemetry reports no account, or no Region (#9780).
 */
export const FUNCTION_ACCOUNT_STEP: string = translationKey(
  "Its cloud's audit log names it by an ID that holds its account and Region. Set cloud.account.id and cloud.region on its telemetry, in OTEL_RESOURCE_ATTRIBUTES, and the changes made to it appear here too.",
);

// Where one of the project's own sources stands: read from its own row.
export const readProjectSecurityTelemetrySource: (
  kind: SecurityTelemetrySourceKind,
) => Promise<SecurityTelemetrySource | null> = async (
  kind: SecurityTelemetrySourceKind,
): Promise<SecurityTelemetrySource | null> => {
  const result: { data: Array<SecurityTelemetrySource> } =
    await ModelAPI.getList({
      modelType: SecurityTelemetrySource,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        kind,
      },
      limit: 1,
      skip: 0,
      select: { _id: true, isEnabled: true },
      sort: {},
    });

  return result.data[0] || null;
};

// Where the project's Traces source stands: read from its own row.
export const readProjectSecurityTracesSource: () => Promise<SecurityTelemetrySource | null> =
  async (): Promise<SecurityTelemetrySource | null> => {
    return await readProjectSecurityTelemetrySource(
      SecurityTelemetrySourceKind.Traces,
    );
  };

/*
 * Where one of the project's sources stands, for a step that needs it:
 * read once the step is drawn at all, and "unknown" - the step still links
 * to its switch - when it could not be read.
 */
function useSourceState(
  kind: SecurityTelemetrySourceKind,
  isNeeded: boolean,
): SecurityEventsLogsState {
  const [source, setSource] = useState<SecurityTelemetrySource | null>(null);
  const [isRead, setIsRead] = useState<boolean>(false);
  const [didReadFail, setDidReadFail] = useState<boolean>(false);

  useEffect(() => {
    if (!isNeeded) {
      return () => {};
    }

    let isCurrent: boolean = true;

    readProjectSecurityTelemetrySource(kind)
      .then((found: SecurityTelemetrySource | null) => {
        if (isCurrent) {
          setSource(found);
          setIsRead(true);
        }
      })
      .catch(() => {
        // Not known: the step still links to the switch.
        if (isCurrent) {
          setDidReadFail(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [kind, isNeeded]);

  if (didReadFail) {
    return "unknown";
  }

  if (!isRead) {
    return "reading";
  }

  return source?.isEnabled === true ? "on" : "off";
}

export interface ComponentProps {
  kind: SecurityConnectionKind;
  // A cloud resource's or a function's cloud (CloudProvider): an AWS resource's data events come from a trail.
  cloudProvider?: string | undefined;
  // A cloud resource of a kind its connection's stream sends logs of: its own logs are read too.
  hasOwnLogs?: boolean | undefined;
  /*
   * A cloud resource or a function: whether its cloud's audit log can name
   * it - a resource's row keeps its own ID, not a stand-in; a function's
   * telemetry says its account and Region. And for a function, whether it
   * is of a cloud whose functions it could name (AWS, Google Cloud), to
   * say what to set when not.
   */
  isNamedByAuditLog?: boolean | undefined;
  canBeNamedByAuditLog?: boolean | undefined;
}

const ResourceSecurityEventsEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [logSource, setLogSource] = useState<SecurityLogSource | null>(null);
  const [isLogSourceRead, setIsLogSourceRead] = useState<boolean>(false);
  const [didLogSourceReadFail, setDidLogSourceReadFail] =
    useState<boolean>(false);
  const isService: boolean = props.kind === SecurityConnectionKind.Service;
  const isCloudResource: boolean =
    props.kind === SecurityConnectionKind.CloudResource;
  const isFunction: boolean =
    props.kind === SecurityConnectionKind.ServerlessFunction;
  // A cloud resource's own logs are read only for a kind that has some.
  const readsOwnLogs: boolean = !isCloudResource || Boolean(props.hasOwnLogs);
  // A service's and a function's events come from their traces too.
  const tracesState: SecurityEventsLogsState = useSourceState(
    SecurityTelemetrySourceKind.Traces,
    isService || isFunction,
  );
  // A cloud resource's and a function's its audit log can name come from its account's audit log.
  const isNamedByAuditLog: boolean =
    (isCloudResource || isFunction) && Boolean(props.isNamedByAuditLog);
  const cloudAuditState: SecurityEventsLogsState = useSourceState(
    SecurityTelemetrySourceKind.CloudAudit,
    isNamedByAuditLog,
  );

  useEffect(() => {
    if (!readsOwnLogs) {
      return () => {};
    }

    let isCurrent: boolean = true;

    readProjectSecurityLogSource()
      .then((found: SecurityLogSource | null) => {
        if (isCurrent) {
          setLogSource(found);
          setIsLogSourceRead(true);
        }
      })
      .catch(() => {
        // Not known: the step still links to the switch.
        if (isCurrent) {
          setDidLogSourceReadFail(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readsOwnLogs]);

  const logsState: SecurityEventsLogsState = getSecurityEventsLogsState({
    isRead: isLogSourceRead,
    didReadFail: didLogSourceReadFail,
    source: logSource,
  });

  const connectionsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_CONNECTIONS] as Route,
  );
  const linkClassName: string =
    "font-medium text-indigo-600 hover:text-indigo-700 hover:underline";
  const connectionsLink: ReactElement = (
    <AppLink to={connectionsRoute} className={linkClassName}>
      <span>{translator.translateText("Connections")}</span>
    </AppLink>
  );
  const isCluster: boolean =
    props.kind === SecurityConnectionKind.KubernetesCluster;
  const steps: Array<{ id: string; content: ReactElement; state?: string }> =
    [];

  if (isCluster) {
    steps.push({
      id: "audit-log",
      content: (
        <span>
          {translator.translateText(
            "Send this cluster's audit log: on a cluster you run yourself, set auditLogs.enabled in the OneUptime Kubernetes agent's values. On EKS, GKE or AKS, connect the cloud's audit log on the Security Events Connections page instead.",
          )}
        </span>
      ),
    });
  }

  if (props.kind === SecurityConnectionKind.OpenStackCloud) {
    steps.push({
      id: "audit-trail",
      content: (
        <span>{translator.translateText(OPENSTACK_AUDIT_TRAIL_STEP)}</span>
      ),
    });
  }

  const cloudAuditStep: { id: string; content: ReactElement; state: string } = {
    id: "cloud-audit-logs",
    state: cloudAuditState,
    content: (
      <TranslatedSentence
        template={
          cloudAuditState === "on"
            ? CLOUD_AUDIT_LOGS_ON_STEP
            : CLOUD_AUDIT_LOGS_OFF_STEP
        }
        slots={{ connections: connectionsLink }}
      />
    ),
  };

  // A cloud resource's account's audit log names it first.
  if (isCloudResource && isNamedByAuditLog) {
    steps.push(cloudAuditStep);
  }

  if (readsOwnLogs) {
    steps.push({
      id: "your-logs",
      state: logsState,
      content:
        logsState === "on" ? (
          <TranslatedSentence
            template="Your logs is on: every minute, OneUptime reads this project's new logs for security events. See the Security Events {{connections}} page."
            slots={{ connections: connectionsLink }}
          />
        ) : (
          <TranslatedSentence
            template="Turn on Your logs, on the Security Events {{connections}} page."
            slots={{ connections: connectionsLink }}
          />
        ),
    });
  }

  if (isService || isFunction) {
    steps.push({
      id: "traces",
      state: tracesState,
      content:
        tracesState === "on" ? (
          <TranslatedSentence
            template="Traces is on: OneUptime reads the requests this project's services answer for attacks. See the Security Events {{connections}} page."
            slots={{ connections: connectionsLink }}
          />
        ) : isFunction ? (
          <TranslatedSentence
            template={FUNCTION_TRACES_OFF_STEP}
            slots={{ connections: connectionsLink }}
          />
        ) : (
          <TranslatedSentence
            template="Turn on Traces, on the Security Events {{connections}} page, to read the requests this service answers."
            slots={{ connections: connectionsLink }}
          />
        ),
    });
  }

  if (isFunction && isNamedByAuditLog) {
    steps.push(cloudAuditStep);
  }

  // A function its cloud's audit log could name, once its telemetry says how.
  if (isFunction && !isNamedByAuditLog && props.canBeNamedByAuditLog) {
    steps.push({
      id: "function-account",
      content: <span>{translator.translateText(FUNCTION_ACCOUNT_STEP)}</span>,
    });
  }

  // An AWS resource's data events are no management event: a trail its account streams brings them.
  if (
    isCloudResource &&
    isNamedByAuditLog &&
    props.cloudProvider === CloudProvider.AWS
  ) {
    steps.push({
      id: "cloudtrail-data-events",
      content: (
        <TranslatedSentence
          template={CLOUDTRAIL_DATA_EVENTS_STEP}
          slots={{
            connect: (
              <AppLink
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CLOUD_CONNECT] as Route,
                )}
                className={linkClassName}
              >
                <span>{translator.translateText("Connect")}</span>
              </AppLink>
            ),
          }}
        />
      ),
    });
  }

  return (
    <div
      className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6"
      data-testid={RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}
      data-kind={props.kind}
    >
      <div className="flex flex-col items-center text-center">
        <div
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200"
        >
          <Icon icon={IconProp.ShieldCheck} className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-gray-900">
          {translator.translateText(
            RESOURCE_SECURITY_EVENTS_EMPTY_TITLES[props.kind] ||
              TITLE_OTHERWISE,
          )}
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          {translator.translateText(
            isCloudResource && !isNamedByAuditLog
              ? CLOUD_RESOURCE_WITHOUT_ID_LANDS_HERE
              : RESOURCE_SECURITY_EVENTS_WHAT_LANDS_HERE[props.kind] ||
                  WHAT_LANDS_HERE_OTHERWISE,
          )}
        </p>
      </div>

      {steps.length === 0 ? (
        <></>
      ) : (
        <ol className="mt-6 space-y-3 text-left text-sm text-gray-600">
          {steps.map(
            (
              step: { id: string; content: ReactElement; state?: string },
              index: number,
            ): ReactElement => {
              return (
                <li
                  key={step.id}
                  className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4"
                  data-testid={`${RESOURCE_SECURITY_EVENTS_EMPTY_STATE_ID}-${step.id}`}
                  {...(step.state ? { "data-state": step.state } : {})}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                    {translator.formatNumber(index + 1)}
                  </span>
                  {step.content}
                </li>
              );
            },
          )}
        </ol>
      )}
    </div>
  );
};

export default ResourceSecurityEventsEmptyState;
