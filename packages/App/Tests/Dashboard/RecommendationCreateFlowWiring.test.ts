import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The batch-create flow behind the "Create N Selected" button: what the page
 * does between the click and the monitors existing.
 *
 * None of it is reachable from a unit test. The App suite runs in a plain Node
 * environment with no renderer, so a prop that stops being forwarded, a state
 * seed that is dropped, or a branch that starts closing the panel produces no
 * failure anywhere — the symptom reaches the user instead, and every symptom in
 * this flow is a silent one: a button that appears to do nothing for the first
 * twenty seconds, a Close button that ignores clicks, a progress bar with a
 * NaN width painting an empty track, a partly-failed batch whose per-monitor
 * reasons are thrown away the instant it finishes.
 *
 * The loop itself now lives in MonitorRecommendationCreateRunner precisely so
 * it CAN be exercised, and the panel is rendered against a real DOM in
 * Common/Tests. What is left over is the wiring between them, and that is what
 * this file reads out of the sources.
 *
 * RecommendationPageWiring.test.ts pins the rest of the feature — the eight
 * pages, the badge, dismissal scoping, the notification-mode default. Nothing
 * here repeats it.
 *
 * Sources are whitespace-squashed first so prettier re-wrapping a line cannot
 * turn a real regression check into a red herring, and every negative
 * assertion reads a comment-stripped copy — MonitorRecommendations.tsx has a
 * prop comment containing the words "monitors were created", which is exactly
 * the phrase one of the tests below asserts is gone.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * SideOver is shared UI, not dashboard code: the two props this flow depends on
 * were added to it for this panel, and a caller can forward them perfectly
 * while the component quietly stops passing them to its buttons.
 */
const SIDE_OVER_COMPONENT_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
  "SideOver",
  "SideOver.tsx",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSourceAt(absolutePath: string): string {
  return squash(fs.readFileSync(absolutePath, "utf8"));
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

function readSource(...relativeParts: Array<string>): string {
  return readSourceAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

function readCode(...relativeParts: Array<string>): string {
  return readCodeAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

/*
 * The un-squashed pair, used only by the billing-sweep mirror below. That sweep
 * matches against the bytes on disk, so squashing here would let a call written
 * across two lines satisfy this file while the sweep it protects found nothing.
 */
function readRaw(...relativeParts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8");
}

function readRawCode(...relativeParts: Array<string>): string {
  return stripComments(readRaw(...relativeParts));
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const PAGE_CODE: string = readCode(
  "Components",
  "Recommendations",
  "MonitorRecommendations.tsx",
);

const PAGE_SOURCE: string = readSource(
  "Components",
  "Recommendations",
  "MonitorRecommendations.tsx",
);

const SIDE_OVER_CODE: string = readCode(
  "Components",
  "Recommendations",
  "MonitorRecommendationCreateSideOver.tsx",
);

const PROGRESS_PANEL_CODE: string = readCode(
  "Components",
  "Recommendations",
  "MonitorRecommendationCreateProgress.tsx",
);

const TOOLBAR_CODE: string = readCode(
  "Components",
  "Recommendations",
  "RecommendationToolbar.tsx",
);

const SIDE_OVER_COMPONENT_CODE: string = readCodeAt(SIDE_OVER_COMPONENT_PATH);

/*
 * Everything between `const createMonitors:` and the next top-level
 * declaration. Several assertions below are about what does NOT happen in the
 * create handler, and the same call spelled elsewhere in a 1000-line component
 * would satisfy a whole-file `toContain` while the handler had lost it.
 */
const CREATE_HANDLER: string = PAGE_CODE.split("const createMonitors:")[1]!
  .split("type DismissFunction")[0]!
  .trim();

describe("the create handler is really the region these tests read", () => {
  /*
   * Every extraction below splits on a marker. If one stopped matching, the
   * tests that read the piece after it would pass against an empty string.
   */
  test("it was found, and it is the handler rather than the whole file", () => {
    expect(CREATE_HANDLER.length).toBeGreaterThan(500);
    expect(CREATE_HANDLER).toContain("MonitorRecommendationCreateRunner.run({");
    // The dismissal handler is a different function and is pinned elsewhere.
    expect(CREATE_HANDLER).not.toContain(
      "RecommendationDismissalUtil.dismiss(",
    );
  });
});

/*
 * Creating eighteen monitors takes the better part of a minute — they are
 * created one at a time on purpose, because each one runs label rules, owner
 * rules and workspace notifications server-side. The old flow's only feedback
 * was a line of text that did not appear until the FIRST monitor had landed,
 * which put the longest silence of the whole operation at its very beginning:
 * the moment the user has just pressed a button and most needs to know it
 * worked.
 */
describe("pressing Create has an immediate visible effect", () => {
  test("the panel is seeded with a full list of pending rows before the first request", () => {
    /*
     * Matched as a shape rather than a formatted line: what matters is that
     * getInitialProgress(plan) is what goes into createProgress, not how
     * prettier chose to wrap the call.
     */
    expect(CREATE_HANDLER).toMatch(
      /setCreateProgress\(\s*MonitorRecommendationCreateRunner\.getInitialProgress\(\s*plan,?\s*\),?\s*\)/,
    );

    const seedIndex: number = CREATE_HANDLER.indexOf(
      "MonitorRecommendationCreateRunner.getInitialProgress(",
    );
    const runIndex: number = CREATE_HANDLER.indexOf(
      "MonitorRecommendationCreateRunner.run({",
    );

    expect(seedIndex).toBeGreaterThan(-1);
    /*
     * Seeding after the run would be seeding after it finished: `run` is
     * awaited, so the pending rows would appear for one frame at the end and
     * the whole batch would look like it happened instantly and silently.
     */
    expect(seedIndex).toBeLessThan(runIndex);
  });

  test("but only after the batch has cleared the billing check", () => {
    /*
     * The consent guard returns early. Seeding first would flash a full list
     * of pending monitors for a batch that is then refused, which reads as
     * "it started and then died" rather than "it never started".
     */
    const consentIndex: number = CREATE_HANDLER.indexOf(
      "setActionError(MONITOR_CONSENT_ERROR);",
    );
    const seedIndex: number = CREATE_HANDLER.indexOf(
      "MonitorRecommendationCreateRunner.getInitialProgress(",
    );

    expect(consentIndex).toBeGreaterThan(-1);
    expect(consentIndex).toBeLessThan(seedIndex);
  });

  test("the run is awaited, and every later state write depends on that", () => {
    /*
     * Without the await, `finalProgress` is a Promise: `finalProgress
     * .failedCount === 0` is `undefined === 0`, so the panel would close on
     * nothing having happened yet, and the coverage reload underneath would
     * run against monitors that do not exist.
     */
    expect(CREATE_HANDLER).toContain(
      "await MonitorRecommendationCreateRunner.run({",
    );
  });

  test("progress reaches React state on every emission", () => {
    const runCall: string = CREATE_HANDLER.split(
      "MonitorRecommendationCreateRunner.run({",
    )[1]!.split("setIsCreating(false);")[0]!;

    expect(runCall).toContain("plan: plan,");
    expect(runCall).toContain("onProgress:");
    /*
     * A run without a listener still creates every monitor — the panel just
     * sits on its seeded pending rows for the whole minute, which is worse
     * than no panel at all because it looks stuck.
     */
    expect(runCall).toContain("setCreateProgress(progress);");
    expect(runCall).toContain("createMonitor:");
  });
});

/*
 * PayAsYouGoWiring.test.ts sweeps every Dashboard source for a file that
 * contains both "modelType: Monitor," and "FormType.Create" and fails it unless
 * the same file mentions PayAsYouGo. That sweep is what stops a new monitor
 * create path from shipping without the Free-plan charge notice.
 *
 * Moving the ModelAPI call into the runner would not break a type or a render.
 * It would move those two literals into a file with no billing reference and no
 * reason to have one, and the sweep would start failing for a change that had
 * nothing to do with billing.
 */
describe("the monitor create call stays where the billing sweep looks for it", () => {
  test("the page still carries both literals the sweep matches on, and the gate", () => {
    const rawPage: string = readRaw(
      "Components",
      "Recommendations",
      "MonitorRecommendations.tsx",
    );

    expect(rawPage).toContain("modelType: Monitor,");
    expect(rawPage).toContain("FormType.Create");
    expect(rawPage).toContain("PayAsYouGo");
  });

  test("and the runner carries neither, so it never enters the sweep", () => {
    const runnerCode: string = readRawCode(
      "Components",
      "Recommendations",
      "MonitorRecommendationCreateRunner.ts",
    );

    expect(runnerCode).not.toContain("modelType: Monitor,");
    expect(runnerCode).not.toContain("FormType.Create");
    /*
     * The runner takes the create as an injected function for exactly this
     * reason. An import of the API client here is the first step back.
     */
    expect(runnerCode).not.toContain("ModelAPI");
  });

  test("the injected create is where the call and the consent check sit together", () => {
    const createMonitorCallback: string = CREATE_HANDLER.split(
      "createMonitor:",
    )[1]!.split("setIsCreating(false);")[0]!;

    expect(createMonitorCallback).toContain("await ModelAPI.createOrUpdate({");
    expect(createMonitorCallback).toContain("modelType: Monitor,");
    expect(createMonitorCallback).toContain("formType: FormType.Create,");
    /*
     * miscDataProps is how owners reach the server — they are junction rows,
     * not columns, and ModelAPI.create hardcodes an empty object. Dropping it
     * creates every monitor in the batch with no owners and no error.
     */
    expect(createMonitorCallback).toContain(
      "miscDataProps: item.miscDataProps,",
    );
  });
});

/*
 * The loop used to stop at the first rejection. Monitor creation runs label
 * rules, owner rules and workspace notifications per monitor, so one bad
 * recommendation in a batch of eighteen is an ordinary outcome — and abandoning
 * the fourteen that would have succeeded because the third failed is not.
 */
describe("one failure no longer ends the batch", () => {
  test("the page no longer counts creations or writes the old partial message", () => {
    /*
     * The old handler kept a running `createdCount` and, on the first throw,
     * set an error reading "... (3 of 18 monitors were created.)" — a sentence
     * that named a number and then left the user to work out WHICH three.
     *
     * Read comment-stripped: the prop documentation at the top of this file
     * contains the words "monitors were created", so the raw source would fail
     * this test for a comment that explains the very thing being asserted.
     */
    expect(PAGE_CODE).not.toContain("monitors were created");
    expect(PAGE_CODE).not.toContain("createdCount");

    // ...and the comment that trips the raw source really is there.
    expect(PAGE_SOURCE).toContain("monitors were created");
  });

  test("the page does not iterate the plan at all", () => {
    /*
     * The iteration and its per-item failure accounting live in the runner,
     * where a suite with no renderer can actually run them. A loop that
     * reappears here is a loop nothing tests.
     */
    expect(CREATE_HANDLER).not.toContain("for (");
    expect(CREATE_HANDLER).not.toContain(".forEach(");
    expect(CREATE_HANDLER).not.toContain("Promise.all(");
  });

  test("a failed create is reported as a value, not thrown", () => {
    const createMonitorCallback: string = CREATE_HANDLER.split(
      "createMonitor:",
    )[1]!.split("setIsCreating(false);")[0]!;

    expect(createMonitorCallback).toContain("return { isCreated: true };");
    expect(createMonitorCallback).toContain(
      "errorMessage: API.getFriendlyMessage(err),",
    );

    /*
     * Re-throwing would reach the runner's own catch and still be counted as a
     * failure, but the message would be lost — the user would be told
     * "Something went wrong while creating this monitor" instead of the
     * server's actual reason, on the one row that needs a reason.
     */
    expect(createMonitorCallback).not.toContain("throw");
    /*
     * And a per-item failure must not become the page-level error while the
     * batch is still running: the remaining fifteen monitors would be created
     * underneath a red banner claiming the operation had already failed.
     */
    expect(createMonitorCallback).not.toContain("setActionError");
  });
});

/*
 * When something failed, the panel is the only place the per-monitor reasons
 * are written down. Closing it replaces eighteen rows — a tick on each one that
 * landed, a red line on each one that did not — with a single error string, and
 * there is then no way to find out which monitors are missing short of reading
 * the monitor list against the recommendation list by hand.
 */
describe("a run that partly failed keeps the panel open", () => {
  const SUCCESS_BRANCH: string = CREATE_HANDLER.split(
    "if (finalProgress.failedCount === 0) {",
  )[1]!.split("} else {")[0]!;

  const FAILURE_BRANCH: string = CREATE_HANDLER.split("} else {")[1]!;

  test("the branches were found", () => {
    expect(SUCCESS_BRANCH.length).toBeGreaterThan(0);
    expect(FAILURE_BRANCH.length).toBeGreaterThan(0);
  });

  test("only the zero-failure branch closes it", () => {
    expect(SUCCESS_BRANCH).toContain("setShowCreateSideOver(false);");
    expect(SUCCESS_BRANCH).toContain("setCreateProgress(null);");
    expect(SUCCESS_BRANCH).toContain(
      "setSelectedRecommendationIds(new Set<string>());",
    );

    expect(FAILURE_BRANCH).not.toContain("setShowCreateSideOver");
    /*
     * Nor may it clear the progress it is keeping the panel open to show.
     * Clearing it would leave the drawer open on the form it opened as, with
     * the failure reduced to one line of red text above it.
     */
    expect(FAILURE_BRANCH).not.toContain("setCreateProgress(null)");

    /*
     * One close in the whole handler. A second one — an early return, a
     * finally — is how "only on success" quietly becomes "always".
     */
    expect(countOccurrences(CREATE_HANDLER, "setShowCreateSideOver")).toBe(1);
  });

  test("the failure branch narrows the selection to what did not land", () => {
    expect(FAILURE_BRANCH).toContain(
      "MonitorRecommendationCreateRunner.getUnsuccessfulRecommendationIds({",
    );
    expect(FAILURE_BRANCH).toContain("progress: finalProgress,");
    expect(FAILURE_BRANCH).toContain(
      "selectedRecommendationIds: selectedRecommendationIds,",
    );

    /*
     * Leaving the created ones selected would re-offer them on the next press
     * of Create, and `createOrUpdate` with `FormType.Create` does not
     * de-duplicate: the user would get a second copy of every monitor that
     * worked the first time, each one billed and each one paging.
     */
    expect(FAILURE_BRANCH).not.toContain("new Set<string>()");
  });

  test("the run's own summary is what the error line says", () => {
    /*
     * Not a message rebuilt here. Two sentences describing the same batch is
     * two sentences that can disagree, and the one in the panel is computed
     * from the progress while this one would be computed from whatever the
     * handler happened to still have in scope.
     */
    expect(FAILURE_BRANCH).toContain(
      "MonitorRecommendationCreateRunner.getSummaryText(finalProgress)",
    );
  });

  test("the coverage refresh afterwards cannot bury what the batch reported", () => {
    /*
     * After a partial failure the created monitors are real, so the coverage
     * diff has to be reloaded — but that reload is a fresh set of network
     * calls that can fail on their own. Unwrapped, a rejection here escapes
     * the handler into the caller's `.catch`, which sets actionError and
     * replaces the per-monitor summary with "Failed to fetch monitors": the
     * batch's own result, gone, replaced by a message about something else.
     */
    expect(CREATE_HANDLER).toContain(
      squash("try { await loadCoverage(projectDefaults); } catch (err) {"),
    );
    expect(
      countOccurrences(CREATE_HANDLER, "loadCoverage(projectDefaults)"),
    ).toBe(1);

    /*
     * And it reports through setError, not setActionError. actionError is the
     * line the failure branch just wrote the batch summary into.
     */
    const reloadCatch: string = CREATE_HANDLER.split(
      "await loadCoverage(projectDefaults);",
    )[1]!;

    expect(reloadCatch).toContain("setError(API.getFriendlyMessage(err));");
    expect(reloadCatch).not.toContain("setActionError");
  });
});

/*
 * The list and the filters are frozen while the batch runs. This is not
 * cosmetic: the failure branch narrows `selectedRecommendationIds` using the
 * value captured when the handler started, so a checkbox ticked during the run
 * is silently discarded the moment it finishes — the user watches their click
 * register and then undo itself a minute later.
 */
describe("the page cannot be edited underneath a running batch", () => {
  test("the toolbar and the list are both disabled while creating", () => {
    const toolbarElement: string = PAGE_CODE.split(
      "<RecommendationToolbar",
    )[1]!.split("/>")[0]!;
    const listElement: string = PAGE_CODE.split(
      "<RecommendationsList",
    )[1]!.split("/>")[0]!;

    expect(toolbarElement).toContain("isDisabled={isCreating}");
    expect(listElement).toContain("isDisabled={isCreating}");
  });
});

/*
 * The side over is a form until the first submit and a progress report
 * afterwards. Both halves are one-line props that a refactor can drop without
 * breaking a type: `createProgress` is optional, and `isCreating` was already
 * being used for the submit label before these two existed.
 */
describe("the side over shows the batch running", () => {
  test("it forwards isCreating to both of SideOver's new props", () => {
    /*
     * submitButtonIsLoading is the spinner. Without it the button reads
     * "Creating..." with no motion for the better part of a minute, which is
     * indistinguishable from a stuck page.
     */
    expect(SIDE_OVER_CODE).toContain(
      "submitButtonIsLoading={props.isCreating}",
    );
    /*
     * closeButtonDisabled is the honest version of the previous behaviour: the
     * panel used to no-op inside onClose, leaving a live-looking Close button
     * that did nothing when pressed.
     */
    expect(SIDE_OVER_CODE).toContain("closeButtonDisabled={props.isCreating}");
  });

  test("the submit is disabled while the batch is in flight", () => {
    const submitDisabled: string = SIDE_OVER_CODE.split(
      "submitButtonDisabled={",
    )[1]!.split("}")[0]!;

    /*
     * A second press would start a second run over the same plan, and
     * FormType.Create does not de-duplicate. The billing half of this
     * expression is pinned by PayAsYouGoWiring.test.ts.
     */
    expect(submitDisabled).toContain("props.isCreating");
  });

  test("it renders the progress panel, and only once there is progress", () => {
    expect(SIDE_OVER_CODE).toContain("props.createProgress ? (");
    expect(SIDE_OVER_CODE).toContain(
      squash(
        "<MonitorRecommendationCreateProgressPanel progress={props.createProgress} />",
      ),
    );
  });

  test("the page hands it the progress it is holding", () => {
    const sideOverElement: string = PAGE_CODE.split(
      "<MonitorRecommendationCreateSideOver",
    )[1]!.split("/>")[0]!;

    expect(sideOverElement).toContain("isCreating={isCreating}");
    /*
     * `|| undefined` rather than the state value: the prop is optional, and
     * passing null through would render the panel around a progress object
     * that does not exist.
     */
    expect(sideOverElement).toContain(
      "createProgress={createProgress || undefined}",
    );
  });
});

/*
 * SideOver is shared, and both props exist because of this panel. A component
 * that accepts them and does not forward them type-checks perfectly, renders
 * perfectly, and gives every caller a panel whose buttons ignore them.
 */
describe("SideOver forwards the two props and never traps the user", () => {
  const FOOTER: string = SIDE_OVER_COMPONENT_CODE.split(
    'data-testid="side-over-footer"',
  )[1]!;

  test("the footer was found and holds both buttons", () => {
    expect(countOccurrences(FOOTER, "<Button")).toBeGreaterThanOrEqual(2);
  });

  test("the footer Close button is the one closeButtonDisabled disables", () => {
    const closeButton: string = FOOTER.split("<Button")[1]!.split("/>")[0]!;

    expect(closeButton).toContain('title="Close"');
    expect(closeButton).toContain("disabled={props.closeButtonDisabled}");
  });

  test("the submit button spins on submitButtonIsLoading", () => {
    const submitButton: string = FOOTER.split("<Button")[2]!.split("/>")[0]!;

    expect(submitButton).toContain("isLoading={props.submitButtonIsLoading}");
    expect(submitButton).toContain("disabled={props.submitButtonDisabled}");
  });

  test("the header close control is not gated on it", () => {
    /*
     * The one raw <button> in the component. Disabling this as well would let
     * a panel hold a user on a page with no way out — the footer Close is the
     * abandonable action, the header × is the escape hatch, and they are
     * deliberately not the same control.
     */
    expect(countOccurrences(SIDE_OVER_COMPONENT_CODE, "<button")).toBe(1);

    const headerCloseButton: string =
      SIDE_OVER_COMPONENT_CODE.split("<button")[1]!.split("</button>")[0]!;

    expect(headerCloseButton).toContain('data-testid="close-button"');
    expect(headerCloseButton).toContain("props.onClose();");
    expect(headerCloseButton).not.toContain("disabled");
  });
});

/*
 * ProgressBar computes `(count * 100) / totalCount` and writes the result
 * straight into a `width` style. At totalCount 0 that is NaN, which the browser
 * discards: an empty grey track, a "0 of 0" label and "NaN%" beside it, with
 * nothing thrown and nothing logged.
 */
describe("the coverage bar is guarded against a resource type with no catalog", () => {
  test("it renders only when there is something to divide by", () => {
    /*
     * Zero is a state the page expects rather than a hypothetical: it ships an
     * empty state reading "No recommendations for this resource type yet", and
     * this toolbar renders above that empty state, bar and all.
     */
    expect(PAGE_CODE).toContain("monitor-recommendations-none");

    const guardIndex: number = TOOLBAR_CODE.indexOf(
      "props.counts.total > 0 ? (",
    );
    const barIndex: number = TOOLBAR_CODE.indexOf("<ProgressBar");

    expect(guardIndex).toBeGreaterThan(-1);
    expect(barIndex).toBeGreaterThan(guardIndex);
  });

  test("the guarded number is the divisor", () => {
    /*
     * A guard on one count and a bar dividing by another is not a guard. There
     * is one bar in this file, so the two have to be the same expression.
     */
    expect(countOccurrences(TOOLBAR_CODE, "<ProgressBar")).toBe(1);

    const bar: string = TOOLBAR_CODE.split("<ProgressBar")[1]!.split("/>")[0]!;

    expect(bar).toContain("totalCount={props.counts.total}");
    expect(bar).toContain("count={props.counts.created}");
  });
});

/*
 * The bar in the progress panel measures how far the batch has got, which is
 * not how many monitors were created: a run where six of eighteen failed is
 * finished, and a bar fed only creations would stop at 67% and stay there while
 * the summary line beside it said the run was complete.
 */
describe("the progress bar counts everything that settled", () => {
  test("failures move it forward too", () => {
    expect(PROGRESS_PANEL_CODE).toContain(
      "const settledCount: number = progress.createdCount + progress.failedCount;",
    );
    expect(PROGRESS_PANEL_CODE).toContain("count={settledCount}");
    expect(PROGRESS_PANEL_CODE).not.toContain("count={progress.createdCount}");
  });

  test("against the batch's own total", () => {
    const bar: string =
      PROGRESS_PANEL_CODE.split("<ProgressBar")[1]!.split("/>")[0]!;

    expect(bar).toContain("totalCount={progress.totalCount}");
  });

  test("and the line under it comes from the runner", () => {
    /*
     * Same reason the failure branch uses it: the sentence answers "why is
     * this taking so long" while it runs and "did anything fail" when it
     * stops, and that decision belongs in one place rather than in every
     * surface that renders a batch.
     */
    expect(PROGRESS_PANEL_CODE).toContain(
      "MonitorRecommendationCreateRunner.getSummaryText(progress)",
    );
  });
});
