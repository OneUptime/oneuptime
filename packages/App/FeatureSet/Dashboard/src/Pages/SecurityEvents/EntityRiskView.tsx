import PageComponentProps from "../PageComponentProps";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import SecurityCaseApi, {
  EntityActivity,
} from "../../Components/SecurityCase/SecurityCaseApi";
import { getCorrelateRouteForEntity } from "../../Components/SecurityCase/SecurityEntityChips";
import {
  ACTIVITY_CARD_TITLE,
  ACTIVITY_EVENTS,
  ACTIVITY_FINDINGS,
  ACTIVITY_LAST_SEEN,
  ACTIVITY_WINDOW,
  ENTITY_PAGE_NOT_NAMED_ACTION,
  ENTITY_PAGE_NOT_NAMED_DESCRIPTION,
  ENTITY_PAGE_NOT_NAMED_TITLE,
  ENTITY_NO_RISK,
  ENTITY_RISK_TEST_IDS,
  RESET_RISK,
  RESET_RISK_CONFIRM_DESCRIPTION,
  RESET_RISK_CONFIRM_TITLE,
  RISK_BREAKDOWN,
  RISK_CASE_OPENED_AT,
  RISK_FALLS_AT,
  RISK_FIRST_AND_LAST,
  SOURCE_COUNT,
} from "../../Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import EntityRiskCases from "../../Components/SecurityEvents/EntityRisk/EntityRiskCases";
import EntityRiskHeader from "../../Components/SecurityEvents/EntityRisk/EntityRiskHeader";
import EntityRiskHistory from "../../Components/SecurityEvents/EntityRisk/EntityRiskHistory";
import {
  ENTITY_TYPE_QUERY_PARAM,
  ENTITY_VALUE_QUERY_PARAM,
  EntityRiskBreakdown,
  getEntityRiskBreakdown,
  readEntityTypeFromQuery,
  readEntityValueFromQuery,
} from "../../Components/SecurityEvents/EntityRisk/EntityRiskModel";
import EntityRiskScore from "../../Components/SecurityEvents/EntityRisk/EntityRiskScore";
import EntityRiskSources from "../../Components/SecurityEvents/EntityRisk/EntityRiskSources";
import ConnectedSignals from "../../Components/SecurityConnections/ConnectedSignals";
import { CONNECTED_SIGNALS_ENTITY_DESCRIPTION } from "../../Components/SecurityConnections/SecurityConnectionsCopy";
import useEntityRiskSettings, {
  EntityRiskSettings,
} from "../../Components/SecurityEvents/EntityRisk/useEntityRiskSettings";
import { getSecurityEventsTimeRangeLinkParams } from "../../Components/SecurityEvents/SecurityEventsTimeRange";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityEntityRisk from "Common/Models/DatabaseModels/SecurityEntityRisk";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import {
  SecurityEntityType,
  inferSecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";
import {
  ENTITY_RISK_WINDOW_IN_DAYS,
  SecurityEntityRiskHistoryPoint,
} from "Common/Types/SecurityCase/SecurityEntityRisk";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  getEntityRiskKey,
  readRiskHistory,
} from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// The activity the page counts: the week its risk is counted over.
export const ENTITY_ACTIVITY_HOURS: number = ENTITY_RISK_WINDOW_IN_DAYS * 24;

// The Events explorer, on this entity's events of the week.
export function getEntityEventsRoute(value: string, now: Date): Route {
  return (
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS] as Route,
    ) as Route
  ).addQueryParams({
    search: encodeURIComponent(`observable:${buildSearchTokenValue(value)}`),
    ...getSecurityEventsTimeRangeLinkParams(
      OneUptimeDate.addRemoveHours(now, -ENTITY_ACTIVITY_HOURS),
      now,
    ),
  });
}

// Security Events > Entity Risk: where a page that names no entity sends you.
function getEntityRiskListRoute(): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_ENTITY_RISK] as Route,
  );
}

/*
 * One user's, host's or address's page: who it is, how risky it is now and
 * why - each source that added to its risk, the score of each of the last 30
 * days - the cases opened about it, and its activity this week; with the
 * ways into Correlate and the Events explorer at the top right, as a case's
 * page has its moves, and, for whoever may delete security data, Reset Risk
 * under the header's ⋯.
 *
 * Any value opens it (?value=): an entity nothing scored yet still has its
 * activity and its cases. Its value is shown as written, never looked up as
 * words.
 */
const SecurityEntityRiskViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const settings: EntityRiskSettings = useEntityRiskSettings();
  const value: string = readEntityValueFromQuery(
    Navigation.getQueryStringByName(ENTITY_VALUE_QUERY_PARAM),
  );

  const [risk, setRisk] = useState<SecurityEntityRisk | null>(null);
  const [isRiskLoaded, setIsRiskLoaded] = useState<boolean>(false);
  const [riskError, setRiskError] = useState<string>("");
  const [activity, setActivity] = useState<EntityActivity | null>(null);
  const [activityError, setActivityError] = useState<string>("");
  // Whether its activity has been read (an entity with none reads as null).
  const [isActivityLoaded, setIsActivityLoaded] = useState<boolean>(false);
  const [readCount, setReadCount] = useState<number>(0);
  const [isConfirmingReset, setIsConfirmingReset] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string>("");

  useEffect(() => {
    if (!value) {
      return () => {};
    }

    let isCurrent: boolean = true;

    // Another entity's page starts afresh: nothing of the last one shows meanwhile.
    setRisk(null);
    setActivity(null);
    setIsActivityLoaded(false);
    setIsRiskLoaded(false);
    setRiskError("");

    ModelAPI.getList<SecurityEntityRisk>({
      modelType: SecurityEntityRisk,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        entityKey: getEntityRiskKey(value),
      },
      limit: 1,
      skip: 0,
      select: {
        _id: true,
        entityType: true,
        entityValue: true,
        riskScore: true,
        criticality: true,
        contributions: true,
        firstRiskAt: true,
        lastRiskAt: true,
        riskExpiresAt: true,
        riskCaseAt: true,
        riskHistory: true,
      },
      sort: {},
    })
      .then((result: ListResult<SecurityEntityRisk>) => {
        if (isCurrent) {
          setRisk(result.data[0] || null);
          setIsRiskLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setRiskError(API.getFriendlyMessage(error as Error));
          setIsRiskLoaded(true);
        }
      });

    SecurityCaseApi.getEntityActivity({
      values: [value],
      hours: ENTITY_ACTIVITY_HOURS,
    })
      .then((rows: Array<EntityActivity>) => {
        if (isCurrent) {
          setActivity(rows[0] || null);
          setActivityError("");
          setIsActivityLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setActivityError(API.getFriendlyMessage(error as Error));
          setIsActivityLoaded(true);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [value, readCount]);

  if (!value) {
    return (
      <Card>
        <div data-testid={ENTITY_RISK_TEST_IDS.notNamed}>
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.Fingerprint}
            title={translator.translateText(ENTITY_PAGE_NOT_NAMED_TITLE) || ""}
            description={translator.translateText(
              ENTITY_PAGE_NOT_NAMED_DESCRIPTION,
            )}
            actions={[
              {
                title: ENTITY_PAGE_NOT_NAMED_ACTION,
                icon: IconProp.Fire,
                onClick: () => {
                  Navigation.navigate(getEntityRiskListRoute());
                },
              },
            ]}
          />
        </div>
      </Card>
    );
  }

  const type: SecurityEntityType =
    (risk?.entityType as SecurityEntityType | undefined) ||
    readEntityTypeFromQuery(
      Navigation.getQueryStringByName(ENTITY_TYPE_QUERY_PARAM),
    ) ||
    inferSecurityEntityType(value);
  const breakdown: EntityRiskBreakdown | null = risk
    ? getEntityRiskBreakdown({
        riskScore: risk.riskScore,
        criticality: risk.criticality,
        contributions: risk.contributions,
        threshold: settings.threshold,
      })
    : null;
  const resetGate: PermissionGateResult = PermissionGate.check(
    new SecurityEntityRisk(),
    ModelAction.Delete,
  );
  const hasScore: boolean = Boolean(breakdown && breakdown.score > 0);
  // Any risk in the month the history covers, now or before.
  const hasRiskHistory: boolean =
    hasScore ||
    readRiskHistory(risk?.riskHistory).some(
      (point: SecurityEntityRiskHistoryPoint): boolean => {
        return point.score > 0;
      },
    );

  const resetRisk: () => Promise<void> = async (): Promise<void> => {
    if (!risk?.id) {
      return;
    }

    setIsResetting(true);
    setResetError("");

    try {
      await ModelAPI.deleteItem<SecurityEntityRisk>({
        modelType: SecurityEntityRisk,
        id: risk.id,
      });
      setIsConfirmingReset(false);
      setReadCount((count: number): number => {
        return count + 1;
      });
    } catch (error) {
      setResetError(API.getFriendlyMessage(error as Error));
    }

    setIsResetting(false);
  };

  return (
    <div className="space-y-6 [container-type:inline-size]">
      <EntityRiskHeader
        value={risk?.entityValue || value}
        type={type}
        criticality={breakdown?.criticality || null}
        onOpenInCorrelate={() => {
          Navigation.navigate(getCorrelateRouteForEntity(value));
        }}
        onSearchItsEvents={() => {
          Navigation.navigate(
            getEntityEventsRoute(value, OneUptimeDate.getCurrentDate()),
          );
        }}
        /*
         * Locked, with why, for whoever may not delete security data; left
         * out while the permissions are still loading, and while there is no
         * risk to reset.
         */
        reset={
          hasScore && (resetGate.isAllowed || resetGate.disabledReason)
            ? {
                isAllowed: resetGate.isAllowed,
                disabledReason: resetGate.disabledReason,
                onClick: () => {
                  setResetError("");
                  setIsConfirmingReset(true);
                },
              }
            : undefined
        }
      >
        <div className="border-t border-gray-100 px-4 py-4 sm:px-5">
          {!isRiskLoaded || !settings.isLoaded ? (
            <ComponentLoader />
          ) : riskError ? (
            <ErrorMessage
              message={riskError}
              onRefreshClick={() => {
                setReadCount((count: number): number => {
                  return count + 1;
                });
              }}
            />
          ) : breakdown && hasScore ? (
            <div className="flex flex-col gap-4 [@container(min-width:40rem)]:flex-row [@container(min-width:40rem)]:items-start [@container(min-width:40rem)]:gap-10">
              <div className="[@container(min-width:40rem)]:w-64 [@container(min-width:40rem)]:flex-shrink-0">
                <EntityRiskScore
                  score={breakdown.score}
                  threshold={breakdown.threshold}
                  isLarge={true}
                />
              </div>
              <ul className="min-w-0 space-y-1.5 text-sm text-gray-600">
                <li className="font-medium text-gray-900">
                  {translator.translatePlural(
                    SOURCE_COUNT,
                    breakdown.sources.length,
                  )}
                </li>
                {breakdown.criticality ? (
                  <li>
                    {translator.translateTemplate(RISK_BREAKDOWN, {
                      base: translator.formatNumber(breakdown.baseScore),
                      weight: translator.formatNumber(breakdown.weight),
                      score: translator.formatNumber(breakdown.score),
                    })}
                  </li>
                ) : (
                  <></>
                )}
                {risk?.firstRiskAt && risk.lastRiskAt ? (
                  <li>
                    {translator.translateTemplate(RISK_FIRST_AND_LAST, {
                      first: OneUptimeDate.fromNow(risk.firstRiskAt),
                      last: OneUptimeDate.fromNow(risk.lastRiskAt),
                    })}
                  </li>
                ) : (
                  <></>
                )}
                {risk?.riskExpiresAt ? (
                  <li>
                    {translator.translateTemplate(RISK_FALLS_AT, {
                      when: OneUptimeDate.fromNow(risk.riskExpiresAt),
                    })}
                  </li>
                ) : (
                  <></>
                )}
                {risk?.riskCaseAt ? (
                  <li>
                    {translator.translateTemplate(RISK_CASE_OPENED_AT, {
                      when: OneUptimeDate.fromNow(risk.riskCaseAt),
                    })}
                  </li>
                ) : (
                  <></>
                )}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              {translator.translateText(ENTITY_NO_RISK)}
            </p>
          )}
        </div>
      </EntityRiskHeader>

      <div data-testid={ENTITY_RISK_TEST_IDS.activity}>
        {activityError ? (
          <Card title={ACTIVITY_CARD_TITLE}>
            <ErrorMessage message={activityError} />
          </Card>
        ) : (
          <EventStatBar
            columns={3}
            isLaidOutByOwnWidth={true}
            ariaLabel={ACTIVITY_CARD_TITLE}
          >
            <EventStatTile
              variant="segment"
              icon={IconProp.List}
              label={ACTIVITY_EVENTS}
              value={translator.formatNumber(activity?.eventCount || 0)}
              description={translator.translatePlural(
                ACTIVITY_WINDOW,
                ENTITY_RISK_WINDOW_IN_DAYS,
              )}
            />
            <EventStatTile
              variant="segment"
              icon={IconProp.ShieldExclamation}
              label={ACTIVITY_FINDINGS}
              value={translator.formatNumber(activity?.findingCount || 0)}
              description={translator.translatePlural(
                ACTIVITY_WINDOW,
                ENTITY_RISK_WINDOW_IN_DAYS,
              )}
            />
            <EventStatTile
              variant="segment"
              icon={IconProp.Clock}
              label={ACTIVITY_LAST_SEEN}
              value={
                activity?.lastSeen
                  ? OneUptimeDate.fromNow(activity.lastSeen)
                  : "-"
              }
            />
          </EventStatBar>
        )}
      </div>

      {/*
       * Where OneUptime knows it - the host, cluster, device, service or
       * user it is - and what was happening there around its last event.
       * Read once its activity is in, so the window is its last event's.
       */}
      {isActivityLoaded ? (
        <ConnectedSignals
          request={{
            entities: [{ type, value: risk?.entityValue || value }],
            ...(activity?.lastSeen ? { time: new Date(activity.lastSeen) } : {}),
            readLogResources: true,
          }}
          requestKey={`entity:${value}:${type}:${activity?.lastSeen || ""}`}
          description={CONNECTED_SIGNALS_ENTITY_DESCRIPTION}
        />
      ) : (
        <></>
      )}

      {breakdown && hasScore ? (
        <EntityRiskSources sources={breakdown.sources} />
      ) : (
        <></>
      )}

      {breakdown && hasRiskHistory ? (
        <EntityRiskHistory
          history={risk?.riskHistory}
          threshold={breakdown.threshold}
        />
      ) : (
        <></>
      )}

      <EntityRiskCases entityValue={value} />

      {isConfirmingReset ? (
        <ConfirmModal
          title={RESET_RISK_CONFIRM_TITLE}
          description={RESET_RISK_CONFIRM_DESCRIPTION}
          submitButtonText={RESET_RISK}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isResetting}
          error={resetError || undefined}
          onClose={() => {
            setIsConfirmingReset(false);
          }}
          onSubmit={() => {
            void resetRisk();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityEntityRiskViewPage;
