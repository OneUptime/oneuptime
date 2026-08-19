import MonitorRecommendationCatalog, {
  MonitorRecommendationResourceTypeDefinition,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil, {
  MonitorRecommendationFingerprint,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationNotificationMode,
  MonitorRecommendationNotificationSettings,
  MonitorRecommendationResourceType,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * `getCoveredRecommendationMonitorIds` is the richer sibling of
 * `getCoveredRecommendationIds`: same diff, but it remembers WHICH monitor
 * already watches each recommendation so the card can link to it.
 *
 * Two classes of failure motivate this file:
 *
 *   1. Drift between the two methods. They compute the same diff twice, and
 *      the two answers are rendered in two different places — the side-menu
 *      badge counts what is NOT covered from one of them, the page greys out
 *      cards from the other. If they ever disagree, the badge says "3 to
 *      create" while the page shows a different number of live cards, and
 *      nothing crashes to tell anyone. The agreement tests below run both over
 *      the same inputs for all eight resource types.
 *
 *   2. A wrong link target. The Map's VALUE is a monitor id that becomes a
 *      navigable link. Pointing it at the wrong monitor is worse than not
 *      linking at all: the user opens a monitor, sees thresholds that do not
 *      match the card they clicked, and concludes the feature lies. The
 *      duplicate-monitor and multi-step cases below pin exactly which id wins.
 *
 * The fixture style (buildArgs factory, generated ObjectID constants) mirrors
 * MonitorRecommendationUtil.test.ts so both files describe the same world.
 */

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();

const RESOURCE_IDENTIFIER: string = ObjectID.generate().toString();

/*
 * Structurally identical to the inline element type
 * `getCoveredRecommendationMonitorIds` accepts. Named here only so the
 * helpers below can be typed.
 */
interface ExistingRecommendationMonitor {
  monitorId: ObjectID;
  monitorSteps: Array<MonitorStep>;
}

function buildArgs(
  overrides?: Partial<MonitorRecommendationArgs>,
): MonitorRecommendationArgs {
  return {
    resourceIdentifier: RESOURCE_IDENTIFIER,
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
    monitorName: "Test Monitor",
    ...overrides,
  };
}

/*
 * Build the step a monitor created from this recommendation would actually
 * carry — including the name prefixing the create flow applies. Building it
 * with the raw args instead would still pass today (the name is not part of
 * the fingerprint) but would stop these tests from noticing if the name ever
 * leaked into the fingerprint.
 */
function buildCreatedStep(
  recommendation: MonitorRecommendation,
  args: MonitorRecommendationArgs,
): MonitorStep {
  return recommendation.getMonitorStep({
    ...args,
    monitorName: MonitorRecommendationUtil.getMonitorName({
      recommendation: recommendation,
      resourceDisplayName: args.monitorName,
    }),
  });
}

/*
 * What the diff actually compares for a recommendation, as a string. Used only
 * to pick recommendations the diff can tell apart.
 */
function getSerializedFingerprint(
  recommendation: MonitorRecommendation,
  args: MonitorRecommendationArgs,
): string {
  const fingerprint: MonitorRecommendationFingerprint | undefined =
    MonitorRecommendationUtil.getFingerprintFromMonitorStep(
      buildCreatedStep(recommendation, args),
    );

  if (!fingerprint) {
    throw new Error(
      `${recommendation.recommendationId} built a step with no infrastructure config.`,
    );
  }

  return MonitorRecommendationUtil.serializeFingerprint(fingerprint);
}

function buildMonitorFor(
  recommendations: Array<MonitorRecommendation>,
  args: MonitorRecommendationArgs,
): ExistingRecommendationMonitor {
  return {
    monitorId: ObjectID.generate(),
    monitorSteps: recommendations.map(
      (recommendation: MonitorRecommendation) => {
        return buildCreatedStep(recommendation, args);
      },
    ),
  };
}

/*
 * A step that has `data` but no infrastructure sub-config at all — what an
 * HTTP/Ping monitor on the same project looks like. Distinct from
 * `new MonitorStep()` (no `data` whatsoever), and the more realistic of the
 * two: a bare step could be short-circuited by a null check that a populated
 * one would sail past and then read `undefined.clusterIdentifier` from.
 */
function buildNonInfrastructureStep(): MonitorStep {
  return MonitorStep.getDefaultMonitorStep({
    monitorName: "Ping Monitor",
    monitorType: MonitorType.Ping,
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
  });
}

function getCriteriaInstances(
  monitorStep: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return (
    monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
  );
}

function flattenSteps(
  monitors: Array<ExistingRecommendationMonitor>,
): Array<MonitorStep> {
  return monitors.flatMap((monitor: ExistingRecommendationMonitor) => {
    return monitor.monitorSteps;
  });
}

const RESOURCE_TYPE_DEFINITIONS: Array<MonitorRecommendationResourceTypeDefinition> =
  MonitorRecommendationCatalog.getResourceTypeDefinitions();

const KUBERNETES_RECOMMENDATIONS: Array<MonitorRecommendation> =
  MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.Kubernetes,
  );

describe("MonitorRecommendationUtil.getCoveredRecommendationMonitorIds", () => {
  it("maps a covered recommendation to the id of the monitor that watches it", () => {
    const args: MonitorRecommendationArgs = buildArgs();
    const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
    const existingMonitor: ExistingRecommendationMonitor = buildMonitorFor(
      [created],
      args,
    );

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [existingMonitor],
        args: args,
      });

    expect(covered.size).toBe(1);
    /*
     * `toBe`, not `toEqual`: the caller hands the id straight to a link, so
     * the method must pass the caller's own ObjectID through rather than
     * reconstructing one from a string somewhere in the middle.
     */
    expect(covered.get(created.recommendationId)).toBe(
      existingMonitor.monitorId,
    );
  });

  it("leaves recommendations that no monitor watches out of the map", () => {
    /*
     * Absence, not a `undefined` value under the key: the page renders a
     * "create" card for anything missing from the map, and a present key with
     * no id would render an "already created" card whose link goes nowhere.
     */
    const args: MonitorRecommendationArgs = buildArgs();
    const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
    const notCreated: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[1]!;

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [buildMonitorFor([created], args)],
        args: args,
      });

    expect(covered.has(notCreated.recommendationId)).toBe(false);
    expect(KUBERNETES_RECOMMENDATIONS.length).toBeGreaterThan(1);
  });

  it("is empty when the resource has no monitors at all", () => {
    expect(
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [],
        args: buildArgs(),
      }).size,
    ).toBe(0);
  });

  it("is empty when every existing monitor carries no infrastructure config", () => {
    /*
     * A project's non-infrastructure monitors (HTTP, Ping, ...) are handed to
     * this method too. A fingerprint of `("", [], [])` for all of them would
     * collide with any recommendation that also produced an empty
     * fingerprint, marking real work as already done.
     */
    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [
          { monitorId: ObjectID.generate(), monitorSteps: [new MonitorStep()] },
          {
            monitorId: ObjectID.generate(),
            monitorSteps: [buildNonInfrastructureStep()],
          },
          { monitorId: ObjectID.generate(), monitorSteps: [] },
        ],
        args: buildArgs(),
      });

    expect(covered.size).toBe(0);
  });

  it("keeps the first monitor in the array when two monitors watch the same thing", () => {
    /*
     * Reachable by hand: create a recommendation, then create it again from a
     * second browser tab that still shows the stale "not created" card. Both
     * monitors exist and fingerprint identically. The API returns them sorted,
     * so honouring the array order makes the link target stable across page
     * loads instead of flipping with whatever row order Postgres felt like.
     */
    const args: MonitorRecommendationArgs = buildArgs();
    const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;

    const firstMonitor: ExistingRecommendationMonitor = buildMonitorFor(
      [created],
      args,
    );
    const secondMonitor: ExistingRecommendationMonitor = buildMonitorFor(
      [created],
      args,
    );

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [firstMonitor, secondMonitor],
        args: args,
      }).get(created.recommendationId),
    ).toBe(firstMonitor.monitorId);

    /*
     * Reversing the input flips the answer. Without this the assertion above
     * would also pass an implementation that picked the LAST monitor and
     * happened to be handed them in a lucky order.
     */
    expect(
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [secondMonitor, firstMonitor],
        args: args,
      }).get(created.recommendationId),
    ).toBe(secondMonitor.monitorId);
  });

  it("credits every step of a monitor that has several", () => {
    /*
     * A monitor is not limited to one step, and nothing stops a user from
     * hand-adding a second infrastructure step to a monitor the feature
     * created. Only looking at step 0 would resurface an already-watched
     * recommendation as "not created" and invite a duplicate monitor.
     */
    const args: MonitorRecommendationArgs = buildArgs();
    const createdRecommendations: Array<MonitorRecommendation> =
      KUBERNETES_RECOMMENDATIONS.slice(0, 3);

    const multiStepMonitor: ExistingRecommendationMonitor = buildMonitorFor(
      createdRecommendations,
      args,
    );

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [multiStepMonitor],
        args: args,
      });

    expect(createdRecommendations.length).toBe(3);
    for (const recommendation of createdRecommendations) {
      expect(covered.get(recommendation.recommendationId)).toBe(
        multiStepMonitor.monitorId,
      );
    }
  });

  it("still credits a real step sitting next to a non-infrastructure one", () => {
    /*
     * The undefined fingerprint of the unrelated step must be skipped, not
     * treated as the monitor's answer and used to abandon the rest.
     */
    const args: MonitorRecommendationArgs = buildArgs();
    const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
    const monitorId: ObjectID = ObjectID.generate();

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [
          {
            monitorId: monitorId,
            monitorSteps: [
              buildNonInfrastructureStep(),
              buildCreatedStep(created, args),
            ],
          },
        ],
        args: args,
      });

    expect(covered.get(created.recommendationId)).toBe(monitorId);
  });

  it("covers nothing when the existing monitors are scoped to another resource", () => {
    /*
     * Same recommendation, different cluster. Coverage is per resource: the
     * cluster being viewed genuinely is not watched, and reporting otherwise
     * would hide a real gap on every cluster after the first.
     */
    const otherResourceMonitor: ExistingRecommendationMonitor = buildMonitorFor(
      KUBERNETES_RECOMMENDATIONS,
      buildArgs({ resourceIdentifier: "some-other-cluster" }),
    );

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [otherResourceMonitor],
        args: buildArgs(),
      });

    expect(covered.size).toBe(0);
  });

  it("is unaffected by the on-call policies, labels and severities applied at create time", () => {
    /*
     * Monitors created through this feature have had notification settings
     * written into their criteria; the recommendation the diff rebuilds has
     * not. If any of that reached the fingerprint, every monitor created with
     * an on-call policy would immediately show up as "not created" again.
     */
    const args: MonitorRecommendationArgs = buildArgs();
    const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
    const monitorId: ObjectID = ObjectID.generate();

    const existingStep: MonitorStep =
      MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
        monitorStep: buildCreatedStep(created, args),
        notificationSettings: {
          onCallPolicyIds: [ObjectID.generate(), ObjectID.generate()],
          labelIds: [ObjectID.generate()],
          ownerTeamIds: [ObjectID.generate()],
          ownerUserIds: [ObjectID.generate()],
          incidentSeverityIdBySeverity: {
            Critical: ObjectID.generate(),
            Warning: ObjectID.generate(),
          },
          alertSeverityIdBySeverity: {
            Critical: ObjectID.generate(),
            Warning: ObjectID.generate(),
          },
        },
        severity: created.severity,
      });

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: KUBERNETES_RECOMMENDATIONS,
        existingMonitors: [
          { monitorId: monitorId, monitorSteps: [existingStep] },
        ],
        args: args,
      });

    expect(covered.get(created.recommendationId)).toBe(monitorId);
  });

  it("is unaffected by the notification mode the monitor was created with", () => {
    /*
     * The Alert / Incident / Both choice flips `createIncidents` and
     * `createAlerts`, which decides what a breach OPENS — not what the
     * monitor WATCHES. A monitor created as alert-only watches exactly the
     * same metrics as one created as incident-only, so both must still cover
     * their recommendation. Were the flags in the fingerprint, a user who
     * picked "Alert" would be offered the same monitor again forever.
     */
    const args: MonitorRecommendationArgs = buildArgs();
    const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;

    const modes: Array<MonitorRecommendationNotificationMode> = [
      MonitorRecommendationNotificationMode.Alert,
      MonitorRecommendationNotificationMode.Incident,
      MonitorRecommendationNotificationMode.Both,
    ];

    for (const mode of modes) {
      const notificationSettings: MonitorRecommendationNotificationSettings = {
        notificationMode: mode,
      };

      const existingStep: MonitorStep =
        MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
          monitorStep: buildCreatedStep(created, args),
          notificationSettings: notificationSettings,
          severity: created.severity,
        });

      const monitorId: ObjectID = ObjectID.generate();

      const covered: Map<string, ObjectID> =
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          existingMonitors: [
            { monitorId: monitorId, monitorSteps: [existingStep] },
          ],
          args: args,
        });

      expect(covered.get(created.recommendationId)).toBe(monitorId);
    }

    /*
     * Guard against a vacuous version of the loop above: if the mode stopped
     * changing anything on the step, every iteration would trivially pass
     * while proving nothing. Alert mode must actually turn incident creation
     * off somewhere on the step.
     */
    const alertOnlyStep: MonitorStep =
      MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
        monitorStep: buildCreatedStep(created, args),
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Alert,
        },
        severity: created.severity,
      });

    const bothStep: MonitorStep =
      MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
        monitorStep: buildCreatedStep(created, args),
        notificationSettings: {
          notificationMode: MonitorRecommendationNotificationMode.Both,
        },
        severity: created.severity,
      });

    const alertOnlyIncidentFlags: Array<boolean | undefined> =
      getCriteriaInstances(alertOnlyStep).map(
        (instance: MonitorCriteriaInstance) => {
          return instance.data?.createIncidents;
        },
      );

    const bothIncidentFlags: Array<boolean | undefined> = getCriteriaInstances(
      bothStep,
    ).map((instance: MonitorCriteriaInstance) => {
      return instance.data?.createIncidents;
    });

    expect(alertOnlyIncidentFlags).not.toEqual(bothIncidentFlags);
  });

  it("agrees exactly with getCoveredRecommendationIds for every resource type", () => {
    /*
     * The divergence this rules out: the side-menu badge counts the
     * uncovered recommendations from one method and the page greys cards out
     * using the other. Any difference in how the two walk the existing
     * monitors — a `continue` in one and not the other, a different empty
     * check — shows up as a badge that contradicts the page, with no error
     * anywhere.
     *
     * Every other recommendation is "created", each on its own monitor, so
     * both a covered and an uncovered answer are exercised for all eight
     * resource types.
     */
    expect(RESOURCE_TYPE_DEFINITIONS.length).toBe(10);

    for (const definition of RESOURCE_TYPE_DEFINITIONS) {
      const recommendations: Array<MonitorRecommendation> =
        definition.getRecommendations();
      const args: MonitorRecommendationArgs = buildArgs();

      const createdRecommendations: Array<MonitorRecommendation> =
        recommendations.filter(
          (_recommendation: MonitorRecommendation, index: number) => {
            return index % 2 === 0;
          },
        );

      const existingMonitors: Array<ExistingRecommendationMonitor> =
        createdRecommendations.map((recommendation: MonitorRecommendation) => {
          return buildMonitorFor([recommendation], args);
        });

      const coveredMap: Map<string, ObjectID> =
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations: recommendations,
          existingMonitors: existingMonitors,
          args: args,
        });

      const coveredSet: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: recommendations,
          existingMonitorSteps: flattenSteps(existingMonitors),
          args: args,
        });

      expect(new Set<string>(coveredMap.keys())).toEqual(coveredSet);

      // Non-vacuity: both answers must actually contain the created ones.
      expect(createdRecommendations.length).toBeGreaterThan(0);
      for (const recommendation of createdRecommendations) {
        expect(coveredMap.has(recommendation.recommendationId)).toBe(true);
        expect(coveredSet.has(recommendation.recommendationId)).toBe(true);
      }

      // ...and neither may claim everything, or agreement would be trivial.
      expect(coveredMap.size).toBeLessThan(recommendations.length);
    }
  });

  it("agrees with getCoveredRecommendationIds on the empty and unmatched cases", () => {
    /*
     * The two methods take their early-out on an empty fingerprint index
     * separately. A mismatch here would mean a resource with only HTTP
     * monitors renders one way in the badge and another on the page.
     */
    const args: MonitorRecommendationArgs = buildArgs();

    const noiseMonitors: Array<ExistingRecommendationMonitor> = [
      { monitorId: ObjectID.generate(), monitorSteps: [] },
      {
        monitorId: ObjectID.generate(),
        monitorSteps: [buildNonInfrastructureStep(), new MonitorStep()],
      },
      buildMonitorFor(
        [KUBERNETES_RECOMMENDATIONS[0]!],
        buildArgs({ resourceIdentifier: "unrelated-cluster" }),
      ),
    ];

    for (const existingMonitors of [
      [] as Array<ExistingRecommendationMonitor>,
      noiseMonitors,
    ]) {
      const coveredMap: Map<string, ObjectID> =
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          existingMonitors: existingMonitors,
          args: args,
        });

      const coveredSet: Set<string> =
        MonitorRecommendationUtil.getCoveredRecommendationIds({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          existingMonitorSteps: flattenSteps(existingMonitors),
          args: args,
        });

      expect(new Set<string>(coveredMap.keys())).toEqual(coveredSet);
      expect(coveredMap.size).toBe(0);
    }
  });

  it("resolves the right monitor id for every resource type in the catalog", () => {
    /*
     * Each resource type renames the identifier field on its way into the
     * template module (clusterIdentifier / hostIdentifier / fleetIdentifier).
     * A type whose rename is wrong produces a step scoped to "" on both sides
     * of the diff, which still matches — so this asserts the id of the RIGHT
     * monitor among two, which an all-empty fingerprint could not do: with
     * every fingerprint collapsed to `("", [], [])` both recommendations would
     * resolve to the first monitor and this fails.
     *
     * The pair is chosen by fingerprint rather than by taking index 0 and 1,
     * because Proxmox and Ceph ship several templates that watch the same
     * metric with different thresholds and therefore fingerprint identically
     * — see `serializeFingerprint`, which reads metric names and formulas
     * only. Those are genuinely indistinguishable to the diff (reported
     * separately); this test is about the identifier plumbing, so it uses a
     * pair the diff can tell apart.
     */
    for (const definition of RESOURCE_TYPE_DEFINITIONS) {
      const recommendations: Array<MonitorRecommendation> =
        definition.getRecommendations();
      const args: MonitorRecommendationArgs = buildArgs();

      const first: MonitorRecommendation = recommendations[0]!;
      const firstFingerprint: string = getSerializedFingerprint(first, args);

      const second: MonitorRecommendation | undefined = recommendations.find(
        (recommendation: MonitorRecommendation) => {
          return (
            getSerializedFingerprint(recommendation, args) !== firstFingerprint
          );
        },
      );

      expect(second).toBeDefined();

      const firstMonitor: ExistingRecommendationMonitor = buildMonitorFor(
        [first],
        args,
      );
      const secondMonitor: ExistingRecommendationMonitor = buildMonitorFor(
        [second!],
        args,
      );

      const covered: Map<string, ObjectID> =
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations: recommendations,
          existingMonitors: [firstMonitor, secondMonitor],
          args: args,
        });

      expect(covered.get(first.recommendationId)).toBe(firstMonitor.monitorId);
      expect(covered.get(second!.recommendationId)).toBe(
        secondMonitor.monitorId,
      );
    }
  });

  /*
   * The side-menu badge (RecommendationsSideMenuItem) computes this same diff,
   * and it does so WITHOUT fetching the project's monitor statuses or its
   * incident and alert severities — it passes ObjectID.getZeroObjectID() for
   * all four, because those ids are written into the criteria a template
   * builds but never reach the fingerprint the diff compares. That saves four
   * project-wide list requests on every page of every resource.
   *
   * It also means a change on the template side that DID let one of those ids
   * into the metric config would make the badge disagree with the page it
   * links to: the badge would find nothing covered and nag about
   * recommendations the page shows as already created. Nothing about that
   * failure is visible from either file, so the invariant is pinned here
   * rather than described in a comment over there.
   */
  it("ignores the monitor-status and severity args entirely", () => {
    for (const definition of RESOURCE_TYPE_DEFINITIONS) {
      const recommendations: Array<MonitorRecommendation> =
        definition.getRecommendations();

      const realArgs: MonitorRecommendationArgs = buildArgs();

      const placeholderArgs: MonitorRecommendationArgs = buildArgs({
        onlineMonitorStatusId: ObjectID.getZeroObjectID(),
        offlineMonitorStatusId: ObjectID.getZeroObjectID(),
        defaultIncidentSeverityId: ObjectID.getZeroObjectID(),
        defaultAlertSeverityId: ObjectID.getZeroObjectID(),
      });

      /*
       * The monitor was created with the project's real ids; the diff is run
       * with placeholders. This is exactly the asymmetry the badge relies on.
       */
      const existingMonitor: ExistingRecommendationMonitor = buildMonitorFor(
        recommendations,
        realArgs,
      );

      const coveredWithPlaceholders: Map<string, ObjectID> =
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations: recommendations,
          existingMonitors: [existingMonitor],
          args: placeholderArgs,
        });

      const coveredWithRealIds: Map<string, ObjectID> =
        MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
          recommendations: recommendations,
          existingMonitors: [existingMonitor],
          args: realArgs,
        });

      expect(coveredWithPlaceholders.size).toBe(recommendations.length);
      expect([...coveredWithPlaceholders.keys()].sort()).toEqual(
        [...coveredWithRealIds.keys()].sort(),
      );
    }
  });
  /*
   * Every shipped template must fingerprint differently from every other
   * template FOR THE SAME RESOURCE TYPE. This is the property the whole
   * already-created diff rests on, and it is not obvious: the fingerprint is
   * derived, not declared, so two templates can collide without either author
   * doing anything wrong.
   *
   * They did. Before the fingerprint was widened past (identifier, metric
   * names, formulas), thirteen groups collided — eight Ceph templates share
   * the single metric `ceph_health_detail` and differ only in the health-check
   * name they filter on, and "Cluster Near Full" differs from "Cluster Full"
   * only in its threshold. Creating "Ceph Daemon Crash" therefore marked
   * clock-skew, OSD-nearfull, OSD-backfillfull and OSD-full as already
   * created, hiding four real monitoring gaps behind cards that read as
   * handled, and pointed each of their "View monitor" links at a monitor with
   * unrelated thresholds.
   *
   * Nothing about that is visible from the page, from the templates, or from
   * any other test. It is caught here or not at all.
   */
  it("gives every template a distinct fingerprint within its resource type", () => {
    for (const definition of RESOURCE_TYPE_DEFINITIONS) {
      const args: MonitorRecommendationArgs = buildArgs();

      const idsByFingerprint: Map<string, Array<string>> = new Map<
        string,
        Array<string>
      >();

      for (const recommendation of definition.getRecommendations()) {
        const fingerprint: string = getSerializedFingerprint(
          recommendation,
          args,
        );

        const ids: Array<string> = idsByFingerprint.get(fingerprint) || [];
        ids.push(recommendation.recommendationId);
        idsByFingerprint.set(fingerprint, ids);
      }

      const collisions: Array<Array<string>> = [
        ...idsByFingerprint.values(),
      ].filter((ids: Array<string>) => {
        return ids.length > 1;
      });

      /*
       * Asserted as the colliding ids rather than as a count, so a failure
       * names the two templates that need separating instead of saying "3".
       */
      expect(collisions).toEqual([]);
    }
  });

  /*
   * The same property across resource types. The page never mixes them — it
   * queries monitors by monitorType — but nothing in the fingerprint enforced
   * that, and Docker, Docker Swarm and Podman ship byte-identical metric
   * configs ("container.cpu.utilization" and friends). A future caller that
   * diffs across types, or a resource type that starts accepting another's
   * monitor type, would silently mark half its recommendations as handled.
   */
  it("gives every template in the whole catalog a distinct fingerprint", () => {
    const args: MonitorRecommendationArgs = buildArgs();

    const idsByFingerprint: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    for (const recommendation of MonitorRecommendationCatalog.getAllRecommendations()) {
      const fingerprint: string = getSerializedFingerprint(
        recommendation,
        args,
      );

      const ids: Array<string> = idsByFingerprint.get(fingerprint) || [];
      ids.push(recommendation.recommendationId);
      idsByFingerprint.set(fingerprint, ids);
    }

    const collisions: Array<Array<string>> = [
      ...idsByFingerprint.values(),
    ].filter((ids: Array<string>) => {
      return ids.length > 1;
    });

    expect(collisions).toEqual([]);
  });

  /*
   * The concrete regressions, named. The tests above would catch these too,
   * but they would report them as an anonymous collision list; these say what
   * broke and what the user loses when it does.
   */
  it("does not let one Ceph health-detail template cover the others", () => {
    const cephRecommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Ceph,
      );

    const daemonCrash: MonitorRecommendation | undefined =
      cephRecommendations.find((recommendation: MonitorRecommendation) => {
        return recommendation.templateId === "ceph-daemon-crash";
      });

    expect(daemonCrash).toBeDefined();

    const args: MonitorRecommendationArgs = buildArgs();

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: cephRecommendations,
        existingMonitors: [buildMonitorFor([daemonCrash!], args)],
        args: args,
      });

    expect([...covered.keys()]).toEqual([daemonCrash!.recommendationId]);
  });

  it("does not let a near-full threshold cover the full threshold", () => {
    const cephRecommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Ceph,
      );

    const nearFull: MonitorRecommendation | undefined =
      cephRecommendations.find((recommendation: MonitorRecommendation) => {
        return recommendation.templateId === "ceph-cluster-near-full";
      });
    const full: MonitorRecommendation | undefined = cephRecommendations.find(
      (recommendation: MonitorRecommendation) => {
        return recommendation.templateId === "ceph-cluster-full";
      },
    );

    expect(nearFull).toBeDefined();
    expect(full).toBeDefined();

    const args: MonitorRecommendationArgs = buildArgs();

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: cephRecommendations,
        existingMonitors: [buildMonitorFor([nearFull!], args)],
        args: args,
      });

    expect(covered.has(nearFull!.recommendationId)).toBe(true);
    expect(covered.has(full!.recommendationId)).toBe(false);
  });

  it("does not let a Docker monitor cover the identical Podman recommendation", () => {
    /*
     * Docker and Podman ship the same metric names, the same aliases and the
     * same thresholds for container CPU. Only the step's own config kind
     * (dockerMonitor vs podmanMonitor) tells them apart.
     */
    const args: MonitorRecommendationArgs = buildArgs();

    const dockerRecommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Docker,
      );
    const podmanRecommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.Podman,
      );

    const covered: Map<string, ObjectID> =
      MonitorRecommendationUtil.getCoveredRecommendationMonitorIds({
        recommendations: podmanRecommendations,
        existingMonitors: [buildMonitorFor(dockerRecommendations, args)],
        args: args,
      });

    expect(covered.size).toBe(0);
  });
});
