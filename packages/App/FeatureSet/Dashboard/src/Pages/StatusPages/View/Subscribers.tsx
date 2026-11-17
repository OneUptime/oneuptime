import PageComponentProps from "../../PageComponentProps";
import StatusPageSubscriberList from "../../../Components/StatusPage/StatusPageSubscriberList";
import {
  SUBSCRIBER_LIST_CHANNELS,
  SubscriberListChannel,
  getSubscriberChannelQuery,
  getSubscriberListChannel,
  getSubscriberListChannelByTabName,
} from "../../../Components/StatusPage/SubscriberListChannels";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberChannel, {
  DEFAULT_STATUS_PAGE_SUBSCRIBER_CHANNEL,
  STATUS_PAGE_SUBSCRIBER_CHANNEL_QUERY_PARAM,
  readStatusPageSubscriberChannel,
} from "Common/Types/StatusPage/StatusPageSubscriberChannel";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A status page's subscribers, on one page with a tab per channel: Email,
 * SMS, Slack, Microsoft Teams and Webhook. Each tab carries how many
 * subscribers the channel has, and draws the same list
 * (StatusPageSubscriberList), configured by its channel
 * (SubscriberListChannels).
 *
 * These were five pages until #9125, one menu entry each, so finding out who
 * was subscribed meant opening five pages. One kind of record is one page
 * (Docs/ux/README.md#side-menus).
 *
 * The open tab is in the address (`?channel=sms`, from Common's
 * StatusPageSubscriberChannel), so the old per-channel addresses forward to
 * their tab (Routes/StatusPagesRoutes), the emails the server sends open the
 * right one, and a reload stays there. A bare address opens Email. It is
 * written in place, without a history entry, as the On-Call Rules tabs do.
 */
export const STATUS_PAGE_SUBSCRIBERS_TABS_TEST_ID: string =
  "status-page-subscribers-tabs";

const StatusPageSubscribers: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const statusPageId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  const requestedChannel: StatusPageSubscriberChannel =
    readStatusPageSubscriberChannel(
      Navigation.getQueryStringByName(
        STATUS_PAGE_SUBSCRIBER_CHANNEL_QUERY_PARAM,
      ),
    ) || DEFAULT_STATUS_PAGE_SUBSCRIBER_CHANNEL;

  // How many subscribers each channel has, for its tab; none until counted.
  const [counts, setCounts] = useState<Dictionary<number>>({});

  const countChannel: (
    channel: StatusPageSubscriberChannel,
  ) => Promise<void> = async (
    channel: StatusPageSubscriberChannel,
  ): Promise<void> => {
    try {
      const count: number = await ModelAPI.count<StatusPageSubscriber>({
        modelType: StatusPageSubscriber,
        query: {
          ...getSubscriberChannelQuery(getSubscriberListChannel(channel)),
          statusPageId: statusPageId,
          projectId: projectId,
        },
      });

      setCounts((previous: Dictionary<number>): Dictionary<number> => {
        return { ...previous, [channel]: count };
      });
    } catch {
      /*
       * A count is a hint on a tab, not the list: the tab is drawn without
       * one, and the list says what went wrong if it is the list.
       */
    }
  };

  useEffect(() => {
    for (const definition of SUBSCRIBER_LIST_CHANNELS) {
      void countChannel(definition.channel);
    }
  }, []);

  const tabs: Array<Tab> = SUBSCRIBER_LIST_CHANNELS.map(
    (definition: SubscriberListChannel): Tab => {
      return {
        name: definition.copy.title,
        countBadge: counts[definition.channel],
        /*
         * Keyed by channel: the tab panel draws one child at a time in the
         * same place, and without a key React would hand the previous tab's
         * list (its loaded status page, its open dialog) to the next one.
         */
        children: (
          <StatusPageSubscriberList
            key={definition.channel}
            channel={definition.channel}
            statusPageId={statusPageId}
            projectId={projectId}
            currentProject={props.currentProject}
            onSubscribersChanged={() => {
              void countChannel(definition.channel);
            }}
          />
        ),
      };
    },
  );

  return (
    <div data-testid={STATUS_PAGE_SUBSCRIBERS_TABS_TEST_ID}>
      <Tabs
        label="Subscribers"
        tabs={tabs}
        initialTabName={getSubscriberListChannel(requestedChannel).copy.title}
        onTabChange={(tab: Tab): void => {
          const definition: SubscriberListChannel | undefined =
            getSubscriberListChannelByTabName(tab.name);

          if (!definition) {
            return;
          }

          /*
           * The open tab goes into the address in place (no history entry),
           * so a reload or a copied link opens it again. The first tab is
           * the bare address.
           */
          Navigation.setQueryString({
            [STATUS_PAGE_SUBSCRIBER_CHANNEL_QUERY_PARAM]:
              definition.channel === DEFAULT_STATUS_PAGE_SUBSCRIBER_CHANNEL
                ? null
                : definition.channel,
          });
        }}
      />
    </div>
  );
};

export default StatusPageSubscribers;
