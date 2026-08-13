import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useCallback, useEffect, useState } from "react";
import {
  ReadinessPageWire,
  ReadinessSummaryWire,
  mergeReadinessPages,
  parseReadinessPage,
} from "./ReadinessTypes";

/*
 * Loads a policy's responder readiness.
 *
 * Both readiness surfaces (the policy overview card and the dots on the
 * escalation summary chips) need the same payload, and neither is ever mounted
 * beside the other, so a hook rather than a shared provider keeps this simple:
 * one fetch per mounted surface, against a service that caches for 60s anyway.
 *
 * The request goes through API.get + ModelAPI.getCommonHeaders() exactly as
 * TeamComplianceStatusTable.tsx:77 does — this endpoint is a computed view, not
 * a model, so ModelAPI.getList has nothing to offer it — but the response is run
 * through parseReadinessPage rather than cast to `any`, so the rendered shape
 * stays tied to the server contract.
 *
 * WHY IT READS PAGES RATHER THAN A RESPONSE. The endpoint is paged (default 100
 * responders, maximum 500) and both surfaces ask about SPECIFIC people: the card
 * counts every responder, and each escalation chip looks its own user up by id.
 * A responder who did not fit in the one page a single request returns has no
 * readiness row, so their chip renders no dot and their state is invisible in
 * the tiles — an unreachable responder omitted from the surface built to find
 * unreachable responders. So this reads until the server stops saying `hasMore`.
 */

export interface OnCallReadinessState {
  isLoading: boolean;
  error: string;
  summary: ReadinessSummaryWire | null;
  /*
   * True when the scope holds more responders than this hook was willing to
   * read, which makes `summary` a prefix of the list rather than the list. The
   * server sorts most-broken-first, so the rows beyond the cut are the healthy
   * tail — but a surface still has to say it is holding part of a list rather
   * than print a reassuring count computed from what it happened to receive.
   */
  isTruncated: boolean;
  // Responders in the whole scope, as the server counts them. Never the page's.
  totalCount: number;
  reload: () => Promise<void>;
}

export interface UseOnCallReadinessOptions {
  /*
   * Undefined leaves the hook idle: no request, no error, no data. That is the
   * state the escalation summary sits in until its parent passes the policy id
   * down, and an idle hook renders no dots rather than a broken card.
   */
  onCallDutyPolicyId?: ObjectID | undefined;
}

/*
 * The server's documented maximum, asked for explicitly. A limit above the
 * maximum is refused rather than clamped — deliberately, so that a client cannot
 * mistake a short page for a complete list — so asking for exactly the ceiling
 * is both the fewest round trips and the loudest failure if that ceiling ever
 * moves.
 */
const READINESS_PAGE_SIZE: number = 500;

/*
 * 10,000 responders on a single on-call policy, after which this stops reading
 * and says so. The cap is not a performance tuning knob, it is a refusal to hang
 * a page on an unbounded loop if a server ever reports `hasMore` forever.
 */
const READINESS_MAX_PAGES: number = 20;

const useOnCallReadiness: (
  options: UseOnCallReadinessOptions,
) => OnCallReadinessState = (
  options: UseOnCallReadinessOptions,
): OnCallReadinessState => {
  /*
   * Keyed on the string, not the ObjectID. Callers build their id from the route
   * on every render (Navigation.getLastParamAsObjectID() returns a fresh
   * instance each time), so an ObjectID in the dependency array would never
   * compare equal and the effect would refetch on every single render.
   */
  const policyId: string = options.onCallDutyPolicyId?.toString() || "";

  const [isLoading, setIsLoading] = useState<boolean>(Boolean(policyId));
  const [error, setError] = useState<string>("");
  const [summary, setSummary] = useState<ReadinessSummaryWire | null>(null);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number>(0);

  const loadReadiness: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (!policyId) {
        return;
      }

      try {
        setIsLoading(true);
        setError("");

        const pages: Array<ReadinessPageWire> = [];
        let skip: number = 0;
        let truncated: boolean = false;

        for (
          let request: number = 0;
          request < READINESS_MAX_PAGES;
          request++
        ) {
          /*
           * A fresh URL per request: addQueryParam mutates and returns the same
           * instance, so a hoisted url would carry the previous page's skip.
           */
          const url: URL = URL.fromString(APP_API_URL.toString())
            .addRoute(`/on-call-readiness/policy/${policyId}`)
            .addQueryParam("limit", String(READINESS_PAGE_SIZE))
            .addQueryParam("skip", String(skip));

          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.get<JSONObject>({
              url: url,
              headers: ModelAPI.getCommonHeaders(),
            });

          if (response instanceof HTTPErrorResponse) {
            throw response;
          }

          const page: ReadinessPageWire = parseReadinessPage(response.data);

          pages.push(page);

          if (!page.hasMore) {
            break;
          }

          /*
           * A page that claims there is more but returned nothing would advance
           * `skip` by zero and re-request the same offset until the cap. Stop
           * instead, and report the scope as truncated, because that server is
           * not telling us how to reach the rest.
           */
          if (page.summary.users.length === 0) {
            truncated = true;
            break;
          }

          skip = skip + page.summary.users.length;

          if (request === READINESS_MAX_PAGES - 1) {
            truncated = true;
          }
        }

        const merged: ReadinessSummaryWire | null = mergeReadinessPages(pages);
        const lastPage: ReadinessPageWire | undefined = pages[pages.length - 1];

        /*
         * Two independent ways to be holding part of the picture, unioned into
         * one flag because a surface's obligation is the same either way: the
         * server can report that its own reads hit a ceiling, and this loop can
         * stop before the last page. `summary.isTruncated` still carries the
         * server's half on its own, for copy that needs to tell them apart.
         */
        setSummary(merged);
        setIsTruncated(truncated || Boolean(merged && merged.isTruncated));
        setTotalCount(lastPage ? lastPage.totalCount : 0);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
        setSummary(null);
        setIsTruncated(false);
        setTotalCount(0);
      }

      setIsLoading(false);
    }, [policyId]);

  useEffect(() => {
    if (!policyId) {
      setIsLoading(false);
      setSummary(null);
      setError("");
      setIsTruncated(false);
      setTotalCount(0);
      return;
    }

    loadReadiness().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [policyId, loadReadiness]);

  return {
    isLoading: isLoading,
    error: error,
    summary: summary,
    isTruncated: isTruncated,
    totalCount: totalCount,
    reload: loadReadiness,
  };
};

export default useOnCallReadiness;
