import MonitorRecommendationSeverityMapper, {
  MonitorRecommendationSeverityOption,
  MonitorRecommendationTemplateSeverityIds,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import MonitorRecommendationCatalog from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "../../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationSeverity,
  MonitorRecommendationSeverityMap,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import { CriteriaIncident } from "../../../../Types/Monitor/CriteriaIncident";
import { CriteriaAlert } from "../../../../Types/Monitor/CriteriaAlert";
import ObjectID from "../../../../Types/ObjectID";

/*
 * This mapper is the only thing standing between "the card said Warning" and
 * "the incident it opened said Critical".
 *
 * Before it existed, `MonitorRecommendationArgs` carried a single
 * `defaultIncidentSeverityId` that the page filled with the project's first
 * severity, so every template — Critical and Warning alike — opened the same
 * severity of incident. That failure is invisible in every obvious place: the
 * page renders correctly, the monitor is created successfully, the criteria
 * validate, and the mis-signal only shows up weeks later when someone is paged
 * at 3am for a replica-count drift. Nothing but these tests notices.
 *
 * Two properties are worth naming up front because they are easy to "clean up"
 * into bugs:
 *
 *   1. Rank comes from `order`, never from array position and never from the
 *      severity NAME. Severities are user-renameable and user-reorderable
 *      ("Sev1", "P0", localized names), so name matching works for the default
 *      seed and for no other project on the planet.
 *
 *   2. A row with no `order` is UNRANKED, not rank zero. Coercing it to zero
 *      (which `a.order || MAX` quietly does, and which is the natural way to
 *      write this) promotes a legacy row to most-severe and maps every
 *      Critical recommendation onto it.
 */

/*
 * The real default-project seed, from ProjectService.addDefaultIncidentSeverity
 * and addDefaultAlertSeverity. Written out rather than imported because the
 * mapper deliberately takes a structural slice — the point of these tests is
 * that the mapper produces the right answer for the shape the overwhelming
 * majority of real projects actually have.
 */
const CRITICAL_INCIDENT_ID: ObjectID = ObjectID.generate();
const MAJOR_INCIDENT_ID: ObjectID = ObjectID.generate();
const MINOR_INCIDENT_ID: ObjectID = ObjectID.generate();

const HIGH_ALERT_ID: ObjectID = ObjectID.generate();
const LOW_ALERT_ID: ObjectID = ObjectID.generate();

const DEFAULT_INCIDENT_SEVERITIES: Array<MonitorRecommendationSeverityOption> =
  [
    { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
    { id: MAJOR_INCIDENT_ID, name: "Major Incident", order: 2 },
    { id: MINOR_INCIDENT_ID, name: "Minor Incident", order: 3 },
  ];

const DEFAULT_ALERT_SEVERITIES: Array<MonitorRecommendationSeverityOption> = [
  { id: HIGH_ALERT_ID, name: "High", order: 1 },
  { id: LOW_ALERT_ID, name: "Low", order: 2 },
];

function getNames(
  options: Array<MonitorRecommendationSeverityOption>,
): Array<string> {
  return options.map((option: MonitorRecommendationSeverityOption) => {
    return option.name;
  });
}

function idString(id: ObjectID | undefined): string | undefined {
  return id ? id.toString() : undefined;
}

describe("MonitorRecommendationSeverityMapper", () => {
  describe("rankSeverities", () => {
    it("sorts by order ascending regardless of array position", () => {
      const ranked: Array<MonitorRecommendationSeverityOption> =
        MonitorRecommendationSeverityMapper.rankSeverities([
          { id: MINOR_INCIDENT_ID, name: "Minor Incident", order: 3 },
          { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
          { id: MAJOR_INCIDENT_ID, name: "Major Incident", order: 2 },
        ]);

      expect(getNames(ranked)).toEqual([
        "Critical Incident",
        "Major Incident",
        "Minor Incident",
      ]);
    });

    it("pushes rows with no order to the very end", () => {
      /*
       * The unranked row is placed FIRST in the input on purpose: an
       * implementation that treats a missing order as 0 — or that simply
       * leaves unsortable rows where they were — leaves it at index 0, where
       * `getDefaultSeverityMapping` reads it as the project's most severe.
       */
      const ranked: Array<MonitorRecommendationSeverityOption> =
        MonitorRecommendationSeverityMapper.rankSeverities([
          { id: ObjectID.generate(), name: "Legacy Unranked" },
          { id: MAJOR_INCIDENT_ID, name: "Major Incident", order: 2 },
          { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
        ]);

      expect(getNames(ranked)).toEqual([
        "Critical Incident",
        "Major Incident",
        "Legacy Unranked",
      ]);
    });

    it("treats an explicitly undefined order the same as an absent one", () => {
      // `{ order: undefined }` and `{}` are different objects to `in`/hasOwnProperty.
      const ranked: Array<MonitorRecommendationSeverityOption> =
        MonitorRecommendationSeverityMapper.rankSeverities([
          {
            id: ObjectID.generate(),
            name: "Legacy Unranked",
            order: undefined,
          },
          { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
        ]);

      expect(getNames(ranked)).toEqual([
        "Critical Incident",
        "Legacy Unranked",
      ]);
    });

    it("keeps order 0 as the most severe rather than treating it as unset", () => {
      /*
       * Zero is a legitimate order and the exact value a truthiness check
       * (`a.order || MAX_SAFE_INTEGER`) mangles: it would demote the project's
       * most severe row to last and hand Critical to whatever came next.
       */
      const zeroOrderId: ObjectID = ObjectID.generate();

      const ranked: Array<MonitorRecommendationSeverityOption> =
        MonitorRecommendationSeverityMapper.rankSeverities([
          { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
          { id: zeroOrderId, name: "Sev0", order: 0 },
        ]);

      expect(getNames(ranked)).toEqual(["Sev0", "Critical Incident"]);
    });

    it("does not mutate the array it was given", () => {
      /*
       * Callers pass the API's own severity list straight in and keep using it
       * to render the dropdown. Sorting it in place would silently reorder the
       * form's options as a side effect of computing the mapping.
       */
      const input: Array<MonitorRecommendationSeverityOption> = [
        { id: MINOR_INCIDENT_ID, name: "Minor Incident", order: 3 },
        { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
      ];

      const ranked: Array<MonitorRecommendationSeverityOption> =
        MonitorRecommendationSeverityMapper.rankSeverities(input);

      expect(getNames(input)).toEqual(["Minor Incident", "Critical Incident"]);
      expect(ranked).not.toBe(input);
    });

    it("keeps the input order for severities that share an order", () => {
      /*
       * The product permits two severities with the same order. An unstable
       * tiebreak would mean the mapping shown in the create form and the
       * mapping written onto the monitor could disagree between two calls with
       * identical input.
       */
      const firstTiedId: ObjectID = ObjectID.generate();
      const secondTiedId: ObjectID = ObjectID.generate();

      const input: Array<MonitorRecommendationSeverityOption> = [
        { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
        { id: firstTiedId, name: "Tied A", order: 2 },
        { id: secondTiedId, name: "Tied B", order: 2 },
      ];

      expect(
        getNames(MonitorRecommendationSeverityMapper.rankSeverities(input)),
      ).toEqual(["Critical Incident", "Tied A", "Tied B"]);

      expect(
        getNames(MonitorRecommendationSeverityMapper.rankSeverities(input)),
      ).toEqual(["Critical Incident", "Tied A", "Tied B"]);
    });

    it("keeps the input order among several unranked rows", () => {
      const input: Array<MonitorRecommendationSeverityOption> = [
        { id: ObjectID.generate(), name: "Unranked A" },
        { id: ObjectID.generate(), name: "Unranked B" },
      ];

      expect(
        getNames(MonitorRecommendationSeverityMapper.rankSeverities(input)),
      ).toEqual(["Unranked A", "Unranked B"]);
    });

    it("returns an empty array for empty input", () => {
      expect(MonitorRecommendationSeverityMapper.rankSeverities([])).toEqual(
        [],
      );
    });
  });

  describe("getDefaultSeverityMapping", () => {
    it("maps Critical to Critical Incident and Warning to Major Incident on the default seed", () => {
      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
          DEFAULT_INCIDENT_SEVERITIES,
        );

      expect(idString(map.Critical)).toBe(CRITICAL_INCIDENT_ID.toString());
      expect(idString(map.Warning)).toBe(MAJOR_INCIDENT_ID.toString());
    });

    it("maps Critical to High and Warning to Low on the default alert seed", () => {
      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
          DEFAULT_ALERT_SEVERITIES,
        );

      expect(idString(map.Critical)).toBe(HIGH_ALERT_ID.toString());
      expect(idString(map.Warning)).toBe(LOW_ALERT_ID.toString());
    });

    it("never maps Critical and Warning to the same severity when the project has more than one", () => {
      /*
       * The single assertion that the whole feature reduces to. If these two
       * ever collapse back to one id, every recommendation pages identically
       * again and the Critical/Warning badge on each card describes nothing.
       */
      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
          DEFAULT_INCIDENT_SEVERITIES,
        );

      expect(idString(map.Critical)).not.toBe(idString(map.Warning));
    });

    it("maps by order, not by position in the array it was handed", () => {
      /*
       * The API sorts severities today, so an implementation that just took
       * `options[0]` and `options[1]` would pass every other test here and
       * break the day the API's sort changes or a caller passes an unsorted
       * list from a cache.
       */
      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping([
          { id: MINOR_INCIDENT_ID, name: "Minor Incident", order: 3 },
          { id: MAJOR_INCIDENT_ID, name: "Major Incident", order: 2 },
          { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
        ]);

      expect(idString(map.Critical)).toBe(CRITICAL_INCIDENT_ID.toString());
      expect(idString(map.Warning)).toBe(MAJOR_INCIDENT_ID.toString());
    });

    it("does not hand Critical to an unranked legacy severity", () => {
      /*
       * The end-to-end consequence of the rankSeverities ordering rule: a
       * project carrying one severity row with no order (created before the
       * field existed, or through an import) must not have every Critical
       * recommendation silently routed to it.
       */
      const unrankedId: ObjectID = ObjectID.generate();

      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping([
          { id: unrankedId, name: "Imported Severity" },
          ...DEFAULT_INCIDENT_SEVERITIES,
        ]);

      expect(idString(map.Critical)).toBe(CRITICAL_INCIDENT_ID.toString());
      expect(idString(map.Warning)).toBe(MAJOR_INCIDENT_ID.toString());
      expect(idString(map.Critical)).not.toBe(unrankedId.toString());
      expect(idString(map.Warning)).not.toBe(unrankedId.toString());
    });

    it("maps both Critical and Warning to the only severity a one-severity project has", () => {
      /*
       * A project with one severity cannot express the distinction, and
       * leaving Warning unmapped would drop those monitors back onto the
       * template's own `defaultIncidentSeverityId` — the pre-fix behaviour
       * this class exists to replace. Mapping both is the deliberate choice.
       */
      const onlyId: ObjectID = ObjectID.generate();

      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping([
          { id: onlyId, name: "Sev1", order: 1 },
        ]);

      expect(idString(map.Critical)).toBe(onlyId.toString());
      expect(idString(map.Warning)).toBe(onlyId.toString());
    });

    it("returns an empty map when the project has no severities at all", () => {
      /*
       * Empty rather than a map onto undefined ids: `resolveSeverityId` returns
       * undefined for a missing entry, and the util reads that as "leave the
       * template's severity alone". A map containing `Critical: undefined`
       * would travel the same path, but an empty object says so unambiguously
       * and keeps `describeMapping` from rendering half a row.
       */
      expect(
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping([]),
      ).toEqual({});
    });

    it("gives Warning the SECOND severity, not the least severe one", () => {
      /*
       * Pinned because it is a judgement call that the default three-severity
       * seed hides completely: there, second and last-but-one are the same row.
       * On a five-severity project the two answers diverge, and the intended
       * one is second — a recommendation the catalog calls Warning ("Disk Will
       * Fill In 24h", "Deployment Replica Mismatch") is a real production
       * problem, not the bottom of the scale.
       *
       * If someone deliberately changes this to "least severe", this test is
       * where that decision gets recorded.
       */
      const sev1: ObjectID = ObjectID.generate();
      const sev2: ObjectID = ObjectID.generate();
      const sev5: ObjectID = ObjectID.generate();

      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping([
          { id: sev1, name: "Sev1", order: 1 },
          { id: sev2, name: "Sev2", order: 2 },
          { id: ObjectID.generate(), name: "Sev3", order: 3 },
          { id: ObjectID.generate(), name: "Sev4", order: 4 },
          { id: sev5, name: "Sev5", order: 5 },
        ]);

      expect(idString(map.Critical)).toBe(sev1.toString());
      expect(idString(map.Warning)).toBe(sev2.toString());
      expect(idString(map.Warning)).not.toBe(sev5.toString());
    });

    it("does not mutate the options array it was given", () => {
      const input: Array<MonitorRecommendationSeverityOption> = [
        { id: MINOR_INCIDENT_ID, name: "Minor Incident", order: 3 },
        { id: CRITICAL_INCIDENT_ID, name: "Critical Incident", order: 1 },
      ];

      MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(input);

      expect(getNames(input)).toEqual(["Minor Incident", "Critical Incident"]);
    });
  });

  describe("getMappingFromRankedIds", () => {
    /*
     * The monitor-edit template pickers only ever see the dropdown options the
     * form built — `{ value, label }` pairs off a list the API already sorted
     * by `order` — so the `order` column is gone by the time a picker needs a
     * mapping. This turns position back into rank rather than introducing a
     * second ranking rule that could disagree with `rankSeverities`.
     */
    it("treats array position as the rank", () => {
      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getMappingFromRankedIds([
          CRITICAL_INCIDENT_ID,
          MAJOR_INCIDENT_ID,
          MINOR_INCIDENT_ID,
        ]);

      expect(idString(map.Critical)).toBe(CRITICAL_INCIDENT_ID.toString());
      expect(idString(map.Warning)).toBe(MAJOR_INCIDENT_ID.toString());
    });

    it("does not re-sort the ids it was handed", () => {
      /*
       * The synthesised orders are 1, 2, 3 in the order given. An
       * implementation that sorted the ids themselves (by uuid, say) would
       * pass the test above only by luck.
       */
      const map: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getMappingFromRankedIds([
          MINOR_INCIDENT_ID,
          CRITICAL_INCIDENT_ID,
        ]);

      expect(idString(map.Critical)).toBe(MINOR_INCIDENT_ID.toString());
      expect(idString(map.Warning)).toBe(CRITICAL_INCIDENT_ID.toString());
    });

    it("returns an empty map for an empty list", () => {
      expect(
        MonitorRecommendationSeverityMapper.getMappingFromRankedIds([]),
      ).toEqual({});
    });
  });

  describe("resolveTemplateSeverityIds", () => {
    /*
     * The monitor-edit template pickers hand their severity ids to
     * `getMonitorStep` UP FRONT and never see the criteria instances again —
     * unlike the recommendations page, which rewrites them afterwards through
     * `applyNotificationSettingsToMonitorStep`. So a picker has to choose
     * correctly the first time, and before this resolver existed every one of
     * them passed the project's FIRST severity into both slots for every
     * template. "Task Down" (Critical) and "High Task CPU Usage" (Warning)
     * opened records at exactly the same level.
     */
    const FALLBACK_INCIDENT_ID: ObjectID = ObjectID.generate();
    const FALLBACK_ALERT_ID: ObjectID = ObjectID.generate();

    it("does not resolve a Critical and a Warning template to the same alert severity", () => {
      /*
       * The single assertion this whole resolver reduces to. If these collapse
       * back onto one id, the Critical/Warning badge on a picker card again
       * describes nothing that subsequently happens.
       */
      const critical: MonitorRecommendationTemplateSeverityIds =
        MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
          severity: "Critical",
          rankedAlertSeverityIds: [HIGH_ALERT_ID, LOW_ALERT_ID],
          fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
          fallbackAlertSeverityId: FALLBACK_ALERT_ID,
        });

      const warning: MonitorRecommendationTemplateSeverityIds =
        MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
          severity: "Warning",
          rankedAlertSeverityIds: [HIGH_ALERT_ID, LOW_ALERT_ID],
          fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
          fallbackAlertSeverityId: FALLBACK_ALERT_ID,
        });

      expect(idString(critical.alertSeverityId)).toBe(HIGH_ALERT_ID.toString());
      expect(idString(warning.alertSeverityId)).toBe(LOW_ALERT_ID.toString());
      expect(idString(critical.alertSeverityId)).not.toBe(
        idString(warning.alertSeverityId),
      );
    });

    it("resolves incident and alert severities independently", () => {
      /*
       * The two seeds are not the same shape — incidents get three rows and
       * alerts get two (ProjectService.addDefaultIncidentSeverity vs
       * addDefaultAlertSeverity) — so one shared ranked list would be wrong
       * for one of them. On the real default seed a Warning template lands on
       * "Major Incident" and on "Low", which is why a production alert email
       * can read SEVERITY: Low for a card badged Warning.
       */
      const ids: MonitorRecommendationTemplateSeverityIds =
        MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
          severity: "Warning",
          rankedIncidentSeverityIds: [
            CRITICAL_INCIDENT_ID,
            MAJOR_INCIDENT_ID,
            MINOR_INCIDENT_ID,
          ],
          rankedAlertSeverityIds: [HIGH_ALERT_ID, LOW_ALERT_ID],
          fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
          fallbackAlertSeverityId: FALLBACK_ALERT_ID,
        });

      expect(idString(ids.incidentSeverityId)).toBe(
        MAJOR_INCIDENT_ID.toString(),
      );
      expect(idString(ids.alertSeverityId)).toBe(LOW_ALERT_ID.toString());
      expect(idString(ids.incidentSeverityId)).not.toBe(
        MINOR_INCIDENT_ID.toString(),
      );
    });

    it("gives Critical the most severe row of each list", () => {
      const ids: MonitorRecommendationTemplateSeverityIds =
        MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
          severity: "Critical",
          rankedIncidentSeverityIds: [
            CRITICAL_INCIDENT_ID,
            MAJOR_INCIDENT_ID,
            MINOR_INCIDENT_ID,
          ],
          rankedAlertSeverityIds: [HIGH_ALERT_ID, LOW_ALERT_ID],
          fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
          fallbackAlertSeverityId: FALLBACK_ALERT_ID,
        });

      expect(idString(ids.incidentSeverityId)).toBe(
        CRITICAL_INCIDENT_ID.toString(),
      );
      expect(idString(ids.alertSeverityId)).toBe(HIGH_ALERT_ID.toString());
    });

    it("ranks by position rather than re-sorting the ids", () => {
      /*
       * Guards the synthesised `order` in `getMappingFromRankedIds`: the form
       * already sorted the API list, so index 0 must win for Critical even
       * when the ids sort differently by any other measure.
       */
      const ids: MonitorRecommendationTemplateSeverityIds =
        MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
          severity: "Critical",
          rankedAlertSeverityIds: [LOW_ALERT_ID, HIGH_ALERT_ID],
          fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
          fallbackAlertSeverityId: FALLBACK_ALERT_ID,
        });

      expect(idString(ids.alertSeverityId)).toBe(LOW_ALERT_ID.toString());
    });

    it("falls back to the caller's own defaults when the project has no severities", () => {
      /*
       * `<X>AlertTemplateArgs` declares both id fields as required, so the
       * resolver can never hand back undefined — it would only push the
       * `|| ObjectID.generate()` fallback back into the eight picker call
       * sites, which is where this bug lived in the first place.
       */
      const ids: MonitorRecommendationTemplateSeverityIds =
        MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
          severity: "Warning",
          rankedIncidentSeverityIds: [],
          rankedAlertSeverityIds: [],
          fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
          fallbackAlertSeverityId: FALLBACK_ALERT_ID,
        });

      expect(idString(ids.incidentSeverityId)).toBe(
        FALLBACK_INCIDENT_ID.toString(),
      );
      expect(idString(ids.alertSeverityId)).toBe(FALLBACK_ALERT_ID.toString());
    });

    it("falls back when the ranked lists are omitted entirely", () => {
      // The eight picker call sites can legitimately have nothing to pass yet.
      const ids: MonitorRecommendationTemplateSeverityIds =
        MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
          severity: "Critical",
          fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
          fallbackAlertSeverityId: FALLBACK_ALERT_ID,
        });

      expect(idString(ids.incidentSeverityId)).toBe(
        FALLBACK_INCIDENT_ID.toString(),
      );
      expect(idString(ids.alertSeverityId)).toBe(FALLBACK_ALERT_ID.toString());
    });

    it("maps both Critical and Warning to the only severity a one-severity project has", () => {
      /*
       * Mirrors the getDefaultSeverityMapping single-severity case: such a
       * project cannot express the distinction, but the template must still
       * get a valid id or `MonitorCriteriaInstance.getValidationError` fails
       * the create.
       */
      const onlyIncidentId: ObjectID = ObjectID.generate();
      const onlyAlertId: ObjectID = ObjectID.generate();

      const severities: Array<MonitorRecommendationSeverity> = [
        "Critical",
        "Warning",
      ];

      for (const severity of severities) {
        const ids: MonitorRecommendationTemplateSeverityIds =
          MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
            severity: severity,
            rankedIncidentSeverityIds: [onlyIncidentId],
            rankedAlertSeverityIds: [onlyAlertId],
            fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
            fallbackAlertSeverityId: FALLBACK_ALERT_ID,
          });

        expect(idString(ids.incidentSeverityId)).toBe(
          onlyIncidentId.toString(),
        );
        expect(idString(ids.alertSeverityId)).toBe(onlyAlertId.toString());
      }
    });

    it("agrees with getDefaultSeverityMapping on the real default seed", () => {
      /*
       * The two entry points into this decision — the recommendations page
       * (getDefaultSeverityMapping over rows carrying `order`) and the
       * monitor-edit pickers (this, over a pre-ranked id list) — must not be
       * able to drift apart. Pinned against the real seed shapes.
       */
      const mapping: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
          DEFAULT_ALERT_SEVERITIES,
        );

      const severities: Array<MonitorRecommendationSeverity> = [
        "Critical",
        "Warning",
      ];

      for (const severity of severities) {
        const ids: MonitorRecommendationTemplateSeverityIds =
          MonitorRecommendationSeverityMapper.resolveTemplateSeverityIds({
            severity: severity,
            rankedAlertSeverityIds: DEFAULT_ALERT_SEVERITIES.map(
              (option: MonitorRecommendationSeverityOption) => {
                return option.id;
              },
            ),
            fallbackIncidentSeverityId: FALLBACK_INCIDENT_ID,
            fallbackAlertSeverityId: FALLBACK_ALERT_ID,
          });

        expect(idString(ids.alertSeverityId)).toBe(idString(mapping[severity]));
      }
    });
  });

  describe("resolveSeverityId", () => {
    it("returns the id the map holds for that severity", () => {
      const map: MonitorRecommendationSeverityMap = {
        Critical: CRITICAL_INCIDENT_ID,
        Warning: MAJOR_INCIDENT_ID,
      };

      expect(
        idString(
          MonitorRecommendationSeverityMapper.resolveSeverityId({
            severity: "Critical",
            severityMap: map,
          }),
        ),
      ).toBe(CRITICAL_INCIDENT_ID.toString());

      expect(
        idString(
          MonitorRecommendationSeverityMapper.resolveSeverityId({
            severity: "Warning",
            severityMap: map,
          }),
        ),
      ).toBe(MAJOR_INCIDENT_ID.toString());
    });

    it("returns undefined when there is no map", () => {
      /*
       * "No map" is the state of every caller that predates this feature, and
       * it must mean "leave the template's severity alone" rather than throw or
       * return a blank id — a criteria instance that creates incidents and has
       * a populated incident with no severity fails
       * MonitorCriteriaInstance.getValidationError, so the whole create would
       * fail at submit with a message about a field the user never saw.
       */
      expect(
        MonitorRecommendationSeverityMapper.resolveSeverityId({
          severity: "Critical",
          severityMap: undefined,
        }),
      ).toBeUndefined();

      expect(
        MonitorRecommendationSeverityMapper.resolveSeverityId({
          severity: "Warning",
        }),
      ).toBeUndefined();
    });

    it("returns undefined for a severity the map has no entry for", () => {
      // Same "leave it alone" contract, reached through a partial map.
      expect(
        MonitorRecommendationSeverityMapper.resolveSeverityId({
          severity: "Warning",
          severityMap: { Critical: CRITICAL_INCIDENT_ID },
        }),
      ).toBeUndefined();

      expect(
        MonitorRecommendationSeverityMapper.resolveSeverityId({
          severity: "Critical",
          severityMap: {},
        }),
      ).toBeUndefined();
    });
  });

  describe("describeMapping", () => {
    it("describes both severities by their project-facing names, Critical first", () => {
      /*
       * This string is the only thing that makes an automatic severity choice
       * reviewable instead of surprising: it is what the create form renders so
       * the user can see "Critical -> Critical Incident" before submitting.
       */
      expect(
        MonitorRecommendationSeverityMapper.describeMapping({
          options: DEFAULT_INCIDENT_SEVERITIES,
          severityMap:
            MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
              DEFAULT_INCIDENT_SEVERITIES,
            ),
        }),
      ).toEqual([
        { severity: "Critical", name: "Critical Incident" },
        { severity: "Warning", name: "Major Incident" },
      ]);
    });

    it("skips a severity the map does not cover", () => {
      expect(
        MonitorRecommendationSeverityMapper.describeMapping({
          options: DEFAULT_INCIDENT_SEVERITIES,
          severityMap: { Critical: CRITICAL_INCIDENT_ID },
        }),
      ).toEqual([{ severity: "Critical", name: "Critical Incident" }]);
    });

    it("skips an id that matches none of the options", () => {
      /*
       * A stale id is reachable in normal use: the form holds a mapping while
       * the user deletes that severity in another tab, or the map is restored
       * from a previous session. Rendering "Critical -> undefined" (or throwing
       * on the missing option) is worse than saying nothing about Critical.
       */
      expect(
        MonitorRecommendationSeverityMapper.describeMapping({
          options: DEFAULT_INCIDENT_SEVERITIES,
          severityMap: {
            Critical: ObjectID.generate(),
            Warning: MAJOR_INCIDENT_ID,
          },
        }),
      ).toEqual([{ severity: "Warning", name: "Major Incident" }]);
    });

    it("matches options by id value rather than by object identity", () => {
      /*
       * The map's ObjectIDs and the options' ObjectIDs come from different
       * fetches in the real page, so they are never the same instance even when
       * they hold the same uuid. A `===` comparison would describe nothing.
       */
      expect(
        MonitorRecommendationSeverityMapper.describeMapping({
          options: DEFAULT_INCIDENT_SEVERITIES,
          severityMap: {
            Critical: new ObjectID(CRITICAL_INCIDENT_ID.toString()),
          },
        }),
      ).toEqual([{ severity: "Critical", name: "Critical Incident" }]);
    });

    it("returns an empty list when there is no map", () => {
      expect(
        MonitorRecommendationSeverityMapper.describeMapping({
          options: DEFAULT_INCIDENT_SEVERITIES,
          severityMap: undefined,
        }),
      ).toEqual([]);

      expect(
        MonitorRecommendationSeverityMapper.describeMapping({
          options: DEFAULT_INCIDENT_SEVERITIES,
        }),
      ).toEqual([]);
    });

    it("returns an empty list when the project has no severities to name", () => {
      expect(
        MonitorRecommendationSeverityMapper.describeMapping({
          options: [],
          severityMap: { Critical: CRITICAL_INCIDENT_ID },
        }),
      ).toEqual([]);
    });
  });

  describe("end to end with real catalog recommendations", () => {
    /*
     * The mapper is only useful if its output survives the trip into
     * `applyNotificationSettingsToMonitorStep` and lands on the criteria
     * incidents the monitor evaluator actually reads. The unit tests above pin
     * the mapping; this pins that nothing between here and the created monitor
     * flattens it back to one severity — which is exactly what the code did
     * before this feature, because every template took the single
     * `args.defaultIncidentSeverityId`.
     */

    const ALL_RECOMMENDATIONS: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getAllRecommendations();

    const CRITICAL_RECOMMENDATION: MonitorRecommendation | undefined =
      ALL_RECOMMENDATIONS.find((recommendation: MonitorRecommendation) => {
        return recommendation.severity === "Critical";
      });

    const WARNING_RECOMMENDATION: MonitorRecommendation | undefined =
      ALL_RECOMMENDATIONS.find((recommendation: MonitorRecommendation) => {
        return recommendation.severity === "Warning";
      });

    const TEMPLATE_INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
    const TEMPLATE_ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();

    function buildArgs(): MonitorRecommendationArgs {
      return {
        resourceIdentifier: ObjectID.generate().toString(),
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: TEMPLATE_INCIDENT_SEVERITY_ID,
        defaultAlertSeverityId: TEMPLATE_ALERT_SEVERITY_ID,
        monitorName: "Test Monitor",
      };
    }

    function buildStepWithDefaultMapping(
      recommendation: MonitorRecommendation,
    ): MonitorStep {
      return MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
        monitorStep: recommendation.getMonitorStep(buildArgs()),
        notificationSettings: {
          incidentSeverityIdBySeverity:
            MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
              DEFAULT_INCIDENT_SEVERITIES,
            ),
          alertSeverityIdBySeverity:
            MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
              DEFAULT_ALERT_SEVERITIES,
            ),
        },
        severity: recommendation.severity,
      });
    }

    function getIncidents(monitorStep: MonitorStep): Array<CriteriaIncident> {
      return (
        monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray ||
        []
      ).flatMap((instance: MonitorCriteriaInstance) => {
        return instance.data?.incidents || [];
      });
    }

    function getAlerts(monitorStep: MonitorStep): Array<CriteriaAlert> {
      return (
        monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray ||
        []
      ).flatMap((instance: MonitorCriteriaInstance) => {
        return instance.data?.alerts || [];
      });
    }

    it("ships both a Critical and a Warning recommendation to compare", () => {
      /*
       * Guards the two tests below against passing vacuously if the catalog
       * ever stops shipping one of the two severities.
       */
      expect(CRITICAL_RECOMMENDATION).toBeDefined();
      expect(WARNING_RECOMMENDATION).toBeDefined();
    });

    it("gives a Critical and a Warning recommendation DIFFERENT incident severities", () => {
      const criticalIncidents: Array<CriteriaIncident> = getIncidents(
        buildStepWithDefaultMapping(CRITICAL_RECOMMENDATION!),
      );
      const warningIncidents: Array<CriteriaIncident> = getIncidents(
        buildStepWithDefaultMapping(WARNING_RECOMMENDATION!),
      );

      expect(criticalIncidents.length).toBeGreaterThan(0);
      expect(warningIncidents.length).toBeGreaterThan(0);

      for (const incident of criticalIncidents) {
        expect(idString(incident.incidentSeverityId)).toBe(
          CRITICAL_INCIDENT_ID.toString(),
        );
      }

      for (const incident of warningIncidents) {
        expect(idString(incident.incidentSeverityId)).toBe(
          MAJOR_INCIDENT_ID.toString(),
        );
      }

      /*
       * The regression this whole feature fixes, stated directly: both used to
       * come out as `args.defaultIncidentSeverityId`, so the two arrays were
       * identical and neither told the truth about the card's badge.
       */
      expect(idString(criticalIncidents[0]!.incidentSeverityId)).not.toBe(
        idString(warningIncidents[0]!.incidentSeverityId),
      );
      expect(idString(warningIncidents[0]!.incidentSeverityId)).not.toBe(
        TEMPLATE_INCIDENT_SEVERITY_ID.toString(),
      );
    });

    it("gives a Critical and a Warning recommendation DIFFERENT alert severities", () => {
      const criticalAlerts: Array<CriteriaAlert> = getAlerts(
        buildStepWithDefaultMapping(CRITICAL_RECOMMENDATION!),
      );
      const warningAlerts: Array<CriteriaAlert> = getAlerts(
        buildStepWithDefaultMapping(WARNING_RECOMMENDATION!),
      );

      expect(criticalAlerts.length).toBeGreaterThan(0);
      expect(warningAlerts.length).toBeGreaterThan(0);

      for (const alert of criticalAlerts) {
        expect(idString(alert.alertSeverityId)).toBe(HIGH_ALERT_ID.toString());
      }

      for (const alert of warningAlerts) {
        expect(idString(alert.alertSeverityId)).toBe(LOW_ALERT_ID.toString());
      }
    });

    it("routes every catalog recommendation to the severity its own badge claims", () => {
      /*
       * The per-recommendation version of the above, across all eight resource
       * types. A single template whose declared severity disagrees with what it
       * writes onto its criteria would be invisible on the page and would only
       * surface as a mis-severity incident in production.
       */
      expect(ALL_RECOMMENDATIONS.length).toBeGreaterThan(0);

      for (const recommendation of ALL_RECOMMENDATIONS) {
        const expectedIncidentSeverityId: ObjectID =
          recommendation.severity === "Critical"
            ? CRITICAL_INCIDENT_ID
            : MAJOR_INCIDENT_ID;

        for (const incident of getIncidents(
          buildStepWithDefaultMapping(recommendation),
        )) {
          expect(idString(incident.incidentSeverityId)).toBe(
            expectedIncidentSeverityId.toString(),
          );
        }
      }
    });

    it("falls back to the template's own severity when the project has none", () => {
      /*
       * A project with no severities produces an empty map, and an empty map
       * must leave the templates untouched rather than blank the severity out —
       * a criteria incident with no severity id fails validation and the create
       * fails at submit.
       */
      const severities: Array<MonitorRecommendationSeverity> = [
        "Critical",
        "Warning",
      ];

      for (const severity of severities) {
        const monitorStep: MonitorStep =
          MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
            monitorStep: CRITICAL_RECOMMENDATION!.getMonitorStep(buildArgs()),
            notificationSettings: {
              incidentSeverityIdBySeverity:
                MonitorRecommendationSeverityMapper.getDefaultSeverityMapping(
                  [],
                ),
            },
            severity: severity,
          });

        for (const incident of getIncidents(monitorStep)) {
          expect(idString(incident.incidentSeverityId)).toBe(
            TEMPLATE_INCIDENT_SEVERITY_ID.toString(),
          );
        }
      }
    });

    it("maps Critical and Warning to the same severity on a one-severity project", () => {
      /*
       * The documented single-severity fallback, checked where it actually
       * matters: the monitor still gets a valid severity (so the create
       * succeeds), it just cannot express the distinction.
       */
      const onlyId: ObjectID = ObjectID.generate();
      const oneSeverityMap: MonitorRecommendationSeverityMap =
        MonitorRecommendationSeverityMapper.getDefaultSeverityMapping([
          { id: onlyId, name: "Sev1", order: 1 },
        ]);

      const recommendations: Array<MonitorRecommendation> = [
        CRITICAL_RECOMMENDATION!,
        WARNING_RECOMMENDATION!,
      ];

      for (const recommendation of recommendations) {
        const monitorStep: MonitorStep =
          MonitorRecommendationUtil.applyNotificationSettingsToMonitorStep({
            monitorStep: recommendation.getMonitorStep(buildArgs()),
            notificationSettings: {
              incidentSeverityIdBySeverity: oneSeverityMap,
            },
            severity: recommendation.severity,
          });

        const incidents: Array<CriteriaIncident> = getIncidents(monitorStep);

        expect(incidents.length).toBeGreaterThan(0);

        for (const incident of incidents) {
          expect(idString(incident.incidentSeverityId)).toBe(onlyId.toString());
        }
      }
    });
  });
});
