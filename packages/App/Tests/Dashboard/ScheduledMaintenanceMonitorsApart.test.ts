import {
  hasPickedMonitors,
  omitMonitorStatusWithoutMonitors,
} from "../../FeatureSet/Dashboard/src/Components/Incident/ChangeMonitorStatusField";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The maintainer, on declaring an incident: "we also need to have monitors
 * and other affected resources as seperate things (so change monitor state
 * to makes more sense), only show that dropdown if any monitor is selected."
 * #4354 did it for the incident forms; scheduled maintenance asks the same
 * question, so it gets the same shape.
 *
 * Every scheduled maintenance form that asks for affected resources - Create
 * Scheduled Maintenance Event, the event's Affected Resources Edit, and a
 * template's create wizard and Affected Resources card - asks for the
 * monitors in a picker of their own, then "Change Monitor Status to" right
 * under them, then the other resources:
 *
 *   - Create asks for the status only once a monitor is picked, and never
 *     sends it without one (ChangeMonitorStatusField);
 *   - a template always asks for it: it also applies to the monitors picked
 *     when an event is scheduled from the template, and to the events a
 *     recurring template schedules;
 *   - the event's Edit has no status at all, as before: the API takes an
 *     event's monitor status on create only.
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
const HOST_A: string = "b0000000-0000-4000-8000-00000000000a";
const STATUS_ID: string = "d0000000-0000-4000-8000-000000000001";

const CREATE_FILE: string = "Pages/ScheduledMaintenanceEvents/Create.tsx";
const EDIT_FILE: string =
  "Components/ScheduledMaintenance/ScheduledMaintenanceAffectedResourcesFormFields.tsx";
const VIEW_FILE: string = "Pages/ScheduledMaintenanceEvents/View/Index.tsx";
const TEMPLATE_FILE: string =
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx";
const TEMPLATE_VIEW_FILE: string =
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView.tsx";

// Everything but monitors an event can affect, in the pickers' order.
const EVENT_OTHER_TYPES: Array<string> = [
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "DockerSwarmCluster",
  "IoTFleet",
  "DatabaseServer",
  "NetworkSite",
  "Service",
];

// A template holds these five besides monitors.
const TEMPLATE_OTHER_TYPES: Array<string> = [
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "Service",
];

const TEMPLATE_STATUS_DESCRIPTION: string =
  "Events scheduled from this template change their monitors to this status while they are ongoing - the monitors picked here and any picked when the event is scheduled.";

const EVENT_STATUS_DESCRIPTION: string =
  "When the event starts, its monitors change to this status, and back to operational when it ends.";

describe("the rules, on a scheduled maintenance event", () => {
  function eventWithStatus(): ScheduledMaintenance {
    const status: MonitorStatus = new MonitorStatus();
    status._id = STATUS_ID;

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.title = "Database upgrade";
    event.changeMonitorStatusTo = status;
    event.changeMonitorStatusToId = new ObjectID(STATUS_ID);

    return event;
  }

  test("the status is asked once the form holds a monitor, and not for other resources", () => {
    expect(hasPickedMonitors({ monitors: [MONITOR_A] })).toBe(true);
    expect(
      hasPickedMonitors({ monitors: [{ _id: MONITOR_A, name: "API" }] }),
    ).toBe(true);
    expect(hasPickedMonitors({ monitors: [], hosts: [HOST_A] })).toBe(false);
    expect(hasPickedMonitors({ networkSites: [HOST_A] })).toBe(false);
  });

  test("with a monitor, the event is created with the status picked", () => {
    const event: ScheduledMaintenance = eventWithStatus();

    const sent: ScheduledMaintenance = omitMonitorStatusWithoutMonitors({
      item: event,
      formValues: { monitors: [MONITOR_A] },
    });

    expect(sent).toBe(event);
    expect(sent.changeMonitorStatusToId?.toString()).toBe(STATUS_ID);
    expect(
      (BaseModel.toJSON(sent, ScheduledMaintenance)["changeMonitorStatusTo"] as
        | JSONObject
        | undefined)?.["_id"],
    ).toBe(STATUS_ID);
  });

  test("without one, the request carries no status at all, and nothing else changes", () => {
    const sent: ScheduledMaintenance = omitMonitorStatusWithoutMonitors({
      item: eventWithStatus(),
      formValues: { monitors: [], hosts: [HOST_A] },
    });

    const json: JSONObject = BaseModel.toJSON(sent, ScheduledMaintenance);

    expect(json["changeMonitorStatusTo"]).toBeUndefined();
    expect(json["changeMonitorStatusToId"]).toBeUndefined();
    expect(json["title"]).toBe("Database upgrade");
  });
});

/*
 * Why the event's Edit asks for no status: the API takes the event's
 * monitor status on create only. Should that change, the Edit can ask for
 * it under the monitors, as Create does - and this is the test to revisit.
 */
describe("the columns the forms write", () => {
  function updatePermissions(
    model: BaseModel,
    column: string,
  ): Array<unknown> | undefined {
    const access: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    return access[column]?.update;
  }

  test("an event's monitor status is chosen when it is created, and taken by no update", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();

    expect(updatePermissions(event, "changeMonitorStatusTo")).toEqual([]);
    expect(
      (event.getColumnAccessControlForAllColumns()["changeMonitorStatusTo"]
        ?.create || []).length,
    ).toBeGreaterThan(0);
  });

  test("an event's monitors and other resources are edited, as before", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();

    for (const column of [
      "monitors",
      "hosts",
      "kubernetesClusters",
      "networkSites",
      "services",
    ]) {
      expect(
        `${column}: ${(updatePermissions(event, column) || []).length > 0}`,
      ).toBe(`${column}: true`);
    }
  });

  test("a template's status is chosen with the template, as an event's is", () => {
    expect(
      updatePermissions(new ScheduledMaintenanceTemplate(), "changeMonitorStatusTo"),
    ).toEqual([]);
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

enum StatusRule {
  // Asked once a monitor is picked, and never sent without one.
  OnceAMonitorIsPicked = "once a monitor is picked",
  // Always asked: it also applies to the monitors picked later.
  Always = "always",
  // Not asked: the API takes it on create only.
  NotAsked = "not asked",
}

interface ScheduledMaintenanceForm {
  file: string;
  label: string;
  status: StatusRule;
  otherTypes: Array<string>;
}

const FORMS: Array<ScheduledMaintenanceForm> = [
  {
    file: CREATE_FILE,
    label: "Create Scheduled Maintenance Event",
    status: StatusRule.OnceAMonitorIsPicked,
    otherTypes: EVENT_OTHER_TYPES,
  },
  {
    file: EDIT_FILE,
    label: "the event's Affected Resources Edit",
    status: StatusRule.NotAsked,
    otherTypes: EVENT_OTHER_TYPES,
  },
  {
    file: TEMPLATE_FILE,
    label: "a template's create wizard",
    status: StatusRule.Always,
    otherTypes: TEMPLATE_OTHER_TYPES,
  },
  {
    file: TEMPLATE_VIEW_FILE,
    label: "a template's Affected Resources card",
    status: StatusRule.Always,
    otherTypes: TEMPLATE_OTHER_TYPES,
  },
];

describe.each(FORMS)("$label", (form: ScheduledMaintenanceForm) => {
  const source: string = dense(form.file);

  test("asks for the monitors, then the status they change to, then the other resources", () => {
    const expected: Array<string> =
      form.status === StatusRule.NotAsked
        ? ["monitors", "hosts"]
        : ["monitors", "changeMonitorStatusTo", "hosts"];

    expect(
      fieldOrder(source, ["monitors", "changeMonitorStatusTo", "hosts"]),
    ).toEqual(expected);

    expect(objectAround(source, "field: { monitors: true, }")).toContain(
      'title: "Monitors",',
    );
    expect(objectAround(source, "field: { hosts: true, }")).toContain(
      'title: "Other Affected Resources",',
    );
    // Hosts is the second picker's anchor, not a hidden registration too.
    expect(source).not.toContain("field: { hosts: true },");
    // The one mixed picker's title is gone.
    expect(source).not.toContain('title: "Resources Affected", stepId');
  });

  test("the Monitors picker offers monitors alone, and writes back nothing else", () => {
    const monitors: string = objectAround(source, "field: { monitors: true, }");

    expect(resourceTypesOf(monitors, source)).toEqual(["Monitor"]);
    expect(monitors).toContain('placeholder="Search monitors..."');
    expect(monitors).toContain("monitors: payload.monitors,");
    expect(monitors).not.toMatch(
      /\b(hosts|services|kubernetesClusters|networkSites): payload\./,
    );
    expect(monitors).toContain("ariaLabelledby={elementProps.ariaLabelledby}");
  });

  test("the other picker offers everything else the form can hold, and never monitors", () => {
    const rest: string = objectAround(source, "field: { hosts: true, }");

    expect(resourceTypesOf(rest, source)).toEqual(form.otherTypes);
    expect(rest).toContain("hosts: payload.hosts,");
    expect(rest).not.toContain("monitors: payload.monitors,");
    expect(rest).not.toContain("monitors={");
    expect(rest).toContain("ariaLabelledby={elementProps.ariaLabelledby}");

    // Every relation it offers is written back, and loaded by a registration.
    const keys: Record<string, string> = {
      Host: "hosts",
      KubernetesCluster: "kubernetesClusters",
      DockerHost: "dockerHosts",
      PodmanHost: "podmanHosts",
      ProxmoxCluster: "proxmoxClusters",
      VMwareVCenter: "vmwareVCenters",
      CephCluster: "cephClusters",
      DockerSwarmCluster: "dockerSwarmClusters",
      IoTFleet: "iotFleets",
      DatabaseServer: "databaseServers",
      NetworkSite: "networkSites",
      Service: "services",
    };

    for (const type of form.otherTypes) {
      const key: string = keys[type]!;

      expect(`${type}: ${rest.includes(`${key}: payload.${key},`)}`).toBe(
        `${type}: true`,
      );

      if (key !== "hosts") {
        expect(
          `${type}: ${source.includes(`field: { ${key}: true }, `)}`,
        ).toBe(`${type}: true`);
      }
    }
  });

  test("no title keeps the old trailing space", () => {
    expect(source).not.toContain('"Change Monitor Status to "');
  });

  if (form.status === StatusRule.NotAsked) {
    test("asks for no monitor status: an event's is chosen when it is created", () => {
      expect(source).not.toContain("changeMonitorStatusTo");
    });
  } else {
    test("Change Monitor Status to is never folded", () => {
      const status: string = objectAround(
        source,
        "field: { changeMonitorStatusTo: true, }",
      );

      expect(status).toContain('title: "Change Monitor Status to",');
      expect(status).not.toContain("collapsibleSection");
      expect(status).toContain("type: MonitorStatus,");
    });
  }

  if (form.status === StatusRule.OnceAMonitorIsPicked) {
    test("the status is asked only once a monitor is picked, and never sent without one", () => {
      const status: string = objectAround(
        source,
        "field: { changeMonitorStatusTo: true, }",
      );

      expect(status).toContain("showIf: hasMonitors,");
      expect(source).toContain(
        "const hasMonitors: (values: FormValues<ScheduledMaintenance>) => boolean = ( values: FormValues<ScheduledMaintenance>, ): boolean => { return hasPickedMonitors(values); };",
      );
      expect(status).toContain(`description: "${EVENT_STATUS_DESCRIPTION}",`);
      expect(source).toContain(
        "onBeforeCreate={async ( item: ScheduledMaintenance, _miscDataProps: JSONObject, formValues: JSONObject, ): Promise<ScheduledMaintenance> => { return omitMonitorStatusWithoutMonitors({ item: item, formValues: formValues, }); }}",
      );
    });
  }

  if (form.status === StatusRule.Always) {
    test("on a template, the status is always asked: it also applies to monitors picked when scheduling", () => {
      const status: string = objectAround(
        source,
        "field: { changeMonitorStatusTo: true, }",
      );

      expect(status).not.toContain("showIf");
      expect(status).toContain(
        `description: "${TEMPLATE_STATUS_DESCRIPTION}",`,
      );
    });
  }
});

describe("the event's page", () => {
  const page: string = dense(VIEW_FILE);

  test("its Affected Resources card draws the shared fields, in a Medium dialog", () => {
    const start: number = page.indexOf(
      '<CardModelDetail<ScheduledMaintenance> name="Affected Resources"',
    );

    expect(start).toBeGreaterThan(-1);

    // The card's props, up to what it shows.
    const card: string = page.slice(
      start,
      page.indexOf("modelDetailProps={{", start),
    );

    expect(card).toContain(
      "formFields={getScheduledMaintenanceAffectedResourcesFormFields()}",
    );
    expect(card).toContain("createEditModalWidth={ModalWidth.Medium}");
    // Nothing is picked on the page itself any more.
    expect(page).not.toContain("<AffectedResourcesPicker");
  });

  test("its Edit offers what Create offers, picker by picker", () => {
    const create: string = dense(CREATE_FILE);
    const edit: string = dense(EDIT_FILE);

    for (const key of ["monitors", "hosts"]) {
      expect(
        resourceTypesOf(objectAround(edit, `field: { ${key}: true, }`), edit),
      ).toEqual(
        resourceTypesOf(
          objectAround(create, `field: { ${key}: true, }`),
          create,
        ),
      );
    }
  });
});

describe("Create Scheduled Maintenance Event's Resources Affected step", () => {
  const source: string = dense(CREATE_FILE);

  test("asks for the resources first, then the status pages and who hears", () => {
    expect(
      fieldOrder(source, [
        "monitors",
        "changeMonitorStatusTo",
        "hosts",
        "statusPages",
        "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
      ]),
    ).toEqual([
      "monitors",
      "changeMonitorStatusTo",
      "hosts",
      "statusPages",
      "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
    ]);

    for (const key of ["monitors", "changeMonitorStatusTo", "hosts"]) {
      expect(objectAround(source, `field: { ${key}: true, }`)).toContain(
        'stepId: "resources-affected",',
      );
    }
  });

  test("the review names the monitors and the other resources apart", () => {
    const monitors: string = objectAround(source, "field: { monitors: true, }");
    const rest: string = objectAround(source, "field: { hosts: true, }");

    expect(monitors).toContain(
      '"No monitors affected by this scheduled maintenance event."',
    );
    expect(rest).toContain(
      '"No other resources affected by this scheduled maintenance event."',
    );
    expect(source).not.toContain(
      '"No resources affected by this scheduled maintenance event."',
    );
  });

  test("the status page suggestions still read the monitors the first picker writes", () => {
    const pages: string = objectAround(source, "field: { statusPages: true, }");

    expect(pages).toContain(
      "getStatusPageSuggestionsFooter<ScheduledMaintenance>({ eventType: StatusPageEventType.ScheduledEvent, })",
    );
  });
});

/*
 * FormField and FieldLabel look a field's title, description and placeholder
 * up by its English text, so a string with no entry silently stays English.
 * The split's copy is in every locale.
 */
describe("the split's copy, in every language", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

  const COPY: Array<string> = [
    "Monitors",
    "Other Affected Resources",
    "Change Monitor Status to",
    "Search monitors...",
    "Search and attach the monitors affected by this scheduled maintenance.",
    "Search and attach hosts, clusters, container hosts, databases, IoT fleets, network sites, or services affected by this scheduled maintenance. Attaching a network site covers every site beneath it.",
    EVENT_STATUS_DESCRIPTION,
    "No monitors affected by this scheduled maintenance event.",
    "No other resources affected by this scheduled maintenance event.",
    "Status of the monitors will not be changed when this scheduled maintenance event starts.",
    "Search and attach the monitors that events created from this template should pre-populate.",
    "Search and attach hosts, Kubernetes clusters, Docker hosts, or services that events created from this template should pre-populate.",
    TEMPLATE_STATUS_DESCRIPTION,
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
      CREATE_FILE,
      EDIT_FILE,
      TEMPLATE_FILE,
      TEMPLATE_VIEW_FILE,
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
