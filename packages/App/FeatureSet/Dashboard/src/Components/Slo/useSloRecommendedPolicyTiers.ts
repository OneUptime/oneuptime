import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import ObjectID from "Common/Types/ObjectID";
import { SloRecommendedPolicyTierToAdd } from "Common/Utils/Slo/SloErrorBudgetPolicy";
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
   * The recommended tiers the SLO does not have yet, while it has no tier
   * at all: empty until the server has said, and empty once it has one.
   */
  missingTiers: Array<SloRecommendedPolicyTierToAdd>;
  /*
   * The tiers table read its rows. What is missing is asked only while the
   * table has none - "Use the recommended policy" starts a policy - and
   * only when the rows are not the ones it was last asked for.
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
 * "Use the recommended policy" for the Error Budget Policy page: the
 * recommended tiers a policy-less SLO would start with, and the call that
 * adds them.
 *
 * Asked only while the table is empty and only when its rows change, so an
 * SLO with a policy never asks, and an empty one asks once. A failure to ask
 * leaves the list empty: the starter is offered only once the server has
 * said what it would add, and the table shows its own errors.
 */
export default function useSloRecommendedPolicyTiers(
  serviceLevelObjectiveId: ObjectID,
): UseSloRecommendedPolicyTiersResult {
  const [missingTiers, setMissingTiers] = useState<
    Array<SloRecommendedPolicyTierToAdd>
  >([]);

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
  }, [sloKey]);

  const onTiersFetched: (
    tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
    totalCount: number,
  ) => void = useCallback(
    (
      tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
      totalCount: number,
    ): void => {
      const signature: string = getRecommendedPolicySignature(
        tiers,
        totalCount,
      );

      if (signatureRef.current === signature) {
        return;
      }

      signatureRef.current = signature;

      // A policy has been started: there is nothing to start it with.
      if (totalCount > 0 || tiers.length > 0) {
        requestRef.current += 1;
        setMissingTiers([]);
        return;
      }

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
    onTiersFetched: onTiersFetched,
    addMissingTiers: addMissingTiers,
  };
}
