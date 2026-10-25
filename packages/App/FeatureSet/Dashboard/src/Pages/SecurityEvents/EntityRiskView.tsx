import PageComponentProps from "../PageComponentProps";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import SecurityCaseApi, {
  EntityActivity,
} from "../../Components/SecurityCase/SecurityCaseApi";
import { getCorrelateRouteForEntity } from "../../Components/SecurityCase/SecurityEntityChips";
import EntityCriticalityPill from "../../Components/SecurityEvents/EntityRisk/EntityCriticalityPill";
import {
  ACTIVITY_EVENTS,
  ACTIVITY_FINDINGS,
  ACTIVITY_FIRST_SEEN,
  ACTIVITY_LAST_SEEN,
  ENTITY_PAGE_NOT_NAMED_DESCRIPTION,
  ENTITY_PAGE_NOT_NAMED_TITLE,
  ENTITY_NO_RISK,
  ENTITY_RISK_TEST_IDS,
  OPEN_IN_CORRELATE,
  RESET_RISK,
  RESET_RISK_CONFIRM_DESCRIPTION,
  RESET_RISK_CONFIRM_TITLE,
  RISK_BREAKDOWN,
  RISK_CASE_OPENED_AT,
  RISK_FALLS_AT,
  RISK_FIRST_AND_LAST,
  SEARCH_ITS_EVENTS,
  SOURCE_COUNT,
} from "../../Components/SecurityEvents/EntityRisk/EntityRiskCopy";
import EntityRiskCases from "../../Components/SecurityEvents/EntityRisk/EntityRiskCases";
import EntityRiskHistory from "../../Components/SecurityEvents/EntityRisk/EntityRiskHistory";
import {
  ENTITY_VALUE_QUERY_PARAM,
  EntityRiskBreakdown,
  getEntityRiskBreakdown,
  readEntityValueFromQuery,
} from "../../Components/SecurityEvents/EntityRisk/EntityRiskModel";
import EntityRiskScore from "../../Components/SecurityEvents/EntityRisk/EntityRiskScore";
import EntityRiskSources from "../../Components/SecurityEvents/EntityRisk/EntityRiskSources";
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
  getSecurityEntityIcon,
  inferSecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";
import { ENTITY_RISK_WINDOW_IN_DAYS } from "Common/Types/SecurityCase/SecurityEntityRisk";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import { getEntityRiskKey } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
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

/*
 * One user's, host's or address's page: who it is, how risky it is now and
 * why - each source that added to its risk, the score of each of the last 30
 * days - the cases opened about it, and its activity this week; with the
 * ways into Correlate and the Events explorer, and, for whoever may delete
 * security data, Reset Risk.
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
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setActivityError(API.getFriendlyMessage(error as Error));
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
          />
        </div>
      </Card>
    );
  }

  const type: SecurityEntityType =
    (risk?.entityType as SecurityEntityType | undefined) ||
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
      <section
        className="rounded-xl border border-gray-200 bg-white shadow-sm"
        data-testid={ENTITY_RISK_TEST_IDS.entityHeader}
      >
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 [@container(min-width:48rem)]:flex-row [@container(min-width:48rem)]:items-start [@container(min-width:48rem)]:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
              <Icon
                icon={getSecurityEntityIcon(type)}
                className="h-5 w-5 text-gray-500"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {translator.translateText(type) || type}
                </span>
                {breakdown?.criticality ? (
                  <EntityCriticalityPill criticality={breakdown.criticality} />
                ) : (
                  <></>
                )}
              </div>
              <h1 className="mt-0.5 font-mono text-xl font-semibold text-gray-900 [overflow-wrap:anywhere]">
                {risk?.entityValue || value}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 [@container(min-width:48rem)]:flex-shrink-0 [@container(min-width:48rem)]:justify-end">
            <Button
              title={OPEN_IN_CORRELATE}
              icon={IconProp.Share}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                Navigation.navigate(getCorrelateRouteForEntity(value));
              }}
            />
            <Button
              title={SEARCH_ITS_EVENTS}
              icon={IconProp.Search}
              buttonStyle={ButtonStyleType.NORMAL}
              onClick={() => {
                Navigation.navigate(
                  getEntityEventsRoute(value, OneUptimeDate.getCurrentDate()),
                );
              }}
            />
            {hasScore && resetGate.isAllowed ? (
              <Button
                title={RESET_RISK}
                icon={IconProp.Refresh}
                buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                dataTestId={ENTITY_RISK_TEST_IDS.reset}
                onClick={() => {
                  setResetError("");
                  setIsConfirmingReset(true);
                }}
              />
            ) : (
              <></>
            )}
          </div>
        </div>

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
      </section>

      <div data-testid={ENTITY_RISK_TEST_IDS.activity}>
        {activityError ? (
          <Card title="Activity">
            <ErrorMessage message={activityError} />
          </Card>
        ) : (
          <EventStatBar
            columns={4}
            isLaidOutByOwnWidth={true}
            ariaLabel="Activity"
          >
            <EventStatTile
              variant="segment"
              icon={IconProp.List}
              label={ACTIVITY_EVENTS}
              value={translator.formatNumber(activity?.eventCount || 0)}
              description={translator.translatePlural(
                {
                  one: "In the last {{count}} day",
                  other: "In the last {{count}} days",
                },
                ENTITY_RISK_WINDOW_IN_DAYS,
              )}
            />
            <EventStatTile
              variant="segment"
              icon={IconProp.ShieldExclamation}
              label={ACTIVITY_FINDINGS}
              value={translator.formatNumber(activity?.findingCount || 0)}
            />
            <EventStatTile
              variant="segment"
              icon={IconProp.Clock}
              label={ACTIVITY_FIRST_SEEN}
              value={
                activity?.firstSeen
                  ? OneUptimeDate.fromNow(activity.firstSeen)
                  : "-"
              }
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

      {breakdown && hasScore ? (
        <>
          <EntityRiskSources sources={breakdown.sources} />
          <EntityRiskHistory
            history={risk?.riskHistory}
            threshold={breakdown.threshold}
          />
        </>
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
