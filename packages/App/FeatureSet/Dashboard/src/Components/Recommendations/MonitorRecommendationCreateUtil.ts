import Monitor from "Common/Models/DatabaseModels/Monitor";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import Label from "Common/Models/DatabaseModels/Label";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import MonitorRecommendationUtil from "Common/Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationSettings,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";

/*
 * One monitor about to be created from one recommendation.
 *
 * `miscDataProps` is separate from `monitor` because monitor OWNERS are not
 * columns on Monitor — `MonitorService.onCreateSuccess` reads them out of the
 * request's `miscDataProps` and writes `MonitorOwnerTeam` / `MonitorOwnerUser`
 * junction rows. `ModelAPI.create` hardcodes `miscDataProps: {}`, so the
 * caller has to use `ModelAPI.createOrUpdate` to send them.
 */
export interface MonitorRecommendationCreatePlanItem {
  recommendation: MonitorRecommendation;
  monitor: Monitor;
  miscDataProps: JSONObject;
}

export default class MonitorRecommendationCreateUtil {
  /*
   * Flatten every step of every already-existing monitor on this resource,
   * for the not-yet-created diff.
   *
   * Monitors come back from `ModelAPI.getList` with `monitorSteps` already
   * deserialized into a `MonitorSteps` instance, but a monitor saved before
   * steps existed (or one whose select omitted them) has none — hence the
   * defensive read rather than a bare `monitor.monitorSteps!.data!`.
   */
  public static getExistingMonitorSteps(
    monitors: Array<Monitor>,
  ): Array<MonitorStep> {
    const steps: Array<MonitorStep> = [];

    for (const monitor of monitors) {
      const monitorSteps: MonitorSteps | undefined = monitor.monitorSteps;

      if (!monitorSteps || !monitorSteps.data) {
        continue;
      }

      for (const step of monitorSteps.data.monitorStepsInstanceArray || []) {
        steps.push(step);
      }
    }

    return steps;
  }

  /*
   * Owners ride in `miscDataProps`, not on the model.
   *
   * ObjectIDs are stringified because this object is serialized straight to
   * JSON on the wire; `MonitorService.addOwners` re-hydrates strings back into
   * ObjectIDs on the server side.
   */
  public static buildMiscDataProps(
    notificationSettings: MonitorRecommendationNotificationSettings,
  ): JSONObject {
    const miscDataProps: JSONObject = {};

    if (
      notificationSettings.ownerUserIds &&
      notificationSettings.ownerUserIds.length > 0
    ) {
      miscDataProps["ownerUsers"] = notificationSettings.ownerUserIds.map(
        (id: ObjectID) => {
          return id.toString();
        },
      );
    }

    if (
      notificationSettings.ownerTeamIds &&
      notificationSettings.ownerTeamIds.length > 0
    ) {
      miscDataProps["ownerTeams"] = notificationSettings.ownerTeamIds.map(
        (id: ObjectID) => {
          return id.toString();
        },
      );
    }

    return miscDataProps;
  }

  public static buildMonitor(data: {
    recommendation: MonitorRecommendation;
    args: MonitorRecommendationArgs;
    resourceDisplayName: string;
    defaultMonitorStatusId: ObjectID;
    notificationSettings: MonitorRecommendationNotificationSettings;
  }): Monitor {
    const monitorName: string = MonitorRecommendationUtil.getMonitorName({
      recommendation: data.recommendation,
      resourceDisplayName: data.resourceDisplayName,
    });

    const monitor: Monitor = new Monitor();

    monitor.name = monitorName;
    monitor.description = data.recommendation.description;
    monitor.monitorType = data.recommendation.monitorType;

    /*
     * A template that says how often its monitor need run - a cloud
     * resource's, every five minutes, as often as its points can change -
     * sets it; every other monitor keeps the default, every minute.
     */
    if (data.recommendation.monitoringInterval) {
      monitor.monitoringInterval = data.recommendation.monitoringInterval;
    }

    /*
     * The template interpolates `monitorName` into its incident and alert
     * titles, and every one of those titles already restates the template's
     * own name — so it must be the bare RESOURCE name, not `monitorName`,
     * which ends with that same template name. Passing the composed name
     * produced "[K8s] Pod CPU Saturating Container Limit (>90%) -
     * oneuptime-test - Pod CPU Saturating Container Limit". The resource is
     * still named, so an incident still says which cluster or host it came
     * from. `monitor.name` above is unchanged.
     *
     * `MonitorRecommendationUtil.getSerializedFingerprintForRecommendation`
     * calls the same helper, so the coverage diff keeps building steps the
     * way this does.
     */
    monitor.monitorSteps = MonitorRecommendationUtil.buildMonitorSteps({
      recommendation: data.recommendation,
      args: {
        ...data.args,
        monitorName: MonitorRecommendationUtil.getTemplateMonitorName({
          recommendation: data.recommendation,
          resourceDisplayName: data.resourceDisplayName,
        }),
      },
      defaultMonitorStatusId: data.defaultMonitorStatusId,
      notificationSettings: data.notificationSettings,
    });

    if (
      data.notificationSettings.labelIds &&
      data.notificationSettings.labelIds.length > 0
    ) {
      monitor.labels = data.notificationSettings.labelIds.map(
        (labelId: ObjectID) => {
          const label: Label = new Label();
          label.id = labelId;
          return label;
        },
      );
    }

    return monitor;
  }

  /*
   * A monitor created for a cloud resource holds the resource in its Linked
   * Resources (Monitor.cloudResources): the monitor's page names it, the
   * incidents and alerts it opens are linked to it, and the resource's own
   * Incidents and Alerts list them - from its Recommendations tab or its
   * account's alike.
   */
  public static linkToCloudResource(data: {
    monitor: Monitor;
    cloudResourceId: ObjectID;
  }): void {
    const resource: CloudResource = new CloudResource();
    resource.id = data.cloudResourceId;
    data.monitor.cloudResources = [resource];
  }

  /*
   * Turn the user's selection into an ordered list of monitors to POST.
   *
   * Recommendation ids that do not resolve are skipped rather than throwing:
   * the selection lives in React state and a stale id (from a template removed
   * in a deploy while the page was open) should not block creating the rest.
   */
  public static buildCreatePlan(data: {
    recommendations: Array<MonitorRecommendation>;
    selectedRecommendationIds: Array<string>;
    args: MonitorRecommendationArgs;
    resourceDisplayName: string;
    defaultMonitorStatusId: ObjectID;
    notificationSettings: MonitorRecommendationNotificationSettings;
    /*
     * What each monitor is linked to beside its scope, for the resource
     * types that link it (RecommendationResourceDefinition
     * .linkCreatedMonitor): a cloud resource's monitors carry it in their
     * Linked Resources.
     */
    linkMonitor?: ((monitor: Monitor) => void) | undefined;
  }): Array<MonitorRecommendationCreatePlanItem> {
    const miscDataProps: JSONObject = this.buildMiscDataProps(
      data.notificationSettings,
    );

    const plan: Array<MonitorRecommendationCreatePlanItem> = [];

    for (const recommendationId of data.selectedRecommendationIds) {
      const recommendation: MonitorRecommendation | undefined =
        data.recommendations.find((item: MonitorRecommendation) => {
          return item.recommendationId === recommendationId;
        });

      if (!recommendation) {
        continue;
      }

      const monitor: Monitor = this.buildMonitor({
        recommendation: recommendation,
        args: data.args,
        resourceDisplayName: data.resourceDisplayName,
        defaultMonitorStatusId: data.defaultMonitorStatusId,
        notificationSettings: data.notificationSettings,
      });

      data.linkMonitor?.(monitor);

      plan.push({
        recommendation: recommendation,
        monitor: monitor,
        miscDataProps: miscDataProps,
      });
    }

    return plan;
  }

  /*
   * Which of the user's selections can actually be created.
   *
   * Already-covered recommendations are filtered out rather than rejected:
   * another tab (or another engineer) may have created one while this page was
   * open, and re-POSTing would silently produce a duplicate monitor.
   */
  public static getCreatableSelection(data: {
    selectedRecommendationIds: Array<string>;
    coveredRecommendationIds: Set<string>;
  }): Array<string> {
    return data.selectedRecommendationIds.filter((recommendationId: string) => {
      return !data.coveredRecommendationIds.has(recommendationId);
    });
  }
}
