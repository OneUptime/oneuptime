import EventStatBar from "../EventView/EventStatBar";
import EventStatTile from "../EventView/EventStatTile";
import AppLink from "../AppLink/AppLink";
import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import { getEntityRiskRoute } from "../SecurityEvents/EntityRisk/EntityRiskModel";
import { EntityRiskLevelPill } from "../SecurityEvents/EntityRisk/EntityRiskScore";
import useEntityRiskSettings, {
  EntityRiskSettings,
} from "../SecurityEvents/EntityRisk/useEntityRiskSettings";
import SecurityEventSeverityPill from "../SecurityEvents/SecurityEventSeverityPill";
import SecurityCaseSummaryRow from "./SecurityCaseSummaryRow";
import {
  RESOURCE_SECURITY_DESCRIPTION,
  RESOURCE_SECURITY_EVENTS,
  RESOURCE_SECURITY_FINDINGS,
  RESOURCE_SECURITY_IN_WINDOW,
  RESOURCE_SECURITY_LAST_SEEN,
  RESOURCE_SECURITY_MORE_CASES,
  RESOURCE_SECURITY_OPEN_CASES,
  RESOURCE_SECURITY_OPEN_IN_SECURITY,
  RESOURCE_SECURITY_QUIET,
  RESOURCE_SECURITY_RISK,
  RESOURCE_SECURITY_SERVICE_DESCRIPTION,
  RESOURCE_SECURITY_SERVICE_QUIET,
  RESOURCE_SECURITY_TITLE,
  SECURITY_CONNECTIONS_TEST_IDS,
} from "./SecurityConnectionsCopy";
import {
  getRecordSecurityEventsRoute,
  hasResourceSecurityNews,
} from "./SecurityConnectionsModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  ResourceSecurityCaseJson,
  ResourceSecurityJson,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";
import { ocsfSeverityFromId } from "Common/Types/SecurityEvent/OcsfSeverity";
import { getEntityRiskLevel } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * THE WAY BACK: what Security Events says about one of the project's own
 * records, on its page - a host, a Docker or Podman host, a Kubernetes
 * cluster, a network device, a service, a user.
 *
 * Over the last week (the week an entity's risk is counted over): the open
 * security cases naming it, how many security events and findings named it
 * and the worst of them, and its risk - each opening Security Events on it:
 * the events in the explorer, the risk on the entity's page, a case on its
 * page. A service is told about by the events read from its logs.
 *
 * Drawn only for whoever may read security events, and only in a project
 * that uses Security Events (any event this week); when nothing named the
 * record, one quiet line says so. A read that fails draws nothing: the page
 * is the record's, and this card only adds to it.
 */
export interface ComponentProps {
  kind: SecurityConnectionKind;
  modelId: ObjectID;
  // Change it to read again (a page's own refresh).
  refreshToken?: number | undefined;
}

/*
 * A record's risk, its level against the project's threshold, opening the
 * entity's page. Its own component, so the threshold is read only for a
 * record that has some risk.
 */
const RiskValue: FunctionComponent<{
  risk: NonNullable<ResourceSecurityJson["risk"]>;
}> = (props: {
  risk: NonNullable<ResourceSecurityJson["risk"]>;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const riskSettings: EntityRiskSettings = useEntityRiskSettings();
  const route: Route = getEntityRiskRoute(
    props.risk.entityValue,
    props.risk.entityType,
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <AppLink
        to={route}
        className="tabular-nums hover:text-indigo-700 hover:underline"
      >
        {translator.formatNumber(props.risk.score)}
      </AppLink>
      <EntityRiskLevelPill
        level={getEntityRiskLevel(props.risk.score, riskSettings.threshold)}
      />
    </span>
  );
};

const ResourceSecurityCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const readGate: PermissionGateResult = PermissionGate.check(
    new SecurityEvent(),
    ModelAction.Read,
  );
  const [security, setSecurity] = useState<ResourceSecurityJson | null>(null);

  useEffect(() => {
    if (!readGate.isAllowed) {
      return () => {};
    }

    let isCurrent: boolean = true;

    SecurityCaseApi.getResourceSecurity({
      kind: props.kind,
      id: props.modelId,
    })
      .then((result: ResourceSecurityJson) => {
        if (isCurrent) {
          setSecurity(result);
        }
      })
      .catch(() => {
        // The card only adds to the page: a failed read draws nothing.
        if (isCurrent) {
          setSecurity(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [
    props.kind,
    props.modelId.toString(),
    props.refreshToken,
    readGate.isAllowed,
  ]);

  if (!readGate.isAllowed || !security || !security.isInUse) {
    return <></>;
  }

  const isService: boolean = props.kind === SecurityConnectionKind.Service;
  const eventsRoute: Route | null = getRecordSecurityEventsRoute({
    security,
    now: OneUptimeDate.getCurrentDate(),
  });
  const openRoute: Route | null = security.entity
    ? getEntityRiskRoute(security.entity.value, security.entity.type)
    : eventsRoute;
  const buttons: Array<{
    title: string;
    icon: IconProp;
    buttonStyle: ButtonStyleType;
    onClick: () => void;
  }> = openRoute
    ? [
        {
          title: RESOURCE_SECURITY_OPEN_IN_SECURITY,
          icon: IconProp.ShieldCheck,
          buttonStyle: ButtonStyleType.OUTLINE,
          onClick: () => {
            Navigation.navigate(openRoute);
          },
        },
      ]
    : [];

  if (!hasResourceSecurityNews(security)) {
    return (
      <div
        data-testid={SECURITY_CONNECTIONS_TEST_IDS.resourceSecurity}
        data-state="quiet"
      >
        <Card
          title={RESOURCE_SECURITY_TITLE}
          description={
            isService ? RESOURCE_SECURITY_SERVICE_QUIET : RESOURCE_SECURITY_QUIET
          }
          buttons={buttons}
        />
      </div>
    );
  }

  const cases: Array<ResourceSecurityCaseJson> =
    security.openCases?.items || [];
  const moreCases: number =
    (security.openCases?.count || 0) - cases.length;
  const lastSeen: string | undefined = security.lastSeen
    ? translator.translateTemplate(RESOURCE_SECURITY_LAST_SEEN, {
        when: OneUptimeDate.fromNow(new Date(security.lastSeen)),
      })
    : undefined;
  const worst: string | undefined =
    security.findingCount > 0
      ? ocsfSeverityFromId(security.maxSeverityId)
      : undefined;
  const tiles: Array<ReactElement> = [];

  if (security.openCases) {
    tiles.push(
      <EventStatTile
        key="cases"
        variant="segment"
        icon={IconProp.ShieldExclamation}
        label={RESOURCE_SECURITY_OPEN_CASES}
        value={
          <span className={security.openCases.count > 0 ? "text-red-700" : ""}>
            {translator.formatNumber(security.openCases.count)}
          </span>
        }
      />,
    );
  }

  tiles.push(
    <EventStatTile
      key="events"
      variant="segment"
      icon={IconProp.List}
      label={RESOURCE_SECURITY_EVENTS}
      value={
        eventsRoute && security.eventCount > 0 ? (
          <AppLink
            to={eventsRoute}
            className="hover:text-indigo-700 hover:underline"
            dataTestId={SECURITY_CONNECTIONS_TEST_IDS.resourceSecurityOpen}
          >
            {translator.formatNumber(security.eventCount)}
          </AppLink>
        ) : (
          translator.formatNumber(security.eventCount)
        )
      }
      description={
        lastSeen || translator.translateText(RESOURCE_SECURITY_IN_WINDOW)
      }
    />,
    <EventStatTile
      key="findings"
      variant="segment"
      icon={IconProp.ShieldCheck}
      label={RESOURCE_SECURITY_FINDINGS}
      value={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>{translator.formatNumber(security.findingCount)}</span>
          {worst ? <SecurityEventSeverityPill severityName={worst} /> : <></>}
        </span>
      }
      description={translator.translateText(RESOURCE_SECURITY_IN_WINDOW)}
    />,
  );

  if (security.openCases || security.risk) {
    tiles.push(
      <EventStatTile
        key="risk"
        variant="segment"
        icon={IconProp.Fire}
        label={RESOURCE_SECURITY_RISK}
        value={
          security.risk ? (
            <RiskValue risk={security.risk} />
          ) : (
            <span className="text-gray-400">-</span>
          )
        }
      />,
    );
  }

  return (
    <div
      data-testid={SECURITY_CONNECTIONS_TEST_IDS.resourceSecurity}
      data-state="news"
    >
      <Card
        title={RESOURCE_SECURITY_TITLE}
        description={
          isService
            ? RESOURCE_SECURITY_SERVICE_DESCRIPTION
            : RESOURCE_SECURITY_DESCRIPTION
        }
        buttons={buttons}
      >
        <div className="space-y-4">
          <EventStatBar
            columns={tiles.length as 2 | 3 | 4}
            isLaidOutByOwnWidth={true}
            ariaLabel={RESOURCE_SECURITY_TITLE}
          >
            {tiles}
          </EventStatBar>

          {cases.length > 0 ? (
            <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.resourceSecurityCases}>
              <ul className="divide-y divide-gray-100">
                {cases.map(
                  (securityCase: ResourceSecurityCaseJson): ReactElement => {
                    return (
                      <SecurityCaseSummaryRow
                        key={securityCase.id}
                        securityCase={securityCase}
                      />
                    );
                  },
                )}
              </ul>
              {moreCases > 0 ? (
                <p className="mt-2 text-sm text-gray-500">
                  {translator.translatePlural(
                    RESOURCE_SECURITY_MORE_CASES,
                    moreCases,
                  )}
                </p>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>
    </div>
  );
};

export default ResourceSecurityCard;
