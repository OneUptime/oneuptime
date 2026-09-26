import SubscriberUnsubscribeCopy, {
  RECENTLY_UNSUBSCRIBED_LIST_LIMIT,
  RECENTLY_UNSUBSCRIBED_WINDOW_IN_DAYS,
} from "./SubscriberUnsubscribeCopy";
import { formatScopeText } from "../Incident/IncidentStatusPageScopeCopy";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberUnsubscribe, {
  StatusPageSubscriberContact,
} from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

/*
 * A notice above a status page's subscriber list naming the subscribers the
 * team added (they have a creator: dashboard and API creates) that have
 * unsubscribed recently.
 *
 * Every notification carries an unsubscribe link that works without signing
 * in, so one reader of a shared address - a site's mailing list, say - can
 * take the whole site off the page. The page's owners and whoever added the
 * subscriber are emailed when that happens; this keeps it on screen for
 * everyone else who manages the list, until it is old news. It names
 * teammates' own unsubscribes too - the list cannot tell who pressed the
 * button, and a subscriber the team added is not getting notifications
 * either way.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  projectId: ObjectID;
  /*
   * The same channel filter the list uses (e.g. { subscriberEmail: new
   * NotNull() }), so each list names only its own subscribers.
   */
  channelQuery: Query<StatusPageSubscriber>;
  // The contact columns this channel's subscribers are named by.
  contactSelect: Select<StatusPageSubscriber>;
}

interface RecentUnsubscribe {
  id: string;
  contact: string;
  unsubscribedAt: Date;
}

const TeamAddedSubscribersUnsubscribedNotice: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const { translateString } = useTranslateValue();
  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const [recent, setRecent] = useState<Array<RecentUnsubscribe>>([]);
  const [total, setTotal] = useState<number>(0);

  useAsyncEffect(async () => {
    try {
      const result: ListResult<StatusPageSubscriber> =
        await ModelAPI.getList<StatusPageSubscriber>({
          modelType: StatusPageSubscriber,
          query: {
            ...props.channelQuery,
            statusPageId: props.statusPageId,
            projectId: props.projectId,
            isUnsubscribed: true,
            createdByUserId: new NotNull(),
            unsubscribedAt: new GreaterThan(
              OneUptimeDate.getSomeDaysAgo(
                RECENTLY_UNSUBSCRIBED_WINDOW_IN_DAYS,
              ),
            ),
          },
          select: {
            _id: true,
            unsubscribedAt: true,
            ...props.contactSelect,
          },
          sort: {
            unsubscribedAt: SortOrder.Descending,
          },
          skip: 0,
          limit: RECENTLY_UNSUBSCRIBED_LIST_LIMIT,
        });

      setTotal(result.count);
      setRecent(
        result.data
          .filter((subscriber: StatusPageSubscriber): boolean => {
            return Boolean(subscriber._id && subscriber.unsubscribedAt);
          })
          .map((subscriber: StatusPageSubscriber): RecentUnsubscribe => {
            const contact: StatusPageSubscriberContact | null =
              StatusPageSubscriberUnsubscribe.describeContact(subscriber, {
                maskPhone: false,
              });

            return {
              id: subscriber._id!.toString(),
              contact: contact?.contact || subscriber._id!.toString(),
              unsubscribedAt: subscriber.unsubscribedAt!,
            };
          }),
      );
    } catch {
      // A notice that cannot load is left out; the list below still works.
      setRecent([]);
      setTotal(0);
    }
  }, [props.statusPageId.toString()]);

  if (recent.length === 0) {
    return <Fragment />;
  }

  const more: number = Math.max(total - recent.length, 0);

  return (
    <Alert
      type={AlertType.WARNING}
      dataTestId="team-added-subscribers-unsubscribed"
      strongTitle={SubscriberUnsubscribeCopy.recentlyUnsubscribedTitle}
      title={
        <div>
          <p>
            {translate(
              SubscriberUnsubscribeCopy.recentlyUnsubscribedDescription,
            )}
          </p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            {recent.map((item: RecentUnsubscribe): ReactElement => {
              return (
                <li key={item.id}>
                  {formatScopeText(
                    translate(
                      SubscriberUnsubscribeCopy.recentlyUnsubscribedItem,
                    ),
                    {
                      contact: item.contact,
                      date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        item.unsubscribedAt,
                      ),
                    },
                  )}
                </li>
              );
            })}
          </ul>
          {more > 0 ? (
            <p className="mt-2">
              {formatScopeText(
                translate(SubscriberUnsubscribeCopy.recentlyUnsubscribedMore),
                { count: more },
              )}
            </p>
          ) : null}
        </div>
      }
    />
  );
};

export default TeamAddedSubscribersUnsubscribedNotice;
