import React, { ReactElement, useCallback } from "react";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "Common/Models/DatabaseModels/User";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import useFeedItems, {
  UseFeedItemsResult,
} from "Common/UI/Components/Feed/useFeedItems";
import useFeedOptions, {
  UseFeedOptionsResult,
} from "Common/UI/Components/Feed/useFeedOptions";
import FeedCard from "Common/UI/Components/Feed/FeedCard";
import FeedContent from "Common/UI/Components/Feed/FeedContent";
import {
  FeedEntryKind,
  SHARED_FEED_ENTRY_KINDS,
  getFeedEntryColor,
} from "Common/UI/Components/Feed/FeedEntryKind";
import {
  GetFeedEventTypeIconFunction,
  getFeedEventTypeQuery,
  getFeedNoItemsMessage,
} from "Common/UI/Components/Feed/FeedOptions";

/*
 * Every infrastructure and catalog resource feed - Kubernetes clusters, Docker
 * and Podman hosts, Docker Swarm / Proxmox / Ceph clusters, vCenters, servers, cloud
 * resources and catalog services - and the SLO feed store the same shape:
 * markdown, a colour, the acting user and a posted-at. Only the two column
 * names differ (the foreign key back to the resource, and the event type
 * column), along with the list of event types the event type filter
 * offers, so the whole feed page is one component parameterised by those
 * rather than eleven copies that drift apart. A feed whose events the shared
 * kind rules do not cover passes its own `getKind`.
 */
export interface ResourceFeedModel extends BaseModel {
  feedInfoInMarkdown?: string | undefined;
  moreInformationInMarkdown?: string | undefined;
  displayColor?: Color | undefined;
  user?: User | undefined;
  postedAt?: Date | undefined;
}

export interface ComponentProps<TFeedModel extends ResourceFeedModel> {
  modelType: { new (): TFeedModel };
  /** Foreign key column on the feed table, e.g. "kubernetesClusterId". */
  resourceIdColumn: string;
  resourceId: ObjectID;
  /** Event type column on the feed table, e.g. "kubernetesClusterFeedEventType". */
  eventTypeColumn: string;
  /**
   * Every value of the feed model's event type enum, e.g.
   * Object.values(KubernetesClusterFeedEventType) - the checklist of the
   * event type filter.
   */
  eventTypes: Array<string>;
  title: string;
  description: string;
  noItemsMessage: string;
  /*
   * Kinds for the event types that are this feed's own - an SLO's
   * StatusChanged or BurnRateAlertRaised - which the shared suffix rules
   * below know nothing about. Returning undefined falls back to those rules,
   * so a feed maps only what is its own and its Created / Updated / owner
   * events still look like every other feed's.
   */
  getKind?: GetResourceFeedKindFunction | undefined;
}

export type GetResourceFeedKindFunction = (
  eventType: string,
) => FeedEntryKind | undefined;

type GetKindForEventType = (eventType: string) => FeedEntryKind;

/*
 * Event type members are named <Model>Created / <Model>Updated / ... per feed
 * model, so the kind is chosen from the suffix rather than from an enum this
 * component would have to import ten times over. The owner and rule events
 * share their names across every feed, and their kinds with every other
 * feed in the product.
 */
export const getKindForEventType: GetKindForEventType = (
  eventType: string,
): FeedEntryKind => {
  switch (eventType) {
    case "OwnerUserAdded":
      return SHARED_FEED_ENTRY_KINDS.OwnerUserAdded;
    case "OwnerTeamAdded":
      return SHARED_FEED_ENTRY_KINDS.OwnerTeamAdded;
    case "OwnerUserRemoved":
      return SHARED_FEED_ENTRY_KINDS.OwnerUserRemoved;
    case "OwnerTeamRemoved":
      return SHARED_FEED_ENTRY_KINDS.OwnerTeamRemoved;
    case "OwnerRuleExecuted":
      return SHARED_FEED_ENTRY_KINDS.OwnerRuleExecuted;
    case "LabelRuleExecuted":
      return SHARED_FEED_ENTRY_KINDS.LabelRuleExecuted;
    default:
      break;
  }

  if (eventType.endsWith("Created")) {
    return SHARED_FEED_ENTRY_KINDS.Created;
  }

  if (eventType.endsWith("Updated")) {
    return SHARED_FEED_ENTRY_KINDS.Updated;
  }

  if (eventType.endsWith("Archived")) {
    return SHARED_FEED_ENTRY_KINDS.Archived;
  }

  if (eventType.endsWith("Restored")) {
    return SHARED_FEED_ENTRY_KINDS.Restored;
  }

  return SHARED_FEED_ENTRY_KINDS.Other;
};

// The icon of the shared rules alone: the event type filter's checklist.
export const getIconForEventType: (eventType: string) => IconProp = (
  eventType: string,
): IconProp => {
  return getKindForEventType(eventType).icon;
};

export type ResolveResourceFeedKindFunction = (data: {
  eventType: string;
  getKind?: GetResourceFeedKindFunction | undefined;
}) => FeedEntryKind;

// The feed's own mapping first, then the shared suffix rules.
export const resolveResourceFeedKind: ResolveResourceFeedKindFunction = (data: {
  eventType: string;
  getKind?: GetResourceFeedKindFunction | undefined;
}): FeedEntryKind => {
  const ownKind: FeedEntryKind | undefined = data.getKind
    ? data.getKind(data.eventType)
    : undefined;

  return ownKind || getKindForEventType(data.eventType);
};

export const resolveResourceFeedIcon: (data: {
  eventType: string;
  getKind?: GetResourceFeedKindFunction | undefined;
}) => IconProp = (data: {
  eventType: string;
  getKind?: GetResourceFeedKindFunction | undefined;
}): IconProp => {
  return resolveResourceFeedKind(data).icon;
};

const ResourceFeed: <TFeedModel extends ResourceFeedModel>(
  props: ComponentProps<TFeedModel>,
) => ReactElement = <TFeedModel extends ResourceFeedModel>(
  props: ComponentProps<TFeedModel>,
): ReactElement => {
  type GetFeedItem = (feed: TFeedModel) => FeedItemProps;

  const getFeedItem: GetFeedItem = (feed: TFeedModel): FeedItemProps => {
    const eventType: string =
      ((feed as unknown as Record<string, unknown>)[
        props.eventTypeColumn
      ] as string) || "";

    const kind: FeedEntryKind = resolveResourceFeedKind({
      eventType: eventType,
      getKind: props.getKind,
    });

    return {
      key: feed.id!.toString(),
      textInMarkdown: feed.feedInfoInMarkdown || "",
      moreTextInMarkdown: feed.moreInformationInMarkdown || "",
      user: feed.user,
      itemDateTime: feed.postedAt || feed.createdAt!,
      color: getFeedEntryColor({ kind: kind, rowColor: feed.displayColor }),
      icon: kind.icon,
      burstKind: kind.burst,
      detailsLabel: kind.moreText,
      eventType: eventType || undefined,
    };
  };

  /*
   * The event type filter's checklist shows each event type with the icon
   * its items carry. Memoised so the checklist is not rebuilt on every render.
   */
  const getEventTypeIcon: GetFeedEventTypeIconFunction = useCallback(
    (eventType: string): IconProp => {
      return resolveResourceFeedIcon({
        eventType: eventType,
        getKind: props.getKind,
      });
    },
    [props.getKind],
  );

  const feedOptions: UseFeedOptionsResult = useFeedOptions({
    eventTypes: props.eventTypes,
    getEventTypeIcon: getEventTypeIcon,
    storageKey: props.eventTypeColumn,
    resetKey: props.resourceId.toString(),
  });

  const feed: UseFeedItemsResult = useFeedItems<TFeedModel>({
    resourceKey: props.resourceId.toString(),
    viewKey: feedOptions.optionsKey,
    getItems: async (limit: number): Promise<ListResult<TFeedModel>> => {
      return await ModelAPI.getList<TFeedModel>({
        modelType: props.modelType,
        /*
         * The two column names arrive as strings because one component serves
         * ten different feed models, so neither key can be checked against
         * TFeedModel here.
         */
        query: {
          [props.resourceIdColumn]: props.resourceId,
          ...getFeedEventTypeQuery<TFeedModel>(
            props.eventTypeColumn as Extract<keyof TFeedModel, string>,
            feedOptions.options,
          ),
        } as unknown as Query<TFeedModel>,
        select: {
          moreInformationInMarkdown: true,
          feedInfoInMarkdown: true,
          displayColor: true,
          createdAt: true,
          user: {
            name: true,
            email: true,
            profilePictureId: true,
          },
          [props.eventTypeColumn]: true,
          postedAt: true,
        } as unknown as Select<TFeedModel>,
        skip: 0,
        sort: {
          postedAt: feedOptions.options.sortOrder,
        },
        limit,
      });
    },
    mapItems: (feeds: Array<TFeedModel>): Array<FeedItemProps> => {
      return feeds.map((feed: TFeedModel) => {
        return getFeedItem(feed);
      });
    },
  });

  return (
    <FeedCard
      title={props.title}
      description={props.description}
      feedOptions={feedOptions}
      onRefresh={feed.refresh}
    >
      <div>
        <FeedContent
          feed={feed}
          noItemsMessage={getFeedNoItemsMessage({
            options: feedOptions.options,
            noItemsMessage: props.noItemsMessage,
          })}
          sortOrder={feedOptions.options.sortOrder}
        />
      </div>
    </FeedCard>
  );
};

export default ResourceFeed;
