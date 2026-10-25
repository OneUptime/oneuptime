import {
  SecurityCaseValueLists,
  getSecurityCaseValues,
} from "./SecurityCaseValues";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { useCallback, useEffect, useState } from "react";

export interface UseSecurityCaseValues {
  // Null until the project's case priorities and statuses are read.
  values: SecurityCaseValueLists | null;
  // Why they could not be read, in the product's words; "" otherwise.
  error: string;
  // Reads them again (the error's Try again).
  retry: () => void;
}

/*
 * The project's case priorities and statuses, for a page or a component
 * that draws a case's priority or status, lists open or closed cases, or
 * offers them to pick (SecurityCaseValues). Read once per project per
 * minute, whoever asks.
 */
export default function useSecurityCaseValues(): UseSecurityCaseValues {
  const [values, setValues] = useState<SecurityCaseValueLists | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return () => {};
    }

    let isCurrent: boolean = true;

    getSecurityCaseValues(projectId)
      .then((read: SecurityCaseValueLists) => {
        if (isCurrent) {
          setValues(read);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err as Error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [readCount]);

  const retry: () => void = useCallback((): void => {
    setError("");
    setReadCount((count: number): number => {
      return count + 1;
    });
  }, []);

  return { values, error, retry };
}
