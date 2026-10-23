import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import {
  OwnerRulePreviewDraft,
  OwnerRulePreviewEvent,
  OwnerRulePreviewResult,
} from "Common/Types/Rules/OwnerRulePreview";
import API from "Common/UI/Utils/API/API";
import { useEffect, useState } from "react";
import { fetchOwnerRulePreview } from "./OwnerRulePreviewApi";
import { getOwnerRulePreviewRequestKey } from "./OwnersOnCreateRules";

/*
 * Which owner rules would run for the event a create form holds, and who
 * they would add (OwnerRulePreviewApi), asked once per draft: the review
 * step draws its rows more than once, and a new draft - the person went
 * back and picked another monitor - asks again. An answer to a draft that
 * has since changed is dropped.
 *
 * Someone who may not read the owner rules is not told about them: the
 * server refuses them (422), and the review says nothing about rules. Any
 * other failure is said in a line - it never stops the create.
 */

export interface OwnerRulePreviewState {
  result: OwnerRulePreviewResult | null;
  isLoading: boolean;
  // Why the answer could not be had; empty when it was, or is on its way.
  error: string;
}

// The answers that mean "you may not see the owner rules".
const NOT_ALLOWED_STATUS_CODES: ReadonlyArray<number> = [403, 422];

const useOwnerRulePreview: (data: {
  event: OwnerRulePreviewEvent;
  // Null asks nothing.
  draft: OwnerRulePreviewDraft | null;
}) => OwnerRulePreviewState = (data: {
  event: OwnerRulePreviewEvent;
  draft: OwnerRulePreviewDraft | null;
}): OwnerRulePreviewState => {
  const requestKey: string = data.draft
    ? `${data.event}:${getOwnerRulePreviewRequestKey(data.draft)}`
    : "";

  const [state, setState] = useState<{
    key: string;
    result: OwnerRulePreviewResult | null;
    error: string;
  }>({ key: "", result: null, error: "" });

  useEffect(() => {
    if (!requestKey || !data.draft) {
      return;
    }

    let isCancelled: boolean = false;

    fetchOwnerRulePreview({ event: data.event, draft: data.draft })
      .then((result: OwnerRulePreviewResult) => {
        if (!isCancelled) {
          setState({ key: requestKey, result: result, error: "" });
        }
      })
      .catch((err: unknown) => {
        if (isCancelled) {
          return;
        }

        if (
          err instanceof HTTPErrorResponse &&
          NOT_ALLOWED_STATUS_CODES.includes(err.statusCode)
        ) {
          // Not theirs to see: nothing to say, and nothing went wrong.
          setState({ key: requestKey, result: { rules: [] }, error: "" });
          return;
        }

        setState({
          key: requestKey,
          result: null,
          error: API.getFriendlyMessage(err) || "error",
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [requestKey]);

  if (!requestKey) {
    return { result: null, isLoading: false, error: "" };
  }

  // Until the answer for this draft arrives, the last one is stale.
  if (state.key !== requestKey) {
    return { result: null, isLoading: true, error: "" };
  }

  return { result: state.result, isLoading: false, error: state.error };
};

export default useOwnerRulePreview;
