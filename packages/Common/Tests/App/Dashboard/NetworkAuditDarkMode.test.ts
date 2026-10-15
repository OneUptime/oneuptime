import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * The Network surfaces the audit added or redrew, in the dark theme.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour -
 * a near-white box on a slate panel - and nothing fails (Tests/Helpers/
 * DarkModeScan). So every colour class these draw with is held to what
 * Theme.css remaps: the first-run path and its step markers, the Add a probe
 * dialog's run step and connection line, the vendor template offer, the
 * neighbour list, the device hero's Monitor Status tile, the Monitors card,
 * the scan's credentials step, the empty map card and the Overview.
 */

// Relative to Common/UI, where the scan reads from.
const DASHBOARD: string = "../../App/FeatureSet/Dashboard/src";

const FILES: Array<string> = [
  `${DASHBOARD}/Components/Network/NetworkGetStarted.tsx`,
  `${DASHBOARD}/Components/Network/AddProbeModal.tsx`,
  `${DASHBOARD}/Components/NetworkDevice/DeviceVendorTemplateBanner.tsx`,
  `${DASHBOARD}/Components/NetworkDevice/DeviceAttachmentCard.tsx`,
  `${DASHBOARD}/Components/NetworkDevice/DeviceStatusHero.tsx`,
  `${DASHBOARD}/Components/NetworkDevice/DeviceMonitorsCard.tsx`,
  `${DASHBOARD}/Components/NetworkDevice/SnmpConfigListEditor.tsx`,
  `${DASHBOARD}/Components/Topology/NetworkTopologyEmptyState.tsx`,
  `${DASHBOARD}/Pages/NetworkDevice/Overview.tsx`,
];

describe("the audited Network surfaces in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The first-run path: the step numbers, the ticks, the status lines.
        "bg-indigo-50",
        "text-indigo-700",
        "bg-emerald-50",
        "text-emerald-600",
        "text-emerald-700",
        // The waiting probe's pulse: a mid-tone, the same in both themes.
        "bg-indigo-500",
        // The scan's credentials step, when a set is refused.
        "text-red-600",
        // The dialog's connection line, waiting and connected.
        "border-gray-200",
        "bg-gray-50",
        "text-gray-600",
        "border-emerald-200",
        "text-emerald-800",
        // The links.
        "text-indigo-600",
        // Words.
        "text-gray-900",
        "text-gray-500",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
