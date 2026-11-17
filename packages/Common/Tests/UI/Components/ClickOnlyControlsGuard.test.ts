// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  ClickOnlyElementInSource,
  clickOnlyKey,
  scanClickOnlyElements,
} from "../../Helpers/ClickOnlyControlsScan";

/*
 * Nothing is pressed with a mouse alone. A `div`, `li` or `span` handed an
 * onClick and nothing else is out of a keyboard's reach and is read as text:
 * every item in the header's notification bell, going back to a finished
 * step of a form, and a chart legend's series were like that (#9136). Draw a
 * `<button type="button">` or a link. See Tests/Helpers/ClickOnlyControlsScan
 * for what is read and what counts as reachable.
 *
 * The shared components (Common/UI/Components) hold none but those listed
 * below with their reason. The apps hold no more than STILL_TO_FIX allows a
 * file, a count that may only fall.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SHARED_COMPONENTS: string = "packages/Common/UI/Components/";

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

/*
 * The clicks kept on purpose in the shared components, by file, each with
 * its reason: a keyboard does the same another way. An entry whose element
 * is gone fails the guard, so the list cannot outlive what it excuses.
 */
const DELIBERATE: Record<string, { elements: Array<string>; reason: string }> =
  {
    "packages/Common/UI/Components/Modal/Modal.tsx": {
      elements: ["div"],
      reason:
        "The backdrop: a click outside the dialog closes it, as Escape and its Close button do from the keyboard.",
    },
    "packages/Common/UI/Components/CommandPalette/CommandPalette.tsx": {
      elements: ["div"],
      reason:
        "The backdrop: a click outside the palette closes it, as Escape does from the keyboard.",
    },
    "packages/Common/UI/Components/Navbar/NavBarMenuModal.tsx": {
      elements: ["div"],
      reason:
        "The backdrop: a click outside the products menu closes it, as Escape does from the keyboard.",
    },
    "packages/Common/UI/Components/TelemetryViewer/components/TelemetryDetailPanel.tsx":
      {
        elements: ["div"],
        reason:
          "The floating panel's transparent backdrop: a click outside closes it, as Escape and its Close button do from the keyboard.",
      },
    "packages/Common/UI/Components/SideMenu/SideMenu.tsx": {
      elements: ["div", "nav"],
      reason:
        "The phone menu's backdrop (the menu button, which opened it, closes it again from the keyboard), and the menu's list, which hears its links' clicks to close itself after one is followed; the links are what a keyboard presses.",
    },
    "packages/Common/UI/Components/MoreMenu/MoreMenu.tsx": {
      elements: ["div[role=menu]"],
      reason:
        "The open menu hears its items' clicks to close itself; each item is a menuitem button the arrow keys move between.",
    },
    "packages/Common/UI/Components/Alerts/Alert.tsx": {
      elements: ["div[role=alert]"],
      reason:
        "A pressable alert draws a real button over its whole box, which a keyboard reaches and presses; the box's click is the same action for a click that lands on its words.",
    },
    "packages/Common/UI/Components/HiddenText/HiddenText.tsx": {
      elements: ["div[role=hidden-text]"],
      reason:
        "The reveal button inside it is what a person presses; its click reaches the box, which end-to-end specs find by its role.",
    },
    "packages/Common/UI/Components/Dropdown/Dropdown.tsx": {
      elements: ["div"],
      reason:
        "Wraps the select, which a keyboard reaches and opens itself; the wrapper hands a click on its edge on to the page.",
    },
    "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx": {
      elements: ["div[role=presentation]"],
      reason:
        "The search box's frame: a click on its padding focuses the input inside it, which Tab reaches directly.",
    },
    "packages/Common/UI/Components/TimePicker/TimePicker.tsx": {
      elements: ["div[role=group]"],
      reason:
        "A click anywhere on the time field opens its dialog; from the keyboard the field's own button opens it.",
    },
    "packages/Common/UI/Components/Forms/Fields/IconPicker.tsx": {
      elements: ["div"],
      reason:
        "The chosen icon's preview, hidden from a screen reader: a click on it opens the picker, which the field beside it opens from the keyboard.",
    },
    "packages/Common/UI/Components/CodeEditor/CodeEditor.tsx": {
      elements: ["div"],
      reason:
        "Hands a click anywhere on the editor to the page; the editor's text area is what a keyboard reaches.",
    },
    "packages/Common/UI/Components/Detail/DetailIdLine.tsx": {
      elements: ["span"],
      reason:
        "A click on an ID copies it, a shortcut for the Copy button beside it, which a keyboard reaches and presses.",
    },
    "packages/Common/UI/Components/Glossary/DefinedTerm.tsx": {
      elements: ["div"],
      reason:
        "The definition's popover keeps a click on its words from reaching the label or card its word is drawn in; it does nothing a person asked for.",
    },
    "packages/Common/UI/Components/ModelList/StaticModelList.tsx": {
      elements: ["div"],
      reason:
        "A row given a role, a tabIndex and its keys in rowControlProps, spread onto it, which the scan cannot read.",
    },
    "packages/Common/UI/Components/LogsViewer/components/LogsTable.tsx": {
      elements: ["tr"],
      reason:
        "A log row: the logs viewer moves between rows with the arrow keys and j/k and opens the focused one with Enter (LogsViewer's keyboard shortcuts).",
    },
  };

/*
 * Clicks in the shared components a keyboard cannot do yet, each with the
 * follow-up that fixes it. Fixed, an entry fails the guard until it is
 * taken off.
 */
const KNOWN_GAPS: Record<string, { elements: Array<string>; issue: number }> = {
  "packages/Common/UI/Components/Table/TableRow.tsx": {
    elements: ["div", "td"],
    issue: 9223,
  },
  "packages/Common/UI/Components/Workflow/Component.tsx": {
    elements: ["div", "div"],
    issue: 9223,
  },
  "packages/Common/UI/Components/Icon/Icon.tsx": {
    elements: ["svg"],
    issue: 6922,
  },
};

/*
 * The apps' click-only elements, by file: how many each may still hold.
 * Lower a count (or take the file off) as you fix them (#9222); a new one,
 * or a new file, fails the guard.
 */
const STILL_TO_FIX: Record<string, number> = {
  "packages/App/FeatureSet/Accounts/src/Pages/Login.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/AI/AiOffSummary.tsx": 2,
  "packages/App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPanel.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/CallSMS/PhoneNumberPurchase.tsx": 2,
  "packages/App/FeatureSet/Dashboard/src/Components/Code/CodeTaskList.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDevicesTable.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/TransceiverHealthCard.tsx": 2,
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkEvents/NetworkEventsTimeline.tsx": 2,
  "packages/App/FeatureSet/Dashboard/src/Components/NetworkTraffic/TrafficConversationDiagram.tsx": 2,
  "packages/App/FeatureSet/Dashboard/src/Components/ProductAnalytics/ProductAnalyticsPeopleCard.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/Profiles/DiffFlamegraph.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/Profiles/FlamegraphView.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/Profiles/FunctionFocusPanel.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchBar.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer.tsx": 2,
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/FlameGraph.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceOperations.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceExplorer.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Pages/Code/Repositories.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Pages/IoT/View/Index.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index.tsx": 3,
  "packages/App/FeatureSet/Dashboard/src/Pages/Proxmox/View/Index.tsx": 3,
  "packages/App/FeatureSet/Dashboard/src/Pages/SecurityEvents/HuntLibrary.tsx": 1,
  "packages/App/FeatureSet/Dashboard/src/Pages/SecurityEvents/RuleLibrary.tsx": 1,
};

let cachedScan: Array<ClickOnlyElementInSource> | null = null;

function scanProject(): Array<ClickOnlyElementInSource> {
  if (cachedScan) {
    return cachedScan;
  }

  const files: Array<string> = listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    });

  cachedScan = files.flatMap((file: string) => {
    return scanClickOnlyElements(relative(file), fs.readFileSync(file, "utf8"));
  });

  return cachedScan;
}

function elementsByFile(
  found: Array<ClickOnlyElementInSource>,
): Map<string, Array<string>> {
  const byFile: Map<string, Array<string>> = new Map<string, Array<string>>();

  for (const element of found) {
    byFile.set(element.file, [
      ...(byFile.get(element.file) || []),
      clickOnlyKey(element),
    ]);
  }

  return byFile;
}

function sorted(list: Array<string>): Array<string> {
  return [...list].sort();
}

describe("the detector", () => {
  function scan(jsx: string): Array<string> {
    return scanClickOnlyElements(
      "Example.tsx",
      `import React from "react";\nexport const X = () => (\n${jsx}\n);\n`,
    ).map(clickOnlyKey);
  }

  test.each([
    [
      "a div with a click (the bell's items)",
      '<div className="cursor-pointer" onClick={open}>Incidents</div>',
      "div",
    ],
    [
      "an li with a click (a form's finished step)",
      "<li onClick={() => { go(step); }}>Monitor Info</li>",
      "li",
    ],
    [
      "a span with a click (copy on click)",
      "<span onClick={copy}>abc123</span>",
      "span",
    ],
    [
      "a role=button without a tabIndex",
      '<div role="button" onClick={open} onKeyDown={keys}>x</div>',
      "div[role=button]",
    ],
    [
      "a role=button with a tabIndex but no keys",
      '<div role="button" tabIndex={0} onClick={open}>x</div>',
      "div[role=button]",
    ],
    [
      "a role that is not a control",
      '<div role="group" tabIndex={0} onKeyDown={keys} onClick={open}>x</div>',
      "div[role=group]",
    ],
    ["a picture with a click", '<img src="a.png" onClick={open} />', "img"],
    [
      "a click that does more than stop the event",
      "<div onClick={(e) => { e.stopPropagation(); open(); }}>x</div>",
      "div",
    ],
  ])("flags %s", (_name: string, jsx: string, expected: string) => {
    expect(scan(jsx)).toEqual([expected]);
  });

  test.each([
    ["a button", '<button type="button" onClick={open}>x</button>'],
    ["a link", '<a href="/x" onClick={track}>x</a>'],
    ["a label around its input", "<label onClick={x}><input /></label>"],
    [
      "a control written by hand: role, tabIndex and keys",
      '<div role="button" tabIndex={0} onKeyDown={keys} onClick={open}>x</div>',
    ],
    [
      "a role given only when it does something",
      '<div role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={keys} onClick={onClick}>x</div>',
    ],
    [
      "an option its listbox drives",
      '<li role="option" aria-selected={a} onClick={pick}>x</li>',
    ],
    [
      "a click that only stops the event",
      "<div onClick={(e) => { e.stopPropagation(); }}>x</div>",
    ],
    [
      "a click that only stops the event, as an expression",
      "<div onClick={(e) => e.stopPropagation()}>x</div>",
    ],
    ["a component handed a click", "<Card onClick={open} />"],
    ["a div with no click", '<div className="cursor-pointer">x</div>'],
  ])("lets through %s", (_name: string, jsx: string) => {
    expect(scan(jsx)).toEqual([]);
  });

  test("reports the element's line", () => {
    const found: Array<ClickOnlyElementInSource> = scanClickOnlyElements(
      "Example.tsx",
      [
        "export const X = () => (",
        "  <section>",
        "    <div onClick={go} />",
        "  </section>",
        ");",
      ].join("\n"),
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.line).toBe(3);
  });
});

describe("clicks across the project", () => {
  test("the scan reads the shared components and the pages", () => {
    const files: Set<string> = new Set<string>(
      listScanRoots(REPOSITORY_ROOT).flatMap(listSourceFiles).map(relative),
    );

    for (const expected of [
      "packages/Common/UI/Components/HeaderAlert/NotificationBell/NotificationBellItem.tsx",
      "packages/Common/UI/Components/Forms/Steps/Step.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index.tsx",
      "packages/App/FeatureSet/StatusPage/src/App.tsx",
    ]) {
      expect(files).toContain(expected);
    }
  });

  test("no shared component is pressed with a mouse alone", () => {
    const byFile: Map<string, Array<string>> = elementsByFile(
      scanProject().filter((element: ClickOnlyElementInSource): boolean => {
        return element.file.startsWith(SHARED_COMPONENTS);
      }),
    );

    const offenders: Array<string> = [];

    for (const [file, elements] of byFile) {
      const allowed: Array<string> = [
        ...(DELIBERATE[file]?.elements || []),
        ...(KNOWN_GAPS[file]?.elements || []),
      ];

      if (sorted(elements).join(",") !== sorted(allowed).join(",")) {
        offenders.push(
          ...scanProject()
            .filter((element: ClickOnlyElementInSource): boolean => {
              return element.file === file;
            })
            .map((element: ClickOnlyElementInSource): string => {
              return `${element.file}:${element.line} ${clickOnlyKey(element)}`;
            }),
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  test("every listed click is still drawn, with its reason or its issue", () => {
    const byFile: Map<string, Array<string>> = elementsByFile(scanProject());

    for (const [file, entry] of Object.entries(DELIBERATE)) {
      expect(entry.reason.length).toBeGreaterThan(40);

      for (const element of entry.elements) {
        expect(byFile.get(file) || []).toContain(element);
      }
    }

    for (const [file, entry] of Object.entries(KNOWN_GAPS)) {
      expect(entry.issue).toBeGreaterThan(0);
      expect(sorted(byFile.get(file) || [])).toEqual(
        expect.arrayContaining(sorted(entry.elements)),
      );
    }
  });

  test("the apps hold no more mouse-only clicks than they did", () => {
    const counts: Map<string, number> = new Map<string, number>();

    for (const element of scanProject()) {
      if (element.file.startsWith(SHARED_COMPONENTS)) {
        continue;
      }

      counts.set(element.file, (counts.get(element.file) || 0) + 1);
    }

    const over: Array<string> = [];

    for (const [file, count] of counts) {
      if (count > (STILL_TO_FIX[file] || 0)) {
        over.push(
          ...scanProject()
            .filter((element: ClickOnlyElementInSource): boolean => {
              return element.file === file;
            })
            .map((element: ClickOnlyElementInSource): string => {
              return `${element.file}:${element.line} ${clickOnlyKey(element)}`;
            }),
        );
      }
    }

    expect(over).toEqual([]);

    // A count that fell is lowered here, so it cannot climb back.
    for (const [file, allowed] of Object.entries(STILL_TO_FIX)) {
      expect(`${file}: ${counts.get(file) || 0}`).toBe(`${file}: ${allowed}`);
    }
  });

  /*
   * The ones this rule was written for (#9136). None may come back, and
   * none may become an exception.
   */
  test("the controls this rule was written for stay real controls", () => {
    for (const file of [
      "packages/Common/UI/Components/HeaderAlert/NotificationBell/NotificationBellItem.tsx",
      "packages/Common/UI/Components/HeaderAlert/HeaderAlert.tsx",
      "packages/Common/UI/Components/Forms/Steps/Step.tsx",
      "packages/Common/UI/Components/IconText/IconText.tsx",
      "packages/Common/UI/Components/ProgressButtons/ProgressButtonItem.tsx",
      "packages/Common/UI/Components/CSVFileUpload/CSVFileUpload.tsx",
      "packages/Common/UI/Components/Graphs/UptimeBarTooltip.tsx",
      "packages/Common/UI/Components/Charts/ChartLibrary/AreaChart/AreaChart.tsx",
      "packages/Common/UI/Components/Charts/ChartLibrary/BarChart/BarChart.tsx",
      "packages/Common/UI/Components/Charts/ChartLibrary/LineChart/LineChart.tsx",
      "packages/Common/UI/Components/Image/Image.tsx",
      "packages/Common/UI/Components/ProductLogo/ProductLogo.tsx",
    ]) {
      expect(DELIBERATE[file]).toBeUndefined();
      expect(KNOWN_GAPS[file]).toBeUndefined();
      expect(
        scanClickOnlyElements(
          file,
          fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
        ).map(clickOnlyKey),
      ).toEqual([]);
    }
  });
});
