import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ObjectID from "Common/Types/ObjectID";
import { SloRecommendedBurnRateRuleToAdd } from "Common/Utils/Slo/SloRecommendedBurnRateRules";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import RecommendedBurnRateRulesApi from "../../Pages/Slo/Utils/RecommendedBurnRateRulesApi";

export interface UseSloRecommendedBurnRateRulesResult {
  // The recommended rules the SLO does not have yet: empty until known.
  missingRules: Array<SloRecommendedBurnRateRuleToAdd>;
  /*
   * The rules table read its rows: what is missing is asked again when they
   * are not the rows it was last asked for - a rule added, renamed, moved to
   * another window or deleted - and not when the worker only stamped a
   * rule's lifecycle, which the table also reads its rows again for.
   */
  onRulesFetched: (
    rules: Array<ServiceLevelObjectiveBurnRateRule>,
    totalCount: number,
  ) => void;
  /*
   * Adds them. Resolves with what the server added; rejects with its
   * refusal, for the confirmation to say. Either way, what is missing is
   * asked again once the table shows its new rows.
   */
  addMissingRules: () => Promise<Array<SloRecommendedBurnRateRuleToAdd>>;
}

// What decides whether a recommended rule is missing, per row the table holds.
export function getRecommendedRulesSignature(
  rules: Array<ServiceLevelObjectiveBurnRateRule>,
  totalCount: number,
): string {
  return JSON.stringify([
    totalCount,
    rules.map((rule: ServiceLevelObjectiveBurnRateRule): Array<unknown> => {
      return [
        rule._id?.toString() || "",
        rule.name || "",
        rule.longWindowInMinutes ?? null,
      ];
    }),
  ]);
}

/*
 * "Add recommended rules" for the Burn Rate Rules page: which of the
 * recommended rules this SLO is missing, and the call that adds them.
 *
 * Asked only when the table's rows change, so the page makes one request
 * when it opens and one after each change to the rules, never one per live
 * update. A failure to ask leaves the list empty: the action is offered only
 * when the server has said what it would add, and the table shows its own
 * errors.
 */
export default function useSloRecommendedBurnRateRules(
  serviceLevelObjectiveId: ObjectID,
): UseSloRecommendedBurnRateRulesResult {
  const [missingRules, setMissingRules] = useState<
    Array<SloRecommendedBurnRateRuleToAdd>
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
      const rules: Array<SloRecommendedBurnRateRuleToAdd> =
        await RecommendedBurnRateRulesApi.getMissing(serviceLevelObjectiveId);

      if (requestRef.current === request) {
        setMissingRules(rules);
      }
    } catch {
      if (requestRef.current === request) {
        setMissingRules([]);
      }
    }
  }, [sloKey]);

  /*
   * Another SLO's page: start over. Only on a change of SLO, never on the
   * first render - the table's first read reaches onRulesFetched before
   * this effect runs (a child's effects run first), and resetting then
   * would ask the server a second time for the same rows.
   */
  const shownSloKeyRef: MutableRefObject<string> = useRef<string>(sloKey);

  useEffect(() => {
    if (shownSloKeyRef.current === sloKey) {
      return;
    }

    shownSloKeyRef.current = sloKey;
    signatureRef.current = null;
    setMissingRules([]);
  }, [sloKey]);

  const onRulesFetched: (
    rules: Array<ServiceLevelObjectiveBurnRateRule>,
    totalCount: number,
  ) => void = useCallback(
    (
      rules: Array<ServiceLevelObjectiveBurnRateRule>,
      totalCount: number,
    ): void => {
      const signature: string = getRecommendedRulesSignature(rules, totalCount);

      if (signatureRef.current === signature) {
        return;
      }

      signatureRef.current = signature;

      load().catch(() => {
        // load() handles its own errors.
      });
    },
    [load],
  );

  const addMissingRules: () => Promise<Array<SloRecommendedBurnRateRuleToAdd>> =
    useCallback(async (): Promise<Array<SloRecommendedBurnRateRuleToAdd>> => {
      try {
        return await RecommendedBurnRateRulesApi.addMissing(
          serviceLevelObjectiveId,
        );
      } finally {
        // Whatever was added, the next rows the table reads are asked about again.
        signatureRef.current = null;
      }
    }, [sloKey]);

  return {
    missingRules: missingRules,
    onRulesFetched: onRulesFetched,
    addMissingRules: addMissingRules,
  };
}
