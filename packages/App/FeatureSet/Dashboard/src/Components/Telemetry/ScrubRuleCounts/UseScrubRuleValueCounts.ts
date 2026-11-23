import ScrubRuleValueCountsApi from "./ScrubRuleValueCountsApi";
import {
  ScrubRuleValueCountOfRule,
  ScrubRuleValueCountsAnswer,
  ScrubRuleValueCountSignal,
} from "Common/Types/Telemetry/ScrubRuleValueCounts";
import { useCallback, useEffect, useState } from "react";

/*
 * The counts of the rules a list shows (#10366): read each time the list
 * loads a page, for that page's rules. A read that fails says nothing of
 * any rule - "Not counted" - and the list draws as it would without it.
 */
export interface ScrubRuleValueCountsState {
  // Undefined until a read answered.
  isChecked: boolean | undefined;
  countOf: (ruleId: string) => ScrubRuleValueCountOfRule | undefined;
  // The rules the list now shows.
  setRuleIds: (ruleIds: Array<string>) => void;
}

export function useScrubRuleValueCounts(
  signal: ScrubRuleValueCountSignal,
): ScrubRuleValueCountsState {
  const [ruleIds, setRuleIdsState] = useState<Array<string>>([]);
  const [answer, setAnswer] = useState<ScrubRuleValueCountsAnswer | null>(
    null,
  );

  useEffect(() => {
    if (ruleIds.length === 0) {
      setAnswer(null);
      return;
    }

    let isCurrent: boolean = true;

    ScrubRuleValueCountsApi.getCounts({ signal, scrubRuleIds: ruleIds })
      .then((read: ScrubRuleValueCountsAnswer) => {
        if (isCurrent) {
          setAnswer(read);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setAnswer({ since: "", days: 7, isChecked: false, rules: [] });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [signal, ruleIds.join(",")]);

  const setRuleIds: (ids: Array<string>) => void = useCallback(
    (ids: Array<string>): void => {
      setRuleIdsState(
        ids.map((id: string): string => {
          return id.toLowerCase();
        }),
      );
    },
    [],
  );

  const countOf: (ruleId: string) => ScrubRuleValueCountOfRule | undefined = (
    ruleId: string,
  ): ScrubRuleValueCountOfRule | undefined => {
    const id: string = ruleId.toLowerCase();

    return answer?.rules.find((rule: ScrubRuleValueCountOfRule): boolean => {
      return rule.scrubRuleId === id;
    });
  };

  return {
    isChecked: answer ? answer.isChecked : undefined,
    countOf,
    setRuleIds,
  };
}
