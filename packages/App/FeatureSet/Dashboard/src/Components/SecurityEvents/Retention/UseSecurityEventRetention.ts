import SecurityCaseApi from "../../SecurityCase/SecurityCaseApi";
import { SecurityEventRetentionStatus } from "Common/Types/SecurityEvent/SecurityEventRetention";
import { useEffect, useState } from "react";

/*
 * How long the project keeps its security events, and the enabled rules
 * that read further back (#10432), read once when the component that asks
 * is drawn. Null until it is known, and when it could not be read: what it
 * says is a notice, and without it the page is as it was.
 */
export default function useSecurityEventRetention(): SecurityEventRetentionStatus | null {
  const [status, setStatus] = useState<SecurityEventRetentionStatus | null>(
    null,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    // Started inside a promise, so even a read that throws at once is only no notice.
    Promise.resolve()
      .then(() => {
        return SecurityCaseApi.getSecurityEventRetention();
      })
      .then((answer: SecurityEventRetentionStatus | null) => {
        if (isCurrent) {
          setStatus(answer);
        }
      })
      .catch(() => {
        // Only a notice: without it, the page is as it was.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  return status;
}
