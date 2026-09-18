import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * https://github.com/OneUptime/oneuptime/issues/3867
 *
 * "The 'Test Monitor' option is currently only available inside Monitors ->
 * View Monitor -> Criteria. It is not accessible from the Monitor Overview
 * page." The action now also sits on the overview's Monitor Summary card.
 *
 * What is pinned here is the wiring that lives in props and JSX and therefore
 * cannot be rendered in the App suite's plain Node environment - above all the
 * two things that fail SILENTLY rather than loudly:
 *
 *   - the overview must keep feeding the card the monitor's OWN probes. The
 *     obvious way to build this was to copy the criteria page, which fetches
 *     every probe in the project; that is the bug issue #2899 was about, and
 *     MonitorProbeSummaryPages.test.ts guards the page against it. This file
 *     states the positive half: the test form is fed the attached list.
 *   - the overview must pass the monitor's id. Without it the server skips
 *     secret resolution entirely and the probe tests a literal
 *     {{monitorSecrets.x}} placeholder - a test that "passes" against nothing.
 *
 * Behaviour that CAN be rendered is covered in
 * Common/Tests/App/Dashboard/MonitorTestForm.test.tsx and
 * Common/Tests/App/Dashboard/MonitorSummaryTestMonitorButton.test.tsx, and the
 * rule about when the action is offered in
 * Common/Tests/Utils/Monitor/MonitorTestAvailabilityUtil.test.ts.
 *
 * Sources are whitespace-squashed first so prettier re-wrapping a line cannot
 * turn a real regression check into a red herring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

describe("the monitor overview hands the summary card what a test needs", () => {
  const source: string = readSource("Pages", "Monitor", "View", "Index.tsx");

  test("passes the monitor id down", () => {
    /*
     * The one that fails silently: the server returns the test unchanged when
     * the row carries no monitorId, so the probe requests the placeholder
     * rather than the secret.
     */
    expect(source).toContain(squash("monitorId={modelId}"));
  });

  test("still passes the monitor's own probes, not the project's", () => {
    expect(source).toContain(squash("probes={probes}"));
    expect(source).toContain(squash("disabledProbeIds={disabledProbeIds}"));
  });

  test("still does not reach for the whole project's probe list", () => {
    /*
     * Restated from MonitorProbeSummaryPages.test.ts on purpose: that file
     * guards the probe PICKER, and this feature is the most likely reason
     * somebody would reintroduce the call - the criteria page, which this
     * action was copied from, fetches exactly that list.
     */
    expect(source).not.toContain("getAllProbes");
    expect(source).not.toContain("Utils/Probe");
  });

  test("passes the steps the test would run", () => {
    expect(source).toContain(squash("monitorSteps={monitor?.monitorSteps}"));
  });
});

describe("the summary card decides when a test is offered", () => {
  const source: string = readSource(
    "Components",
    "Monitor",
    "SummaryView",
    "Summary.tsx",
  );

  test("asks the shared rule rather than spelling the conditions out", () => {
    /*
     * Three separate dead ends - a type no probe runs, no steps, no probes -
     * all have to be excluded, and two of them look identical to the user (a
     * two and a half minute wait ending in "took too long"). The rule lives in
     * Common/Utils/Monitor/MonitorTestAvailabilityUtil.ts so it is tested once
     * and cannot drift between call sites.
     */
    expect(source).toContain("MonitorTestAvailabilityUtil.isAvailable({");
    expect(source).toContain(squash("monitorType: props.monitorType,"));
    expect(source).toContain(squash("monitorSteps: props.monitorSteps,"));
    expect(source).toContain(
      squash("attachedProbeCount: attachedProbes.length,"),
    );
  });

  test("offers the test through the card's own actions slot", () => {
    /*
     * NOT through rightElement: that slot already holds the probe picker, and
     * replacing it would remove the picker with nothing to catch it.
     */
    expect(source).toContain(squash("buttons={"));
    expect(source).toContain("<MonitorTestForm");
  });

  test("keeps the probe picker in the right-hand slot", () => {
    expect(source).toContain(squash("rightElement={"));
    expect(source).toContain("<ProbePicker");
  });

  test("hands the form the monitor id it was given", () => {
    expect(source).toContain(squash("monitorId={props.monitorId}"));
  });

  test("hands the form the card's own probe list", () => {
    expect(source).toContain(squash("probes={props.probes || []}"));
  });
});

describe("the criteria page keeps its own copy of the action", () => {
  const source: string = readSource("Pages", "Monitor", "View", "Criteria.tsx");

  test("the overview is an addition, not a move", () => {
    // The issue asks for the action "as well", not instead.
    expect(source).toContain("<MonitorTestForm");
    expect(source).toContain("ProbeUtil.getAllProbes()");
  });
});

describe("the test form guards the action it exposes", () => {
  const source: string = readSource(
    "Components",
    "Form",
    "Monitor",
    "MonitorTest.tsx",
  );

  test("checks the permission the create actually needs", () => {
    /*
     * Running a test creates a MonitorTest row. Its create list excludes
     * Viewer / MonitorViewer / ReadProjectMonitor, all of which CAN open the
     * overview page - so before the gate, the widened placement would have
     * handed a guaranteed refusal to every read-only user, and only after they
     * had picked a probe and pressed Run Test.
     */
    expect(source).toContain(
      squash("PermissionGate.check( new MonitorTest(), ModelAction.Create, )"),
    );
  });

  test("declares its hooks before any early return", () => {
    /*
     * The early return for a non-probeable monitor used to sit above the
     * useState calls. One mounted instance whose monitor type resolved from
     * non-probeable to probeable would then render with a different number of
     * hooks and React would throw. Nothing in eslint catches this - there is
     * no react-hooks plugin - so it is pinned here instead.
     */
    const firstUseState: number = source.indexOf("useState<boolean>(false)");
    const earlyReturn: number = source.indexOf(
      squash("if (!isProbeable || !canRunTest) { return <></>; }"),
    );

    expect(firstUseState).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(firstUseState).toBeLessThan(earlyReturn);
  });

  test("stops its poll when the component goes away", () => {
    /*
     * The poll used to run its full budget no matter what: closing the result,
     * starting a second test, or navigating away all left it fetching every
     * fifteen seconds and calling setState. The overview page is the one
     * people navigate away from, which is what made this worth fixing here.
     */
    expect(source).toContain("useEffect");
    expect(source).toContain("stopPolling");
    expect(source).toContain(squash("clearInterval(pollIntervalRef.current)"));
  });
});
