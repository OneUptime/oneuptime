import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorRecommendations from "./MonitorRecommendations";
import RecommendationResourceRegistry, {
  RecommendationResourceDefinition,
} from "./RecommendationResourceRegistry";

export interface ComponentProps {
  resourceType: MonitorRecommendationResourceType;
}

/*
 * The whole of a `View/Recommendations.tsx` page, for any resource type.
 *
 * Each of the eight resource types used to ship its own copy of this: fetch
 * the model, read one identifier column, pass three props. Eight copies meant
 * eight chances for the identifier column to be selected on one page and
 * forgotten on another — and a forgotten select does not error, it renders
 * "No telemetry yet" on a resource that has been reporting for months.
 * The column names live in `RecommendationResourceRegistry` now, and this
 * reads them from there.
 */
const RecommendationsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resource, setResource] = useState<BaseModel | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const definition: RecommendationResourceDefinition | undefined =
    RecommendationResourceRegistry.getDefinition(props.resourceType);

  useAsyncEffect(async () => {
    if (!definition) {
      setError(
        `Recommendations are not wired up for ${props.resourceType} resources.`,
      );
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      setResource(
        await ModelAPI.getItem({
          modelType: definition.modelType,
          id: modelId,
          select: RecommendationResourceRegistry.getSelect(props.resourceType),
        }),
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
    /*
     * `modelId` is in the dependency list even though it comes from the URL
     * rather than from props. Today every route change remounts this page, so
     * omitting it would be inert — but the day the router starts reusing the
     * component between two resources of the SAME type, this page would keep
     * rendering the previous resource's recommendations while
     * RecommendationsSideMenuItem next door (which keys on resourceId) showed
     * the new one's count. Two views of the same thing disagreeing is a much
     * harder bug to recognise than a page that simply reloads.
     */
  }, [props.resourceType, modelId.toString()]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!resource) {
    return <ErrorMessage message="This resource was not found." />;
  }

  const { resourceIdentifier, resourceDisplayName } =
    RecommendationResourceRegistry.readResourceFields({
      resourceType: props.resourceType,
      model: resource,
    });

  /*
   * Read from the SAME fetched row the identifier came from, rather than
   * fetched separately, so the page cannot end up showing one service's
   * recommendations narrowed by another's runtime.
   */
  const resourceContext: MonitorRecommendationContext =
    RecommendationResourceRegistry.readContext({
      resourceType: props.resourceType,
      model: resource,
    });

  return (
    <Fragment>
      <MonitorRecommendations
        resourceType={props.resourceType}
        resourceIdentifier={resourceIdentifier}
        resourceDisplayName={resourceDisplayName}
        resourceId={modelId}
        resourceContext={resourceContext}
        resourceContextNote={RecommendationResourceRegistry.describeContext({
          resourceType: props.resourceType,
          context: resourceContext,
        })}
      />
    </Fragment>
  );
};

export default RecommendationsPage;
