import Service from "../../Models/DatabaseModels/Service";
import Search from "../../Types/BaseDatabase/Search";
import Select from "../../Types/BaseDatabase/Select";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import {
  SearchValueOperator,
  SearchValuePredicate,
} from "../../Types/Telemetry/TelemetrySearchQuery";
import ModelAPI, { ListResult } from "./ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * A TYPED `service:` TOKEN, RESOLVED ON THE SERVER (#10921).
 *
 * The explorers' search bars take a service by NAME (`service:checkout`,
 * `@service:api-*`) while the telemetry stores its id, so each explorer
 * matched the token against a list of the project's services it read once:
 * the first 10,000 by name. A service past them never matched - the token
 * filtered by nothing, or by "no such service" - and the page could not say
 * why.
 *
 * The token's services are searched for on the server instead, by the text
 * every name it matches must contain (getServiceNameSearchTexts), and the
 * explorer's own matcher then keeps exactly the ones it matches: the same
 * answer as before, past any number of services. A token that matches no
 * text (a glob of wildcards alone) is read as the first services by name.
 */

/*
 * The most services one token's search reads: a token that matches more
 * than this many services is still the widest filter a query carries.
 */
export const SERVICE_NAME_SEARCH_LIMIT: number = LIMIT_PER_PROJECT;

// What a token's services are read with: a name to match, a colour to draw.
export const SERVICE_NAME_SEARCH_SELECT: Select<Service> = {
  _id: true,
  name: true,
  serviceColor: true,
};

/*
 * The longest run of characters a glob matches literally: every name the
 * glob matches contains it. "" when the glob is wildcards alone. A
 * backslash takes the character after it literally (WildcardPattern).
 */
export const getGlobLiteral: (glob: string) => string = (
  glob: string,
): string => {
  let longest: string = "";
  let run: string = "";

  for (let index: number = 0; index < glob.length; index++) {
    const character: string = glob[index]!;

    if (character === "\\" && index + 1 < glob.length) {
      run += glob[index + 1];
      index += 1;
      continue;
    }

    if (character === "*" || character === "?") {
      if (run.length > longest.length) {
        longest = run;
      }

      run = "";
      continue;
    }

    run += character;
  }

  return run.length > longest.length ? run : longest;
};

/*
 * The texts a server search can narrow a predicate's services by: every
 * service name the predicate - or, for a negation, the predicate it
 * negates - matches contains one of them, whatever its case. Null when no
 * text narrows it (a glob of wildcards alone, Exists): its services are
 * then read by name from the first.
 */
export const getServiceNameSearchTexts: (
  predicate: SearchValuePredicate,
) => Array<string> | null = (
  predicate: SearchValuePredicate,
): Array<string> | null => {
  const texts: Array<string> = [];

  switch (predicate.operator) {
    case SearchValueOperator.Equals:
    case SearchValueOperator.NotEquals:
    case SearchValueOperator.Contains:
    case SearchValueOperator.NotContains:
    case SearchValueOperator.StartsWith:
    case SearchValueOperator.EndsWith:
      texts.push(predicate.value);
      break;
    case SearchValueOperator.In:
    case SearchValueOperator.NotIn:
      texts.push(...predicate.values);
      break;
    case SearchValueOperator.Wildcard:
    case SearchValueOperator.NotWildcard: {
      const globs: Array<string> =
        predicate.values.length > 0 ? predicate.values : [predicate.value];

      for (const glob of globs) {
        const literal: string = getGlobLiteral(glob);

        if (!literal.trim()) {
          return null;
        }

        texts.push(literal);
      }

      break;
    }
    default:
      return null;
  }

  const distinct: Array<string> = [];

  for (const text of texts) {
    const trimmed: string = text.trim();

    if (!trimmed) {
      // A blank literal narrows nothing: every name contains it.
      return null;
    }

    if (
      !distinct.some((known: string): boolean => {
        return known.toLowerCase() === trimmed.toLowerCase();
      })
    ) {
      distinct.push(trimmed);
    }
  }

  return distinct.length > 0 ? distinct : null;
};

/*
 * The services a token's predicates may match, read from the server: each
 * text's search (by name, case-insensitive), each service once. Ids pasted
 * into the bar match themselves and need no read. A failed read fails the
 * search: the caller says so rather than filter by a part of the answer.
 */
export const searchServicesForNamePredicates: (data: {
  predicates: Array<SearchValuePredicate>;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<Array<Service>> = async (data: {
  predicates: Array<SearchValuePredicate>;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<Array<Service>> => {
  const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;
  const searches: Array<string | null> = [];

  for (const predicate of data.predicates) {
    const texts: Array<string> | null = getServiceNameSearchTexts(predicate);

    if (!texts) {
      if (
        predicate.operator === SearchValueOperator.Exists ||
        predicate.operator === SearchValueOperator.NotExists
      ) {
        continue;
      }

      searches.push(null);
      continue;
    }

    for (const text of texts) {
      if (
        !searches.some((known: string | null): boolean => {
          return known !== null && known.toLowerCase() === text.toLowerCase();
        })
      ) {
        searches.push(text);
      }
    }
  }

  const results: Array<ListResult<Service>> = await Promise.all(
    searches.map((text: string | null): Promise<ListResult<Service>> => {
      return modelAPI.getList<Service>({
        modelType: Service,
        query: text === null ? {} : { name: new Search<string>(text) },
        select: SERVICE_NAME_SEARCH_SELECT,
        sort: { name: SortOrder.Ascending },
        limit: SERVICE_NAME_SEARCH_LIMIT,
        skip: 0,
      });
    }),
  );

  const byId: Map<string, Service> = new Map<string, Service>();

  for (const result of results) {
    for (const service of result.data || []) {
      const id: string = (service.id || service._id || "")
        .toString()
        .toLowerCase();

      if (id && !byId.has(id)) {
        byId.set(id, service);
      }
    }
  }

  return Array.from(byId.values());
};

/*
 * The id of the service a typed name names, its case aside: the first by
 * name of the services the server's search finds for it (#11072, the logs
 * explorer's `service:` name). Undefined when no service has that name -
 * an id typed in matches itself, and needs no read. A failed search
 * throws: the caller says so rather than filter by the name.
 */
export const findServiceIdByName: (data: {
  name: string;
  modelAPI?: typeof ModelAPI | undefined;
}) => Promise<string | undefined> = async (data: {
  name: string;
  modelAPI?: typeof ModelAPI | undefined;
}): Promise<string | undefined> => {
  const name: string = data.name.trim();

  if (!name) {
    return undefined;
  }

  const services: Array<Service> = await searchServicesForNamePredicates({
    predicates: [
      { operator: SearchValueOperator.Equals, value: name, values: [] },
    ],
    modelAPI: data.modelAPI,
  });

  const named: Service | undefined = services.find(
    (service: Service): boolean => {
      return (
        (service.name || "").toString().toLowerCase() === name.toLowerCase()
      );
    },
  );

  return (named?.id || named?._id)?.toString() || undefined;
};

// One empty list, so a page's memos keyed on the services hold still.
const NO_SERVICES: Array<Service> = [];

export interface ServiceNameSearch {
  // The services the token's predicates may match, once read.
  services: Array<Service>;
  // Whether the token's services are being read: a list waits for them.
  isSearching: boolean;
  // Whether the last read failed: the token cannot be applied.
  hasFailed: boolean;
}

/*
 * The services a token's predicates may match, read as the token changes.
 * No predicates, no read: an explorer with no `service:` token reads none.
 */
export const useServiceNameSearch: (
  predicates: Array<SearchValuePredicate>,
) => ServiceNameSearch = (
  predicates: Array<SearchValuePredicate>,
): ServiceNameSearch => {
  const key: string = JSON.stringify(predicates);
  const [state, setState] = useState<{
    key: string;
    services: Array<Service>;
    hasFailed: boolean;
  }>({ key: "[]", services: NO_SERVICES, hasFailed: false });

  useEffect(() => {
    if (predicates.length === 0) {
      setState({ key: key, services: NO_SERVICES, hasFailed: false });
      return;
    }

    let cancelled: boolean = false;

    searchServicesForNamePredicates({ predicates: predicates })
      .then((services: Array<Service>) => {
        if (!cancelled) {
          setState({ key: key, services: services, hasFailed: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ key: key, services: NO_SERVICES, hasFailed: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const isCurrent: boolean = state.key === key;

  return {
    services: isCurrent ? state.services : NO_SERVICES,
    isSearching: predicates.length > 0 && !isCurrent,
    hasFailed: isCurrent && state.hasFailed,
  };
};
