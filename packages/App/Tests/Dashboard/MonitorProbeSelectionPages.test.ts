import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Two probe defects, both of which live in a prop or a field list rather than
 * in extractable logic - and the App suite runs in a plain Node environment
 * with no renderer, so these read the sources and assert the exact
 * expressions, the same way NetworkSitePageInvariants.test.ts does.
 *
 * 1. Monitor creation had no probe step. Probes were chosen for you afterwards
 *    (every probe flagged "auto enable on new monitors"), so a project with a
 *    global probe and a custom probe could not say which one should watch a
 *    given resource.
 *
 * 2. Editing a probe looked like it did nothing. The Probe Details form was a
 *    two-step wizard, so the modal's primary button read "Next" and a user who
 *    edited a field on step one never saw a Save button - closing the modal
 *    threw the edit away. And the card never displayed the auto-enable toggle
 *    it edits, so even a successful save left the page looking unchanged.
 *    Long forms are stepped again since, edit forms included, and a stepped
 *    edit dialog now keeps Save Changes on every step instead
 *    (SteppedEditFormSave.test.tsx drives that through the real components).
 *    The Probe Details form itself is one page since #4303, its optional
 *    fields folded under Advanced.
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

describe("Monitor create page lets the user pick probes", () => {
  const source: string = readSource("Pages", "Monitor", "Create.tsx");

  test("declares a probes field", () => {
    expect(source).toContain(squash("overrideField: { probes: true, },"));
    expect(source).toContain(squash('title: "Probes",'));
  });

  test("carries the selection through miscDataProps, not as a Monitor column", () => {
    /*
     * overrideField (not field) keeps `probes` out of ModelForm's select and
     * out of the Monitor payload; overrideFieldKey is what puts it into
     * miscDataProps, where MonitorService.onCreateSuccess reads it.
     */
    expect(source).toContain(squash('overrideFieldKey: "probes",'));
    expect(source).not.toContain(squash("field: { probes: true, },"));
  });

  test("shows the field even though Monitor has no probes column", () => {
    // Without this, ModelForm drops the field for lack of column permissions.
    expect(source).toContain("showEvenIfPermissionDoesNotExist: true");
  });

  test("puts probes on the step that already gates on probeable monitor types", () => {
    /*
     * doesMonitorTypeHaveInterval is isProbableMonitor, so this step appears
     * for exactly the monitor types a probe can watch. Moving probes to a step
     * of their own would also need E2E/Tests/Dashboard/Helpers/Monitors.ts to
     * grow another submit click.
     */
    expect(source).toContain(squash('stepId: "monitoring-interval",'));
    expect(source).toContain(squash('title: "Probes & Interval",'));
    expect(source).toContain(
      squash("MonitorTypeHelper.doesMonitorTypeHaveInterval("),
    );
  });

  test("pre-selects the probes the server would have attached anyway", () => {
    /*
     * Leaving the picker alone must keep the old behaviour, so the default
     * selection comes from the same rule the server applies.
     */
    expect(source).toContain(
      "MonitorProbeSelectionUtil.getDefaultSelectedProbeIds(",
    );
    expect(source).toContain("doNotAddGlobalProbesByDefaultOnNewMonitors");
  });

  test("waits for the probe list before mounting the form", () => {
    // ModelForm reads initialValues once, on mount.
    expect(source).toContain("isLoadingProbes");
    expect(source).toContain(
      squash("{!isLoading && !isLoadingProbes && !isBinding && !error && ("),
    );
  });

  test("still creates the monitor when the probe list cannot be loaded", () => {
    /*
     * On failure defaultProbeIds stays null and probeOptions is empty. A
     * device probe is pinned only when it is among the loaded options -
     * BasicForm drops an initial value that is not, and would submit
     * probes: [], which the server honours as "attach no probes" - so with
     * nothing loaded the pin is dropped too, seededProbes is null, no
     * "probes" value is submitted and the server keeps assigning the
     * defaults exactly as before.
     */
    expect(source).toContain(
      squash(
        "const pinnedDeviceProbes: Array<string> | null = deviceProbeIds && deviceProbeIds.every((probeId: string): boolean => { return probeOptions.some((option: DropdownOption): boolean => { return option.value === probeId; }); }) ? deviceProbeIds : null;",
      ),
    );
    expect(source).toContain(
      squash(
        "const seededProbes: Array<string> | null = pinnedDeviceProbes ?? defaultProbeIds;",
      ),
    );
    expect(source).toContain(
      squash(
        "seededProbes ? { ...initialValues, probes: seededProbes } : initialValues",
      ),
    );
  });

  test("a device's own probe wins over the defaults", () => {
    /*
     * The "Create Ping Monitor" deep link from a monitor-backed device seeds
     * the device's probe - the one that can reach it - through a state of
     * its own. `??` is what makes it win: the defaults only apply when no
     * device probe was seeded (or the loaded probe list does not carry it).
     * Writing the device probe into defaultProbeIds instead would race
     * loadProbes, which writes the same setter when the probe list arrives,
     * so the pre-seed must never touch that setter.
     */
    expect(source).toContain(
      "const [deviceProbeIds, setDeviceProbeIds] = useState<Array<string> | null>(",
    );
    expect(source).toContain("pinnedDeviceProbes ?? defaultProbeIds");

    const pingPreSeed: string = source.slice(
      source.indexOf("const preSeedPingMonitorForMonitorBackedDevice"),
      source.indexOf("const preSeedFromNetworkDeviceLink"),
    );

    expect(pingPreSeed).toContain("setDeviceProbeIds(");
    expect(pingPreSeed).not.toContain("setDefaultProbeIds(");
  });
});

describe("Probe list carries the flag the create form pre-selects on", () => {
  const source: string = readSource("Utils", "Probe.ts");

  test("selects shouldAutoEnableProbeOnNewMonitors for both probe sources", () => {
    const matches: number = (
      source.match(/shouldAutoEnableProbeOnNewMonitors: true/g) || []
    ).length;

    expect(matches).toBe(2);
  });

  test("marks which probes are global, since the endpoint does not return it", () => {
    expect(source).toContain("probe.isGlobalProbe = true;");
    expect(source).toContain("probe.isGlobalProbe = false;");
  });
});

describe("Probe view page makes an edit saveable and visible", () => {
  const source: string = readSource(
    "Pages",
    "Monitor",
    "Settings",
    "MonitorProbeView.tsx",
  );

  /*
   * ModelFormModal used to label its primary button "Next" on every step but
   * the last, so with steps someone editing the name or the auto-enable
   * toggle saw only "Cancel" and "Next" and lost the edit by closing the
   * modal. Since #4303 the form is one page, laid out like the Create Probe
   * form: the name and the description up front, and Advanced folding the
   * logo, the auto-enable switch and the labels. With no steps there is no
   * "Next" at all.
   */
  test("the Probe Details form is one page, folded like the Create Probe form", () => {
    type BetweenFunction = (code: string, from: string, to: string) => string;
    const between: BetweenFunction = (
      code: string,
      from: string,
      to: string,
    ): string => {
      const start: number = code.indexOf(from);
      expect(start).toBeGreaterThan(-1);
      const end: number = code.indexOf(to, start + from.length);
      expect(end).toBeGreaterThan(start);
      return code.slice(start, end);
    };

    const createPage: string = readSource(
      "Pages",
      "Monitor",
      "Settings",
      "MonitorProbes.tsx",
    );
    const detailsForm: string = between(
      source,
      "formFields={[",
      "modelDetailProps={{",
    );
    const createForm: string = between(
      createPage.slice(createPage.indexOf('title: "Custom Probes"')),
      "formFields={[",
      "showRefreshButton={true}",
    );

    for (const page of [source, createPage]) {
      expect(page).not.toContain("formSteps");
      expect(page).toContain(
        squash(
          "const advancedSection: FormFieldCollapsibleSection<Probe> = getAdvancedFormSection<Probe>();",
        ),
      );
    }

    for (const form of [detailsForm, createForm]) {
      expect(form).not.toContain("stepId");
      for (const field of ["name", "description"]) {
        expect(
          between(form, squash(`field: { ${field}: true, },`), "field: {"),
        ).not.toContain("collapsibleSection");
      }
      expect(
        between(form, squash("field: { iconFile: true, },"), "field: {"),
      ).toContain(squash("collapsibleSection: advancedSection,"));
      expect(
        between(
          form,
          squash("field: { shouldAutoEnableProbeOnNewMonitors: true, },"),
          "getLabelsFormField",
        ),
      ).toContain(squash("collapsibleSection: advancedSection,"));
      expect(form).toContain(
        squash(
          "getLabelsFormField<Probe>({ collapsibleSection: advancedSection, }),",
        ),
      );
    }
  });

  /*
   * The probe's edit dialog is one page (above), so Save Changes is on it.
   * A stepped edit dialog would keep an edit within reach too: its step list
   * opens any step, and Save Changes is on the last one, after checking
   * every step (Forms/Utils/SteppedFormFooter.ts).
   */
  test("an edit is never stranded: a stepped edit dialog opens any step, and saves from the last", () => {
    const modal: string = squash(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "UI",
          "Components",
          "ModelFormModal",
          "ModelFormModal.tsx",
        ),
        "utf8",
      ),
    );

    // CardModelDetail's edit dialog is an Update form, the case this covers.
    expect(modal).toContain(
      squash(
        "const isEditFormWithSteps: boolean = hasSteps && props.formProps.formType === FormType.Update;",
      ),
    );
    expect(modal).toContain(
      squash("allowAnyStepNavigation={isEditFormWithSteps}"),
    );
    expect(modal).toContain(squash("onSubmit={footer.onSubmit}"));
    expect(modal).toContain(squash("secondaryButton={footer.secondaryButton}"));
    expect(modal).toContain("submitAllSteps()");

    const footer: string = squash(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "UI",
          "Components",
          "Forms",
          "Utils",
          "SteppedFormFooter.ts",
        ),
        "utf8",
      ),
    );

    expect(footer).toContain(
      squash(
        "if (!data.hasSteps || data.isOnLastStep) { return { showActionButton: true, showNextButton: false, }; }",
      ),
    );
  });

  test("the card displays the auto-enable toggle the form edits", () => {
    // Otherwise a successful save is invisible and reads as "not applied".
    expect(source).toContain(
      squash(
        'field: { shouldAutoEnableProbeOnNewMonitors: true, }, title: "Enable Monitoring on New Monitors",',
      ),
    );
  });

  test("the form still edits the toggle", () => {
    expect(source).toContain(
      squash(
        'field: { shouldAutoEnableProbeOnNewMonitors: true, }, title: "Enable monitoring automatically on new monitors",',
      ),
    );
  });
});
