import RecommendationFilterUtil from "../../FeatureSet/Dashboard/src/Components/Recommendations/RecommendationFilterUtil";
import {
  RecommendationCategoryGroup,
  RecommendationCounts,
  RecommendationSeverityFilter,
  RecommendationStatus,
  RecommendationStatusFilter,
  RecommendationViewModel,
} from "../../FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
import MonitorRecommendationCatalog from "../../../Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
  MonitorRecommendationSeverity,
} from "../../../Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import RecommendationDismissal from "../../../Common/Models/DatabaseModels/RecommendationDismissal";
import ObjectID from "../../../Common/Types/ObjectID";

/*
 * Every defect this file pins renders perfectly.
 *
 * The recommendations page has no error state — it joins a stateless catalog
 * against project data and draws cards. When the join is wrong the page still
 * paints: a card offering to create a monitor that already exists, a badge
 * reading "18" on a cluster where there is nothing left to do, a "Select all"
 * that quietly deselects the category you picked a minute ago. None of it
 * throws, none of it logs, and the only symptom is a duplicate monitor or a
 * recommendation nobody ever acts on. So the assertions below are about the
 * classification and the arithmetic, not about markup.
 *
 * Real catalog entries are used throughout rather than hand-built fixtures.
 * Hand-built recommendations would let a change in what the catalog actually
 * contains — a category renamed, a severity flipped, a description reworded —
 * pass these tests while breaking the page.
 */

const KUBERNETES_RECOMMENDATIONS: Array<MonitorRecommendation> =
  MonitorRecommendationCatalog.getRecommendations(
    MonitorRecommendationResourceType.Kubernetes,
  );

const KUBERNETES_CATEGORIES: Array<string> =
  MonitorRecommendationCatalog.getCategories(
    MonitorRecommendationResourceType.Kubernetes,
  );

/*
 * The HPA saturation template is the canonical "the metric only appears in the
 * description" case: an engineer who is worried about `k8s.hpa.current_replicas`
 * types the metric, not the marketing name of the check.
 */
const HPA_RECOMMENDATION_ID: string = "Kubernetes:k8s-hpa-at-max-replicas";
const DESCRIPTION_ONLY_METRIC: string = "k8s.hpa.current_replicas";

function getRecommendationById(
  recommendationId: string,
): MonitorRecommendation {
  const recommendation: MonitorRecommendation | undefined =
    KUBERNETES_RECOMMENDATIONS.find((candidate: MonitorRecommendation) => {
      return candidate.recommendationId === recommendationId;
    });

  if (!recommendation) {
    throw new Error(
      `The Kubernetes catalog no longer contains ${recommendationId}. Pick another real recommendation for this test rather than inventing one.`,
    );
  }

  return recommendation;
}

function getRecommendationsWithSeverity(
  severity: MonitorRecommendationSeverity,
): Array<MonitorRecommendation> {
  return KUBERNETES_RECOMMENDATIONS.filter(
    (recommendation: MonitorRecommendation) => {
      return recommendation.severity === severity;
    },
  );
}

function getFirstWithSeverity(
  severity: MonitorRecommendationSeverity,
): MonitorRecommendation {
  const recommendation: MonitorRecommendation | undefined =
    getRecommendationsWithSeverity(severity)[0];

  if (!recommendation) {
    throw new Error(
      `The Kubernetes catalog has no ${severity} recommendation.`,
    );
  }

  return recommendation;
}

function buildViewModel(
  recommendation: MonitorRecommendation,
  status: RecommendationStatus,
): RecommendationViewModel {
  return {
    recommendation: recommendation,
    status: status,
  };
}

function buildDismissal(data: {
  recommendationId?: string | undefined;
  dismissalReason?: string | undefined;
  id?: ObjectID | undefined;
  omitId?: boolean | undefined;
}): RecommendationDismissal {
  const dismissal: RecommendationDismissal = new RecommendationDismissal();

  if (data.omitId !== true) {
    dismissal.id = data.id || ObjectID.generate();
  }

  if (data.recommendationId !== undefined) {
    dismissal.recommendationId = data.recommendationId;
  }

  if (data.dismissalReason !== undefined) {
    dismissal.dismissalReason = data.dismissalReason;
  }

  return dismissal;
}

function idsOf(viewModels: Array<RecommendationViewModel>): Array<string> {
  return viewModels.map((viewModel: RecommendationViewModel) => {
    return viewModel.recommendation.recommendationId;
  });
}

function buildAllViewModels(
  status: RecommendationStatus,
): Array<RecommendationViewModel> {
  return KUBERNETES_RECOMMENDATIONS.map(
    (recommendation: MonitorRecommendation) => {
      return buildViewModel(recommendation, status);
    },
  );
}

function findViewModel(data: {
  viewModels: Array<RecommendationViewModel>;
  recommendationId: string;
}): RecommendationViewModel {
  const viewModel: RecommendationViewModel | undefined = data.viewModels.find(
    (candidate: RecommendationViewModel) => {
      return (
        candidate.recommendation.recommendationId === data.recommendationId
      );
    },
  );

  if (!viewModel) {
    throw new Error(`No view model was built for ${data.recommendationId}.`);
  }

  return viewModel;
}

describe("RecommendationFilterUtil", () => {
  describe("buildViewModels", () => {
    it("leaves a recommendation nobody has touched Available", () => {
      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>(),
          dismissals: [],
        });

      expect(viewModels).toHaveLength(KUBERNETES_RECOMMENDATIONS.length);

      for (const viewModel of viewModels) {
        expect(viewModel.status).toBe(RecommendationStatus.Available);
        expect(viewModel.monitorId).toBeUndefined();
        expect(viewModel.dismissalId).toBeUndefined();
      }
    });

    it("marks a covered recommendation Created and carries the monitor id", () => {
      /*
       * The monitor id is the whole point of the Created state: the card
       * becomes a link to the monitor that already covers this. Dropping it
       * turns the card into a dead end that says "already created" and gives
       * the user no way to go look at it.
       */
      const covered: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
      const monitorId: ObjectID = ObjectID.generate();

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>([
            [covered.recommendationId, monitorId],
          ]),
          dismissals: [],
        });

      const viewModel: RecommendationViewModel = findViewModel({
        viewModels: viewModels,
        recommendationId: covered.recommendationId,
      });

      expect(viewModel.status).toBe(RecommendationStatus.Created);
      expect(viewModel.monitorId?.toString()).toBe(monitorId.toString());
    });

    it("marks a dismissed recommendation Dismissed and carries the row id and reason", () => {
      /*
       * `dismissalId` is the row the Restore button deletes. Without it the
       * button has nothing to DELETE, and the card is dismissed forever with a
       * Restore control that does nothing.
       */
      const dismissed: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[1]!;
      const dismissalId: ObjectID = ObjectID.generate();

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>(),
          dismissals: [
            buildDismissal({
              recommendationId: dismissed.recommendationId,
              dismissalReason: "We do not run this workload here.",
              id: dismissalId,
            }),
          ],
        });

      const viewModel: RecommendationViewModel = findViewModel({
        viewModels: viewModels,
        recommendationId: dismissed.recommendationId,
      });

      expect(viewModel.status).toBe(RecommendationStatus.Dismissed);
      expect(viewModel.dismissalId?.toString()).toBe(dismissalId.toString());
      expect(viewModel.dismissalReason).toBe(
        "We do not run this workload here.",
      );
      expect(viewModel.monitorId).toBeUndefined();
    });

    it("leaves dismissalReason undefined when the row carries none", () => {
      /*
       * The reason is optional on the model, so the card has to distinguish
       * "dismissed without a reason" from "dismissed with the empty string" —
       * rendering the latter produces a quote block with nothing in it.
       */
      const dismissed: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[1]!;

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>(),
          dismissals: [
            buildDismissal({
              recommendationId: dismissed.recommendationId,
              dismissalReason: "",
            }),
          ],
        });

      const viewModel: RecommendationViewModel = findViewModel({
        viewModels: viewModels,
        recommendationId: dismissed.recommendationId,
      });

      expect(viewModel.status).toBe(RecommendationStatus.Dismissed);
      expect(viewModel.dismissalReason).toBeUndefined();
    });

    it("still marks a recommendation Dismissed when the row has no id yet", () => {
      /*
       * An optimistic dismissal rendered before the POST comes back has no id.
       * It must still hide the card — falling through to Available would make
       * the card flicker back for the round trip, which reads as the dismissal
       * having failed.
       */
      const dismissed: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[2]!;

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>(),
          dismissals: [
            buildDismissal({
              recommendationId: dismissed.recommendationId,
              omitId: true,
            }),
          ],
        });

      const viewModel: RecommendationViewModel = findViewModel({
        viewModels: viewModels,
        recommendationId: dismissed.recommendationId,
      });

      expect(viewModel.status).toBe(RecommendationStatus.Dismissed);
      expect(viewModel.dismissalId).toBeUndefined();
    });

    it("lets Created win over Dismissed when a recommendation is both", () => {
      /*
       * Reachable in one sitting: dismiss the recommendation, then build the
       * same monitor by hand from the monitor form. If Dismissed won, the page
       * would describe a monitor that is live and paging people as something
       * the team declined — and would keep offering to create a second copy of
       * it the moment somebody hit Restore.
       *
       * This is the one precedence rule in the file, and nothing else in the
       * codebase re-states it.
       */
      const both: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
      const monitorId: ObjectID = ObjectID.generate();

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>([
            [both.recommendationId, monitorId],
          ]),
          dismissals: [
            buildDismissal({
              recommendationId: both.recommendationId,
              dismissalReason: "Dismissed before somebody built it by hand.",
            }),
          ],
        });

      const viewModel: RecommendationViewModel = findViewModel({
        viewModels: viewModels,
        recommendationId: both.recommendationId,
      });

      expect(viewModel.status).toBe(RecommendationStatus.Created);
      expect(viewModel.monitorId?.toString()).toBe(monitorId.toString());
      expect(viewModel.dismissalId).toBeUndefined();
      expect(viewModel.dismissalReason).toBeUndefined();
    });

    it("ignores dismissal rows that carry no recommendationId", () => {
      /*
       * A row written for a future project-wide recommendation kind, or a row
       * fetched with a select that omitted the column. Indexing it under
       * `undefined` would be harmless; treating its absence as a match would
       * dismiss an arbitrary card that nobody dismissed.
       */
      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>(),
          dismissals: [
            buildDismissal({ recommendationId: undefined }),
            buildDismissal({ recommendationId: "" }),
          ],
        });

      expect(viewModels).toHaveLength(KUBERNETES_RECOMMENDATIONS.length);

      for (const viewModel of viewModels) {
        expect(viewModel.status).toBe(RecommendationStatus.Available);
      }
    });

    it("uses the FIRST of several dismissal rows for the same recommendation", () => {
      /*
       * `@UniqueColumnBy` should make duplicates impossible, but if two rows
       * ever do exist the Restore button must delete a deterministic one.
       * Taking whichever row happened to sort last would make Restore delete a
       * different row depending on query order, leaving the card dismissed by
       * the surviving row with no reason shown and no way to tell why.
       */
      const dismissed: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[3]!;
      const firstId: ObjectID = ObjectID.generate();
      const secondId: ObjectID = ObjectID.generate();

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>(),
          dismissals: [
            buildDismissal({
              recommendationId: dismissed.recommendationId,
              dismissalReason: "first",
              id: firstId,
            }),
            buildDismissal({
              recommendationId: dismissed.recommendationId,
              dismissalReason: "second",
              id: secondId,
            }),
          ],
        });

      const viewModel: RecommendationViewModel = findViewModel({
        viewModels: viewModels,
        recommendationId: dismissed.recommendationId,
      });

      expect(viewModel.dismissalId?.toString()).toBe(firstId.toString());
      expect(viewModel.dismissalReason).toBe("first");
    });

    it("returns nothing for an empty recommendation list", () => {
      /*
       * A resource type whose template module has not shipped yet. The page
       * renders an empty state; it must not throw on the dismissals it still
       * fetched.
       */
      expect(
        RecommendationFilterUtil.buildViewModels({
          recommendations: [],
          coveredMonitorIds: new Map<string, ObjectID>([
            ["Kubernetes:k8s-node-not-ready", ObjectID.generate()],
          ]),
          dismissals: [
            buildDismissal({
              recommendationId: "Kubernetes:k8s-node-not-ready",
            }),
          ],
        }),
      ).toEqual([]);
    });

    it("does not invent cards for dismissals of recommendations that no longer exist", () => {
      /*
       * A deploy that deletes a template leaves its dismissal rows behind.
       * Driving the output off the dismissal list instead of the catalog would
       * render a card with no name, no severity and no way to act on it.
       */
      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>([
            ["Kubernetes:this-monitor-type-was-removed", ObjectID.generate()],
          ]),
          dismissals: [
            buildDismissal({
              recommendationId: "Kubernetes:this-template-was-deleted",
            }),
          ],
        });

      expect(viewModels).toHaveLength(KUBERNETES_RECOMMENDATIONS.length);
      expect(idsOf(viewModels)).toEqual(
        KUBERNETES_RECOMMENDATIONS.map(
          (recommendation: MonitorRecommendation) => {
            return recommendation.recommendationId;
          },
        ),
      );
    });

    it("classifies a mixed project into all three states at once", () => {
      const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
      const dismissed: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[1]!;
      const available: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[2]!;

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: [created, dismissed, available],
          coveredMonitorIds: new Map<string, ObjectID>([
            [created.recommendationId, ObjectID.generate()],
          ]),
          dismissals: [
            buildDismissal({ recommendationId: dismissed.recommendationId }),
          ],
        });

      expect(
        viewModels.map((viewModel: RecommendationViewModel) => {
          return viewModel.status;
        }),
      ).toEqual([
        RecommendationStatus.Created,
        RecommendationStatus.Dismissed,
        RecommendationStatus.Available,
      ]);
    });
  });

  describe("getCounts", () => {
    it("counts the three states so they add up to the total", () => {
      const created: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
      const dismissed: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[1]!;

      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>([
            [created.recommendationId, ObjectID.generate()],
          ]),
          dismissals: [
            buildDismissal({ recommendationId: dismissed.recommendationId }),
          ],
        });

      const counts: RecommendationCounts =
        RecommendationFilterUtil.getCounts(viewModels);

      expect(counts.total).toBe(KUBERNETES_RECOMMENDATIONS.length);
      expect(counts.created).toBe(1);
      expect(counts.dismissed).toBe(1);
      expect(counts.available).toBe(KUBERNETES_RECOMMENDATIONS.length - 2);
      expect(counts.available + counts.created + counts.dismissed).toBe(
        counts.total,
      );
    });

    it("splits only the available ones by severity", () => {
      const counts: RecommendationCounts = RecommendationFilterUtil.getCounts(
        buildAllViewModels(RecommendationStatus.Available),
      );

      expect(counts.availableCritical).toBe(
        getRecommendationsWithSeverity("Critical").length,
      );
      expect(counts.availableWarning).toBe(
        getRecommendationsWithSeverity("Warning").length,
      );
      expect(counts.availableCritical + counts.availableWarning).toBe(
        counts.available,
      );
    });

    it("does not count a Critical recommendation that is already created", () => {
      /*
       * These two numbers are what the severity filter chips show. Counting
       * created recommendations in them produces a chip that reads "4 Critical"
       * and, when clicked, filters to nothing actionable — because the four are
       * already covered. The chip has to promise what clicking it delivers.
       */
      const critical: MonitorRecommendation = getFirstWithSeverity("Critical");

      const baseline: RecommendationCounts = RecommendationFilterUtil.getCounts(
        buildAllViewModels(RecommendationStatus.Available),
      );

      const counts: RecommendationCounts = RecommendationFilterUtil.getCounts(
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>([
            [critical.recommendationId, ObjectID.generate()],
          ]),
          dismissals: [],
        }),
      );

      expect(counts.availableCritical).toBe(baseline.availableCritical - 1);
      expect(counts.availableWarning).toBe(baseline.availableWarning);
      expect(counts.created).toBe(1);
    });

    it("does not count a Warning recommendation that has been dismissed", () => {
      const warning: MonitorRecommendation = getFirstWithSeverity("Warning");

      const baseline: RecommendationCounts = RecommendationFilterUtil.getCounts(
        buildAllViewModels(RecommendationStatus.Available),
      );

      const counts: RecommendationCounts = RecommendationFilterUtil.getCounts(
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>(),
          dismissals: [
            buildDismissal({ recommendationId: warning.recommendationId }),
          ],
        }),
      );

      expect(counts.availableWarning).toBe(baseline.availableWarning - 1);
      expect(counts.availableCritical).toBe(baseline.availableCritical);
      expect(counts.dismissed).toBe(1);
    });

    it("reports zero severity counts when everything is created", () => {
      const counts: RecommendationCounts = RecommendationFilterUtil.getCounts(
        buildAllViewModels(RecommendationStatus.Created),
      );

      expect(counts.total).toBe(KUBERNETES_RECOMMENDATIONS.length);
      expect(counts.created).toBe(KUBERNETES_RECOMMENDATIONS.length);
      expect(counts.available).toBe(0);
      expect(counts.availableCritical).toBe(0);
      expect(counts.availableWarning).toBe(0);
    });

    it("reports zero severity counts when everything is dismissed", () => {
      const counts: RecommendationCounts = RecommendationFilterUtil.getCounts(
        buildAllViewModels(RecommendationStatus.Dismissed),
      );

      expect(counts.dismissed).toBe(KUBERNETES_RECOMMENDATIONS.length);
      expect(counts.available).toBe(0);
      expect(counts.availableCritical).toBe(0);
      expect(counts.availableWarning).toBe(0);
    });

    it("returns all zeros for an empty list", () => {
      expect(RecommendationFilterUtil.getCounts([])).toEqual({
        total: 0,
        available: 0,
        created: 0,
        dismissed: 0,
        availableCritical: 0,
        availableWarning: 0,
      });
    });
  });

  describe("getActionableCount", () => {
    it("is exactly the available count", () => {
      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>([
            [
              KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
              ObjectID.generate(),
            ],
          ]),
          dismissals: [
            buildDismissal({
              recommendationId: KUBERNETES_RECOMMENDATIONS[1]!.recommendationId,
            }),
          ],
        });

      expect(RecommendationFilterUtil.getActionableCount(viewModels)).toBe(
        RecommendationFilterUtil.getCounts(viewModels).available,
      );
    });

    it("is not the catalog size once anything has been acted on", () => {
      /*
       * The bug this pins is a badge wired to `recommendations.length`. It
       * looks right on day one and is wrong forever after, because it never
       * moves no matter what the team does.
       */
      const viewModels: Array<RecommendationViewModel> =
        RecommendationFilterUtil.buildViewModels({
          recommendations: KUBERNETES_RECOMMENDATIONS,
          coveredMonitorIds: new Map<string, ObjectID>([
            [
              KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
              ObjectID.generate(),
            ],
          ]),
          dismissals: [],
        });

      expect(RecommendationFilterUtil.getActionableCount(viewModels)).toBe(
        KUBERNETES_RECOMMENDATIONS.length - 1,
      );
    });

    it("reaches zero when every recommendation is created", () => {
      expect(
        RecommendationFilterUtil.getActionableCount(
          buildAllViewModels(RecommendationStatus.Created),
        ),
      ).toBe(0);
    });

    it("reaches zero when every recommendation is dismissed", () => {
      /*
       * Dismissing is the only way to clear a badge for something you are never
       * going to create. If dismissed recommendations counted, the badge would
       * be uncleanable and everyone would learn to ignore it.
       */
      expect(
        RecommendationFilterUtil.getActionableCount(
          buildAllViewModels(RecommendationStatus.Dismissed),
        ),
      ).toBe(0);
    });

    it("reaches zero on a mix of created and dismissed", () => {
      const viewModels: Array<RecommendationViewModel> =
        KUBERNETES_RECOMMENDATIONS.map(
          (recommendation: MonitorRecommendation, index: number) => {
            return buildViewModel(
              recommendation,
              index % 2 === 0
                ? RecommendationStatus.Created
                : RecommendationStatus.Dismissed,
            );
          },
        );

      expect(RecommendationFilterUtil.getActionableCount(viewModels)).toBe(0);
    });

    it("is zero for an empty list", () => {
      expect(RecommendationFilterUtil.getActionableCount([])).toBe(0);
    });
  });

  describe("matchesSearch", () => {
    it("matches the name regardless of case", () => {
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[0]!;

      for (const searchText of [
        recommendation.name,
        recommendation.name.toUpperCase(),
        recommendation.name.toLowerCase(),
      ]) {
        expect(
          RecommendationFilterUtil.matchesSearch({
            viewModel: buildViewModel(
              recommendation,
              RecommendationStatus.Available,
            ),
            searchText: searchText,
          }),
        ).toBe(true);
      }
    });

    it("matches a partial name and ignores surrounding whitespace", () => {
      const recommendation: MonitorRecommendation = getRecommendationById(
        "Kubernetes:k8s-node-not-ready",
      );

      expect(
        RecommendationFilterUtil.matchesSearch({
          viewModel: buildViewModel(
            recommendation,
            RecommendationStatus.Available,
          ),
          searchText: "   not ready  ",
        }),
      ).toBe(true);
    });

    it("finds a metric name that appears only in a description", () => {
      /*
       * The reason descriptions are searchable at all. Somebody staring at a
       * `k8s.hpa.current_replicas` graph searches the metric, not "HPA
       * Saturated at Max Replicas" — a name they have never seen. Dropping
       * description from the haystack makes this search return nothing, which
       * reads as "OneUptime has no recommendation for this".
       */
      const recommendation: MonitorRecommendation = getRecommendationById(
        HPA_RECOMMENDATION_ID,
      );

      expect(recommendation.description).toContain(DESCRIPTION_ONLY_METRIC);
      expect(recommendation.name.toLowerCase()).not.toContain(
        DESCRIPTION_ONLY_METRIC,
      );

      const matched: Array<RecommendationViewModel> = buildAllViewModels(
        RecommendationStatus.Available,
      ).filter((viewModel: RecommendationViewModel) => {
        return RecommendationFilterUtil.matchesSearch({
          viewModel: viewModel,
          searchText: DESCRIPTION_ONLY_METRIC,
        });
      });

      expect(idsOf(matched)).toContain(HPA_RECOMMENDATION_ID);
    });

    it("matches on category even when the category word appears nowhere else", () => {
      const recommendation: MonitorRecommendation | undefined =
        KUBERNETES_RECOMMENDATIONS.find((candidate: MonitorRecommendation) => {
          const category: string = candidate.category.toLowerCase();

          return ![candidate.name, candidate.description].some(
            (field: string) => {
              return field.toLowerCase().includes(category);
            },
          );
        });

      /*
       * Guard rather than a silent skip: if every category word also appears in
       * its own name or description, this test stops proving that category is
       * in the haystack and needs rewriting.
       */
      expect(recommendation).toBeDefined();

      expect(
        RecommendationFilterUtil.matchesSearch({
          viewModel: buildViewModel(
            recommendation!,
            RecommendationStatus.Available,
          ),
          searchText: recommendation!.category,
        }),
      ).toBe(true);
    });

    it("matches on severity even when the severity word appears nowhere else", () => {
      const recommendation: MonitorRecommendation | undefined =
        KUBERNETES_RECOMMENDATIONS.find((candidate: MonitorRecommendation) => {
          const severity: string = candidate.severity.toLowerCase();

          return ![
            candidate.name,
            candidate.description,
            candidate.category,
          ].some((field: string) => {
            return field.toLowerCase().includes(severity);
          });
        });

      expect(recommendation).toBeDefined();

      expect(
        RecommendationFilterUtil.matchesSearch({
          viewModel: buildViewModel(
            recommendation!,
            RecommendationStatus.Available,
          ),
          searchText: recommendation!.severity.toUpperCase(),
        }),
      ).toBe(true);
    });

    it("matches everything for an empty search", () => {
      for (const viewModel of buildAllViewModels(
        RecommendationStatus.Available,
      )) {
        expect(
          RecommendationFilterUtil.matchesSearch({
            viewModel: viewModel,
            searchText: "",
          }),
        ).toBe(true);
      }
    });

    it("matches everything for a whitespace-only search", () => {
      /*
       * A user who clears the box by selecting-all and typing a space must get
       * the full list back, not an empty page.
       */
      for (const viewModel of buildAllViewModels(
        RecommendationStatus.Available,
      )) {
        expect(
          RecommendationFilterUtil.matchesSearch({
            viewModel: viewModel,
            searchText: "   \t  ",
          }),
        ).toBe(true);
      }
    });

    it("matches nothing for a term that is in no field", () => {
      for (const viewModel of buildAllViewModels(
        RecommendationStatus.Available,
      )) {
        expect(
          RecommendationFilterUtil.matchesSearch({
            viewModel: viewModel,
            searchText: "zzz-not-a-real-term-zzz",
          }),
        ).toBe(false);
      }
    });

    it("searches created and dismissed recommendations too", () => {
      /*
       * Search and status are independent axes. If search silently skipped
       * anything not Available, "show me dismissed things about memory" would
       * be impossible to express even with the status filter set correctly.
       */
      const recommendation: MonitorRecommendation =
        KUBERNETES_RECOMMENDATIONS[0]!;

      for (const status of [
        RecommendationStatus.Created,
        RecommendationStatus.Dismissed,
      ]) {
        expect(
          RecommendationFilterUtil.matchesSearch({
            viewModel: buildViewModel(recommendation, status),
            searchText: recommendation.name,
          }),
        ).toBe(true);
      }
    });
  });

  describe("matchesStatus", () => {
    it("passes every status when the filter is All", () => {
      for (const status of [
        RecommendationStatus.Available,
        RecommendationStatus.Created,
        RecommendationStatus.Dismissed,
      ]) {
        expect(
          RecommendationFilterUtil.matchesStatus({
            viewModel: buildViewModel(KUBERNETES_RECOMMENDATIONS[0]!, status),
            status: RecommendationStatusFilter.All,
          }),
        ).toBe(true);
      }
    });

    it("passes only the matching status for each specific filter", () => {
      const cases: Array<{
        filter: RecommendationStatusFilter;
        matching: RecommendationStatus;
      }> = [
        {
          filter: RecommendationStatusFilter.Available,
          matching: RecommendationStatus.Available,
        },
        {
          filter: RecommendationStatusFilter.Created,
          matching: RecommendationStatus.Created,
        },
        {
          filter: RecommendationStatusFilter.Dismissed,
          matching: RecommendationStatus.Dismissed,
        },
      ];

      for (const testCase of cases) {
        for (const status of [
          RecommendationStatus.Available,
          RecommendationStatus.Created,
          RecommendationStatus.Dismissed,
        ]) {
          expect(
            RecommendationFilterUtil.matchesStatus({
              viewModel: buildViewModel(KUBERNETES_RECOMMENDATIONS[0]!, status),
              status: testCase.filter,
            }),
          ).toBe(status === testCase.matching);
        }
      }
    });
  });

  describe("matchesSeverity", () => {
    it("passes both severities when the filter is All", () => {
      for (const severity of [
        "Critical",
        "Warning",
      ] as Array<MonitorRecommendationSeverity>) {
        expect(
          RecommendationFilterUtil.matchesSeverity({
            viewModel: buildViewModel(
              getFirstWithSeverity(severity),
              RecommendationStatus.Available,
            ),
            severity: RecommendationSeverityFilter.All,
          }),
        ).toBe(true);
      }
    });

    it("passes only Critical recommendations for the Critical filter", () => {
      expect(
        RecommendationFilterUtil.matchesSeverity({
          viewModel: buildViewModel(
            getFirstWithSeverity("Critical"),
            RecommendationStatus.Available,
          ),
          severity: RecommendationSeverityFilter.Critical,
        }),
      ).toBe(true);

      expect(
        RecommendationFilterUtil.matchesSeverity({
          viewModel: buildViewModel(
            getFirstWithSeverity("Warning"),
            RecommendationStatus.Available,
          ),
          severity: RecommendationSeverityFilter.Critical,
        }),
      ).toBe(false);
    });

    it("passes only Warning recommendations for the Warning filter", () => {
      expect(
        RecommendationFilterUtil.matchesSeverity({
          viewModel: buildViewModel(
            getFirstWithSeverity("Warning"),
            RecommendationStatus.Available,
          ),
          severity: RecommendationSeverityFilter.Warning,
        }),
      ).toBe(true);

      expect(
        RecommendationFilterUtil.matchesSeverity({
          viewModel: buildViewModel(
            getFirstWithSeverity("Critical"),
            RecommendationStatus.Available,
          ),
          severity: RecommendationSeverityFilter.Warning,
        }),
      ).toBe(false);
    });
  });

  describe("filter", () => {
    it("requires the search, the status and the severity to all agree", () => {
      /*
       * The bug an OR would produce is a list that grows as you add filters —
       * plausible-looking, and it makes the page unusable exactly when there is
       * too much on it to read.
       */
      const criticalAvailable: MonitorRecommendation =
        getFirstWithSeverity("Critical");
      const criticalCreated: MonitorRecommendation =
        getRecommendationsWithSeverity("Critical")[1]!;
      const warningAvailable: MonitorRecommendation =
        getFirstWithSeverity("Warning");

      const viewModels: Array<RecommendationViewModel> = [
        buildViewModel(criticalAvailable, RecommendationStatus.Available),
        buildViewModel(criticalCreated, RecommendationStatus.Created),
        buildViewModel(warningAvailable, RecommendationStatus.Available),
      ];

      const filtered: Array<RecommendationViewModel> =
        RecommendationFilterUtil.filter({
          viewModels: viewModels,
          filterState: {
            searchText: "",
            status: RecommendationStatusFilter.Available,
            severity: RecommendationSeverityFilter.Critical,
          },
        });

      expect(idsOf(filtered)).toEqual([criticalAvailable.recommendationId]);
    });

    it("returns nothing when only the severity disagrees", () => {
      const recommendation: MonitorRecommendation =
        getFirstWithSeverity("Critical");

      expect(
        RecommendationFilterUtil.filter({
          viewModels: [
            buildViewModel(recommendation, RecommendationStatus.Available),
          ],
          filterState: {
            searchText: recommendation.name,
            status: RecommendationStatusFilter.Available,
            severity: RecommendationSeverityFilter.Warning,
          },
        }),
      ).toEqual([]);
    });

    it("returns nothing when only the status disagrees", () => {
      const recommendation: MonitorRecommendation =
        getFirstWithSeverity("Critical");

      expect(
        RecommendationFilterUtil.filter({
          viewModels: [
            buildViewModel(recommendation, RecommendationStatus.Dismissed),
          ],
          filterState: {
            searchText: recommendation.name,
            status: RecommendationStatusFilter.Available,
            severity: RecommendationSeverityFilter.Critical,
          },
        }),
      ).toEqual([]);
    });

    it("returns nothing when only the search disagrees", () => {
      const recommendation: MonitorRecommendation =
        getFirstWithSeverity("Critical");

      expect(
        RecommendationFilterUtil.filter({
          viewModels: [
            buildViewModel(recommendation, RecommendationStatus.Available),
          ],
          filterState: {
            searchText: "zzz-not-a-real-term-zzz",
            status: RecommendationStatusFilter.Available,
            severity: RecommendationSeverityFilter.Critical,
          },
        }),
      ).toEqual([]);
    });

    it("returns everything when nothing is filtered", () => {
      const viewModels: Array<RecommendationViewModel> = buildAllViewModels(
        RecommendationStatus.Available,
      );

      expect(
        RecommendationFilterUtil.filter({
          viewModels: viewModels,
          filterState: {
            searchText: "",
            status: RecommendationStatusFilter.All,
            severity: RecommendationSeverityFilter.All,
          },
        }),
      ).toHaveLength(viewModels.length);
    });

    it("preserves the order of the list it was given", () => {
      const viewModels: Array<RecommendationViewModel> = buildAllViewModels(
        RecommendationStatus.Available,
      );

      const filtered: Array<RecommendationViewModel> =
        RecommendationFilterUtil.filter({
          viewModels: viewModels,
          filterState: {
            searchText: "",
            status: RecommendationStatusFilter.All,
            severity: RecommendationSeverityFilter.Critical,
          },
        });

      expect(idsOf(filtered)).toEqual(
        idsOf(viewModels).filter((recommendationId: string) => {
          return (
            getRecommendationById(recommendationId).severity === "Critical"
          );
        }),
      );
    });
  });

  describe("groupByCategory", () => {
    it("emits categories in the order it was handed, not alphabetically", () => {
      /*
       * `getCategories` returns first-declaration order, which is the template
       * module's own editorial judgement about what matters most. Sorting
       * alphabetically would bury Kubernetes "Workload" under "ControlPlane" —
       * a change nobody would notice in review and everybody would feel on the
       * page.
       */
      const sortedAlphabetically: Array<string> = [
        ...KUBERNETES_CATEGORIES,
      ].sort();

      /*
       * Guard: this test only proves anything while the catalog's own order
       * differs from alphabetical.
       */
      expect(KUBERNETES_CATEGORIES).not.toEqual(sortedAlphabetically);

      const groups: Array<RecommendationCategoryGroup> =
        RecommendationFilterUtil.groupByCategory({
          viewModels: buildAllViewModels(RecommendationStatus.Available),
          categories: KUBERNETES_CATEGORIES,
        });

      expect(
        groups.map((group: RecommendationCategoryGroup) => {
          return group.category;
        }),
      ).toEqual(KUBERNETES_CATEGORIES);
    });

    it("drops categories that have nothing left after filtering", () => {
      /*
       * The empty-heading bug: search for something that only exists in one
       * category and the page renders five headings, four of them over nothing.
       */
      const category: string = KUBERNETES_CATEGORIES[1]!;

      const viewModels: Array<RecommendationViewModel> = buildAllViewModels(
        RecommendationStatus.Available,
      ).filter((viewModel: RecommendationViewModel) => {
        return viewModel.recommendation.category === category;
      });

      const groups: Array<RecommendationCategoryGroup> =
        RecommendationFilterUtil.groupByCategory({
          viewModels: viewModels,
          categories: KUBERNETES_CATEGORIES,
        });

      expect(groups).toHaveLength(1);
      expect(groups[0]!.category).toBe(category);
      expect(groups[0]!.recommendations).toHaveLength(viewModels.length);
    });

    it("puts recommendations from an unlisted category into Other rather than losing them", () => {
      /*
       * Only reachable through a wiring bug — a page handing the Kubernetes
       * category list to the Host catalog. But silently dropping cards is the
       * worst possible symptom of that: the page looks fine and simply never
       * mentions half the recommendations. An "Other" heading is visible.
       */
      const listed: Array<string> = [KUBERNETES_CATEGORIES[0]!];

      const viewModels: Array<RecommendationViewModel> = buildAllViewModels(
        RecommendationStatus.Available,
      );

      const groups: Array<RecommendationCategoryGroup> =
        RecommendationFilterUtil.groupByCategory({
          viewModels: viewModels,
          categories: listed,
        });

      expect(
        groups.map((group: RecommendationCategoryGroup) => {
          return group.category;
        }),
      ).toEqual([KUBERNETES_CATEGORIES[0]!, "Other"]);

      const groupedCount: number = groups.reduce(
        (total: number, group: RecommendationCategoryGroup) => {
          return total + group.recommendations.length;
        },
        0,
      );

      expect(groupedCount).toBe(viewModels.length);
    });

    it("puts everything under Other when no categories are supplied", () => {
      const viewModels: Array<RecommendationViewModel> = buildAllViewModels(
        RecommendationStatus.Available,
      );

      const groups: Array<RecommendationCategoryGroup> =
        RecommendationFilterUtil.groupByCategory({
          viewModels: viewModels,
          categories: [],
        });

      expect(groups).toHaveLength(1);
      expect(groups[0]!.category).toBe("Other");
      expect(groups[0]!.recommendations).toHaveLength(viewModels.length);
    });

    it("returns no groups for an empty list", () => {
      expect(
        RecommendationFilterUtil.groupByCategory({
          viewModels: [],
          categories: KUBERNETES_CATEGORIES,
        }),
      ).toEqual([]);
    });

    it("sorts within each group so the actionable cards are at the top", () => {
      const category: string = KUBERNETES_CATEGORIES[0]!;

      const inCategory: Array<MonitorRecommendation> =
        KUBERNETES_RECOMMENDATIONS.filter(
          (recommendation: MonitorRecommendation) => {
            return recommendation.category === category;
          },
        );

      expect(inCategory.length).toBeGreaterThan(1);

      const viewModels: Array<RecommendationViewModel> = [
        buildViewModel(inCategory[0]!, RecommendationStatus.Dismissed),
        buildViewModel(inCategory[1]!, RecommendationStatus.Available),
      ];

      const groups: Array<RecommendationCategoryGroup> =
        RecommendationFilterUtil.groupByCategory({
          viewModels: viewModels,
          categories: [category],
        });

      expect(idsOf(groups[0]!.recommendations)).toEqual([
        inCategory[1]!.recommendationId,
        inCategory[0]!.recommendationId,
      ]);
    });
  });

  describe("sortForDisplay", () => {
    it("puts Available above Created above Dismissed", () => {
      const sorted: Array<RecommendationViewModel> =
        RecommendationFilterUtil.sortForDisplay([
          buildViewModel(
            KUBERNETES_RECOMMENDATIONS[0]!,
            RecommendationStatus.Dismissed,
          ),
          buildViewModel(
            KUBERNETES_RECOMMENDATIONS[1]!,
            RecommendationStatus.Created,
          ),
          buildViewModel(
            KUBERNETES_RECOMMENDATIONS[2]!,
            RecommendationStatus.Available,
          ),
        ]);

      expect(
        sorted.map((viewModel: RecommendationViewModel) => {
          return viewModel.status;
        }),
      ).toEqual([
        RecommendationStatus.Available,
        RecommendationStatus.Created,
        RecommendationStatus.Dismissed,
      ]);
    });

    it("puts Critical above Warning within one status", () => {
      const critical: MonitorRecommendation = getFirstWithSeverity("Critical");
      const warning: MonitorRecommendation = getFirstWithSeverity("Warning");

      const sorted: Array<RecommendationViewModel> =
        RecommendationFilterUtil.sortForDisplay([
          buildViewModel(warning, RecommendationStatus.Available),
          buildViewModel(critical, RecommendationStatus.Available),
        ]);

      expect(idsOf(sorted)).toEqual([
        critical.recommendationId,
        warning.recommendationId,
      ]);
    });

    it("ranks status above severity", () => {
      /*
       * A Critical recommendation that already has a monitor is done. Letting
       * severity win would park it at the top of the list forever, above the
       * Warning nobody has acted on — which is the one thing on the page that
       * still needs a human.
       */
      const critical: MonitorRecommendation = getFirstWithSeverity("Critical");
      const warning: MonitorRecommendation = getFirstWithSeverity("Warning");

      const sorted: Array<RecommendationViewModel> =
        RecommendationFilterUtil.sortForDisplay([
          buildViewModel(critical, RecommendationStatus.Created),
          buildViewModel(warning, RecommendationStatus.Available),
        ]);

      expect(idsOf(sorted)).toEqual([
        warning.recommendationId,
        critical.recommendationId,
      ]);
    });

    it("keeps the input order between recommendations of equal status and severity", () => {
      /*
       * The tiebreak has to come from the input array, not from anything
       * intrinsic to the recommendation (a name, an id). If it sorted by name,
       * the list would silently reorder itself the moment a template was
       * renamed, and the two assertions below would disagree.
       */
      const criticals: Array<MonitorRecommendation> =
        getRecommendationsWithSeverity("Critical");

      expect(criticals.length).toBeGreaterThan(1);

      const forwards: Array<RecommendationViewModel> = [
        buildViewModel(criticals[0]!, RecommendationStatus.Available),
        buildViewModel(criticals[1]!, RecommendationStatus.Available),
      ];

      const backwards: Array<RecommendationViewModel> = [
        buildViewModel(criticals[1]!, RecommendationStatus.Available),
        buildViewModel(criticals[0]!, RecommendationStatus.Available),
      ];

      expect(idsOf(RecommendationFilterUtil.sortForDisplay(forwards))).toEqual([
        criticals[0]!.recommendationId,
        criticals[1]!.recommendationId,
      ]);

      expect(idsOf(RecommendationFilterUtil.sortForDisplay(backwards))).toEqual(
        [criticals[1]!.recommendationId, criticals[0]!.recommendationId],
      );
    });

    it("produces the same order every time it runs", () => {
      /*
       * The page re-sorts on every render, over a fresh `filter` result. A
       * comparator that ever returns something order-dependent would make cards
       * swap places under the cursor while the user is reading them.
       */
      const viewModels: Array<RecommendationViewModel> =
        KUBERNETES_RECOMMENDATIONS.map(
          (recommendation: MonitorRecommendation, index: number) => {
            const statuses: Array<RecommendationStatus> = [
              RecommendationStatus.Available,
              RecommendationStatus.Created,
              RecommendationStatus.Dismissed,
            ];

            return buildViewModel(recommendation, statuses[index % 3]!);
          },
        );

      expect(
        idsOf(RecommendationFilterUtil.sortForDisplay(viewModels)),
      ).toEqual(idsOf(RecommendationFilterUtil.sortForDisplay(viewModels)));
    });

    it("does not reorder the array it was given", () => {
      /*
       * The input is React state on the page. Sorting it in place would mutate
       * state outside a setState call — the classic invisible React bug where
       * the data changes but nothing re-renders.
       */
      const viewModels: Array<RecommendationViewModel> = [
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[0]!,
          RecommendationStatus.Dismissed,
        ),
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[1]!,
          RecommendationStatus.Available,
        ),
      ];

      const before: Array<string> = idsOf(viewModels);
      const sorted: Array<RecommendationViewModel> =
        RecommendationFilterUtil.sortForDisplay(viewModels);

      expect(idsOf(viewModels)).toEqual(before);
      expect(sorted).not.toBe(viewModels);
    });

    it("returns an empty array unchanged", () => {
      expect(RecommendationFilterUtil.sortForDisplay([])).toEqual([]);
    });
  });

  describe("getSelectableViewModels", () => {
    it("returns only the Available recommendations that are selected", () => {
      const selected: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;
      const notSelected: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[1]!;

      const selectable: Array<RecommendationViewModel> =
        RecommendationFilterUtil.getSelectableViewModels({
          viewModels: [
            buildViewModel(selected, RecommendationStatus.Available),
            buildViewModel(notSelected, RecommendationStatus.Available),
          ],
          selectedRecommendationIds: new Set<string>([
            selected.recommendationId,
          ]),
        });

      expect(idsOf(selectable)).toEqual([selected.recommendationId]);
    });

    it("drops a selection that has since been created in another tab", () => {
      /*
       * Selection survives the background reload that reclassifies the card.
       * Re-POSTing a created recommendation does not error — it silently makes
       * a second identical monitor, which then pages twice for one problem.
       */
      const stale: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;

      expect(
        RecommendationFilterUtil.getSelectableViewModels({
          viewModels: [buildViewModel(stale, RecommendationStatus.Created)],
          selectedRecommendationIds: new Set<string>([stale.recommendationId]),
        }),
      ).toEqual([]);
    });

    it("drops a selection a teammate has since dismissed", () => {
      /*
       * Creating it anyway would contradict the "Dismissed" badge the user is
       * looking at while they press the button.
       */
      const stale: MonitorRecommendation = KUBERNETES_RECOMMENDATIONS[0]!;

      expect(
        RecommendationFilterUtil.getSelectableViewModels({
          viewModels: [buildViewModel(stale, RecommendationStatus.Dismissed)],
          selectedRecommendationIds: new Set<string>([stale.recommendationId]),
        }),
      ).toEqual([]);
    });

    it("ignores a selected id that is not on the page at all", () => {
      expect(
        RecommendationFilterUtil.getSelectableViewModels({
          viewModels: [
            buildViewModel(
              KUBERNETES_RECOMMENDATIONS[0]!,
              RecommendationStatus.Available,
            ),
          ],
          selectedRecommendationIds: new Set<string>([
            "Kubernetes:this-template-was-deleted",
          ]),
        }),
      ).toEqual([]);
    });

    it("returns nothing when nothing is selected", () => {
      expect(
        RecommendationFilterUtil.getSelectableViewModels({
          viewModels: buildAllViewModels(RecommendationStatus.Available),
          selectedRecommendationIds: new Set<string>(),
        }),
      ).toEqual([]);
    });

    it("preserves the order of the displayed list, not the order of selection", () => {
      /*
       * A Set has no meaningful order, so the created monitors have to follow
       * the list the user was looking at. Anything else makes the progress
       * readout jump around during a bulk create.
       */
      const viewModels: Array<RecommendationViewModel> = buildAllViewModels(
        RecommendationStatus.Available,
      );

      const selectedIds: Array<string> = [
        KUBERNETES_RECOMMENDATIONS[4]!.recommendationId,
        KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
        KUBERNETES_RECOMMENDATIONS[2]!.recommendationId,
      ];

      const selectable: Array<RecommendationViewModel> =
        RecommendationFilterUtil.getSelectableViewModels({
          viewModels: viewModels,
          selectedRecommendationIds: new Set<string>(selectedIds),
        });

      expect(idsOf(selectable)).toEqual([
        KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
        KUBERNETES_RECOMMENDATIONS[2]!.recommendationId,
        KUBERNETES_RECOMMENDATIONS[4]!.recommendationId,
      ]);
    });
  });

  describe("toggleSelectionForGroup", () => {
    it("selects every available recommendation in the group when none are selected", () => {
      const group: Array<RecommendationViewModel> = [
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[0]!,
          RecommendationStatus.Available,
        ),
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[1]!,
          RecommendationStatus.Available,
        ),
      ];

      const selected: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: new Set<string>(),
          groupViewModels: group,
        });

      expect([...selected].sort()).toEqual(
        [
          KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
          KUBERNETES_RECOMMENDATIONS[1]!.recommendationId,
        ].sort(),
      );
    });

    it("selects the rest rather than clearing when only some are selected", () => {
      /*
       * The half-selected case is the one people actually hit: tick one card,
       * then decide you want the whole category. A plain toggle would clear the
       * card you had already chosen and leave the rest selected — the exact
       * opposite of what the click asked for, and it looks like nothing much
       * happened.
       */
      const group: Array<RecommendationViewModel> = [
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[0]!,
          RecommendationStatus.Available,
        ),
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[1]!,
          RecommendationStatus.Available,
        ),
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[2]!,
          RecommendationStatus.Available,
        ),
      ];

      const selected: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: new Set<string>([
            KUBERNETES_RECOMMENDATIONS[1]!.recommendationId,
          ]),
          groupViewModels: group,
        });

      expect(selected.size).toBe(3);

      for (const viewModel of group) {
        expect(selected.has(viewModel.recommendation.recommendationId)).toBe(
          true,
        );
      }
    });

    it("clears the group only when every available member is already selected", () => {
      const group: Array<RecommendationViewModel> = [
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[0]!,
          RecommendationStatus.Available,
        ),
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[1]!,
          RecommendationStatus.Available,
        ),
      ];

      const selected: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: new Set<string>([
            KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
            KUBERNETES_RECOMMENDATIONS[1]!.recommendationId,
          ]),
          groupViewModels: group,
        });

      expect([...selected]).toEqual([]);
    });

    it("leaves selections from other groups alone in both directions", () => {
      /*
       * "Select all" on two categories has to be additive — this is what makes
       * a bulk create across categories possible at all.
       */
      const outsider: string = KUBERNETES_RECOMMENDATIONS[5]!.recommendationId;

      const group: Array<RecommendationViewModel> = [
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[0]!,
          RecommendationStatus.Available,
        ),
      ];

      const afterSelect: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: new Set<string>([outsider]),
          groupViewModels: group,
        });

      expect(afterSelect.has(outsider)).toBe(true);
      expect(
        afterSelect.has(KUBERNETES_RECOMMENDATIONS[0]!.recommendationId),
      ).toBe(true);

      const afterClear: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: afterSelect,
          groupViewModels: group,
        });

      expect([...afterClear]).toEqual([outsider]);
    });

    it("never selects a created or dismissed member of the group", () => {
      /*
       * Selecting them would put them straight into the create plan, which
       * either duplicates a monitor or resurrects something the team declined.
       */
      const group: Array<RecommendationViewModel> = [
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[0]!,
          RecommendationStatus.Available,
        ),
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[1]!,
          RecommendationStatus.Created,
        ),
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[2]!,
          RecommendationStatus.Dismissed,
        ),
      ];

      const selected: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: new Set<string>(),
          groupViewModels: group,
        });

      expect([...selected]).toEqual([
        KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
      ]);
    });

    it("treats a group whose only available member is selected as fully selected", () => {
      /*
       * The all-selected test has to ignore created and dismissed members too,
       * or a category with one created card in it could never be toggled off —
       * the checkbox would stay stuck on.
       */
      const group: Array<RecommendationViewModel> = [
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[0]!,
          RecommendationStatus.Available,
        ),
        buildViewModel(
          KUBERNETES_RECOMMENDATIONS[1]!,
          RecommendationStatus.Created,
        ),
      ];

      const selected: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: new Set<string>([
            KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
          ]),
          groupViewModels: group,
        });

      expect([...selected]).toEqual([]);
    });

    it("changes nothing for a group with no available members", () => {
      const outsider: string = KUBERNETES_RECOMMENDATIONS[5]!.recommendationId;

      const selected: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: new Set<string>([outsider]),
          groupViewModels: [
            buildViewModel(
              KUBERNETES_RECOMMENDATIONS[0]!,
              RecommendationStatus.Created,
            ),
          ],
        });

      expect([...selected]).toEqual([outsider]);
    });

    it("changes nothing for an empty group", () => {
      const outsider: string = KUBERNETES_RECOMMENDATIONS[5]!.recommendationId;

      expect([
        ...RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: new Set<string>([outsider]),
          groupViewModels: [],
        }),
      ]).toEqual([outsider]);
    });

    it("returns a new Set instead of mutating the one it was given", () => {
      /*
       * The passed Set is React state. Mutating it in place gives the next
       * render the same object reference, so `setSelected` sees no change and
       * the checkboxes do not move — the click appears to do nothing.
       */
      const original: Set<string> = new Set<string>();

      const selected: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: original,
          groupViewModels: [
            buildViewModel(
              KUBERNETES_RECOMMENDATIONS[0]!,
              RecommendationStatus.Available,
            ),
          ],
        });

      expect(selected).not.toBe(original);
      expect(original.size).toBe(0);
      expect(selected.size).toBe(1);
    });

    it("does not mutate the passed Set when it clears the group either", () => {
      const original: Set<string> = new Set<string>([
        KUBERNETES_RECOMMENDATIONS[0]!.recommendationId,
      ]);

      const selected: Set<string> =
        RecommendationFilterUtil.toggleSelectionForGroup({
          selectedRecommendationIds: original,
          groupViewModels: [
            buildViewModel(
              KUBERNETES_RECOMMENDATIONS[0]!,
              RecommendationStatus.Available,
            ),
          ],
        });

      expect(selected.size).toBe(0);
      expect(original.size).toBe(1);
    });
  });
});
