import PageComponentProps from "../PageComponentProps";
import ResellerPlanNotice from "../../Components/Billing/ResellerPlanNotice";
import {
  getSecretShownOnCreate,
  rememberSecretForFeed,
} from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedApi";
import {
  BlocklistFeedEntriesCell,
  BlocklistFeedLastFetchedCell,
  BlocklistFeedStatusCell,
  getBlocklistFeedFormFields,
} from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedFields";
import {
  BLOCKLIST_FEEDS_TEST_IDS,
  ENTRIES_COLUMN_TITLE,
  FEEDS_EMPTY_DESCRIPTION,
  FEEDS_EMPTY_TITLE,
  FEEDS_TABLE_DESCRIPTION,
  FEEDS_TABLE_TITLE,
  FEED_PLURAL,
  FEED_SINGULAR,
  LAST_FETCHED_COLUMN_TITLE,
  NAME_COLUMN_TITLE,
  OTHER_FIREWALL_LABEL,
  STATUS_COLUMN_TITLE,
} from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedsCopy";
import { getBlocklistFeedViewRoute } from "../../Components/SecurityEvents/BlocklistFeeds/BlocklistFeedRoutes";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SecurityBlocklistFeed from "Common/Models/DatabaseModels/SecurityBlocklistFeed";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES,
  SecurityBlocklistFeedFirewall,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeed";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

// The firewall a feed is for, as its maker names it.
export function getFirewallName(
  translator: Translator,
  firewall: SecurityBlocklistFeedFirewall | undefined,
): string {
  return !firewall || firewall === SecurityBlocklistFeedFirewall.Other
    ? translator.translateText(OTHER_FIREWALL_LABEL) || OTHER_FIREWALL_LABEL
    : SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES[firewall];
}

/*
 * SECURITY EVENTS > PLAYBOOKS > BLOCKLIST FEEDS (#10345): the secret URLs
 * the project's firewalls and proxies read the blocklist from - each with
 * whether its firewall reads it, when it last did and from where, and how
 * many entries it holds. Create Blocklist Feed asks which firewall reads it
 * and opens the feed's page, where its secret is shown once, with the steps
 * for that firewall.
 */
const SecurityBlocklistFeedsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // Same reseller-telemetry gate as every other Security Events page.
  if (props.currentProject?.reseller?.enableTelemetryFeatures === false) {
    return (
      <ResellerPlanNotice
        project={props.currentProject}
        product="Security Events"
      />
    );
  }

  if (!projectId) {
    return <></>;
  }

  const now: Date = OneUptimeDate.getCurrentDate();

  return (
    <ModelTable<SecurityBlocklistFeed>
      modelType={SecurityBlocklistFeed}
      id={BLOCKLIST_FEEDS_TEST_IDS.table}
      name="Security Events > Blocklist Feeds"
      userPreferencesKey={BLOCKLIST_FEEDS_TEST_IDS.table}
      singularName={FEED_SINGULAR}
      pluralName={FEED_PLURAL}
      getItemName={(feed: SecurityBlocklistFeed): string => {
        return feed.name || "";
      }}
      query={{ projectId }}
      isDeleteable={true}
      // A feed is changed on its page, beside its secret and its steps.
      isEditable={false}
      isCreateable={true}
      isViewable={true}
      viewButtonText="View"
      viewPageRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_BLOCKLIST_FEEDS] as Route,
      )}
      formFields={getBlocklistFeedFormFields({ translator })}
      onCreateSuccess={(
        feed: SecurityBlocklistFeed,
      ): Promise<SecurityBlocklistFeed> => {
        /*
         * The create's answer is the one time the server sends the secret:
         * the feed's page shows it, once, with the steps that need it.
         */
        if (feed._id) {
          const secret: string | null = getSecretShownOnCreate(feed.secret);

          if (secret) {
            rememberSecretForFeed(feed._id, secret);
          }

          Navigation.navigate(getBlocklistFeedViewRoute(feed._id));
        }

        return Promise.resolve(feed);
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: FEEDS_TABLE_TITLE,
        description: FEEDS_TABLE_DESCRIPTION,
      }}
      emptyState={{
        title: FEEDS_EMPTY_TITLE,
        description: FEEDS_EMPTY_DESCRIPTION,
        icon: IconProp.CloudArrowDown,
      }}
      showRefreshButton={true}
      searchableFields={["name"]}
      filters={[]}
      selectMoreFields={{
        firewall: true,
        secretHint: true,
        lastFetchedAt: true,
        lastFetchSourceIp: true,
        usualFetchIntervalInSeconds: true,
        servedCount: true,
      }}
      columns={[
        {
          field: { name: true },
          title: NAME_COLUMN_TITLE,
          type: FieldType.Element,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[18rem]",
          getExportValue: (feed: SecurityBlocklistFeed): string => {
            return feed.name || "";
          },
          getElement: (feed: SecurityBlocklistFeed): ReactElement => {
            return (
              <div>
                <span className="text-sm font-medium text-gray-900">
                  {feed.name || ""}
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  {getFirewallName(translator, feed.firewall)}
                </span>
              </div>
            );
          },
        },
        {
          field: { lastFetchedAt: true },
          title: STATUS_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          getElement: (feed: SecurityBlocklistFeed): ReactElement => {
            return <BlocklistFeedStatusCell feed={feed} now={now} />;
          },
        },
        {
          field: { lastFetchSourceIp: true },
          title: LAST_FETCHED_COLUMN_TITLE,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (feed: SecurityBlocklistFeed): ReactElement => {
            return <BlocklistFeedLastFetchedCell feed={feed} now={now} />;
          },
        },
        {
          field: { servedCount: true },
          title: ENTRIES_COLUMN_TITLE,
          type: FieldType.Element,
          hideOnMobile: true,
          getElement: (feed: SecurityBlocklistFeed): ReactElement => {
            return <BlocklistFeedEntriesCell feed={feed} />;
          },
        },
      ]}
    />
  );
};

export default SecurityBlocklistFeedsPage;
