import { FacetData, FacetValue } from "./types";

/*
 * How a telemetry explorer asks for its facet counts, so that a facet with
 * values chosen is counted with its OWN selection left out.
 *
 * A facet's counts describe the rows the filters leave. Counted with every
 * filter - its own included - a facet with a value checked had nothing left
 * to count but that value: check Status = Error, and Ok and Unset dropped out
 * of the Status facet, so a second status could only be added by unchecking
 * the first or typing `status:(error OR unset)`. Every faceted search counts
 * a facet with the other facets' filters and not its own, and so do these
 * explorers now:
 *
 *   - each facet a value is chosen in is counted in a request of its own,
 *     with every filter but that facet's own. Its checked values keep their
 *     counts, and the values beside them stay listed, with theirs;
 *   - the facets nothing is chosen in are counted in one request, with every
 *     filter, as before.
 *
 * The page's own scope (a service's or a host's tab) is never a choice: an
 * explorer leaves only what the reader chose out of a facet's request.
 *
 * The database work is the same as before - one GROUP BY per facet either
 * way - and the requests run side by side. Kept free of React so the plan
 * and the merge are unit-tested on their own (FacetCountPlan.test.ts).
 */

export interface FacetCountRequestPart {
  // The facets this request counts, in the explorer's order.
  facetKeys: Array<string>;
  /*
   * The facet whose own selection this request leaves out, or null for the
   * request that counts every facet nothing is chosen in, with every filter.
   */
  withoutSelectionOf: string | null;
}

export interface FacetCountAnswer {
  facets: FacetData;
  timedOutFacets: Array<string>;
}

/*
 * The requests that count `facetKeys`: one per facet with a choice, in the
 * order the explorer lists them, then one for every facet nothing is chosen
 * in. That one carries every filter, as the single request explorers always
 * sent did, and is sent last, so the newest request an explorer sends is
 * still the one that says what the list is filtered by. A chosen facet the
 * explorer does not ask for is ignored; with nothing chosen this is that one
 * request alone.
 */
export const planFacetCountRequests: (data: {
  facetKeys: ReadonlyArray<string>;
  selectedFacetKeys: ReadonlySet<string> | ReadonlyArray<string>;
}) => Array<FacetCountRequestPart> = (data: {
  facetKeys: ReadonlyArray<string>;
  selectedFacetKeys: ReadonlySet<string> | ReadonlyArray<string>;
}): Array<FacetCountRequestPart> => {
  const selected: Set<string> = new Set<string>(data.selectedFacetKeys);
  const facetKeys: Array<string> = Array.from(new Set<string>(data.facetKeys));

  const unchosen: Array<string> = facetKeys.filter((key: string): boolean => {
    return !selected.has(key);
  });

  const parts: Array<FacetCountRequestPart> = [];

  for (const key of facetKeys) {
    if (selected.has(key)) {
      parts.push({ facetKeys: [key], withoutSelectionOf: key });
    }
  }

  if (unchosen.length > 0) {
    parts.push({ facetKeys: unchosen, withoutSelectionOf: null });
  }

  return parts;
};

/*
 * One answer from the answers to a plan's requests, in the plan's order:
 * each facet from the request that counted it (anything else an answer
 * carries is left out), and the facets each request was stopped on.
 */
export const mergeFacetCountAnswers: (
  parts: ReadonlyArray<FacetCountRequestPart>,
  answers: ReadonlyArray<FacetCountAnswer>,
) => FacetCountAnswer = (
  parts: ReadonlyArray<FacetCountRequestPart>,
  answers: ReadonlyArray<FacetCountAnswer>,
): FacetCountAnswer => {
  const facets: FacetData = {};
  const timedOut: Array<string> = [];

  parts.forEach((part: FacetCountRequestPart, index: number): void => {
    const answer: FacetCountAnswer | undefined = answers[index];

    if (!answer) {
      return;
    }

    for (const key of part.facetKeys) {
      const values: Array<FacetValue> | undefined = answer.facets?.[key];

      if (values) {
        facets[key] = values;
      }

      if (answer.timedOutFacets?.includes(key) && !timedOut.includes(key)) {
        timedOut.push(key);
      }
    }
  });

  return { facets: facets, timedOutFacets: timedOut };
};

// The facet answer an endpoint sent, read defensively.
export const readFacetCountAnswer: (
  data: Record<string, unknown> | null | undefined,
) => FacetCountAnswer = (
  data: Record<string, unknown> | null | undefined,
): FacetCountAnswer => {
  const facets: unknown = data?.["facets"];
  const timedOutFacets: unknown = data?.["timedOutFacets"];

  return {
    facets:
      facets && typeof facets === "object" && !Array.isArray(facets)
        ? (facets as FacetData)
        : {},
    timedOutFacets: Array.isArray(timedOutFacets)
      ? (timedOutFacets as Array<unknown>).filter(
          (key: unknown): key is string => {
            return typeof key === "string";
          },
        )
      : [],
  };
};
