import ScrubRuleAddressesApi from "./ScrubRuleAddressesApi";
import {
  ScrubRuleAddressSignal,
  ScrubRuleHidingAddresses,
  ScrubRulesHidingAddressesAnswer,
} from "Common/Types/Telemetry/ScrubRuleAddresses";
import { useCallback, useEffect, useState } from "react";

/*
 * The project's IP Address scrub rules that keep Security Events from
 * naming an attacker's address (#10396), read once a page opens and again
 * after Hash Instead switches one. A read that fails names no rule: the
 * page draws as it would without the notice.
 */
export interface ScrubRulesHidingAddressesState {
  rules: Array<ScrubRuleHidingAddresses>;
  // The kinds of record Security Events reads addresses from.
  signalsRead: Array<ScrubRuleAddressSignal>;
  // Read again: after a switch, or a change of a rule.
  reload: () => void;
}

export function useScrubRulesHidingAddresses(
  options: { isEnabled?: boolean } = {},
): ScrubRulesHidingAddressesState {
  const isEnabled: boolean = options.isEnabled !== false;
  const [rules, setRules] = useState<Array<ScrubRuleHidingAddresses>>([]);
  const [signalsRead, setSignalsRead] = useState<Array<ScrubRuleAddressSignal>>(
    [],
  );
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    if (!isEnabled) {
      setRules([]);
      setSignalsRead([]);
      return;
    }

    let isCurrent: boolean = true;

    ScrubRuleAddressesApi.getRulesHidingAddresses()
      .then((answer: ScrubRulesHidingAddressesAnswer) => {
        if (isCurrent) {
          setRules(answer.rules);
          setSignalsRead(answer.signalsRead);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setRules([]);
          setSignalsRead([]);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [isEnabled, readCount]);

  const reload: () => void = useCallback((): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  }, []);

  return { rules, signalsRead, reload };
}
