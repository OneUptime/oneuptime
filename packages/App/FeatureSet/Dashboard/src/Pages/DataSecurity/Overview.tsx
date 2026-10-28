import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import DataSecurityApi from "../../Components/DataSecurity/DataSecurityApi";
import { SeverityPill } from "../../Components/DataSecurity/DataSecurityPills";
import OverviewGettingStarted from "../../Components/DataSecurity/OverviewGettingStarted";
import { getDataSecurityIssueRoute } from "../../Components/DataSecurity/StoreIssuesTable";
import EventStatBar from "../../Components/EventView/EventStatBar";
import EventStatTile from "../../Components/EventView/EventStatTile";
import RankedBars, {
  RankedBarItem,
} from "../../Components/SecurityOverview/RankedBars";
import StackedDayBars, {
  StackedSeries,
} from "../../Components/SecurityOverview/StackedDayBars";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import DataCategory from "Common/Types/DataSecurity/DataCategory";
import {
  DataSecurityOverview,
  DataSecurityOverviewIssue,
  DataSecurityOverviewTrendDay,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import DataSensitivity from "Common/Types/DataSecurity/DataSensitivity";
import IconProp from "Common/Types/Icon/IconProp";
import SecuritySeverity from "Common/Types/SecuritySeverity";
import { DayCount } from "Common/Utils/SecurityCase/SecurityOverviewMetrics";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * DATA SECURITY AT A GLANCE.
 *
 * The four questions, in the order people ask them: what sensitive data do
 * we have (the sensitive stores, and the kinds of data in them), where is it
 * and who can reach it (the sensitive stores that are public or shared
 * outside), what do we fix first (the open issues, riskiest first, and how
 * they have moved in a month), and how much of it OneUptime has looked at
 * (scan coverage). Everything is worked out by the server
 * (DataSecurityApi.getOverview), so the page reads it in one request.
 *
 * Until anything is found, the page is a three-step start instead
 * (OverviewGettingStarted): connect a cloud, turn on Data Security for it,
 * review the issues.
 */

// Each category's colour on the "Stores by Data Category" bars.
const CATEGORY_COLORS: Readonly<Record<DataCategory, string>> = {
  [DataCategory.SecretsAndCredentials]: "#ef4444",
  [DataCategory.Financial]: "#f97316",
  [DataCategory.Health]: "#f43f5e",
  [DataCategory.GovernmentId]: "#f59e0b",
  [DataCategory.SpecialCategory]: "#a855f7",
  [DataCategory.ContactAndIdentity]: "#6366f1",
  [DataCategory.BusinessConfidential]: "#6b7280",
};

const SEVERITY_BAR_COLORS: Readonly<Record<SecuritySeverity, string>> = {
  [SecuritySeverity.Critical]: "#ef4444",
  [SecuritySeverity.High]: "#f97316",
  [SecuritySeverity.Medium]: "#eab308",
  [SecuritySeverity.Low]: "#3b82f6",
};

// The trend's two series: issues opened and issues resolved, each day.
const TREND_SERIES: Array<StackedSeries> = [
  { key: "opened", label: translationKey("Opened"), color: "#ef4444" },
  { key: "resolved", label: translationKey("Resolved"), color: "#22c55e" },
];

const STORES_CHECKED: string = translationKey("stores checked");
const STORES_CONTENT_SCANNED: string = translationKey(
  "stores with their content scanned",
);

export const DATA_SECURITY_OVERVIEW_CHARTS_ID: string =
  "data-security-overview-charts";
export const DATA_SECURITY_OVERVIEW_COVERAGE_ID: string =
  "data-security-overview-coverage";

function countOf(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// The trend as the day-by-day bars read it.
export function getTrendDays(
  trend: Array<DataSecurityOverviewTrendDay> | undefined,
): Array<DayCount> {
  return (trend || []).map((day: DataSecurityOverviewTrendDay): DayCount => {
    const opened: number = countOf(day.opened);
    const resolved: number = countOf(day.resolved);

    return {
      day: day.day,
      total: opened + resolved,
      byKey: { opened: opened, resolved: resolved },
    };
  });
}

const DataSecurityOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [overview, setOverview] = useState<DataSecurityOverview | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [readCount, setReadCount] = useState<number>(0);
  // Whether the overview was ever read: a read again that fails keeps it.
  const hasLoaded: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(!hasLoaded.current);

      try {
        const result: DataSecurityOverview =
          await DataSecurityApi.getOverview();

        if (!isCurrent) {
          return;
        }

        hasLoaded.current = true;
        setError("");
        setOverview(result);
      } catch (err) {
        if (!isCurrent) {
          return;
        }

        if (!hasLoaded.current) {
          setError(API.getFriendlyMessage(err));
        }
      }

      setIsLoading(false);
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  const readAgain: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  const route: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route);
  };

  if (error) {
    return <ErrorMessage message={error} onRefreshClick={readAgain} />;
  }

  if (isLoading || !overview) {
    return <PageLoader isVisible={true} />;
  }

  const storeCount: number = countOf(overview.storeCount);
  const connectionsWithoutContentAccess: number = countOf(
    overview.connectionsWithoutContentAccess,
  );

  // Content scanning needs the connection's content level: say so, and where.
  const contentAccessCallout: ReactElement =
    connectionsWithoutContentAccess > 0 ? (
      <Alert
        type={AlertType.INFO}
        dataTestId="data-security-content-access-callout"
        title={
          <span>
            {translator.translatePlural(
              {
                one: "{{count}} cloud connection lets Data Security read how its stores are set up, but not what is in them. To find sensitive data inside buckets and databases, set its Data security setting to Configuration and content samples, and run the command it shows.",
                other:
                  "{{count}} cloud connections let Data Security read how their stores are set up, but not what is in them. To find sensitive data inside buckets and databases, set their Data security setting to Configuration and content samples, and run the command it shows.",
              },
              connectionsWithoutContentAccess,
            )}{" "}
            <AppLink
              to={route(PageMap.CLOUD_CONNECT)}
              className="font-medium underline"
            >
              <span>{translator.translateText("Open cloud connections")}</span>
            </AppLink>
          </span>
        }
      />
    ) : (
      <></>
    );

  if (storeCount === 0) {
    return (
      <div className="space-y-5">
        {contentAccessCallout}
        <OverviewGettingStarted
          hasCloudConnection={Boolean(overview.hasCloudConnection)}
        />
      </div>
    );
  }

  const bySensitivity: Partial<Record<DataSensitivity, number>> =
    overview.storesBySensitivity || {};
  const restricted: number = countOf(bySensitivity[DataSensitivity.Restricted]);
  const confidential: number = countOf(
    bySensitivity[DataSensitivity.Confidential],
  );
  const bySeverity: Partial<Record<SecuritySeverity, number>> =
    overview.openIssuesBySeverity || {};
  const critical: number = countOf(bySeverity[SecuritySeverity.Critical]);
  const high: number = countOf(bySeverity[SecuritySeverity.High]);
  const openIssues: number =
    critical +
    high +
    countOf(bySeverity[SecuritySeverity.Medium]) +
    countOf(bySeverity[SecuritySeverity.Low]);

  const categoryItems: Array<RankedBarItem> = [
    ...(overview.storesByCategory || []),
  ]
    .filter(
      (entry: { category: DataCategory; storeCount: number }): boolean => {
        return countOf(entry.storeCount) > 0;
      },
    )
    .sort(
      (
        a: { category: DataCategory; storeCount: number },
        b: { category: DataCategory; storeCount: number },
      ): number => {
        return countOf(b.storeCount) - countOf(a.storeCount);
      },
    )
    .map(
      (entry: {
        category: DataCategory;
        storeCount: number;
      }): RankedBarItem => {
        return {
          key: entry.category,
          label: translator.translateText(entry.category) || entry.category,
          count: countOf(entry.storeCount),
          color: CATEGORY_COLORS[entry.category] || "#6366f1",
        };
      },
    );

  const topIssueItems: Array<RankedBarItem> = (overview.topIssues || [])
    .slice(0, 5)
    .map((issue: DataSecurityOverviewIssue): RankedBarItem => {
      const riskScore: number = countOf(issue.riskScore);

      return {
        key: issue.issueId,
        label: issue.title,
        hint: issue.dataStoreName,
        count: riskScore,
        fillPercent: riskScore,
        color: SEVERITY_BAR_COLORS[issue.severity] || "#6366f1",
        badge: <SeverityPill severity={issue.severity} />,
        to: getDataSecurityIssueRoute(issue.issueId),
      };
    });

  return (
    <div className="space-y-5">
      {contentAccessCallout}

      {overview.hasCloudConnection ? (
        <></>
      ) : (
        <Alert
          type={AlertType.INFO}
          dataTestId="data-security-no-cloud-callout"
          title={
            <span>
              {translator.translateText(
                "Only your telemetry and the databases you added are checked. Connect a cloud account to find your buckets and databases there too.",
              )}{" "}
              <AppLink
                to={route(PageMap.CLOUD_CONNECT)}
                className="font-medium underline"
              >
                <span>{translator.translateText("Connect a cloud")}</span>
              </AppLink>
            </span>
          }
        />
      )}

      <EventStatBar
        columns={4}
        ariaLabel={translator.translateText("Data security figures")}
      >
        <EventStatTile
          variant="segment"
          icon={IconProp.Fingerprint}
          label="Sensitive Stores"
          value={translator.formatNumber(restricted + confidential)}
          description={translator.translateTemplate(
            "{{restricted}} restricted, {{confidential}} confidential",
            {
              restricted: translator.formatNumber(restricted),
              confidential: translator.formatNumber(confidential),
            },
          )}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.Globe}
          label="Exposed Sensitive Stores"
          value={translator.formatNumber(
            countOf(overview.exposedSensitiveStoreCount),
          )}
          description={translator.translateText(
            "Public, or shared outside your accounts",
          )}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.ShieldExclamation}
          label="Open Issues"
          value={translator.formatNumber(openIssues)}
          description={translator.translateTemplate(
            "{{critical}} critical, {{high}} high",
            {
              critical: translator.formatNumber(critical),
              high: translator.formatNumber(high),
            },
          )}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.Logs}
          label="Not Scrubbed in Telemetry"
          value={translator.formatNumber(
            countOf(overview.unscrubbedTelemetryFindingCount),
          )}
          description={translator.translatePlural(
            {
              one: "of {{count}} finding in your telemetry",
              other: "of {{count}} findings in your telemetry",
            },
            countOf(overview.telemetryFindingCount),
          )}
        />
      </EventStatBar>

      <CardGrid columns={2} dataTestId={DATA_SECURITY_OVERVIEW_CHARTS_ID}>
        <Card
          title="Fix These First"
          description="The open issues with the highest risk, from 0 to 100: how sensitive the data is, how exposed the store is, and what the check found."
          buttons={[
            {
              title: "See All Issues",
              icon: IconProp.ShieldExclamation,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                Navigation.navigate(route(PageMap.DATA_SECURITY_ISSUES));
              },
            },
          ]}
        >
          <RankedBars
            items={topIssueItems}
            total={100}
            emptyText="No open issues. Every check passes on the stores Data Security has read."
          />
        </Card>
        <Card
          title="Stores by Data Category"
          description="How many stores hold each kind of sensitive data. A store with several kinds is counted under each."
          buttons={[
            {
              title: "See Sensitive Data",
              icon: IconProp.Fingerprint,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                Navigation.navigate(
                  route(PageMap.DATA_SECURITY_SENSITIVE_DATA),
                );
              },
            },
          ]}
        >
          <RankedBars
            items={categoryItems}
            total={Math.max(1, storeCount)}
            emptyText="No sensitive data found in your stores yet."
          />
        </Card>
      </CardGrid>

      <CardGrid columns={2} dataTestId={DATA_SECURITY_OVERVIEW_COVERAGE_ID}>
        <Card
          title="Issues in the Last 30 Days"
          description="Issues opened and resolved each day."
        >
          <StackedDayBars
            days={getTrendDays(overview.issueTrend)}
            series={TREND_SERIES}
            ariaLabel="Issues opened and resolved per day"
          />
        </Card>
        <Card
          title="Scan Coverage"
          description="How much of your data Data Security has looked at: every store's configuration is checked, and its content is sampled where OneUptime can read it."
          buttons={[
            {
              title: "See Scans",
              icon: IconProp.MagnifyingGlass,
              buttonStyle: ButtonStyleType.NORMAL,
              onClick: () => {
                Navigation.navigate(route(PageMap.DATA_SECURITY_SCANS));
              },
            },
          ]}
        >
          <div className="space-y-5">
            <ProgressBar
              count={countOf(overview.evaluatedStoreCount)}
              totalCount={storeCount}
              suffix={STORES_CHECKED}
              size={ProgressBarSize.Small}
            />
            <ProgressBar
              count={countOf(overview.contentScannedStoreCount)}
              totalCount={storeCount}
              suffix={STORES_CONTENT_SCANNED}
              size={ProgressBarSize.Small}
            />
            <p className="text-sm text-gray-500">
              <TranslatedSentence
                template="A store is checked once its configuration is read, and scanned once samples of its content are. {{link}}"
                slots={{
                  link: (
                    <AppLink
                      to={route(PageMap.DATA_SECURITY_SETTINGS_SCANNING)}
                      className="font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      <span>
                        {translator.translateText(
                          "Change how stores are scanned",
                        )}
                      </span>
                    </AppLink>
                  ),
                }}
              />
            </p>
          </div>
        </Card>
      </CardGrid>
    </div>
  );
};

export default DataSecurityOverviewPage;
