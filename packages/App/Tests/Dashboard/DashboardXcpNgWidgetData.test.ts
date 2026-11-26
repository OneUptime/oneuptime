import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "Common/Types/Translator";
import {
  XcpNgHostPowerState,
  XcpNgVmPowerState,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import {
  XCP_NG_DISABLED_TEXT,
  XCP_NG_HALTED_TEXT,
  XCP_NG_NOT_RUNNING_TEXT,
  XCP_NG_PAUSED_TEXT,
  XCP_NG_RUNNING_TEXT,
  XCP_NG_SUSPENDED_TEXT,
  XCP_NG_UNKNOWN_TEXT,
  XCP_NG_WIDGET_COLORS,
  XcpNgWidgetLegendItem,
  XcpNgWidgetState,
  formatXcpNgPercent,
  getXcpNgHostLegend,
  getXcpNgHostState,
  getXcpNgPercentTextColor,
  getXcpNgVmLegend,
  getXcpNgVmState,
  toFiniteNumber,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/XcpNgWidgetData";

/*
 * What the XCP-ng host and VM dashboard widgets draw for each row: the
 * state Xen Orchestra reports (xcp_host_status / xcp_vm_status, folded by
 * ingest into XcpNgResource's isUp, isEnabled and powerState), its color,
 * and the row's CPU and memory figures. An operator scans these widgets for
 * the one red tile, so a host that is not running must read red and a VM
 * someone halted on purpose must not.
 */

// English as the page draws it: every key reads as itself.
const ENGLISH: Translator = createTranslator(undefined, "en");

// A reader whose every lookup is marked, so a word looked up shows it.
const MARKED: Translator = createTranslator((text: string): string => {
  return `«${text}»`;
}, "de");

const PERSIAN: Translator = createTranslator((text: string): string => {
  return text;
}, "fa");

const GERMAN: Translator = createTranslator((text: string): string => {
  return text;
}, "de");

const LATIN_DIGIT: RegExp = /[0-9]/;

describe("toFiniteNumber", () => {
  test("reads numbers and numeric strings, and nothing else", () => {
    expect(toFiniteNumber(12)).toBe(12);
    expect(toFiniteNumber("42.5")).toBe(42.5);
    expect(toFiniteNumber(0)).toBe(0);
    for (const value of [undefined, null, "", "abc", NaN, Infinity]) {
      expect(toFiniteNumber(value)).toBeUndefined();
    }
  });
});

describe("a host's state", () => {
  test("a running, enabled host is green", () => {
    const state: XcpNgWidgetState = getXcpNgHostState(
      { isUp: true, isEnabled: true, powerState: XcpNgHostPowerState.Running },
      ENGLISH,
    );

    expect(state.text).toBe("Running");
    expect(state.color).toBe(XCP_NG_WIDGET_COLORS.running);
    expect(state.textColor).toContain("success");
  });

  test("a running host Xen Orchestra has not said is enabled or not is still running", () => {
    expect(getXcpNgHostState({ isUp: true }, ENGLISH).text).toBe("Running");
    expect(
      getXcpNgHostState({ isUp: true, isEnabled: null }, ENGLISH).text,
    ).toBe("Running");
  });

  test("a disabled host - maintenance mode - is amber, though it runs", () => {
    const state: XcpNgWidgetState = getXcpNgHostState(
      { isUp: true, isEnabled: false, powerState: XcpNgHostPowerState.Running },
      ENGLISH,
    );

    expect(state.text).toBe("Disabled");
    expect(state.color).toBe(XCP_NG_WIDGET_COLORS.disabled);
    expect(state.textColor).toContain("warning");
  });

  test("a halted host is red, named as Xen Orchestra names it", () => {
    const state: XcpNgWidgetState = getXcpNgHostState(
      { isUp: false, isEnabled: true, powerState: XcpNgHostPowerState.Halted },
      ENGLISH,
    );

    expect(state.text).toBe("Halted");
    expect(state.color).toBe(XCP_NG_WIDGET_COLORS.notRunning);
    expect(state.textColor).toContain("danger");
  });

  test("a host the pool master lost is red too, and Unknown, as Xen Orchestra says", () => {
    for (const powerState of [XcpNgHostPowerState.Unknown, null, "Weird"]) {
      const state: XcpNgWidgetState = getXcpNgHostState(
        { isUp: false, powerState: powerState },
        ENGLISH,
      );

      expect({ powerState, text: state.text, color: state.color }).toEqual({
        powerState,
        text: "Unknown",
        color: XCP_NG_WIDGET_COLORS.notRunning,
      });
    }
  });

  test("a disabled host that stopped running reads not running: that is the worse news", () => {
    expect(
      getXcpNgHostState(
        {
          isUp: false,
          isEnabled: false,
          powerState: XcpNgHostPowerState.Halted,
        },
        ENGLISH,
      ).text,
    ).toBe("Halted");
  });

  test("a host Xen Orchestra has said nothing about has no status yet, in gray", () => {
    for (const row of [{}, { isUp: null }, { isUp: undefined }]) {
      const state: XcpNgWidgetState = getXcpNgHostState(row, ENGLISH);

      expect(state.text).toBe("No status yet");
      expect(state.color).toBe(XCP_NG_WIDGET_COLORS.noStatus);
      expect(state.textColor).toContain("muted");
    }
  });

  test("its words are the reader's, looked up once", () => {
    expect(getXcpNgHostState({ isUp: true }, MARKED).text).toBe("«Running»");
    expect(
      getXcpNgHostState({ isUp: true, isEnabled: false }, MARKED).text,
    ).toBe("«Disabled»");
    expect(
      getXcpNgHostState(
        { isUp: false, powerState: XcpNgHostPowerState.Halted },
        MARKED,
      ).text,
    ).toBe("«Halted»");
    expect(getXcpNgHostState({ isUp: false }, MARKED).text).toBe("«Unknown»");
    expect(getXcpNgHostState({}, MARKED).text).toBe("«No status yet»");
  });
});

describe("a VM's state", () => {
  test("a running VM is green", () => {
    const state: XcpNgWidgetState = getXcpNgVmState(
      { isUp: true, powerState: XcpNgVmPowerState.Running },
      ENGLISH,
    );

    expect(state.text).toBe("Running");
    expect(state.color).toBe(XCP_NG_WIDGET_COLORS.running);
  });

  test("a halted VM is gray, never red: halting one is often meant", () => {
    const state: XcpNgWidgetState = getXcpNgVmState(
      { isUp: false, powerState: XcpNgVmPowerState.Halted },
      ENGLISH,
    );

    expect(state.text).toBe("Halted");
    expect(state.color).toBe(XCP_NG_WIDGET_COLORS.halted);
    expect(state.color).not.toBe(XCP_NG_WIDGET_COLORS.notRunning);
  });

  test("a paused VM is amber: it holds its memory and runs nothing", () => {
    const state: XcpNgWidgetState = getXcpNgVmState(
      { isUp: false, powerState: XcpNgVmPowerState.Paused },
      ENGLISH,
    );

    expect(state.text).toBe("Paused");
    expect(state.color).toBe(XCP_NG_WIDGET_COLORS.paused);
    expect(state.textColor).toContain("warning");
  });

  test("a suspended VM is someone's choice, in its own color", () => {
    const state: XcpNgWidgetState = getXcpNgVmState(
      { isUp: false, powerState: XcpNgVmPowerState.Suspended },
      ENGLISH,
    );

    expect(state.text).toBe("Suspended");
    expect(state.color).toBe(XCP_NG_WIDGET_COLORS.suspended);
    expect(state.textColor).toContain("muted");
  });

  test("a VM not running in a state this version does not know reads not running", () => {
    expect(
      getXcpNgVmState({ isUp: false, powerState: "Crashed" }, ENGLISH).text,
    ).toBe("Not running");
    expect(getXcpNgVmState({ isUp: false }, ENGLISH).text).toBe("Not running");
  });

  test("its up flag wins over a stale power state", () => {
    expect(
      getXcpNgVmState(
        { isUp: true, powerState: XcpNgVmPowerState.Halted },
        ENGLISH,
      ).text,
    ).toBe("Running");
  });

  test("a VM Xen Orchestra has said nothing about has no status yet", () => {
    const state: XcpNgWidgetState = getXcpNgVmState({}, ENGLISH);

    expect(state.text).toBe("No status yet");
    expect(state.color).toBe(XCP_NG_WIDGET_COLORS.noStatus);
  });

  test("its words are the reader's, looked up once", () => {
    expect(
      getXcpNgVmState(
        { isUp: false, powerState: XcpNgVmPowerState.Suspended },
        MARKED,
      ).text,
    ).toBe("«Suspended»");
    expect(getXcpNgVmState({ isUp: false }, MARKED).text).toBe("«Not running»");
  });
});

describe("the legends", () => {
  const labels: (items: Array<XcpNgWidgetLegendItem>) => Array<string> = (
    items: Array<XcpNgWidgetLegendItem>,
  ): Array<string> => {
    return items.map((item: XcpNgWidgetLegendItem): string => {
      return item.label;
    });
  };

  test("the host legend names each color a host tile takes", () => {
    const legend: Array<XcpNgWidgetLegendItem> = getXcpNgHostLegend(ENGLISH);

    expect(labels(legend)).toEqual([
      "Running",
      "Disabled",
      "Not running",
      "No status yet",
    ]);

    const colors: Array<string> = legend.map(
      (item: XcpNgWidgetLegendItem): string => {
        return item.color;
      },
    );

    for (const row of [
      { isUp: true },
      { isUp: true, isEnabled: false },
      { isUp: false, powerState: XcpNgHostPowerState.Halted },
      { isUp: false },
      {},
    ]) {
      expect(colors).toContain(getXcpNgHostState(row, ENGLISH).color);
    }

    // No two entries share a color: each color says one thing.
    expect(new Set(colors).size).toBe(colors.length);
  });

  test("the VM legend names each color a VM tile takes", () => {
    const legend: Array<XcpNgWidgetLegendItem> = getXcpNgVmLegend(ENGLISH);

    expect(labels(legend)).toEqual([
      "Running",
      "Paused",
      "Suspended",
      "Halted",
      "No status yet",
    ]);

    const colors: Array<string> = legend.map(
      (item: XcpNgWidgetLegendItem): string => {
        return item.color;
      },
    );

    for (const powerState of Object.values(XcpNgVmPowerState)) {
      expect(colors).toContain(
        getXcpNgVmState(
          {
            isUp: powerState === XcpNgVmPowerState.Running,
            powerState: powerState,
          },
          ENGLISH,
        ).color,
      );
    }

    expect(colors).toContain(getXcpNgVmState({}, ENGLISH).color);
  });

  test("both legends are worded in the reader's language and say so", () => {
    for (const legend of [
      getXcpNgHostLegend(MARKED),
      getXcpNgVmLegend(MARKED),
    ]) {
      for (const item of legend) {
        expect(item.label.startsWith("«")).toBe(true);
        // Already worded: the honeycomb must not look it up again.
        expect(item.isLabelUserContent).toBe(true);
      }
    }
  });
});

describe("the states' words are keys of the locales", () => {
  test("each is the English word it reads as", () => {
    expect([
      XCP_NG_RUNNING_TEXT,
      XCP_NG_DISABLED_TEXT,
      XCP_NG_HALTED_TEXT,
      XCP_NG_UNKNOWN_TEXT,
      XCP_NG_PAUSED_TEXT,
      XCP_NG_SUSPENDED_TEXT,
      XCP_NG_NOT_RUNNING_TEXT,
    ]).toEqual([
      "Running",
      "Disabled",
      "Halted",
      "Unknown",
      "Paused",
      "Suspended",
      "Not running",
    ]);
  });

  test("Xen Orchestra's power states are the words the widgets draw", () => {
    expect(XCP_NG_RUNNING_TEXT).toBe(XcpNgHostPowerState.Running);
    expect(XCP_NG_HALTED_TEXT).toBe(XcpNgHostPowerState.Halted);
    expect(XCP_NG_UNKNOWN_TEXT).toBe(XcpNgHostPowerState.Unknown);
    expect(XCP_NG_PAUSED_TEXT).toBe(XcpNgVmPowerState.Paused);
    expect(XCP_NG_SUSPENDED_TEXT).toBe(XcpNgVmPowerState.Suspended);
  });
});

describe("a row's CPU and memory figures", () => {
  test("are written with one decimal and a percent sign", () => {
    expect(formatXcpNgPercent(42.54, ENGLISH)).toBe("42.5%");
    expect(formatXcpNgPercent("7", ENGLISH)).toBe("7.0%");
    expect(formatXcpNgPercent(0, ENGLISH)).toBe("0.0%");
  });

  test("a figure not reported is the quiet mark, never 0%", () => {
    for (const value of [undefined, null, "", "abc"]) {
      expect(formatXcpNgPercent(value, ENGLISH)).toBe(EMPTY_VALUE_MARK);
    }
  });

  test("are in the reader's digits, decimal sign and percent sign", () => {
    const persian: string = formatXcpNgPercent(42.5, PERSIAN);
    const german: string = formatXcpNgPercent(42.5, GERMAN);

    expect(persian).not.toMatch(LATIN_DIGIT);
    expect(persian).toContain("٪");
    expect(german).toContain("42,5");
    expect(german).toContain("%");
  });

  test("turn amber from 70% and red from 90%, and stay muted below or unreported", () => {
    expect(getXcpNgPercentTextColor(69.9)).toContain("muted");
    expect(getXcpNgPercentTextColor(70)).toContain("warning");
    expect(getXcpNgPercentTextColor(89.9)).toContain("warning");
    expect(getXcpNgPercentTextColor(90)).toContain("danger");
    expect(getXcpNgPercentTextColor(100)).toContain("danger");
    expect(getXcpNgPercentTextColor(undefined)).toContain("muted");
    expect(getXcpNgPercentTextColor("not a number")).toContain("muted");
  });
});
