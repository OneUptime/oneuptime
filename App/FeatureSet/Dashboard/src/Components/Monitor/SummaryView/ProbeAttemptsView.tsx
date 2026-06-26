import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  attempts: Array<ProbeAttempt>;
  totalAttempts?: number | undefined;
}

const ProbeAttemptsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const attempts: Array<ProbeAttempt> = props.attempts || [];
  const totalAttempts: number = props.totalAttempts ?? attempts.length;

  if (attempts.length <= 1) {
    return null;
  }

  return (
    <div className="rounded-md border-2 border-gray-100 p-4">
      <div className="text-sm font-medium text-gray-900 mb-1">
        Retry Attempts
      </div>
      <div className="text-xs text-gray-500 mb-3">
        Each attempt made for this check, in order.
      </div>
      <ul className="space-y-3">
        {attempts.map((attempt: ProbeAttempt, index: number) => {
          const failed: boolean =
            !attempt.isOnline || Boolean(attempt.failureCause);
          const attemptedAt: Date = new Date(attempt.attemptedAt);
          const responseReceivedAt: Date = new Date(attempt.responseReceivedAt);

          return (
            <li
              key={attempt.attemptNumber ?? index}
              className="text-sm text-gray-700"
            >
              <div>
                <span className="font-mono">
                  Attempt {attempt.attemptNumber}/{totalAttempts}
                </span>
                <span className="mx-2 text-gray-400">—</span>
                <span className={failed ? "text-red-700" : "text-green-700"}>
                  {failed ? "Failed" : "Succeeded"}
                </span>
                {typeof attempt.responseTimeInMs === "number" && (
                  <>
                    <span className="mx-2 text-gray-400">—</span>
                    <span>{Math.round(attempt.responseTimeInMs)} ms</span>
                  </>
                )}
                {typeof attempt.responseCode === "number" && (
                  <>
                    <span className="mx-2 text-gray-400">—</span>
                    <span>HTTP {attempt.responseCode}</span>
                  </>
                )}
              </div>
              <div className="ml-4 mt-1 text-xs text-gray-500">
                Started{" "}
                {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  attemptedAt,
                  false,
                  true,
                )}
                {" → "}
                Responded{" "}
                {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  responseReceivedAt,
                  false,
                  true,
                )}
              </div>
              {failed && attempt.failureCause && (
                <div className="ml-4 mt-1 text-xs text-red-700 break-all">
                  {attempt.failureCause}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ProbeAttemptsView;
