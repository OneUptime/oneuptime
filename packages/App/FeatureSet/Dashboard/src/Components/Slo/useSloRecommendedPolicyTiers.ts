import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import ObjectID from "Common/Types/ObjectID";
import {
  SloRecommendedPolicyState,
  SloRecommendedPolicyTierToAdd,
  getSloRecommendedPolicyStanding,
  isSloRecommendedPolicyOffered,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import RecommendedPolicyTiersApi from "../../Pages/Slo/Utils/RecommendedPolicyTiersApi";

export interface UseSloRecommendedPolicyTiersResult {
  /*
   * The recommended tiers the SLO does not have yet, while it is offered
   * them: empty until the server has said, and empty for an SLO with every
   * recommended tier or with a policy of its own.
   */
  missingTiers: Array<SloRecommendedPolicyTierToAdd>;
  /*
   * Whether the SLO's tiers are part of the recommended policy (#7351): the
   * rest of it is offered above the tiers. False for an SLO with no tier,
   * whose table's empty state offers the whole of it.
   */
  isPolicyPartial: boolean;
  /*
   * Whether a tier the table holds freezes deployments, so the offer can say
   * when the policy freezes nothing until it has the missing tiers.
   */
  isAnyTierFreezing: boolean;
  /*
   * The tiers table read its rows. What is missing is asked when the rows
   * show no tier, or only recommended ones with some missing - the Error
   * Budget Policy page offers the recommended policy, or the rest of it -
   * and only when the rows are not the ones it was last asked for.
   */
  onTiersFetched: (
    tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
    totalCount: number,
  ) => void;
  /*
   * Adds them. Resolves with what the server added; rejects with its
   * refusal, for the confirmation to say. Either way, what is missing is
   * asked again once the table shows its new rows.
   */
  addMissingTiers: () => Promise<Array<SloRecommendedPolicyTierToAdd>>;
}

// What decides whether to ask again, per row the table holds.
export function getRecommendedPolicySignature(
  tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
  totalCount: number,
): string {
  return JSON.stringify([
    totalCount,
    tiers.map(
      (tier: ServiceLevelObjectiveErrorBudgetPolicyTier): Array<unknown> => {
        return [
          tier._id?.toString() || "",
          tier.name || "",
          tier.thresholdPercentage ?? null,
        ];
      },
    ),
  ]);
}

/*
 * Where the rows the table read stand against the recommended policy, or
 * null when they cannot say: a table that shows only some of the SLO's
 * tiers cannot tell a policy of the team's own from the recommended one.
 */
export function getRecommendedPolicyStateOfRows(
  tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
  totalCount: number,
): SloRecommendedPolicyState | null {
  if (totalCount > tiers.length) {
    return null;
  }

  return getSloRecommendedPolicyStanding({ existingTiers: tiers }).state;
}

/*
 * "Use the recommended policy" for the Error Budget Policy page: the
 * recommended tiers a policy-less SLO would start with, or the ones an SLO
 * with part of the recommended policy is missing (#7351), and the call that
 * adds them.
 *
 * Asked only while the table offers them - no tier, or recommended tiers
 * with some missing - and only when its rows change, so an SLO with a policy
 * of its own never asks, and an empty one asks once. A failure to ask leaves
 * the list empty: the offer is made only once the server has said what it
 * would add, and the table shows its own errors.
 */
export default function useSloRecommendedPolicyTiers(
  serviceLevelObjectiveId: ObjectID,
): UseSloRecommendedPolicyTiersResult {
  const [missingTiers, setMissingTiers] = useState<
    Array<SloRecommendedPolicyTierToAdd>
  >([]);
  const [isPolicyPartial, setIsPolicyPartial] = useState<boolean>(false);
  const [isAnyTierFreezing, setIsAnyTierFreezing] = useState<boolean>(false);

  const signatureRef: MutableRefObject<string | null> = useRef<string | null>(
    null,
  );

  // Only the latest request's answer is kept.
  const requestRef: MutableRefObject<number> = useRef<number>(0);

  const sloKey: string = serviceLevelObjectiveId.toString();

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const request: number = requestRef.current + 1;
    requestRef.current = request;

    try {
      const tiers: Array<SloRecommendedPolicyTierToAdd> =
        await RecommendedPolicyTiersApi.getMissing(serviceLevelObjectiveId);

      if (requestRef.current === request) {
        setMissingTiers(tiers);
      }
    } catch {
      if (requestRef.current === request) {
        setMissingTiers([]);
      }
    }
  }, [sloKey]);

  /*
   * Another SLO's page: start over. Only on a change of SLO, never on the
   * first render - the table's first read reaches onTiersFetched before this
   * effect runs (a child's effects run first).
   */
  const shownSloKeyRef: MutableRefObject<string> = useRef<string>(sloKey);

  useEffect(() => {
    if (shownSloKeyRef.current === sloKey) {
      return;
    }

    shownSloKeyRef.current = sloKey;
    signatureRef.current = null;
    requestRef.current += 1;
    setMissingTiers([]);
    setIsPolicyPartial(false);
    setIsAnyTierFreezing(false);
  }, [sloKey]);

  const onTiersFetched: (
    tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
    totalCount: number,
  ) => void = useCallback(
    (
      tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
      totalCount: number,
    ): void => {
      // A switch flipped on a row changes no signature: read on every fetch.
      setIsAnyTierFreezing(
        tiers.some(
          (tier: ServiceLevelObjectiveErrorBudgetPolicyTier): boolean => {
            return tier.freezesDeployments === true;
          },
        ),
      );

      const signature: string = getRecommendedPolicySignature(
        tiers,
        totalCount,
      );

      if (signatureRef.current === signature) {
        return;
      }

      signatureRef.current = signature;

      const state: SloRecommendedPolicyState | null =
        getRecommendedPolicyStateOfRows(tiers, totalCount);

      // A policy of the team's own, the whole recommended one, or rows that cannot say.
      if (!state || !isSloRecommendedPolicyOffered(state)) {
        requestRef.current += 1;
        setMissingTiers([]);
        setIsPolicyPartial(false);
        return;
      }

      setIsPolicyPartial(state === SloRecommendedPolicyState.Partial);

      load().catch(() => {
        // load() handles its own errors.
      });
    },
    [load],
  );

  const addMissingTiers: () => Promise<Array<SloRecommendedPolicyTierToAdd>> =
    useCallback(async (): Promise<Array<SloRecommendedPolicyTierToAdd>> => {
      try {
        return await RecommendedPolicyTiersApi.addMissing(
          serviceLevelObjectiveId,
        );
      } finally {
        // Whatever was added, the next rows the table reads are asked about again.
        signatureRef.current = null;
      }
    }, [sloKey]);

  return {
    missingTiers: missingTiers,
    isPolicyPartial: isPolicyPartial,
    isAnyTierFreezing: isAnyTierFreezing,
    onTiersFetched: onTiersFetched,
    addMissingTiers: addMissingTiers,
  };
}
