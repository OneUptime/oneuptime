import { fetchDetectionRulesUncounted } from "./DetectionRuleUncountedModel";
import { DetectionRuleUncounted } from "Common/Types/SecurityEvent/DetectionRuleUncounted";
import { useEffect, useState } from "react";

/*
 * What each rule a page of Detection Rules lists could not count in the
 * last day (#10547), by rule id: asked once for the page's rules, and again
 * when the page lists others. A read that fails shows nothing - the list of
 * rules is what the page is for - and the next page's ask tries again. The
 * server keeps each answer five minutes, so a refresh costs nothing.
 */
export default function useDetectionRulesUncounted(
  detectionRuleIds: ReadonlyArray<string>,
): Map<string, DetectionRuleUncounted> {
  const [byRule, setByRule] = useState<Map<string, DetectionRuleUncounted>>(
    new Map(),
  );

  // The page's rules as one value, so the same page asks once.
  const key: string = [...detectionRuleIds].sort().join(",");

  useEffect(() => {
    if (!key) {
      setByRule(new Map());
      return;
    }

    let isCurrent: boolean = true;

    fetchDetectionRulesUncounted(key.split(","))
      .then((read: Map<string, DetectionRuleUncounted>) => {
        if (isCurrent) {
          setByRule(read);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setByRule(new Map());
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [key]);

  return byRule;
}
