import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * Whether the project has any exception group at all - in any state, at
 * any time - asked once, and only when `shouldAsk` turns true: the
 * Exceptions page asks while its list is empty and nothing the reader set
 * narrows it (TelemetryFirstSteps). Null until it has asked.
 *
 * None: the empty list offers exception tracking's setup guide. Some: an
 * empty Unresolved list is the good news it looks like, and keeps its own
 * message. A count that fails reads as "has some", so nobody who has
 * exceptions is sent to a setup guide by a network error.
 */
export default function useProjectHasExceptions(
  shouldAsk: boolean,
): boolean | null {
  const [hasExceptions, setHasExceptions] = useState<boolean | null>(null);

  useEffect(() => {
    if (!shouldAsk || hasExceptions !== null) {
      return;
    }

    let isCancelled: boolean = false;

    void (async (): Promise<void> => {
      let answer: boolean = true;

      try {
        const count: number = await ModelAPI.count<TelemetryException>({
          modelType: TelemetryException,
          query: {},
        });
        answer = count > 0;
      } catch {
        answer = true;
      }

      if (!isCancelled) {
        setHasExceptions(answer);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [shouldAsk, hasExceptions]);

  return hasExceptions;
}
