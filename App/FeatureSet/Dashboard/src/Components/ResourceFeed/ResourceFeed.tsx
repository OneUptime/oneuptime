import React, { ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Feed from "Common/UI/Components/Feed/Feed";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { FeedItemProps } from "Common/UI/Components/Feed/FeedItem";
import { Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Exception from "Common/Types/Exception/Exception";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "Common/Models/DatabaseModels/User";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";

/*
 * Every infrastructure and catalog resource feed - Kubernetes clusters, Docker
 * and Podman hosts, Docker Swarm / Proxmox / Ceph clusters, servers, cloud
 * resources and catalog services - stores the same shape: markdown, a colour,
 * the acting user and a posted-at. Only the two column names differ (the
 * foreign key back to the resource, and the event type column), so the whole
 * feed page is one component parameterised by those two names rather than nine
 * copies that drift apart.
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
  title: string;
  description: string;
  noItemsMessage: string;
}

type GetIconForEventType = (eventType: string) => IconProp;

/*
 * Event type members are named <Model>Created / <Model>Updated / ... per feed
 * model, so the icon is chosen from the suffix rather than from an enum this
 * component would have to import nine times over.
 */
export const getIconForEventType: GetIconForEventType = (
  eventType: string,
): IconProp => {
  if (eventType.endsWith("Created")) {
    return IconProp.Add;
  }

  if (eventType.endsWith("Updated")) {
    return IconProp.Edit;
  }

  if (eventType.endsWith("Archived")) {
    return IconProp.Archive;
  }

  if (eventType.endsWith("Restored")) {
    return IconProp.Refresh;
  }

  if (eventType === "OwnerUserAdded") {
    return IconProp.User;
  }

  if (eventType === "OwnerTeamAdded") {
    return IconProp.Team;
  }

  if (eventType === "OwnerUserRemoved" || eventType === "OwnerTeamRemoved") {
    return IconProp.Close;
  }

  if (eventType === "OwnerRuleExecuted") {
    return IconProp.Team;
  }

  if (eventType === "LabelRuleExecuted") {
    return IconProp.Label;
  }

  return IconProp.Circle;
};

const ResourceFeed: <TFeedModel extends ResourceFeedModel>(
  props: ComponentProps<TFeedModel>,
) => ReactElement = <TFeedModel extends ResourceFeedModel>(
  props: ComponentProps<TFeedModel>,
): ReactElement => {
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [feedItems, setFeedItems] = React.useState<Array<FeedItemProps>>([]);

  type GetFeedItem = (feed: TFeedModel) => FeedItemProps;

  const getFeedItem: GetFeedItem = (feed: TFeedModel): FeedItemProps => {
    const eventType: string =
      ((feed as unknown as Record<string, unknown>)[
        props.eventTypeColumn
      ] as string) || "";

    return {
      key: feed.id!.toString(),
      textInMarkdown: feed.feedInfoInMarkdown || "",
      moreTextInMarkdown: feed.moreInformationInMarkdown || "",
      user: feed.user,
      itemDateTime: feed.postedAt || feed.createdAt!,
      color: feed.displayColor || Gray500,
      icon: getIconForEventType(eventType),
    };
  };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      const feeds: ListResult<TFeedModel> = await ModelAPI.getList<TFeedModel>({
        modelType: props.modelType,
        /*
         * The two column names arrive as strings because one component serves
         * nine different feed models, so neither key can be checked against
         * TFeedModel here.
         */
        query: {
          [props.resourceIdColumn]: props.resourceId,
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
          postedAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
      });

      setFeedItems(
        feeds.data.map((feed: TFeedModel) => {
          return getFeedItem(feed);
        }),
      );
    } catch (err: unknown) {
      setError(API.getFriendlyMessage(err as Exception));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    if (!props.resourceId) {
      return;
    }

    fetchItems().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.resourceId?.toString()]);

  return (
    <Card
      title={props.title}
      description={props.description}
      buttons={[
        {
          title: "Refresh",
          buttonStyle: ButtonStyleType.ICON,
          icon: IconProp.Refresh,
          onClick: async () => {
            await fetchItems();
          },
        },
      ]}
    >
      <div>
        {isLoading && <ComponentLoader />}
        {error && <ErrorMessage message={error} />}
        {!isLoading && !error && (
          <Feed items={feedItems} noItemsMessage={props.noItemsMessage} />
        )}
      </div>
    </Card>
  );
};

export default ResourceFeed;
