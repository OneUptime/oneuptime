export interface WebVitalDefinition {
  key: string;
  label: string;
  unit: "ms" | "score";
  thresholds: { warn: number; danger: number };
  names: Array<string>;
}

// Ordered aliases recognized by the RUM overview and the AI assistant.
export const WebVitalDefinitions: Array<WebVitalDefinition> = [
  {
    key: "lcp",
    label: "Largest Contentful Paint",
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
