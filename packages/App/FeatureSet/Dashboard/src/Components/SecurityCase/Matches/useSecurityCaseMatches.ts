import SecurityCaseContextApi from "../Context/SecurityCaseContextApi";
import ObjectID from "Common/Types/ObjectID";
import { SecurityCaseMatchesJson } from "Common/Types/SecurityCase/SecurityCaseMatches";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";

/*
 * Why a case was opened and what its detections matched, read once for the
 * case's Overview - its "Why This Case Was Opened" card and its response
 * plan both draw from it - and read again whenever the case changes (its
 * refresh): a detection joining the case has events of its own.
 *
 * A read again keeps what is shown until the answer is back, and a read
 * for another case is never shown for this one.
 */
export interface SecurityCaseMatchesState {
  // Null until the first answer.
  matches: SecurityCaseMatchesJson | null;
  // Why it could not be read; "" when it was.
  error: string;
  reread: () => void;
}

export default function useSecurityCaseMatches(
  caseId: ObjectID,
  refreshToken?: string | number | undefined,
): SecurityCaseMatchesState {
  const [matches, setMatches] = useState<SecurityCaseMatchesJson | null>(null);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const caseIdText: string = caseId.toString();

  // Another case starts afresh.
  useEffect(() => {
    setMatches(null);
    setError("");
  }, [caseIdText]);

  useEffect(() => {
    let isCurrent: boolean = true;

    SecurityCaseContextApi.getMatches(new ObjectID(caseIdText))
      .then((result: SecurityCaseMatchesJson) => {
        if (isCurrent) {
          setMatches(result);
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
  }, [caseIdText, refreshToken, readCount]);

  return {
    matches,
    error,
    reread: (): void => {
      setError("");
      setReadCount((count: number): number => {
        return count + 1;
      });
    },
  };
}
