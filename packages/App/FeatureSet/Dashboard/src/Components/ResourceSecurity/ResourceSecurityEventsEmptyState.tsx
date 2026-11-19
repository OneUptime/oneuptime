import AppLink from "../AppLink/AppLink";
import { readProjectSecurityLogSource } from "../SecurityEvents/SecurityLogsSourceCard";
import {
  SecurityEventsLogsState,
  getSecurityEventsLogsState,
} from "../SecurityEvents/SecurityEventsEmptyState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityLogSource from "Common/Models/DatabaseModels/SecurityLogSource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
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
 * A record's Security Events page before anything has named it (#9547).
 * The project's setup guide would be the wrong answer here: what puts
 * events on this page is a source that names this host or cluster, or the
 * record's own logs read for them. So it says what lands here, and the
 * steps that bring it - a cluster's audit log first, then Your logs, which
 * reads the project's logs for security events, saying where it stands as
 * the Events page's empty state does: a project whose logs are read
 * already is told so, not asked to turn on what is on.
 */

// The page's title, naming the kind of record.
const TITLES: Partial<Record<SecurityConnectionKind, string>> = {
  [SecurityConnectionKind.KubernetesCluster]: translationKey(
    "No security events about this cluster yet",
  ),
  [SecurityConnectionKind.Host]: translationKey(
    "No security events about this host yet",
  ),
};

const TITLE_OTHERWISE: string = translationKey(
  "No security events about this record yet",
);

// What lands on each kind of record's page, in a sentence.
const WHAT_LANDS_HERE: Partial<Record<SecurityConnectionKind, string>> = {
  [SecurityConnectionKind.KubernetesCluster]: translationKey(
    "They appear here when OneUptime reads them in this cluster's audit log - a shell opened in a pod, a secret read, a role changed, a privileged pod created - or when events from any other source name this cluster.",
  ),
  [SecurityConnectionKind.Host]: translationKey(
    "They appear here when a source names this host, by its name or one of its own public addresses - a sign-in, a blocked connection, an endpoint alert - or when OneUptime reads them in the logs it sends.",
  ),
};

const WHAT_LANDS_HERE_OTHERWISE: string = translationKey(
  "They appear here when events from any source Security Events reads name this record.",
);

export interface ComponentProps {
  kind: SecurityConnectionKind;
}

const ResourceSecurityEventsEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [logSource, setLogSource] = useState<SecurityLogSource | null>(null);
  const [isLogSourceRead, setIsLogSourceRead] = useState<boolean>(false);
  const [didLogSourceReadFail, setDidLogSourceReadFail] =
    useState<boolean>(false);

  useEffect(() => {
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
  }, []);

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
          {translator.translateText(TITLES[props.kind] || TITLE_OTHERWISE)}
        </h3>
        <p className="mt-2 text-sm text-gray-500">
          {translator.translateText(
            WHAT_LANDS_HERE[props.kind] || WHAT_LANDS_HERE_OTHERWISE,
          )}
        </p>
      </div>

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
    </div>
  );
};

export default ResourceSecurityEventsEmptyState;
