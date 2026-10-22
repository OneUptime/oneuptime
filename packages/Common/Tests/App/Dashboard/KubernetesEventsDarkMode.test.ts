import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * The Kubernetes Events views in the dark theme (issue #5179): the cluster's
 * Events page, a node's or a workload's Events tab, the table they share and
 * the Overview's Recent Warnings.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * - a near-white pill on a slate panel - and nothing fails
 * (Tests/Helpers/DarkModeScan). So every colour class they draw with is held
 * to what Theme.css remaps.
 */

// Relative to Common/UI, where the scan reads from.
const DASHBOARD: string = "../../App/FeatureSet/Dashboard/src";

const FILES: Array<string> = [
  `${DASHBOARD}/Components/Kubernetes/KubernetesEventsTable.tsx`,
  `${DASHBOARD}/Components/Kubernetes/KubernetesEventsTab.tsx`,
  `${DASHBOARD}/Components/Kubernetes/KubernetesRecentWarningsCard.tsx`,
  `${DASHBOARD}/Pages/Kubernetes/View/Events.tsx`,
];

describe("the Kubernetes Events views in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // A warning's icon, its Warning pill and the Overview's count.
        "text-amber-500",
        "bg-amber-50",
        "text-amber-800",
        "ring-amber-200",
        "bg-amber-100",
        "text-amber-700",
        // A Normal event's pill and icon.
        "bg-gray-100",
        "text-gray-600",
        "text-gray-400",
        // The object's link.
        "text-indigo-600",
        // The refresh that failed.
        "bg-red-50",
        "text-red-700",
      ]),
    );
    expect(scan.unmapped).toEqual([]);
  });
});
