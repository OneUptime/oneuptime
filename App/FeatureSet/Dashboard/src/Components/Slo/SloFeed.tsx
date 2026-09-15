import ResourceFeed, {
  ComponentProps as ResourceFeedProps,
} from "../ResourceFeed/ResourceFeed";
import ServiceLevelObjectiveFeed from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  sloId: ObjectID;
  title?: string | undefined;
  description?: string | undefined;
}

const DEFAULT_TITLE: string = "SLO Feed";

const DEFAULT_DESCRIPTION: string =
  "Everything that has happened to this SLO - how it was created, every status change, the burn-rate alerts and incidents it raised, and each change to its rules, monitors and owners.";

const NO_ITEMS_MESSAGE: string =
  "No activity has been recorded for this SLO yet.";

export type GetSloResourceFeedPropsFunction = (
  props: ComponentProps,
) => ResourceFeedProps<ServiceLevelObjectiveFeed>;

/*
 * The SLO's ResourceFeed wiring in one place. The Feed page renders
 * ResourceFeed itself, like every other resource's feed page, and this
 * component embeds the same feed elsewhere (the overview) under its own
 * title - both spread these props, so the column names, and anything added
 * to the feed later, cannot drift between the two.
 */
export const getSloResourceFeedProps: GetSloResourceFeedPropsFunction = (
  props: ComponentProps,
): ResourceFeedProps<ServiceLevelObjectiveFeed> => {
  return {
    modelType: ServiceLevelObjectiveFeed,
    resourceIdColumn: "serviceLevelObjectiveId",
    resourceId: props.sloId,
    eventTypeColumn: "serviceLevelObjectiveFeedEventType",
    title: props.title || DEFAULT_TITLE,
    description: props.description || DEFAULT_DESCRIPTION,
    noItemsMessage: NO_ITEMS_MESSAGE,
  };
};

const SloFeed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ResourceFeed<ServiceLevelObjectiveFeed>
      {...getSloResourceFeedProps(props)}
    />
  );
};

export default SloFeed;
