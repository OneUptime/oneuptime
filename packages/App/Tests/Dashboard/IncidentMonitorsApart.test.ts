import {
  getPickedMonitorIds,
  hasPickedMonitors,
  ItemWithMonitorStatus,
  omitMonitorStatusWithoutMonitors,
} from "../../FeatureSet/Dashboard/src/Components/Incident/ChangeMonitorStatusField";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The maintainer, on declaring an incident: "we also need to have monitors
 * and other affected resources as seperate things (so change monitor state
 * to makes more sense), only show that dropdown if any monitor is selected."
 *
 * Every incident form that asks for affected resources - Declare Incident,
 * the incident's Affected Resources Edit, and an incident template's create
 * wizard and Affected Resources card - asks for the monitors in a picker of
 * their own, then "Change Monitor Status to" right under them, then the
 * other resources. On an incident it is asked only once a monitor is picked
 * and never sent without one (ChangeMonitorStatusField); on a template it is
 * always asked, because it also applies to the monitors picked when an
 * incident is declared from the template.
 *
 * The rules are checked directly; the forms are read from source, as React
 * components that an App test must not import.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MONITOR_A: string = "a0000000-0000-4000-8000-00000000000a";
const MONITOR_B: string = "a0000000-0000-4000-8000-00000000000b";
const STATUS_ID: string = "d0000000-0000-4000-8000-000000000001";

// What the affected resources picker hands the form, mid-split.
function pickerPayload(monitors: Array<string> | undefined): JSONObject {
  return {
    __affectedResourcesPayload: true,
    monitors: monitors,
    hosts: undefined,
  } as unknown as JSONObject;
}

describe("getPickedMonitorIds", () => {
  test("nothing picked is no monitor", () => {
    expect(getPickedMonitorIds(undefined)).toEqual([]);
    expect(getPickedMonitorIds(null)).toEqual([]);
    expect(getPickedMonitorIds([])).toEqual([]);
  });

  test("bare ids, as the picker writes them", () => {
    expect(getPickedMonitorIds([MONITOR_A, MONITOR_B])).toEqual([
      MONITOR_A,
      MONITOR_B,
    ]);
  });

  test("{_id, name} objects, ObjectIDs and models, as a template, an alert or a monitor's tab prefill them", () => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_B;

    expect(
      getPickedMonitorIds([{ _id: MONITOR_A, name: "Checkout API" }, monitor]),
    ).toEqual([MONITOR_A, MONITOR_B]);
    expect(getPickedMonitorIds([new ObjectID(MONITOR_A)])).toEqual([MONITOR_A]);
  });

  /*
   * Between the picker's change and the split a microtask later, the form
   * holds the picker's whole payload under `monitors`.
   */
  test("the picker's payload, mid-split: its own monitors", () => {
    expect(getPickedMonitorIds(pickerPayload([MONITOR_A]))).toEqual([
      MONITOR_A,
    ]);
    expect(getPickedMonitorIds(pickerPayload([]))).toEqual([]);
    expect(getPickedMonitorIds(pickerPayload(undefined))).toEqual([]);
  });

  test("each monitor once", () => {
    expect(getPickedMonitorIds([MONITOR_A, MONITOR_A])).toEqual([MONITOR_A]);
  });
});

describe("hasPickedMonitors: when Change Monitor Status to is asked", () => {
  test.each([
    ["no values at all", undefined],
    ["values that are not an object", "monitors"],
    ["no monitors key", {}],
    ["an empty list", { monitors: [] }],
    ["only other resources", { hosts: [MONITOR_A], services: [MONITOR_B] }],
    ["the picker's payload with none left", { monitors: pickerPayload([]) }],
  ])("not with %s", (_label: string, values: unknown) => {
    expect(hasPickedMonitors(values)).toBe(false);
  });

  test.each([
    ["a bare id", { monitors: [MONITOR_A] }],
    ["a prefilled monitor", { monitors: [{ _id: MONITOR_A, name: "API" }] }],
    [
      "the picker's payload, mid-split",
      { monitors: pickerPayload([MONITOR_A]) },
    ],
  ])("with %s", (_label: string, values: unknown) => {
    expect(hasPickedMonitors(values)).toBe(true);
  });
});

describe("omitMonitorStatusWithoutMonitors: what the incident forms send", () => {
  function itemWithStatus(): Incident {
    const status: MonitorStatus = new MonitorStatus();
    status._id = STATUS_ID;

    const incident: Incident = new Incident();
    incident.title = "Checkout is down";
    incident.changeMonitorStatusTo = status;
    incident.changeMonitorStatusToId = new ObjectID(STATUS_ID);

    return incident;
  }

  test("with a monitor picked, the status is sent as picked", () => {
    const item: Incident = itemWithStatus();

    const sent: Incident = omitMonitorStatusWithoutMonitors({
      item: item,
      formValues: { monitors: [MONITOR_A] },
    });

    expect(sent).toBe(item);
    expect(sent.changeMonitorStatusTo?._id).toBe(STATUS_ID);
    expect(sent.changeMonitorStatusToId?.toString()).toBe(STATUS_ID);
  });

  test("without one, neither the relation nor its id is sent, and nothing else changes", () => {
    const sent: Incident = omitMonitorStatusWithoutMonitors({
      item: itemWithStatus(),
      formValues: { monitors: [], hosts: [MONITOR_B] },
    });

    expect("changeMonitorStatusTo" in sent).toBe(false);
    expect("changeMonitorStatusToId" in sent).toBe(false);
    expect(sent.title).toBe("Checkout is down");

    // Left out of the request: the server keeps the incident's own status.
    const json: JSONObject = BaseModel.toJSON(sent, Incident);

    expect(json["changeMonitorStatusTo"]).toBeUndefined();
    expect(json["changeMonitorStatusToId"]).toBeUndefined();
    expect(json["title"]).toBe("Checkout is down");
  });

  test("a form whose monitors were never loaded sends no status either", () => {
    const sent: Incident = omitMonitorStatusWithoutMonitors({
      item: itemWithStatus(),
      formValues: {},
    });

    expect(sent.changeMonitorStatusTo).toBeUndefined();
  });

  test("an item without a status is left as it is", () => {
    const item: ItemWithMonitorStatus = { changeMonitorStatusTo: undefined };

    expect(
      omitMonitorStatusWithoutMonitors({ item: item, formValues: {} }),
    ).toEqual({});
  });
});

// The forms, read from source.

function dense(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ");
}

/*
 * The object literal around `marker`, from the `{` that opens it to the `}`
 * that closes it. Throws unless the marker is there exactly once.
 */
function objectAround(source: string, marker: string): string {
  const at: number = source.indexOf(marker);

  if (at < 0 || source.indexOf(marker, at + 1) >= 0) {
    throw new Error(`Expected exactly one ${marker}`);
  }

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

  throw new Error(`The object around ${marker} never closes`);
}

// The types a `resourceTypes={[...]}` names, or the list it is handed by name.
function resourceTypesOf(field: string, source: string): Array<string> {
  const inline: string | undefined = field.match(
    /resourceTypes=\{\[([^\]]*)\]\}/,
  )?.[1];
  const named: string | undefined = field.match(
    /resourceTypes=\{([A-Z_]+)\}/,
  )?.[1];
  const list: string | undefined =
    inline ??
    (named
      ? source.match(
          new RegExp(
            `const ${named}: Array<AffectedResourceType> = \\[([^\\]]*)\\];`,
          ),
        )?.[1]
      : undefined);

  expect(list).toBeDefined();

  return Array.from(list!.matchAll(/"(\w+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// The order the form's keyed fields are written in.
function fieldOrder(source: string, keys: Array<string>): Array<string> {
  return keys
    .map((key: string): { key: string; at: number } => {
      return { key: key, at: source.indexOf(`field: { ${key}: true, }`) };
    })
    .filter((entry: { at: number }): boolean => {
      return entry.at >= 0;
    })
    .sort((a: { at: number }, b: { at: number }): number => {
      return a.at - b.at;
    })
    .map((entry: { key: string }): string => {
      return entry.key;
    });
}

interface IncidentForm {
  file: string;
  label: string;
  // An incident asks for the status only once a monitor is picked.
  isTemplate: boolean;
}

const FORMS: Array<IncidentForm> = [
  {
    file: "Pages/Incidents/Create.tsx",
    label: "Declare Incident",
    isTemplate: false,
  },
  {
    file: "Components/Incident/IncidentAffectedResourcesFormFields.tsx",
    label: "the incident's Affected Resources Edit",
    isTemplate: false,
  },
  {
    file: "Pages/Incidents/Settings/IncidentTemplates.tsx",
    label: "an incident template's create wizard",
    isTemplate: true,
  },
  {
    file: "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
    label: "an incident template's Affected Resources card",
    isTemplate: true,
  },
];

describe.each(FORMS)("$label", (form: IncidentForm) => {
  const source: string = dense(form.file);

  test("asks for the monitors, then the status they change to, then the other resources", () => {
    expect(
      fieldOrder(source, ["monitors", "changeMonitorStatusTo", "hosts"]),
    ).toEqual(["monitors", "changeMonitorStatusTo", "hosts"]);

    expect(objectAround(source, "field: { monitors: true, }")).toContain(
      'title: "Monitors",',
    );
    expect(objectAround(source, "field: { hosts: true, }")).toContain(
      'title: "Other Affected Resources",',
    );
    // Hosts is the second picker's anchor, not a hidden registration too.
    expect(source).not.toContain("field: { hosts: true },");
  });

  test("the Monitors picker offers monitors alone, and writes back nothing else", () => {
    const monitors: string = objectAround(source, "field: { monitors: true, }");

    expect(resourceTypesOf(monitors, source)).toEqual(["Monitor"]);
    expect(monitors).toContain('placeholder="Search monitors..."');
    expect(monitors).toContain("monitors: payload.monitors,");
    expect(monitors).not.toMatch(
      /\b(hosts|services|kubernetesClusters): payload\./,
    );
    expect(monitors).toContain("ariaLabelledby={elementProps.ariaLabelledby}");
  });

  test("the other picker offers everything but monitors, and never writes them", () => {
    const rest: string = objectAround(source, "field: { hosts: true, }");
    const types: Array<string> = resourceTypesOf(rest, source);

    expect(types).not.toContain("Monitor");
    expect(types).toEqual(
      expect.arrayContaining(["Host", "KubernetesCluster", "Service"]),
    );
    expect(rest).toContain("hosts: payload.hosts,");
    expect(rest).not.toContain("monitors: payload.monitors,");
    expect(rest).not.toContain("monitors={");
    expect(rest).toContain("ariaLabelledby={elementProps.ariaLabelledby}");
  });

  test("Change Monitor Status to is never folded, and has no stray trailing space", () => {
    const status: string = objectAround(
      source,
      "field: { changeMonitorStatusTo: true, }",
    );

    expect(status).toContain('title: "Change Monitor Status to",');
    expect(status).not.toContain("collapsibleSection");
    expect(source).not.toContain('"Change Monitor Status to "');
  });

  if (form.isTemplate) {
    test("on a template, the status is always asked: it also applies to monitors picked when declaring", () => {
      const status: string = objectAround(
        source,
        "field: { changeMonitorStatusTo: true, }",
      );

      expect(status).not.toContain("showIf");
      expect(status).toContain(
        'description: "Incidents declared from this template change the status of their monitors to this one - the monitors picked here and any picked when the incident is declared.",',
      );
    });
  } else {
    test("on an incident, the status is asked only once a monitor is picked, and never sent without one", () => {
      const status: string = objectAround(
        source,
        "field: { changeMonitorStatusTo: true, }",
      );

      expect(status).toMatch(
        /showIf: (hasMonitors|\(values: FormValues<Incident>\): boolean => \{ return hasPickedMonitors\(values\); \}),/,
      );
      expect(source).toContain(
        "omitMonitorStatusWithoutMonitors({ item: item, formValues: formValues, })",
      );
    });
  }
});

describe("the incident's Affected Resources card", () => {
  test("draws the shared fields, and leaves the status out without a monitor", () => {
    const page: string = dense("Pages/Incidents/View/Index.tsx");
    const start: number = page.indexOf(
      '<CardModelDetail<Incident> name="Affected Resources"',
    );

    expect(start).toBeGreaterThan(-1);

    // The card's props, up to what it shows.
    const card: string = page.slice(
      start,
      page.indexOf("modelDetailProps={{", start),
    );

    expect(card).toContain(
      "onBeforeUpdate={onBeforeIncidentAffectedResourcesUpdate} formFields={getIncidentAffectedResourcesFormFields()}",
    );
  });

  test("offers what Declare Incident offers, picker by picker", () => {
    const declare: string = dense("Pages/Incidents/Create.tsx");
    const edit: string = dense(
      "Components/Incident/IncidentAffectedResourcesFormFields.tsx",
    );

    for (const key of ["monitors", "hosts"]) {
      expect(
        resourceTypesOf(objectAround(edit, `field: { ${key}: true, }`), edit),
      ).toEqual(
        resourceTypesOf(
          objectAround(declare, `field: { ${key}: true, }`),
          declare,
        ),
      );
    }
  });
});

describe("an incident template's create wizard", () => {
  test("folds the status pages it limits its incidents to under Advanced, at the end of Resources Affected", () => {
    const source: string = dense(
      "Pages/Incidents/Settings/IncidentTemplates.tsx",
    );
    const pages: string = objectAround(source, "field: { statusPages: true, }");

    expect(pages).toContain('stepId: "resources-affected",');
    expect(pages).toContain("collapsibleSection: advancedSection,");
    expect(
      fieldOrder(source, [
        "monitors",
        "changeMonitorStatusTo",
        "hosts",
        "statusPages",
      ]),
    ).toEqual(["monitors", "changeMonitorStatusTo", "hosts", "statusPages"]);

    // Every field of the step names it, so the status is on that step too.
    expect(
      objectAround(source, "field: { changeMonitorStatusTo: true, }"),
    ).toContain('stepId: "resources-affected",');
  });

  test("offers a template's own relations only: the five it can hold", () => {
    const source: string = dense(
      "Pages/Incidents/Settings/IncidentTemplates.tsx",
    );

    expect(
      resourceTypesOf(objectAround(source, "field: { hosts: true, }"), source),
    ).toEqual([
      "Host",
      "KubernetesCluster",
      "DockerHost",
      "PodmanHost",
      "Service",
    ]);
  });
});

/*
 * FormField and FieldLabel look a field's title, description and placeholder
 * up by its English text, so a string with no entry silently stays English.
 * The split's copy is in every locale, and so are the two strings it now
 * reads that some locales had left in English: the incident forms say
 * "Change Monitor Status to" without the stray trailing space the old title
 * had, and the monitors picker reads "Search monitors...".
 */
describe("the split's copy, in every language", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const COPY: Array<string> = [
    "Monitors",
    "Other Affected Resources",
    "Change Monitor Status to",
    "Search monitors...",
    "Search and attach the monitors affected by this incident. The status pages that list them show it.",
    "Search and attach hosts, Kubernetes clusters, Docker hosts, databases, or services affected by this incident.",
    "No monitors affected by this incident.",
    "No other resources affected by this incident.",
    "Search and attach the monitors that incidents created from this template should pre-populate.",
    "Search and attach hosts, Kubernetes clusters, Docker hosts, or services that incidents created from this template should pre-populate.",
    "Incidents declared from this template change the status of their monitors to this one - the monitors picked here and any picked when the incident is declared.",
  ];

  function readLocale(locale: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
    ) as Record<string, string>;
  }

  const LOCALES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });

  test("every language is checked", () => {
    expect(LOCALES).toHaveLength(16);
  });

  test("each string is a key of its own in English", () => {
    const english: Record<string, string> = readLocale("en");

    for (const text of COPY) {
      expect(`${text} -> ${english[text]}`).toBe(`${text} -> ${text}`);
    }
  });

  test.each(LOCALES)("%s translates each one", (locale: string) => {
    const translations: Record<string, string> = readLocale(locale);
    const untranslated: Array<string> = COPY.filter((text: string): boolean => {
      const value: string | undefined = translations[text];
      return !value || value.trim().length === 0 || value === text;
    });

    expect(untranslated).toEqual([]);
  });

  test("the forms read these strings as they are written here", () => {
    const sources: string = [
      "Pages/Incidents/Create.tsx",
      "Components/Incident/IncidentAffectedResourcesFormFields.tsx",
      "Pages/Incidents/Settings/IncidentTemplates.tsx",
      "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
    ]
      .map((file: string): string => {
        return dense(file);
      })
      .join(" ");

    for (const text of COPY) {
      expect(`${text}: ${sources.includes(`"${text}"`)}`).toBe(`${text}: true`);
    }
  });
});
