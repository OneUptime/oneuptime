import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import RecommendationDismissalService from "../../../Server/Services/RecommendationDismissalService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import RecommendationType from "../../../Types/Recommendation/RecommendationType";
import { describe, expect, test } from "@jest/globals";

/*
 * onBeforeCreate is the only validation a RecommendationDismissal row ever
 * gets, and it exists because the failure it prevents is completely silent.
 *
 * `recommendationType` is a plain ShortText column, not a Postgres enum, so
 * the database accepts any string. The Recommendations page then filters
 * dismissals by the exact enum value: a row written as "monitor", "Monitors"
 * or "" is stored happily, returns 200 to the browser, and matches nothing.
 * The user clicks Dismiss, the card disappears from React state, and on the
 * next page load it is back — with no error in the UI, no error in the logs,
 * and a real row in the table proving "it saved". The same is true of a
 * missing recommendationId: a dismissal that names no recommendation hides
 * nothing.
 *
 * So these tests are not about tidy input. They pin the one boundary where
 * that class of bug is still cheap to catch, and they pin it against the
 * RecommendationType enum itself rather than a copied literal, so a future
 * recommendation kind is accepted without anyone having to remember to come
 * back here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RECOMMENDATION_ID: string = "Kubernetes:k8s-hpa-at-max-replicas";

interface DismissalFields {
  recommendationType?: string | undefined;
  recommendationId?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: ObjectID | undefined;
  dismissalReason?: string | undefined;
}

/*
 * A dismissal exactly as the side-over posts it, minus whichever field the
 * test under way is trying to break. Fields are only assigned when supplied,
 * so "field omitted" and "field set to empty string" stay distinguishable.
 */
function makeCreateBy(
  fields: DismissalFields,
): CreateBy<RecommendationDismissal> {
  const dismissal: RecommendationDismissal = new RecommendationDismissal();
  dismissal.projectId = PROJECT_ID;

  if (fields.recommendationType !== undefined) {
    dismissal.recommendationType = fields.recommendationType;
  }

  if (fields.recommendationId !== undefined) {
    dismissal.recommendationId = fields.recommendationId;
  }

  if (fields.resourceType !== undefined) {
    dismissal.resourceType = fields.resourceType;
  }

  if (fields.resourceId !== undefined) {
    dismissal.resourceId = fields.resourceId;
  }

  if (fields.dismissalReason !== undefined) {
    dismissal.dismissalReason = fields.dismissalReason;
  }

  return {
    data: dismissal,
    props: { isRoot: true },
  };
}

/*
 * onBeforeCreate is protected; the established way service tests in this
 * directory reach a hook is an `as any` cast on the exported singleton (see
 * StatusPageGroupNesting and NetworkSiteAssignmentRuleService).
 */
function onBeforeCreate(
  createBy: CreateBy<RecommendationDismissal>,
): Promise<OnCreate<RecommendationDismissal>> {
  return (RecommendationDismissalService as any).onBeforeCreate(createBy);
}

function validCreateBy(): CreateBy<RecommendationDismissal> {
  return makeCreateBy({
    recommendationType: RecommendationType.Monitor,
    recommendationId: RECOMMENDATION_ID,
    resourceType: "Kubernetes",
    resourceId: RESOURCE_ID,
  });
}

describe("RecommendationDismissalService.onBeforeCreate — recommendationType", () => {
  test("rejects a dismissal that names no recommendation type", async () => {
    await expect(
      onBeforeCreate(makeCreateBy({ recommendationId: RECOMMENDATION_ID })),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects an empty-string recommendation type", async () => {
    /*
     * An empty string survives the `Object.values(...).includes()` check only
     * if the falsy guard above it is removed, which is exactly the kind of
     * refactor that looks harmless. An empty type matches no filter, so the
     * row is invisible the moment it is written.
     */
    await expect(
      onBeforeCreate(
        makeCreateBy({
          recommendationType: "",
          recommendationId: RECOMMENDATION_ID,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects a lowercase 'monitor' — the typo that produces invisible rows", async () => {
    /*
     * The realistic failure. Nothing about "monitor" looks wrong in a request
     * body or a log line, the insert succeeds, and the dismissal is then
     * unreachable forever because the page compares against the enum value
     * "Monitor". Without a case-sensitive check here there is no layer left
     * that would ever notice.
     */
    await expect(
      onBeforeCreate(
        makeCreateBy({
          recommendationType: "monitor",
          recommendationId: RECOMMENDATION_ID,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects a recommendation type that is not in the enum at all", async () => {
    await expect(
      onBeforeCreate(
        makeCreateBy({
          recommendationType: "Dashboard",
          recommendationId: RECOMMENDATION_ID,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("names the accepted types in the error, so the caller can see the typo", async () => {
    /*
     * The message is the only diagnostic the API caller gets. Listing the
     * valid values turns "400 Bad Request" into something a developer can act
     * on without reading the server source.
     */
    let thrown: unknown = null;

    try {
      await onBeforeCreate(
        makeCreateBy({
          recommendationType: "monitor",
          recommendationId: RECOMMENDATION_ID,
        }),
      );
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as BadDataException).message).toContain("monitor");
    expect((thrown as BadDataException).message).toContain(
      RecommendationType.Monitor,
    );
  });

  test("accepts every member of the RecommendationType enum", async () => {
    /*
     * Guards the generalisation this branch is built on: a second
     * recommendation kind (dashboards, cost savings) is meant to need no
     * schema change and no service change. If the validation is ever
     * rewritten to hardcode "Monitor", the next enum member starts throwing
     * on dismiss and this test fails instead of the feature.
     */
    for (const recommendationType of Object.values(RecommendationType)) {
      const createBy: CreateBy<RecommendationDismissal> = makeCreateBy({
        recommendationType: recommendationType,
        recommendationId: RECOMMENDATION_ID,
      });

      const result: OnCreate<RecommendationDismissal> =
        await onBeforeCreate(createBy);

      expect(result.createBy.data.recommendationType).toBe(recommendationType);
    }
  });
});

describe("RecommendationDismissalService.onBeforeCreate — recommendationId", () => {
  test("rejects a dismissal that names no recommendation", async () => {
    /*
     * A row with a valid type but no id hides nothing at all — it is a
     * permanent no-op that still occupies the unique-column slot for its
     * (project, type, resource) triple.
     */
    await expect(
      onBeforeCreate(
        makeCreateBy({ recommendationType: RecommendationType.Monitor }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("rejects an empty-string recommendation id", async () => {
    await expect(
      onBeforeCreate(
        makeCreateBy({
          recommendationType: RecommendationType.Monitor,
          recommendationId: "",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("checks the type before the id, so a typo'd type is reported as such", async () => {
    /*
     * Both fields wrong must surface the type error. Reporting "Recommendation
     * ID is required" for a request that carried an id would send whoever is
     * debugging it in the wrong direction entirely.
     */
    let thrown: unknown = null;

    try {
      await onBeforeCreate(makeCreateBy({ recommendationType: "monitor" }));
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as BadDataException).message).toContain("monitor");
  });
});

describe("RecommendationDismissalService.onBeforeCreate — valid row", () => {
  test("returns the same createBy it was given, unmodified", async () => {
    /*
     * The hook validates and nothing else. Anything it silently rewrote —
     * trimming, case-normalising, defaulting a resourceType — would make the
     * stored row differ from what the UI later looks for, which is the same
     * invisible-dismissal bug arriving from the other direction. Identity is
     * asserted, not just equality, because DatabaseService goes on to insert
     * whatever object comes back out of here.
     */
    const createBy: CreateBy<RecommendationDismissal> = validCreateBy();
    const model: RecommendationDismissal = createBy.data;

    const result: OnCreate<RecommendationDismissal> =
      await onBeforeCreate(createBy);

    expect(result.createBy).toBe(createBy);
    expect(result.createBy.data).toBe(model);
    expect(result.carryForward).toBeNull();

    expect(model.recommendationType).toBe(RecommendationType.Monitor);
    expect(model.recommendationId).toBe(RECOMMENDATION_ID);
    expect(model.resourceType).toBe("Kubernetes");
    expect(model.resourceId).toBe(RESOURCE_ID);
    expect(model.projectId).toBe(PROJECT_ID);
  });

  test("accepts a dismissal that is not scoped to any resource", async () => {
    /*
     * resourceType and resourceId are nullable on purpose: a future
     * project-wide recommendation has no resource to point at. The validation
     * must not quietly grow a requirement the schema does not have.
     */
    const result: OnCreate<RecommendationDismissal> = await onBeforeCreate(
      makeCreateBy({
        recommendationType: RecommendationType.Monitor,
        recommendationId: "project-wide-recommendation",
      }),
    );

    expect(result.createBy.data.resourceType).toBeUndefined();
    expect(result.createBy.data.resourceId).toBeUndefined();
  });

  test("accepts an optional dismissal reason and leaves it untouched", async () => {
    const reason: string = "We alert on this from Prometheus already.";

    const result: OnCreate<RecommendationDismissal> = await onBeforeCreate(
      makeCreateBy({
        recommendationType: RecommendationType.Monitor,
        recommendationId: RECOMMENDATION_ID,
        dismissalReason: reason,
      }),
    );

    expect(result.createBy.data.dismissalReason).toBe(reason);
  });
});
