/*
 * Pure, react-free matching for the Network Map's search box.
 *
 * The box does two things at once, and this file is the local half: as you
 * type, the level in view narrows — the same predicate applied to the map's
 * markers, the site cards and the WAN links, so all three halves of the page
 * agree about what you are looking at. (The other half, finding a site
 * ANYWHERE in the hierarchy, cannot be done on the client: the map only ever
 * holds one level, so it goes to /network-site/search.)
 *
 * Kept out of the components so it can be imported (and unit-tested) in a
 * plain Node/TypeScript environment — see Geo/GeoProjection.ts for why.
 */

/*
 * Below this many characters the box does not ask the server for anything.
 * One character matches most of a franchise estate, so the round trip would
 * buy a list nobody can use — the local narrowing still runs from the first
 * keystroke, because that is free.
 */
export const MIN_SITE_SEARCH_CHARS: number = 2;

// What the local filter reads off a row. Every site DTO on the page has both.
export interface SearchableSite {
  name: string;
  siteType: string;
}

// What the local filter reads off a WAN link row.
export interface SearchableLink {
  name: string;
  fromSiteId?: string | undefined;
  toSiteId?: string | undefined;
}

/**
 * Fold raw input into the form every function here expects: trimmed and
 * lower-cased. Pass the result around rather than re-deriving it per row.
 */
export const normalizeSiteSearchText: (
  value: string | null | undefined,
) => string = (value: string | null | undefined): string => {
  return (value || "").trim().toLowerCase();
};

/**
 * Whether this text is worth a round trip to /network-site/search.
 */
export const isRemoteSearchable: (normalized: string) => boolean = (
  normalized: string,
): boolean => {
  return normalized.length >= MIN_SITE_SEARCH_CHARS;
};

/*
 * Every whitespace-separated token has to appear somewhere in the row.
 *
 * A single token behaves exactly like a substring test, so nothing that used
 * to match stops matching. What it adds is the way people actually name and
 * then recall these things: a site called "Unit 104822 — Michigan Ave" is
 * found by "michigan 104822" and by "104822 michigan", neither of which is a
 * substring of anything.
 */
const tokenize: (normalized: string) => Array<string> = (
  normalized: string,
): Array<string> => {
  return normalized.split(/\s+/).filter((token: string): boolean => {
    return token.length > 0;
  });
};

/**
 * Does this site match? An empty search matches everything — the box being
 * empty is not a filter.
 *
 * The site TYPE is part of the haystack on purpose: "market" is a perfectly
 * reasonable thing to type at a level that mixes markets and stores, and the
 * type name is the customer's own word for it.
 */
export const siteMatchesSearch: (
  site: SearchableSite,
  normalized: string,
) => boolean = (site: SearchableSite, normalized: string): boolean => {
  if (!normalized) {
    return true;
  }
  const haystack: string = `${site.name || ""} ${site.siteType || ""}`
    .trim()
    .toLowerCase();
  return tokenize(normalized).every((token: string): boolean => {
    return haystack.includes(token);
  });
};

/**
 * The rows that survive the search.
 *
 * An empty search returns the INPUT ARRAY ITSELF, not a copy: the graph and
 * the map both key expensive memos (grid layout, projection, cluster
 * bucketing) off this array's identity, and handing them a fresh array on
 * every keystroke-free render would relayout the level for nothing.
 */
export const filterSitesBySearch: <T extends SearchableSite>(
  sites: Array<T>,
  normalized: string,
) => Array<T> = <T extends SearchableSite>(
  sites: Array<T>,
  normalized: string,
): Array<T> => {
  if (!normalized) {
    return sites;
  }
  return sites.filter((site: T): boolean => {
    return siteMatchesSearch(site, normalized);
  });
};

/**
 * The links that survive the search: the ones whose own name matches, plus
 * the ones that touch a site still on screen.
 *
 * Touching ONE surviving site is enough. A search for "kansas city" is a
 * question about Kansas City, and the WAN links out of it are a large part
 * of the answer — dropping every one of them because the far end is in
 * Denver would answer a question nobody asked.
 */
export const filterLinksBySearch: <T extends SearchableLink>(
  links: Array<T>,
  normalized: string,
  visibleSiteIds: Set<string>,
) => Array<T> = <T extends SearchableLink>(
  links: Array<T>,
  normalized: string,
  visibleSiteIds: Set<string>,
): Array<T> => {
  if (!normalized) {
    return links;
  }
  const tokens: Array<string> = tokenize(normalized);
  return links.filter((link: T): boolean => {
    const name: string = (link.name || "").toLowerCase();
    const nameMatches: boolean = tokens.every((token: string): boolean => {
      return name.includes(token);
    });
    return (
      nameMatches ||
      (Boolean(link.fromSiteId) && visibleSiteIds.has(link.fromSiteId!)) ||
      (Boolean(link.toSiteId) && visibleSiteIds.has(link.toSiteId!))
    );
  });
};

/**
 * The ids of a filtered site list, for the link filter above.
 */
export const siteIdSet: (sites: Array<{ id: string }>) => Set<string> = (
  sites: Array<{ id: string }>,
): Set<string> => {
  return new Set<string>(
    sites.map((site: { id: string }): string => {
      return site.id;
    }),
  );
};
