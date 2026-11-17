import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import { getAllMessageQueueAlertTemplates } from "../../../../Types/Monitor/MessageQueueAlertTemplates";
import {
  METRIC_FIXTURES,
  MetricFixture,
} from "../../MessageQueue/MessagingTelemetryFixtures";

/*
 * Every recommendation of a resource type, built as a real resource of it
 * would have it built.
 *
 * Most resource types build a complete monitor from their row's identifier
 * alone, so `getAllPossibleRecommendations` is already that. Three do not:
 * an App Platforms app and a serverless function filter on the telemetry
 * attributes their row records, and a queue on the series its broker
 * reported. Built without them, each is an empty or project-wide monitor
 * that is never offered - which is why none of them is offered without its
 * context - so the invariants (distinct fingerprints, notification flags,
 * coverage) are held against each built with a representative context.
 */

/*
 * A queue whose broker reported every catalog metric a template reads,
 * each with the realistic stored datapoint the resolver suites share.
 */
function everyQueueMetricReported(): MonitorRecommendationContext {
  const observed: Record<string, Array<Record<string, unknown>>> = {};

  for (const template of getAllMessageQueueAlertTemplates()) {
    const fixture: MetricFixture | undefined = METRIC_FIXTURES.find(
      (candidate: MetricFixture): boolean => {
        return (
          candidate.metricName === template.metricName &&
          candidate.expected?.system === template.system
        );
      },
    );

    if (fixture) {
      observed[template.metricId] = [{ ...fixture.attributes }];
    }
  }

  return { messageQueueObservedSeries: observed };
}

export const REPRESENTATIVE_CONTEXTS: ReadonlyMap<
  MonitorRecommendationResourceType,
  MonitorRecommendationContext
> = new Map<MonitorRecommendationResourceType, MonitorRecommendationContext>([
  [
    MonitorRecommendationResourceType.CloudApp,
    {
      cloudAppTelemetryFilters: {
        "resource.cloud.platform": "aws_ecs",
        "resource.aws.ecs.task.family": "checkout",
      },
    },
  ],
  [
    MonitorRecommendationResourceType.ServerlessFunction,
    {
      serverlessFunctionTelemetryFilters: {
        "resource.faas.name": "checkout",
      },
    },
  ],
  [MonitorRecommendationResourceType.MessageQueue, everyQueueMetricReported()],
]);

export function getRepresentativeRecommendations(
  resourceType: MonitorRecommendationResourceType,
): Array<MonitorRecommendation> {
  const context: MonitorRecommendationContext | undefined =
    REPRESENTATIVE_CONTEXTS.get(resourceType);

  return context
    ? MonitorRecommendationCatalog.getRecommendations(resourceType, context)
    : MonitorRecommendationCatalog.getAllPossibleRecommendations(resourceType);
}

export function getAllRepresentativeRecommendations(): Array<MonitorRecommendation> {
  return MonitorRecommendationCatalog.getResourceTypeDefinitions().flatMap(
    (
      definition: MonitorRecommendationResourceTypeDefinition,
    ): Array<MonitorRecommendation> => {
      return getRepresentativeRecommendations(definition.resourceType);
    },
  );
}
