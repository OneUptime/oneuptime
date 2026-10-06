import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  countFieldRows,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "The idea is to reduce decision / choice paralysis as much as possible:
 * show people as few options as possible (and hide those other 'advanced'
 * options), and have sane defaults." - the maintainer, closing the feedback
 * document.
 *
 * Declare Incident opened on five fields and walked six steps: Incident
 * Details, Resources Affected, Incident Roles (one field), On-Call (one
 * field), More (three) and the summary. Create Alert asked for the initial
 * state up front and for root cause and remediation notes - two markdown
 * editors - before anything had happened. The episode forms repeated the
 * one-field steps.
 *
 * Now each opens on what the record cannot be made without - a title, a
 * severity - and its description; the options most of them never touch are
 * folded under one Advanced section at the end of the first step. This guard
 * pins that shape on the four forms, read the way the form guards read
 * every form (Tests/Helpers/FormStepsScan), so a field added later lands
 * under Advanced or comes with a reason:
 *
 *   - each form's steps, in order;
 *   - per step, the fields shown open and the ones folded: one section,
 *     last on its step, built by getAdvancedFormSection;
 *   - every step earns its place: none shows a single row;
 *   - Create Alert asks for nothing the alert's own pages hold;
 *   - no form looks a first state up to prefill: left empty, the server
 *     starts the record in the project's starting state, and the form says
 *     so;
 *   - Declared At starts at the moment the page opened, fixed, so the
 *     Advanced section can tell a time someone set from the one it started
 *     with;
 *   - opened from a monitor's Incidents or Alerts tab, the monitor is
 *     already picked: the tab hands its list the monitor, the list puts it
 *     in the address, and the page picks it (Components/CreateFromRecord;
 *     App's CreateFromRecordGuard holds every other record's tabs to it);
 *   - the monitors are picked apart from every other affected resource, and
 *     Change Monitor Status to sits right under them, asked only once a
 *     monitor is picked and never sent without one; the status pages an
 *     incident is limited to, and whether their subscribers are notified,
 *     wait under More fields. The maintainer: "Limit to these status pages and
 *     notifiy subscribers should be in advanced. change monitor stattus
 *     page to should be outside of advanced", and "we also need to have
 *     monitors and other affected resources as seperate things (so change
 *     monitor sttate to makes more sense), only show that dropdown if any
 *     monitor is selected. Please do this for alert form as well."
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

// How the four forms write the Advanced section on their fields.
const ADVANCED_SECTION: string = "advancedSection";

// Prettier wraps the call where the line runs long.
const USUAL_STARTING_STATE_SUMMARY: RegExp =
  /translator\.translateText\(\s*"The usual starting state\.",?\s*\)/;

interface StepShape {
  id: string | null;
  title: string;
  // The fields shown open on the step, in order.
  open: Array<string>;
  // The fields folded under Advanced at the end of the step, in order.
  folded: Array<string>;
}

interface FormShape {
  file: string;
  label: string;
  steps: Array<StepShape>;
}

const INCIDENT_CREATE: FormShape = {
  file: `${DASHBOARD}/Pages/Incidents/Create.tsx`,
  label: "ModelForm: Create New Incident",
  steps: [
    {
      id: "incident-details",
      title: "Incident Details",
      open: ["title", "incidentSeverity", "description"],
      folded: ["declaredAt", "currentIncidentState", "labels", "isPrivate"],
    },
    {
      id: "resources-affected",
      title: "Resources Affected",
      // The monitors, the status they change to, and the other resources.
      open: ["monitors", "changeMonitorStatusTo", "hosts"],
      folded: [
        "statusPages",
        "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
      ],
    },
    /*
     * The project's custom fields marked Show on Create, when there are any
     * to ask (IncidentCustomFieldDefinitions); its fields are built at run
     * time, so the scan does not place them.
     */
    {
      id: null,
      title: "INCIDENT_DETAILS_STEP_TITLE",
      open: [],
      folded: [],
    },
    {
      id: "on-call",
      title: "On-Call & Roles",
      open: ["onCallDutyPolicies", "incidentRoles"],
      folded: [],
    },
  ],
};

const ALERT_CREATE: FormShape = {
  file: `${DASHBOARD}/Pages/Alerts/Create.tsx`,
  label: "ModelForm: Create New Alert",
  steps: [
    {
      id: "alert-details",
      title: "Alert Details",
      open: ["title", "alertSeverity", "description"],
      folded: ["currentAlertState", "labels", "isPrivate"],
    },
    {
      id: "on-call",
      title: "Resources & On-Call",
      // Its one monitor, in a dropdown of its own, then the other resources.
      open: ["monitor", "hosts", "onCallDutyPolicies"],
      folded: [],
    },
  ],
};

const INCIDENT_EPISODE_CREATE: FormShape = {
  file: `${DASHBOARD}/Pages/Incidents/EpisodeCreate.tsx`,
  label: "ModelForm: Create New Incident Episode",
  steps: [
    {
      id: "episode-details",
      title: "Episode Details",
      open: ["title", "incidentSeverity", "description"],
      folded: ["currentIncidentState", "labels"],
    },
    {
      id: "on-call",
      title: "On-Call & Roles",
      open: ["onCallDutyPolicies", "episodeRoles"],
      folded: [],
    },
  ],
};

const ALERT_EPISODE_CREATE: FormShape = {
  file: `${DASHBOARD}/Pages/Alerts/EpisodeCreate.tsx`,
  label: "ModelForm: Create New Alert Episode",
  steps: [
    {
      id: "episode-details",
      title: "Episode Details",
      open: ["title", "alertSeverity", "description"],
      folded: ["currentAlertState", "labels"],
    },
    {
      id: "on-call",
      title: "On-Call & Owners",
      // The owners picker, built by getOwnersFormField.
      open: ["onCallDutyPolicies", "fieldKey || OWNERS_FORM_FIELD_KEY"],
      folded: [],
    },
  ],
};

const FORMS: Array<FormShape> = [
  INCIDENT_CREATE,
  ALERT_CREATE,
  INCIDENT_EPISODE_CREATE,
  ALERT_EPISODE_CREATE,
];

const SCANNED: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: FORMS.map((form: FormShape): string => {
    return path.join(REPOSITORY_ROOT, form.file);
  }),
});

function formFor(shape: FormShape): FormFacts {
  const found: Array<FormFacts> = SCANNED.filter((form: FormFacts) => {
    return form.file === shape.file && form.label === shape.label;
  });

  expect(found).toHaveLength(1);

  return found[0]!;
}

// The fields a step shows: hidden registrations (showIf () => false) aside.
function shownOn(form: FormFacts, stepId: string): Array<FormFieldFacts> {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return field.stepId === stepId && !field.isNeverShown;
  });
}

function keysOf(fields: Array<FormFieldFacts>): Array<string> {
  return fields.map((field: FormFieldFacts): string => {
    return field.key;
  });
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

function dense(relativePath: string): string {
  return readSource(relativePath).replace(/\s+/g, " ");
}

/*
 * The text of the object literal written right around `marker` (a field's
 * `field: { x: true }`): from the `{` that opens the field to the `}` that
 * closes it. Throws rather than returning empty, so a marker that moved
 * cannot make the checks below pass vacuously.
 */
function fieldObjectAround(source: string, marker: string): string {
  const at: number = source.indexOf(marker);

  if (at < 0 || source.indexOf(marker, at + 1) >= 0) {
    throw new Error(`Expected exactly one ${marker}`);
  }

  // Walk back to the brace that opens the field object.
  let depth: number = 0;
  let start: number = -1;

  for (let index: number = at - 1; index >= 0; index--) {
    const character: string = source[index]!;

    if (character === "}") {
      depth++;
    } else if (character === "{") {
      if (depth === 0) {
        start = index;
        break;
      }

      depth--;
    }
  }

  if (start < 0) {
    throw new Error(`No field object opens before ${marker}`);
  }

  depth = 0;

  for (let index: number = start; index < source.length; index++) {
    const character: string = source[index]!;

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`The field object around ${marker} never closes`);
}

describe("the declare and create forms show what matters first", () => {
  test("the scan reads the four forms, as Create forms", () => {
    for (const shape of FORMS) {
      const form: FormFacts = formFor(shape);

      expect(form.host).toBe("ModelForm");
      expect(form.hasCreateForm).toBe(true);
      expect(form.hasSteps).toBe(true);
    }
  });

  test.each(FORMS)("$label walks exactly these steps", (shape: FormShape) => {
    expect(
      (formFor(shape).steps || []).map(
        (step: FormStepFacts): { id: string | null; title: string } => {
          return { id: step.id, title: step.title };
        },
      ),
    ).toEqual(
      shape.steps.map(
        (step: StepShape): { id: string | null; title: string } => {
          return { id: step.id, title: step.title };
        },
      ),
    );
  });

  test.each(FORMS)(
    "$label shows these fields open, and folds the rest under Advanced at the end of their step",
    (shape: FormShape) => {
      const form: FormFacts = formFor(shape);

      for (const step of shape.steps) {
        if (!step.id) {
          continue;
        }

        const shown: Array<FormFieldFacts> = shownOn(form, step.id);
        const open: Array<FormFieldFacts> = shown.filter(
          (field: FormFieldFacts): boolean => {
            return field.collapsibleSection === undefined;
          },
        );
        const folded: Array<FormFieldFacts> = shown.filter(
          (field: FormFieldFacts): boolean => {
            return field.collapsibleSection !== undefined;
          },
        );

        expect({ step: step.id, open: keysOf(open) }).toEqual({
          step: step.id,
          open: step.open,
        });
        expect({ step: step.id, folded: keysOf(folded) }).toEqual({
          step: step.id,
          folded: step.folded,
        });

        // One section, the step's last fields, written the shared way.
        expect(keysOf(shown.slice(shown.length - folded.length))).toEqual(
          keysOf(folded),
        );

        for (const field of folded) {
          expect(`${field.key}: ${field.collapsibleSection}`).toBe(
            `${field.key}: ${ADVANCED_SECTION}`,
          );
        }
      }
    },
  );

  test.each(FORMS)(
    "$label builds its Advanced section with getAdvancedFormSection, once",
    (shape: FormShape) => {
      const source: string = dense(shape.file);

      expect(source).toMatch(
        /const advancedSection: FormFieldCollapsibleSection<\w+> = getAdvancedFormSection<\w+>\(\);/,
      );
      expect(source.split("getAdvancedFormSection<").length - 1).toBe(1);
    },
  );

  /*
   * "A wizard step has to earn its place. No step exists for one optional
   * field." The folded section counts as one row, as it shows as one header.
   */
  test.each(FORMS)("$label has no step of a single row", (shape: FormShape) => {
    const form: FormFacts = formFor(shape);

    for (const step of shape.steps) {
      if (!step.id) {
        continue;
      }

      expect({
        step: step.id,
        rows: countFieldRows(shownOn(form, step.id)) > 1,
      }).toEqual({ step: step.id, rows: true });
    }
  });

  /*
   * Root cause and remediation notes are written on the alert's own Root
   * Cause and Remediation pages, once there is something to say.
   */
  test("Create Alert asks for no root cause or remediation notes", () => {
    const keys: Array<string> = keysOf(formFor(ALERT_CREATE).fields);

    expect(keys).not.toContain("rootCause");
    expect(keys).not.toContain("remediationNotes");

    const source: string = readSource(ALERT_CREATE.file);

    expect(source).not.toContain("rootCause");
    expect(source).not.toContain("remediationNotes");

    // ...and the alert still has the pages that hold them.
    for (const page of ["RootCause.tsx", "Remediation.tsx"]) {
      expect(
        fs.existsSync(
          path.join(
            REPOSITORY_ROOT,
            DASHBOARD,
            "Pages",
            "Alerts",
            "View",
            page,
          ),
        ),
      ).toBe(true);
    }
  });
});

describe("the state a record starts in", () => {
  const STATE_FIELDS: Array<{
    shape: FormShape;
    key: string;
    help: string;
  }> = [
    {
      shape: INCIDENT_CREATE,
      key: "currentIncidentState",
      help: "Leave empty for the usual starting state. Pick a later state to record an incident that is already acknowledged or resolved. No one is paged for it.",
    },
    {
      shape: ALERT_CREATE,
      key: "currentAlertState",
      help: "Leave empty for the usual starting state. Pick a later state to record an alert that is already acknowledged or resolved. No one is paged for it.",
    },
    {
      shape: INCIDENT_EPISODE_CREATE,
      key: "currentIncidentState",
      help: "Leave empty for the usual starting state. Pick a later state to record an episode that is already acknowledged or resolved. No one is paged for it.",
    },
    {
      shape: ALERT_EPISODE_CREATE,
      key: "currentAlertState",
      help: "Leave empty for the usual starting state. Pick a later state to record an episode that is already acknowledged or resolved. No one is paged for it.",
    },
  ];

  /*
   * The pages used to look up the first state by its order and put it in
   * the form - on the incident page racing the form's first render, and
   * not always the state the server starts a record in (the created state;
   * a custom state can be dragged above it). Left empty, the server picks
   * the project's starting state: one request fewer, and an Advanced
   * section that does not read "Configured" on every form.
   */
  test.each(STATE_FIELDS)(
    "$shape.label looks no state up to prefill",
    ({ shape, key }: { shape: FormShape; key: string }) => {
      const source: string = dense(shape.file);

      expect(source).not.toMatch(/fetchFirst\w*State/);
      expect(source).not.toMatch(/getFirst\w*StateId/);
      expect(source).not.toContain(`${key}: firstStateId`);
      expect(source).not.toContain(`["${key}"] = firstStateId`);
      expect(source).not.toContain("modelType: IncidentState,");
    },
  );

  test("only Declare Incident reads alert states - to offer acknowledging the alerts it is declared from", () => {
    for (const shape of [
      ALERT_CREATE,
      INCIDENT_EPISODE_CREATE,
      ALERT_EPISODE_CREATE,
    ]) {
      expect(dense(shape.file)).not.toContain("modelType: AlertState,");
    }

    const incident: string = dense(INCIDENT_CREATE.file);

    expect(incident.split("modelType: AlertState,").length - 1).toBe(1);
    expect(incident).toContain(
      "select: { _id: true, order: true, isAcknowledgedState: true }",
    );
  });

  test.each(STATE_FIELDS)(
    "$shape.label: the state is optional, folded, and says what empty means",
    ({ shape, key, help }: { shape: FormShape; key: string; help: string }) => {
      const field: string = fieldObjectAround(
        dense(shape.file),
        `field: { ${key}: true, }`,
      );

      expect(field).toContain('title: "Initial State",');
      expect(field).toContain(`description: "${help}",`);
      expect(field).toContain("required: false,");
      expect(field).toContain("collapsibleSection: advancedSection,");
      // What the review step says when it is left empty.
      expect(field).toMatch(USUAL_STARTING_STATE_SUMMARY);
      // Listed in their order, each in its colour (StateDropdownColorsGuard).
      expect(field).toMatch(/sort: \{ order: SortOrder\.Ascending, \}/);
      expect(field).not.toContain("defaultValue");
      expect(field).not.toContain("getDefaultValue");
    },
  );

  test.each(FORMS)("$label starts from no state at all", (shape: FormShape) => {
    expect(formFor(shape).createInitialValueKeys || []).not.toContain(
      "currentIncidentState",
    );
    expect(formFor(shape).createInitialValueKeys || []).not.toContain(
      "currentAlertState",
    );
  });
});

describe("Declared At", () => {
  const source: string = dense(INCIDENT_CREATE.file);

  test("starts at the moment the page opened, fixed for the life of the page", () => {
    expect(source).toContain(
      "const [formOpenedAt] = useState<Date>(() => { return OneUptimeDate.getCurrentDate(); });",
    );

    const field: string = fieldObjectAround(
      source,
      "field: { declaredAt: true, }",
    );

    expect(field).toContain("defaultValue: formOpenedAt,");
    expect(field).toContain("collapsibleSection: advancedSection,");
    /*
     * Read again on every render, the default moved on each time, so the
     * folded section said "Configured" though nobody had touched it.
     */
    expect(field).not.toContain("getDefaultValue");
  });
});

describe("opened from a monitor's tab, the monitor is already picked", () => {
  /*
   * Declare Incident on a monitor's Incidents tab, and Create Alert on its
   * Alerts tab, opened these pages with nothing picked: the monitor was
   * searched for again on the next step, or forgotten, and the new record
   * never showed on the tab it was made from.
   */
  test("the monitor's Incidents and Alerts tabs hand their lists the monitor", () => {
    for (const [file, table] of [
      [`${DASHBOARD}/Pages/Monitor/View/Incidents.tsx`, "IncidentsTable"],
      [`${DASHBOARD}/Pages/Monitor/View/Alerts.tsx`, "AlertsTable"],
    ] as Array<[string, string]>) {
      const source: string = dense(file);

      expect(source).toContain(
        `<${table} query={query} createFrom={{ kind: CreateFromRecordKind.Monitor, id: modelId }} />`,
      );
      // The create values the alerts list took and never used are gone.
      expect(source).not.toContain("createInitialValues");
    }
  });

  test("the lists put it in the address of Declare Incident and Create Alert", () => {
    const incidents: string = dense(
      `${DASHBOARD}/Components/Incident/IncidentsTable.tsx`,
    );
    const alerts: string = dense(
      `${DASHBOARD}/Components/Alert/AlertsTable.tsx`,
    );

    expect(incidents).toContain(
      "RouteUtil.getPageRoute(PageMap.INCIDENT_CREATE, { query: createQuery, })",
    );
    expect(incidents).toContain(
      "query: { ...createQuery, incidentTemplateId: incidentTemplateId.toString(), },",
    );
    expect(alerts).toContain(
      "RouteUtil.getPageRoute(PageMap.ALERT_CREATE, { query: createQuery, })",
    );
  });

  test.each([
    { shape: INCIDENT_CREATE, created: "Incident" },
    { shape: ALERT_CREATE, created: "Alert" },
  ] as Array<{ shape: FormShape; created: string }>)(
    "$shape.label looks the record up, waits for it, and picks it",
    ({ shape, created }: { shape: FormShape; created: string }) => {
      const source: string = dense(shape.file);

      expect(source).toContain(
        `useRecordToCreateFrom( CreatedRecordKind.${created}, )`,
      );
      expect(source).toContain(
        `record: recordToCreateFrom.record, created: CreatedRecordKind.${created},`,
      );
      expect(source).toContain("recordToCreateFrom.isLoading");
    },
  );

  /*
   * Picked on a step of its own: the record is not a field of the first
   * step, and no step is added for it - the steps above are unchanged.
   */
  test("the record is picked on the resources step, not on a step of its own", () => {
    expect(
      shownOn(formFor(INCIDENT_CREATE), "resources-affected")[0]!.key,
    ).toBe("monitors");
    expect(shownOn(formFor(ALERT_CREATE), "on-call")[0]!.key).toBe("monitor");
  });
});

describe("the monitors apart, and the status they change to right under them", () => {
  const incident: string = dense(INCIDENT_CREATE.file);
  const alert: string = dense(ALERT_CREATE.file);

  // The names of a `const <list>: Array<AffectedResourceType> = [...]`.
  function typesOf(source: string, list: string): Array<string> {
    const block: string | undefined = source.match(
      new RegExp(
        `const ${list}: Array<AffectedResourceType> = \\[([^\\]]*)\\];`,
      ),
    )?.[1];

    expect(`${list}: ${block !== undefined}`).toBe(`${list}: true`);

    return Array.from(block!.matchAll(/"(\w+)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );
  }

  test("Declare Incident asks for its monitors in a picker of their own, and for everything else in another", () => {
    expect(typesOf(incident, "MONITOR_RESOURCE_TYPES")).toEqual(["Monitor"]);

    const others: Array<string> = typesOf(
      incident,
      "OTHER_AFFECTED_RESOURCE_TYPES",
    );

    expect(others).not.toContain("Monitor");
    expect(others).toEqual(
      expect.arrayContaining(["Host", "KubernetesCluster", "Service"]),
    );
    // The one mixed list is gone.
    expect(incident).not.toContain("const AFFECTED_RESOURCE_TYPES:");

    const monitors: string = fieldObjectAround(
      incident,
      "field: { monitors: true, }",
    );

    expect(monitors).toContain('title: "Monitors",');
    expect(monitors).toContain("resourceTypes={MONITOR_RESOURCE_TYPES}");
    // It writes back the monitors, and nothing it does not show.
    expect(monitors).toContain("monitors: payload.monitors,");
    expect(monitors).not.toContain("hosts: payload.hosts,");
    expect(monitors).not.toContain("hosts={");

    const rest: string = fieldObjectAround(incident, "field: { hosts: true, }");

    expect(rest).toContain('title: "Other Affected Resources",');
    expect(rest).toContain("resourceTypes={OTHER_AFFECTED_RESOURCE_TYPES}");
    expect(rest).toContain("hosts: payload.hosts,");
    expect(rest).not.toContain("monitors: payload.monitors,");
    expect(rest).not.toContain("monitors={");

    // Each picker is named by its own label, for a screen reader.
    for (const picker of [monitors, rest]) {
      expect(picker).toContain("ariaLabelledby={elementProps.ariaLabelledby}");
    }
  });

  test("Change Monitor Status to is open, right under the monitors, and asked only once a monitor is picked", () => {
    expect(
      keysOf(shownOn(formFor(INCIDENT_CREATE), "resources-affected")).slice(
        0,
        3,
      ),
    ).toEqual(["monitors", "changeMonitorStatusTo", "hosts"]);

    const status: string = fieldObjectAround(
      incident,
      "field: { changeMonitorStatusTo: true, }",
    );

    expect(status).toContain('title: "Change Monitor Status to",');
    expect(status).toContain("showIf: hasMonitors,");
    expect(status).not.toContain("collapsibleSection");
    // It starts from what it is handed - empty, or a template's status.
    expect(status).not.toContain("defaultValue");
    expect(status).not.toContain("getDefaultValue");

    // "A monitor is picked" reads the Monitors picker's value, whatever its shape.
    expect(incident).toContain(
      "const hasMonitors: IncidentFormPredicate = ( values: FormValues<Incident>, ): boolean => { return hasPickedMonitors(values); };",
    );
  });

  test("Declare Incident never sends a monitor status without a monitor", () => {
    const hook: number = incident.indexOf("onBeforeCreate={async (");
    const strip: number = incident.indexOf(
      "omitMonitorStatusWithoutMonitors({ item: item, formValues: formValues, });",
    );

    expect(hook).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(hook);
    // Inside the hook: before the fields it hands the form.
    expect(strip).toBeLessThan(incident.indexOf("fields={[", hook));
  });

  test("the status page limit and the notify switch wait under More fields, and the switch is always on the review", () => {
    const pages: string = fieldObjectAround(
      incident,
      "field: { statusPages: true, }",
    );

    expect(pages).toContain("collapsibleSection: advancedSection,");
    expect(pages).toContain('stepId: "resources-affected",');

    const notify: string = fieldObjectAround(
      incident,
      "field: { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true, }",
    );

    expect(notify).toContain("collapsibleSection: advancedSection,");
    expect(notify).toContain('stepId: "resources-affected",');
    // Still ticked from the start: folding it changes no default.
    expect(notify).toContain("defaultValue: true,");
    // Who is emailed, and a preview, on the review even while it is folded.
    expect(notify).toContain("alwaysInSummary: true,");
    expect(notify).toContain("<SubscriberNotificationPreviewButton");
  });

  test("Create Alert keeps its one monitor apart from the other resources, and has no monitor status to show", () => {
    const monitor: string = fieldObjectAround(
      alert,
      "field: { monitor: true, }",
    );

    expect(monitor).toContain('title: "Monitor",');
    expect(monitor).toContain("fieldType: FormFieldSchemaType.Dropdown,");
    expect(monitor).toContain("dropdownModal: { type: Monitor,");

    expect(typesOf(alert, "OTHER_AFFECTED_RESOURCE_TYPES")).not.toContain(
      "Monitor",
    );

    const rest: string = fieldObjectAround(alert, "field: { hosts: true, }");

    expect(rest).toContain('title: "Other Affected Resources",');
    expect(rest).not.toContain("monitors");

    // An alert never changes its monitor's status: there is no such field.
    expect(alert).not.toContain("changeMonitorStatusTo");
    expect(alert).not.toContain("MonitorStatus");
  });
});

describe("who responds", () => {
  test("Declare Incident and Create Incident Episode put on-call policies and roles on one step, and say who takes an empty role", () => {
    for (const [shape, key, description] of [
      [
        INCIDENT_CREATE,
        "incidentRoles",
        "Who takes each role on this incident. You take any role marked Primary that you leave empty.",
      ],
      [
        INCIDENT_EPISODE_CREATE,
        "episodeRoles",
        "Who takes each role on this episode, and on every incident in it. You take any role marked Primary that you leave empty.",
      ],
    ] as Array<[FormShape, string, string]>) {
      const field: string = fieldObjectAround(
        dense(shape.file),
        `overrideField: { ${key}: true, }`,
      );

      expect(field).toContain('stepId: "on-call",');
      expect(field).toContain(`description: "${description}",`);
      expect(field).toContain(
        '"Nobody picked. You take any role marked Primary."',
      );
    }
  });

  test("the role picker tags the roles the person declaring takes, and nothing else", () => {
    const picker: string = dense(
      `${DASHBOARD}/Components/Incident/IncidentRoleFormField.tsx`,
    );

    expect(picker).toContain('translator.translateText("Primary")');
    expect(picker).not.toMatch(/>\s*Multiple\s*</);
    expect(picker).not.toContain("canAssignMultipleUsers && (");
    // English the reader saw untranslated, now looked up.
    expect(picker).toContain('placeholder="Select User"');
    expect(picker).not.toContain("Select user for ${role.name}");
    expect(picker).toContain('translator.translateText("Unknown User")');
    expect(picker).toContain(
      'translator.translateText( "Only one user can be assigned to this role.", )',
    );
    // Each remove button names the person and the role it takes them off.
    expect(picker).toContain(
      'aria-label={translator.translateTemplate( "Remove {{member}} from {{role}}", { member: name, role: roleName }, )}',
    );
    expect(picker).not.toContain(
      'aria-label={translator.translateText("Remove")}',
    );
    // Each role's picker is named by the role.
    expect(picker).toContain("ariaLabelledby={roleNameId}");
  });

  test("incident episodes use the incident's role picker, not a copy of it", () => {
    const episode: string = dense(
      `${DASHBOARD}/Components/IncidentEpisode/IncidentEpisodeRoleFormField.tsx`,
    );

    expect(episode).toContain("return <IncidentRoleFormField {...props} />;");
    expect(episode).not.toContain("ModelAPI");
  });
});
