import InBetween from "Common/Types/BaseDatabase/InBetween";
import { LlmSetupCheckResponse } from "Common/Types/Telemetry/LlmSetupCheckApi";
import { useEffect, useState } from "react";
import { fetchLlmSetupCheck } from "../LlmObservabilityReads";

/*
 * The project's AI / LLM setup check (LlmSetupCheckApi), read when a view
 * needs it: an empty Conversations or Calls view, or the Connect page. Read
 * again when the view's window changes or the caller asks (reloadToken).
 *
 * "error" is a read that failed: the view then says what it always said,
 * never a diagnosis it could not make.
 */

export type LlmSetupCheckState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; check: LlmSetupCheckResponse }
  | { kind: "error" };

export default function useLlmSetupCheck(data: {
  enabled: boolean;
  window?: InBetween<Date> | undefined;
  reloadToken?: number | undefined;
}): LlmSetupCheckState {
  const [state, setState] = useState<LlmSetupCheckState>({ kind: "idle" });

  const startMs: number | undefined = data.window?.startValue.getTime();
  const endMs: number | undefined = data.window?.endValue.getTime();

  useEffect(() => {
    if (!data.enabled) {
      setState({ kind: "idle" });
      return;
    }

    let cancelled: boolean = false;

    setState({ kind: "loading" });

    fetchLlmSetupCheck(data.window)
      .then((check: LlmSetupCheckResponse) => {
        if (!cancelled) {
          setState({ kind: "loaded", check: check });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [data.enabled, startMs, endMs, data.reloadToken || 0]);

  return state;
}
