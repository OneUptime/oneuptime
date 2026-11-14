import SetupHealthApi from "./SetupHealthApi";
import ObjectID from "Common/Types/ObjectID";
import { SetupHealthSummary } from "Common/Types/SetupHealth/SetupHealth";
import { useEffect, useState } from "react";

/*
 * How many things in the project's setup need a look, for Home's "Needs
 * attention" (#6812): the findings of the first two levels the person may
 * see. Read beside Home's batch, never behind it; null while it is read,
 * or when it could not be - Home then says nothing of the setup.
 */
export default function useSetupHealthSummary(
  projectId: ObjectID | null,
  refreshKey?: number | undefined,
): number | null {
  const [count, setCount] = useState<number | null>(null);
  const projectIdText: string = projectId?.toString() || "";

  useEffect(() => {
    if (!projectIdText) {
      setCount(null);
      return;
    }

    let isCurrent: boolean = true;

    SetupHealthApi.getSummary()
      .then((summary: SetupHealthSummary) => {
        if (isCurrent) {
          setCount(summary.counts.needsALook);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setCount(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [projectIdText, refreshKey]);

  return count;
}
