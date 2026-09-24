export interface WebVitalDefinition {
  key: string;
  label: string;
  /*
   * What the vital measures, in words a non-specialist can act on. The
   * Good / Poor limits are not repeated here - describeWebVitalThresholds
   * derives them from `thresholds`, so the two cannot disagree.
   */
  description: string;
  unit: "ms" | "score";
  thresholds: { warn: number; danger: number };
  names: Array<string>;
}

// Ordered aliases recognized by the RUM overview and the AI assistant.
export const WebVitalDefinitions: Array<WebVitalDefinition> = [
  {
    key: "lcp",
    label: "Largest Contentful Paint",
    description:
      "How long until the biggest image or block of text on screen has rendered - roughly when the page looks loaded to the visitor.",
    unit: "ms",
    thresholds: { warn: 2500, danger: 4000 },
    names: [
      "web_vital.lcp",
      "browser.largest_contentful_paint",
      "largest_contentful_paint",
      "web.vitals.lcp",
    ],
  },
  {
    key: "inp",
    label: "Interaction to Next Paint",
    description:
      "How quickly the page reacts to clicks, taps and key presses: the delay before the screen visibly updates, for close to the slowest interaction on the page.",
    unit: "ms",
    thresholds: { warn: 200, danger: 500 },
    names: [
      "web_vital.inp",
      "browser.interaction_to_next_paint",
      "interaction_to_next_paint",
      "web.vitals.inp",
    ],
  },
  {
    key: "cls",
    label: "Cumulative Layout Shift",
    description:
      "How much the page jumps around while it loads - content moving under the visitor's cursor or finger. A score, not a time: lower is better and 0 means nothing moved.",
    unit: "score",
    thresholds: { warn: 0.1, danger: 0.25 },
    names: [
      "web_vital.cls",
      "browser.cumulative_layout_shift",
      "cumulative_layout_shift",
      "web.vitals.cls",
    ],
  },
  {
    key: "fcp",
    label: "First Contentful Paint",
    description:
      "How long until the first text or image appears, so the visitor can see the page has started loading.",
    unit: "ms",
    thresholds: { warn: 1800, danger: 3000 },
    names: [
      "web_vital.fcp",
      "browser.first_contentful_paint",
      "first_contentful_paint",
      "web.vitals.fcp",
    ],
  },
  {
    key: "ttfb",
    label: "Time to First Byte",
    description:
      "How long the browser waited for the first byte of the page from your server, including redirects, looking up the address and connecting.",
    unit: "ms",
    thresholds: { warn: 800, danger: 1800 },
    names: [
      "web_vital.ttfb",
      "browser.time_to_first_byte",
      "time_to_first_byte",
      "web.vitals.ttfb",
    ],
  },
];

// A threshold the way a person would say it: "2.5 s", "800 ms", "0.1".
export function formatWebVitalThreshold(
  value: number,
  unit: WebVitalDefinition["unit"],
): string {
  if (unit === "score") {
    return String(value);
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  return `${Number((value / 1000).toFixed(2))} s`;
}

/*
 * The Good / Poor limits in words, matching how the overview rates a value:
 * below `warn` is Good, at or above `danger` is Poor, and anything between
 * needs work.
 */
export function describeWebVitalThresholds(
  definition: Pick<WebVitalDefinition, "unit" | "thresholds">,
): string {
  const warn: string = formatWebVitalThreshold(
    definition.thresholds.warn,
    definition.unit,
  );
  const danger: string = formatWebVitalThreshold(
    definition.thresholds.danger,
    definition.unit,
  );

  return `Good below ${warn}; poor at ${danger} or more.`;
}
