import { countActiveExceptionsByRule } from "./RuleExceptionsModel";
import DetectionRuleException from "Common/Models/DatabaseModels/DetectionRuleException";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useCallback, useEffect, useState } from "react";

export interface ActiveRuleExceptionCounts {
  // How many of each rule's exceptions skip something now, by rule id.
  counts: Map<string, number>;
  // Read them again: after an exception is added from a rule's row.
  refresh: () => void;
}

/*
 * The count under each detection rule's name on Detection Rules: one read
 * of the project's exceptions, only the columns that say whether each
 * skips something now. A read that fails shows no counts - the list of
 * rules is what the page is for - and is tried again on the next refresh.
 */
export default function useActiveRuleExceptionCounts(
  projectId: ObjectID | null,
): ActiveRuleExceptionCounts {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [refreshNumber, setRefreshNumber] = useState<number>(0);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<DetectionRuleException> =
          await ModelAPI.getList<DetectionRuleException>({
            modelType: DetectionRuleException,
            query: { projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              detectionRuleId: true,
              kind: true,
              startsAt: true,
              endsAt: true,
              expiresAt: true,
            },
            sort: {},
          });

        if (isCurrent) {
          setCounts(
            countActiveExceptionsByRule(
              result.data,
              OneUptimeDate.getCurrentDate(),
            ),
          );
        }
      } catch {
        if (isCurrent) {
          setCounts(new Map());
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [projectId?.toString(), refreshNumber]);

  const refresh: () => void = useCallback(() => {
    setRefreshNumber((number: number): number => {
      return number + 1;
    });
  }, []);

  return { counts, refresh };
}
