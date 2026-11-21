import AppLink from "../../AppLink/AppLink";
import { getFeedStatus } from "./BlocklistFeedFields";
import { getBlocklistFeedViewRoute } from "./BlocklistFeedRoutes";
import {
  BLOCKLIST_FEEDS_TEST_IDS,
  STOPPED_READING_FEED_SENTENCE,
} from "./BlocklistFeedsCopy";
import SecurityBlocklistFeed from "Common/Models/DatabaseModels/SecurityBlocklistFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { SecurityBlocklistFeedStatus } from "Common/Types/SecurityBlocklist/SecurityBlocklistFeed";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A FIREWALL THAT STOPS READING ITS FEED IS A PROBLEM (#10345), said where
 * the blocks are: above the Blocklist, one line per feed whose firewall has
 * not fetched it for three times its usual interval - "Your firewall stopped
 * reading Palo Alto feed 3 hours ago, so blocks are not enforced there until
 * it reads it again." - each feed's name opening its page. Nothing while
 * every firewall reads its feed, and nothing for a reader who may not read
 * the feeds.
 */

export interface ComponentProps {
  // Changed when the page reads its blocks again: the feeds are read again too.
  refreshToggle: string;
}

// The most feeds one read takes: a project has a handful.
const FEEDS_READ: number = 100;

const BlocklistFeedsStoppedNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [feeds, setFeeds] = useState<Array<SecurityBlocklistFeed>>([]);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    let isCurrent: boolean = true;

    if (!projectId) {
      return;
    }

    ModelAPI.getList<SecurityBlocklistFeed>({
      modelType: SecurityBlocklistFeed,
      query: { projectId },
      select: {
        _id: true,
        name: true,
        secretHint: true,
        lastFetchedAt: true,
        usualFetchIntervalInSeconds: true,
      },
      limit: FEEDS_READ,
      skip: 0,
      sort: { name: SortOrder.Ascending },
    })
      .then((result: ListResult<SecurityBlocklistFeed>) => {
        if (isCurrent) {
          setFeeds(result.data);
        }
      })
      .catch(() => {
        // A reader who may not read the feeds is told nothing of them.
        if (isCurrent) {
          setFeeds([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.refreshToggle]);

  const now: Date = OneUptimeDate.getCurrentDate();
  const stopped: Array<SecurityBlocklistFeed> = feeds.filter(
    (feed: SecurityBlocklistFeed): boolean => {
      return (
        getFeedStatus(feed, now) === SecurityBlocklistFeedStatus.StoppedReading
      );
    },
  );

  if (stopped.length === 0) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.DANGER}
      dataTestId={BLOCKLIST_FEEDS_TEST_IDS.stoppedNotice}
      className="mb-5"
      title={
        <div className="space-y-1">
          {stopped.map((feed: SecurityBlocklistFeed): ReactElement => {
            return (
              <p key={feed.id?.toString() || feed.name || ""}>
                <TranslatedSentence
                  template={STOPPED_READING_FEED_SENTENCE}
                  slots={{
                    feed: (
                      <AppLink
                        to={getBlocklistFeedViewRoute(feed.id!)}
                        className="font-medium underline"
                      >
                        {feed.name || ""}
                      </AppLink>
                    ),
                  }}
                  values={{
                    time: OneUptimeDate.fromNow(
                      new Date(feed.lastFetchedAt!),
                      now,
                    ),
                  }}
                />
              </p>
            );
          })}
        </div>
      }
    />
  );
};

export default BlocklistFeedsStoppedNotice;
