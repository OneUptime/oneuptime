import { FacetValue } from "./types";

/*
 * What a facet's (i) explains: the facet as a whole (FacetConfig.description)
 * and what each of its values is (FacetConfig.valueDescriptionMap) - the
 * traces explorer's Span Type says what Entry, Root and All spans are.
 *
 * Never drawn under the facet's title. The Span Type's three sentences there
 * read as a paragraph above its three options, pushing them, and every facet
 * below, down the sidebar. The (i) beside the title shows them on hover,
 * keyboard focus or a tap, and each described value says its own on its row.
 *
 * Kept free of React so what the (i) lists, and in what order, is
 * unit-testable on its own.
 */

// One described value: its name as the sidebar draws it, and its sentence.
export interface FacetHelpEntry {
  // The value as the facet keys it ("root").
  value: string;
  // Its name as its row draws it ("Root spans").
  label: string;
  // What it is, in one plain sentence (English; drawn in the reader's).
  description: string;
}

export interface FacetHelp {
  // The facet as a whole, in one or two plain sentences (English).
  description?: string | undefined;
  // Every described value, in the order the facet lists its values.
  entries: Array<FacetHelpEntry>;
}

export interface BuildFacetHelpOptions {
  description?: string | undefined;
  valueDescriptionMap?: Record<string, string> | undefined;
  // Every value the facet has, in its order, whatever a search shows.
  values: ReadonlyArray<FacetValue>;
  valueDisplayMap?: Record<string, string> | undefined;
}

// Blank is nothing to say.
const trimmed: (text: string | undefined) => string | undefined = (
  text: string | undefined,
): string | undefined => {
  const value: string = (text || "").trim();
  return value ? value : undefined;
};

/*
 * A value's sentence, if it has one: what its row is described by, and what
 * it says on hover and keyboard focus.
 */
export const getFacetValueDescription: (
  valueDescriptionMap: Record<string, string> | undefined,
  value: string,
) => string | undefined = (
  valueDescriptionMap: Record<string, string> | undefined,
  value: string,
): string | undefined => {
  if (
    !valueDescriptionMap ||
    !Object.prototype.hasOwnProperty.call(valueDescriptionMap, value)
  ) {
    return undefined;
  }

  return trimmed(valueDescriptionMap[value]);
};

/*
 * What the (i) says, or undefined when the facet has nothing to explain -
 * and then its title has no (i) at all, rather than one that opens on
 * nothing.
 *
 * Each described value is named as its row names it (the server's name for
 * it, then the facet's display map, then the value itself), and listed in
 * the order the facet lists its values. A described value the facet has no
 * row for yet (its counts not in) still says what it is, after the others,
 * in the map's own order.
 */
export const buildFacetHelp: (
  options: BuildFacetHelpOptions,
) => FacetHelp | undefined = (
  options: BuildFacetHelpOptions,
): FacetHelp | undefined => {
  const entries: Array<FacetHelpEntry> = [];
  const listed: Set<string> = new Set<string>();

  const add: (value: string, label: string | undefined) => void = (
    value: string,
    label: string | undefined,
  ): void => {
    if (listed.has(value)) {
      return;
    }

    const description: string | undefined = getFacetValueDescription(
      options.valueDescriptionMap,
      value,
    );

    if (!description) {
      return;
    }

    listed.add(value);
    entries.push({
      value: value,
      // The name its row draws, "(empty)" for an empty value as the row does.
      label: label || value || "(empty)",
      description: description,
    });
  };

  // As TelemetryFacetSection hands its rows their names.
  for (const facet of options.values) {
    add(
      facet.value,
      facet.displayName ?? options.valueDisplayMap?.[facet.value],
    );
  }

  for (const value of Object.keys(options.valueDescriptionMap || {})) {
    add(value, options.valueDisplayMap?.[value]);
  }

  const description: string | undefined = trimmed(options.description);

  if (!description && entries.length === 0) {
    return undefined;
  }

  return {
    description: description,
    entries: entries,
  };
};
