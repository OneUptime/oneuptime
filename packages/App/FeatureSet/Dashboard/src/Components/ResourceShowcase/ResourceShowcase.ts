import IconProp from "Common/Types/Icon/IconProp";

/*
 * What a resource list shows under its empty table while the project has
 * none of that resource: what the product gives once one is connected - a
 * pitch, an example of a connected one, and what comes with it - and the
 * list's Add button. The setup guide itself opens from Add (the list's Add
 * dialog), so an empty list no longer shows every step up front.
 *
 *   ┌ eyebrow · title · description      ┐ ┌ example: a connected one ┐
 *   │ [ Add … ]                          │ │ stats, a chart, rows      │
 *   └ three short facts about setup      ┘ └ (and the alert it raised) ┘
 *   ─ what you get: a grid of features ───────────────────────────────
 *
 * Each resource describes its own in a ResourceShowcase (Kubernetes
 * clusters, hosts, Docker and Podman hosts, Docker Swarm, Proxmox, VMware,
 * Ceph, storage arrays, IoT fleets, databases, queues, serverless
 * functions, cloud environments and RUM applications), and
 * ResourceShowcaseCard draws it. React-free, so App tests can read every
 * resource's words.
 *
 * Words are English translation keys (translationKey), looked up when they
 * are drawn. The example's own data - a name, a value, a term the software
 * itself shows ("CrashLoopBackOff") - is drawn as written in every language.
 */

export enum ShowcaseStatus {
  Healthy = "healthy",
  Warning = "warning",
  Critical = "critical",
}

export interface ShowcaseFeature {
  icon: IconProp;
  // English translation keys: "Every workload, mapped" and a sentence.
  title: string;
  description: string;
}

export interface ShowcaseStat {
  // English translation key: "Pods".
  label: string;
  // As drawn in every language: "248", "63%".
  value: string;
}

export interface ShowcaseRow {
  // The example's name, as drawn in every language: "checkout-7d9f8".
  name: string;
  // English translation key: "Deployment · payments".
  detail: string;
  status: ShowcaseStatus;
  // English translation key, or a term drawn as written: "CrashLoopBackOff".
  statusText: string;
}

// What OneUptime raised about the example: the warning row, as an alert.
export interface ShowcaseAlert {
  // English translation keys: "Incident created" and what happened.
  title: string;
  description: string;
}

export interface ShowcaseChart {
  // English translation key: "CPU usage".
  label: string;
  // The line's shape, left to right; any scale.
  values: Array<number>;
}

// A connected one, as its overview shows it: an example, not the project's.
export interface ShowcasePreview {
  // As drawn in every language: "prod-eu-west".
  name: string;
  // English translation key: "Kubernetes 1.30 · 3 nodes".
  subtitle: string;
  // Four, as the overview's tiles.
  stats: Array<ShowcaseStat>;
  chart: ShowcaseChart;
  // Three or four, one of them in trouble.
  rows: Array<ShowcaseRow>;
  alert?: ShowcaseAlert | undefined;
}

export interface ResourceShowcase {
  // The product's icon, as in the navigation.
  icon: IconProp;
  // English translation keys.
  eyebrow: string;
  title: string;
  description: string;
  // Three short facts about getting started: "One Helm command".
  highlights: Array<string>;
  // Six, in the order they are read.
  features: Array<ShowcaseFeature>;
  preview: ShowcasePreview;
}

// ---- the example's chart ---------------------------------------------------

export interface ShowcaseChartPaths {
  // The line itself.
  line: string;
  // The line, closed along the bottom: the area under it.
  area: string;
}

/*
 * How far the line stays from the box's top and bottom, so its stroke is
 * never cut by the edge.
 */
export const SHOWCASE_CHART_INSET: number = 2;

const toCoordinate: (value: number) => string = (value: number): string => {
  return Number(value.toFixed(2)).toString();
};

/**
 * The SVG paths of a chart's values in a width × height box: a smooth line
 * through every value (Catmull-Rom, as cubic Béziers), its highest value
 * near the top of the box and its lowest near the bottom, and the area under
 * it. A flat line - or a single value - runs through the middle; no values
 * draw nothing.
 */
export function getShowcaseChartPaths(data: {
  values: Array<number>;
  width: number;
  height: number;
}): ShowcaseChartPaths {
  const values: Array<number> = data.values.filter((value: number) => {
    return Number.isFinite(value);
  });

  if (values.length === 0) {
    return { line: "", area: "" };
  }

  const series: Array<number> =
    values.length === 1 ? [values[0]!, values[0]!] : values;

  const min: number = Math.min(...series);
  const max: number = Math.max(...series);
  const top: number = SHOWCASE_CHART_INSET;
  const bottom: number = data.height - SHOWCASE_CHART_INSET;
  const step: number = data.width / (series.length - 1);

  const points: Array<{ x: number; y: number }> = series.map(
    (value: number, index: number): { x: number; y: number } => {
      const share: number = max === min ? 0.5 : (value - min) / (max - min);
      return {
        x: index * step,
        y: bottom - share * (bottom - top),
      };
    },
  );

  let line: string = `M${toCoordinate(points[0]!.x)} ${toCoordinate(points[0]!.y)}`;

  for (let index: number = 1; index < points.length; index++) {
    const previous: { x: number; y: number } = points[index - 1]!;
    const current: { x: number; y: number } = points[index]!;
    const before: { x: number; y: number } = points[index - 2] || previous;
    const after: { x: number; y: number } = points[index + 1] || current;

    // Control points a sixth of the way along the neighbours' chord.
    const firstX: number = previous.x + (current.x - before.x) / 6;
    const firstY: number = clamp(
      previous.y + (current.y - before.y) / 6,
      top,
      bottom,
    );
    const secondX: number = current.x - (after.x - previous.x) / 6;
    const secondY: number = clamp(
      current.y - (after.y - previous.y) / 6,
      top,
      bottom,
    );

    line += ` C${toCoordinate(firstX)} ${toCoordinate(firstY)} ${toCoordinate(
      secondX,
    )} ${toCoordinate(secondY)} ${toCoordinate(current.x)} ${toCoordinate(
      current.y,
    )}`;
  }

  const lastX: string = toCoordinate(points[points.length - 1]!.x);
  const firstX: string = toCoordinate(points[0]!.x);
  const area: string = `${line} L${lastX} ${toCoordinate(
    data.height,
  )} L${firstX} ${toCoordinate(data.height)} Z`;

  return { line, area };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
