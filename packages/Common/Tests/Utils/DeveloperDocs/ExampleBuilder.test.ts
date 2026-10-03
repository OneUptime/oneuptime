import { describe, expect, test } from "@jest/globals";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  DeveloperDocsApiBody,
  DeveloperDocsApiFilter,
  DeveloperDocsApiTask,
  DeveloperDocsExampleContext,
  DeveloperDocsExampleError,
  DeveloperDocsTerraformExample,
  DeveloperDocsTerraformRecipe,
  getApiCreateExample,
  getApiFilters,
  getApiReadSelect,
  getApiTasks,
  getApiUpdateExample,
  getCreateTitle,
  getDeveloperDocsDate,
  getDeveloperDocsFieldAbout,
  getDeveloperDocsTerraformBlock,
  getRelatedModelType,
  getTerraformCreateExample,
  getTerraformRecipe,
  getTerraformRecipes,
  isPlaceholderText,
  resolveDeveloperDocsValue,
  withoutGeneratedIds,
} from "../../../Utils/DeveloperDocs/ExampleBuilder";
import { printHclDocument } from "../../../Utils/DeveloperDocs/Hcl";
import { DeveloperDocsLiveData } from "../../../Utils/DeveloperDocs/LiveData";
import { TerraformVariableCollector } from "../../../Utils/DeveloperDocs/TerraformValues";
import {
  FIXTURE_NOW,
  FIXTURE_RECORD_ID,
  FIXTURE_USER_ID,
  fixtureRecordId,
  getEmptyFixtureLiveData,
  getFixtureLiveData,
} from "./DeveloperDocsLiveFixture";

/*
 * The examples on the Developer pages, from a resource's profile and the
 * project's own records. They are what the maintainer asked for ("make it
 * live ... the most commonly used fields for different resources"), so they
 * are pinned exactly where it matters: the new incident a page offers, how
 * an id names its record, what a page does with no project data at all.
 */

const SEVERITY_CRITICAL: string = fixtureRecordId(
  "IncidentSeverity",
  "Critical Incident",
);
const SEVERITY_MAJOR: string = fixtureRecordId(
  "IncidentSeverity",
  "Major Incident",
);
const MONITOR: string = fixtureRecordId("Monitor", "Checkout API");
const DEGRADED: string = fixtureRecordId("MonitorStatus", "Degraded");
const LABEL: string = fixtureRecordId("Label", "production");

function project(): DeveloperDocsExampleContext {
  return { live: getFixtureLiveData() };
}

function nothingLookedUp(): DeveloperDocsExampleContext {
  return { live: getEmptyFixtureLiveData() };
}

function incidentPage(
  json: JSONObject = {
    incidentSeverityId: { _type: "ObjectID", value: SEVERITY_CRITICAL },
  },
): DeveloperDocsExampleContext {
  return {
    live: getFixtureLiveData(),
    record: {
      id: FIXTURE_RECORD_ID,
      displayName: "Checkout requests are failing",
      json,
      terraformAddress: "oneuptime_incident.checkout_requests_are_failing",
    },
  };
}

describe("a new incident, as Terraform", () => {
  test("the fields most incidents set, with this project's severity, monitor, status and label named", () => {
    const example: DeveloperDocsTerraformExample | null =
      getTerraformCreateExample({ modelType: Incident, context: project() });

    expect(example?.hcl).toBe(
      [
        'resource "oneuptime_incident" "checkout_requests_are_failing" {',
        '  title                       = "Checkout requests are failing"',
        '  description                 = "Customers see an error when they pay. We are looking into it."',
        `  incident_severity_id        = "${SEVERITY_CRITICAL}"   # Critical Incident`,
        `  monitors                    = ["${MONITOR}"] # Checkout API`,
        `  change_monitor_status_to_id = "${DEGRADED}"   # Degraded`,
        `  labels                      = ["${LABEL}"] # production`,
        "}",
        "",
      ].join("\n"),
    );
    expect(example?.address).toBe(
      "oneuptime_incident.checkout_requests_are_failing",
    );
    expect(example?.isPlaceholder).toBe(false);
    expect(example?.usesProjectData).toBe(true);
  });

  test("says what each field is for, and which are required", () => {
    expect(
      getTerraformCreateExample({ modelType: Incident, context: project() })
        ?.rows,
    ).toEqual([
      {
        name: "title",
        about: "What is wrong, in a few words. Status pages show it.",
        required: true,
      },
      {
        name: "description",
        about: "More detail, in Markdown. Status pages show it too.",
        required: false,
      },
      {
        name: "incident_severity_id",
        about: "How bad it is: one of your incident severities.",
        required: true,
      },
      {
        name: "monitors",
        about:
          "The monitors it affects. Status pages that show them show the incident.",
        required: false,
      },
      {
        name: "change_monitor_status_to_id",
        about: "The status those monitors move to while the incident is open.",
        required: false,
      },
      {
        name: "labels",
        about: "Labels to find and filter it by.",
        required: false,
      },
    ]);
  });

  test("with nothing looked up: a placeholder for what it must have, nothing for what it may", () => {
    const example: DeveloperDocsTerraformExample | null =
      getTerraformCreateExample({
        modelType: Incident,
        context: nothingLookedUp(),
      });

    expect(example?.hcl).toBe(
      [
        'resource "oneuptime_incident" "checkout_requests_are_failing" {',
        '  title                = "Checkout requests are failing"',
        '  description          = "Customers see an error when they pay. We are looking into it."',
        '  incident_severity_id = "<incident severity id>"',
        "}",
        "",
      ].join("\n"),
    );
    expect(example?.isPlaceholder).toBe(true);
    expect(example?.usesProjectData).toBe(false);
  });
});

describe("a new monitor", () => {
  test("starts with the criteria a new website monitor gets in the dashboard, wired to this project's statuses and severities", () => {
    const hcl: string =
      getTerraformCreateExample({ modelType: Monitor, context: project() })
        ?.hcl || "";
    const offline: string = fixtureRecordId("MonitorStatus", "Offline");
    const operational: string = fixtureRecordId("MonitorStatus", "Operational");

    expect(hcl).toContain('monitor_type = "Website"');
    expect(hcl).toContain('monitor_destination      = "https://example.com/"');
    expect(hcl).toContain(`monitor_status_id     = "${offline}" # Offline`);
    expect(hcl).toContain(
      `monitor_status_id     = "${operational}" # Operational`,
    );
    expect(hcl).toContain(
      `incident_severity_id  = "${SEVERITY_CRITICAL}" # Critical Incident`,
    );
    expect(hcl).toContain('monitoring_interval = "*/5 * * * *"');
  });

  test("leaves out the templates of criteria that do not use them: no alert template when it opens no alerts", () => {
    const hcl: string =
      getTerraformCreateExample({ modelType: Monitor, context: project() })
        ?.hcl || "";

    expect(hcl).toContain("create_alerts         = false");
    expect(hcl).not.toContain("alerts = [");
    expect(hcl).not.toContain("alert_severity_id");
  });

  test("as an API request, its steps are the dashboard's JSON without the ids the server assigns", () => {
    const body: JSONObject = getApiCreateExample({
      modelType: Monitor,
      context: project(),
    }).body;
    const steps: string = JSON.stringify(body["monitorSteps"]);

    expect(steps).toContain('"_type":"MonitorSteps"');
    expect(steps).toContain('"monitorStepsInstanceArray"');
    expect(steps).not.toMatch(/"id":/);
    expect(steps).toContain(fixtureRecordId("MonitorStatus", "Offline"));
  });

  test("a website example counts any 2xx or 3xx answer as up, as the dashboard does", () => {
    const steps: string = JSON.stringify(
      resolveDeveloperDocsValue({
        modelType: Monitor,
        column: "monitorSteps",
        value: {
          kind: "monitorSteps",
          monitorType: MonitorType.Website,
          destination: { type: "URL", value: "https://example.com" },
        },
        context: project(),
      }).json,
    );

    expect(steps).toContain(
      '{"checkOn":"Response Status Code","filterType":"Greater Than Or Equal To","value":200}',
    );
    expect(steps).toContain(
      '{"checkOn":"Response Status Code","filterType":"Less Than","value":400}',
    );
    expect(steps).not.toContain('"filterType":"Not Equal To"');
  });

  test("an SSL certificate example warns before expiry with an alert at the project's second alert severity", () => {
    const steps: string = JSON.stringify(
      resolveDeveloperDocsValue({
        modelType: Monitor,
        column: "monitorSteps",
        value: {
          kind: "monitorSteps",
          monitorType: MonitorType.SSLCertificate,
          destination: { type: "URL", value: "https://example.com" },
        },
        context: project(),
      }).json,
    );

    expect(steps).toContain("certificate expires soon");
    expect(steps).toContain(fixtureRecordId("AlertSeverity", "Low"));
    // The offline criteria opens no alert, so its template is left out.
    expect(steps).not.toContain(fixtureRecordId("AlertSeverity", "High"));
  });

  test("with no statuses looked up, the steps say which ids to fill in", () => {
    const hcl: string =
      getTerraformCreateExample({
        modelType: Monitor,
        context: nothingLookedUp(),
      })?.hcl || "";

    expect(hcl).toContain(
      'monitor_status_id     = "<offline monitor status id>"',
    );
    expect(hcl).toContain(
      'monitor_status_id     = "<operational monitor status id>"',
    );
    expect(hcl).toContain('incident_severity_id  = "<incident severity id>"');
  });
});

describe("values", () => {
  test("an id from the project names its record; a list of one id is a list", () => {
    expect(
      resolveDeveloperDocsValue({
        modelType: Incident,
        column: "monitors",
        value: { kind: "live", list: true },
        context: project(),
      }),
    ).toEqual({
      json: [MONITOR],
      names: ["Checkout API"],
      noun: "monitor",
      isPlaceholder: false,
      fromProject: true,
    });
  });

  test("a column that points at a record defaults to one of the project's", () => {
    expect(
      resolveDeveloperDocsValue({
        modelType: Incident,
        column: "incidentSeverityId",
        context: project(),
      }).json,
    ).toBe(SEVERITY_CRITICAL);
  });

  test("the record the page is about: its id for the API, its address for Terraform", () => {
    expect(
      resolveDeveloperDocsValue({
        modelType: IncidentStateTimeline,
        column: "incidentId",
        value: { kind: "this" },
        context: incidentPage(),
      }),
    ).toEqual({
      json: FIXTURE_RECORD_ID,
      reference: "oneuptime_incident.checkout_requests_are_failing.id",
      names: ["Checkout requests are failing"],
      isPlaceholder: false,
    });
  });

  test("the record the page is about cannot be used where there is none", () => {
    expect(() => {
      resolveDeveloperDocsValue({
        modelType: IncidentStateTimeline,
        column: "incidentId",
        value: { kind: "this" },
        context: project(),
      });
    }).toThrow(DeveloperDocsExampleError);
  });

  test("the viewer is named as you, or a placeholder when unknown", () => {
    expect(
      resolveDeveloperDocsValue({
        modelType: TeamMember,
        column: "userId",
        value: { kind: "me" },
        context: project(),
      }),
    ).toEqual({
      json: FIXTURE_USER_ID,
      names: ["you"],
      isPlaceholder: false,
      fromProject: true,
    });
    expect(
      resolveDeveloperDocsValue({
        modelType: TeamMember,
        column: "userId",
        value: { kind: "me" },
        context: nothingLookedUp(),
      }).json,
    ).toBe("<your user id>");
  });

  test("a name from the project, or the fallback", () => {
    expect(
      resolveDeveloperDocsValue({
        modelType: StatusPageResource,
        column: "displayName",
        value: { kind: "liveName", tableName: "Monitor", fallback: "Website" },
        context: project(),
      }).json,
    ).toBe("Checkout API");
    expect(
      resolveDeveloperDocsValue({
        modelType: StatusPageResource,
        column: "displayName",
        value: { kind: "liveName", tableName: "Monitor", fallback: "Website" },
        context: nothingLookedUp(),
      }).json,
    ).toBe("Website");
  });

  test("a reference to a block that does not exist is a mistake in the profile", () => {
    expect(() => {
      resolveDeveloperDocsValue({
        modelType: TeamMember,
        column: "teamId",
        value: { kind: "ref", block: "team" },
        context: project(),
        references: {},
      });
    }).toThrow(DeveloperDocsExampleError);
  });

  test("a column the model does not have is a mistake in the profile", () => {
    expect(() => {
      resolveDeveloperDocsValue({
        modelType: Incident,
        column: "notAColumn",
        context: project(),
      });
    }).toThrow(DeveloperDocsExampleError);
  });
});

describe("dates", () => {
  test("now, rounded to the minute", () => {
    expect(getDeveloperDocsDate({ now: FIXTURE_NOW })).toBe(
      "2026-10-02T15:30:00.000Z",
    );
  });

  test("some days away, at a time of day (UTC)", () => {
    expect(getDeveloperDocsDate({ now: FIXTURE_NOW, days: -7, hour: 0 })).toBe(
      "2026-09-25T00:00:00.000Z",
    );
    expect(getDeveloperDocsDate({ now: FIXTURE_NOW, days: 1, hour: 9 })).toBe(
      "2026-10-03T09:00:00.000Z",
    );
  });

  test("the next given weekday, always ahead of today", () => {
    // 2026-10-02 is a Friday.
    expect(
      getDeveloperDocsDate({ now: FIXTURE_NOW, weekday: 6, hour: 2 }),
    ).toBe("2026-10-03T02:00:00.000Z");
    expect(
      getDeveloperDocsDate({ now: FIXTURE_NOW, weekday: 5, hour: 2 }),
    ).toBe("2026-10-09T02:00:00.000Z");
  });

  test("scheduled maintenance starts next Saturday at 02:00 and ends at 04:00", () => {
    const body: JSONObject = getApiCreateExample({
      modelType: ScheduledMaintenance,
      context: project(),
    }).body;

    expect(body["startsAt"]).toBe("2026-10-03T02:00:00.000Z");
    expect(body["endsAt"]).toBe("2026-10-03T04:00:00.000Z");
  });
});

describe("recipes", () => {
  test("blocks refer to each other by address", () => {
    const recipe: DeveloperDocsTerraformRecipe = getTerraformRecipes({
      modelType: StatusPage,
      scope: "list",
      context: project(),
    })[0] as DeveloperDocsTerraformRecipe;

    expect(recipe.title).toBe("Groups and monitors");
    expect(recipe.hcl).toContain(
      "status_page_id       = oneuptime_status_page.acme_status.id",
    );
    expect(recipe.hcl).toContain(
      "status_page_group_id = oneuptime_status_page_group.core_services.id",
    );
    expect(recipe.hcl).toContain(
      `monitor_id           = "${MONITOR}" # Checkout API`,
    );
    expect(recipe.hcl).toContain('display_name         = "Checkout API"');
  });

  test("a data source looks a severity up by its name", () => {
    const recipe: DeveloperDocsTerraformRecipe = getTerraformRecipes({
      modelType: Incident,
      scope: "list",
      context: project(),
    }).find((item: DeveloperDocsTerraformRecipe): boolean => {
      return item.title === "Severity by name";
    }) as DeveloperDocsTerraformRecipe;

    expect(recipe.hcl).toBe(
      [
        'data "oneuptime_incident_severity" "critical_incident" {',
        '  name = "Critical Incident"',
        "}",
        "",
        'resource "oneuptime_incident" "checkout_requests_are_failing" {',
        '  title                = "Checkout requests are failing"',
        "  incident_severity_id = data.oneuptime_incident_severity.critical_incident.id",
        "}",
        "",
      ].join("\n"),
    );
  });

  test("on a record's own page they refer to it by its address", () => {
    const recipe: DeveloperDocsTerraformRecipe = getTerraformRecipes({
      modelType: Incident,
      scope: "view",
      context: incidentPage(),
    })[0] as DeveloperDocsTerraformRecipe;

    expect(recipe.hcl).toBe(
      [
        'resource "oneuptime_incident_team_owner" "owner_team" {',
        "  incident_id = oneuptime_incident.checkout_requests_are_failing.id",
        `  team_id     = "${fixtureRecordId("Team", "Platform")}" # Platform`,
        "}",
        "",
      ].join("\n"),
    );
  });

  test("keep a placeholder for a record the project has none of: the record is the point", () => {
    const recipe: DeveloperDocsTerraformRecipe = getTerraformRecipes({
      modelType: Incident,
      scope: "view",
      context: { ...incidentPage(), live: getEmptyFixtureLiveData() },
    })[0] as DeveloperDocsTerraformRecipe;

    expect(recipe.hcl).toContain('team_id     = "<team id>"');
    expect(recipe.isPlaceholder).toBe(true);
  });

  test("a weekly rotation adds you to it", () => {
    const recipe: DeveloperDocsTerraformRecipe = getTerraformRecipes({
      modelType: OnCallDutyPolicySchedule,
      scope: "list",
      context: project(),
    })[0] as DeveloperDocsTerraformRecipe;

    expect(recipe.hcl).toContain(
      `user_id                               = "${FIXTURE_USER_ID}" # you`,
    );
    expect(recipe.hcl).toContain('intervalType = "Week"');
  });

  test("a data source for a model named by its title is refused", () => {
    expect(() => {
      getTerraformRecipe({
        recipe: {
          title: "x",
          description: "x",
          scopes: ["list"],
          blocks: [
            {
              id: "incident",
              modelType: Incident,
              kind: "data",
              fields: [
                {
                  column: "title",
                  value: { kind: "literal", value: "Checkout" },
                },
              ],
            },
          ],
        },
        context: project(),
      });
    }).toThrow(DeveloperDocsExampleError);
  });
});

describe("blocks", () => {
  test("every required attribute is written, even when the fields leave it out", () => {
    const variables: TerraformVariableCollector =
      new TerraformVariableCollector();
    const hcl: string = printHclDocument(
      getDeveloperDocsTerraformBlock({
        modelType: IncidentSeverity,
        fields: [
          { column: "name", value: { kind: "literal", value: "SEV-1" } },
        ],
        context: project(),
        variables,
      }).items,
    );

    expect(hcl).toContain('name  = "SEV-1"');
    expect(hcl).toMatch(/color = "/);
  });

  test("a field that is not an attribute the resource can be created with is refused", () => {
    expect(() => {
      getDeveloperDocsTerraformBlock({
        modelType: Incident,
        fields: [{ column: "currentIncidentStateId" }, { column: "createdAt" }],
        context: project(),
        variables: new TerraformVariableCollector(),
      });
    }).toThrow(DeveloperDocsExampleError);
  });
});

describe("the API", () => {
  test("a new incident, with list relations as {_id} objects", () => {
    const create: DeveloperDocsApiBody = getApiCreateExample({
      modelType: Incident,
      context: project(),
    });

    expect(create.body).toEqual({
      title: "Checkout requests are failing",
      description:
        "Customers see an error when they pay. We are looking into it.",
      incidentSeverityId: SEVERITY_CRITICAL,
      monitors: [{ _id: MONITOR }],
      changeMonitorStatusToId: DEGRADED,
      labels: [{ _id: LABEL }],
    });
    expect(Object.keys(create.body)[0]).toBe("title");
  });

  test("changing an incident moves it to another severity than it has now", () => {
    expect(
      getApiUpdateExample({ modelType: Incident, context: incidentPage() }),
    ).toEqual({
      data: { incidentSeverityId: SEVERITY_MAJOR },
      description:
        "Move it to “Major Incident”. Fields you leave out stay as they are.",
    });
  });

  test("a resource without a change of its own gets a new description", () => {
    expect(
      getApiUpdateExample({
        modelType: Team,
        context: { ...project(), record: { id: "t", displayName: "Platform" } },
      }),
    ).toEqual({
      data: { description: "Updated with the OneUptime API." },
      description:
        "Send only the fields you want to change. Everything else stays as it is.",
    });
  });

  test("filters name the record they use, and use the API's own operators", () => {
    const filters: Array<DeveloperDocsApiFilter> = getApiFilters({
      modelType: Incident,
      context: project(),
    });

    expect(
      filters.map((filter: DeveloperDocsApiFilter): string => {
        return filter.title;
      }),
    ).toEqual([
      "Not resolved",
      "By severity",
      "By monitor",
      "Last 7 days",
      "Search",
    ]);
    expect(filters[0]?.description).toBe(
      "Incidents that have not reached the “Resolved” state, newest first.",
    );
    expect(filters[0]?.body["query"]).toEqual({
      currentIncidentStateId: {
        _type: "NotEqual",
        value: fixtureRecordId("IncidentState", "Resolved"),
      },
    });
    expect(filters[2]?.body["query"]).toEqual({ monitors: [MONITOR] });
    expect(filters[3]?.body["query"]).toEqual({
      declaredAt: { _type: "GreaterThan", value: "2026-09-25T00:00:00.000Z" },
    });
    expect(filters[4]?.body["query"]).toEqual({
      title: { _type: "Search", value: "database" },
    });
  });

  test("a filter that needs a record the project lacks is left out", () => {
    expect(
      getApiFilters({ modelType: Incident, context: nothingLookedUp() }).map(
        (filter: DeveloperDocsApiFilter): string => {
          return filter.title;
        },
      ),
    ).toEqual(["Last 7 days", "Search"]);
  });

  test("acknowledging an incident is a state timeline entry with this project's acknowledged state", () => {
    const tasks: Array<DeveloperDocsApiTask> = getApiTasks({
      modelType: Incident,
      scope: "view",
      context: incidentPage(),
    });
    const acknowledge: DeveloperDocsApiTask | undefined = tasks[0];

    expect(
      tasks.map((task: DeveloperDocsApiTask): string => {
        return task.title;
      }),
    ).toEqual([
      "Acknowledge it",
      "Resolve it",
      "Internal note",
      "Public update",
    ]);
    expect(acknowledge?.modelType).toBe(IncidentStateTimeline);
    expect(acknowledge?.body).toEqual({
      data: {
        incidentId: FIXTURE_RECORD_ID,
        incidentStateId: fixtureRecordId("IncidentState", "Acknowledged"),
      },
    });
    expect(acknowledge?.description).toBe(
      "Moves it to “Acknowledged”, as the Acknowledge button does. Its owners and on-call policies are told.",
    );
  });

  test("with the states unknown, a task says what to fill in", () => {
    const acknowledge: DeveloperDocsApiTask | undefined = getApiTasks({
      modelType: Incident,
      scope: "view",
      context: { ...incidentPage(), live: getEmptyFixtureLiveData() },
    })[0];

    expect(acknowledge?.isPlaceholder).toBe(true);
    expect(acknowledge?.body).toEqual({
      data: {
        incidentId: FIXTURE_RECORD_ID,
        incidentStateId: "<incident state id>",
      },
    });
    expect(acknowledge?.description).toContain(
      "Moves it to the incident state you choose",
    );
  });

  test("a read asks for the profile's fields, never a secret", () => {
    expect(getApiReadSelect(Incident)).toEqual({
      _id: true,
      title: true,
      description: true,
      incidentSeverityId: true,
      currentIncidentStateId: true,
      declaredAt: true,
      createdAt: true,
    });
    expect(Object.keys(getApiReadSelect(Workflow))).not.toContain(
      "webhookSecretKey",
    );
    expect(Object.keys(getApiReadSelect(StatusPage))).not.toContain(
      "masterPassword",
    );
  });
});

describe("words", () => {
  test("create titles use the product's verbs, and the right article", () => {
    expect(
      getCreateTitle({ modelType: Incident, singularName: "Incident" }),
    ).toBe("Declare an incident");
    expect(
      getCreateTitle({
        modelType: ScheduledMaintenance,
        singularName: "Scheduled Maintenance Event",
      }),
    ).toBe("Schedule maintenance");
    expect(getCreateTitle({ modelType: Team, singularName: "Team" })).toBe(
      "Create a team",
    );
    expect(
      getCreateTitle({
        modelType: OnCallDutyPolicySchedule,
        singularName: "On-Call Schedule",
      }),
    ).toBe("Create an on-call schedule");
  });

  test("a field is explained in the profile's words, the shared ones, or the first sentence of its description", () => {
    expect(
      getDeveloperDocsFieldAbout({
        modelType: Incident,
        field: { column: "title", about: "Mine." },
      }),
    ).toBe("Mine.");
    expect(
      getDeveloperDocsFieldAbout({
        modelType: Incident,
        field: { column: "labels" },
      }),
    ).toBe("Labels to find and filter it by.");
    expect(
      getDeveloperDocsFieldAbout({
        modelType: Incident,
        field: { column: "isVisibleOnStatusPage" },
      }),
    ).toBe("Should this incident be visible on the status page?");
  });

  test("placeholders are recognised as such", () => {
    expect(isPlaceholderText("<incident severity id>")).toBe(true);
    expect(isPlaceholderText("Checkout")).toBe(false);
  });
});

describe("relations", () => {
  test("follow the metadata", () => {
    expect(getRelatedModelType(Incident, "incidentSeverityId")).toBe(
      IncidentSeverity,
    );
    expect(getRelatedModelType(Incident, "title")).toBeUndefined();
  });
});

describe("ids the server assigns are dropped", () => {
  test("at any depth, and nothing else is", () => {
    expect(
      withoutGeneratedIds({
        id: "x",
        value: [{ id: "y", name: "a", nested: { id: "z", keep: 1 } }],
        incidentSeverityId: "kept",
      }),
    ).toEqual({
      value: [{ name: "a", nested: { keep: 1 } }],
      incidentSeverityId: "kept",
    });
  });
});

describe("what cannot be created with Terraform", () => {
  test("an inventory item gets no create example: OneUptime works out its key", () => {
    expect(
      getTerraformCreateExample({
        modelType: InventoryItem,
        context: project(),
      }),
    ).toBeNull();
  });

  test("but the API example still shows one", () => {
    const live: DeveloperDocsLiveData = getFixtureLiveData();

    expect(
      getApiCreateExample({ modelType: InventoryItem, context: { live } }).body[
        "entityType"
      ],
    ).toBe("external.service");
  });
});

describe("a monitor type that needs no steps", () => {
  test("a manual monitor recipe has none", () => {
    const manual: DeveloperDocsTerraformRecipe | undefined =
      getTerraformRecipes({
        modelType: Monitor,
        scope: "list",
        context: project(),
      }).find((recipe: DeveloperDocsTerraformRecipe): boolean => {
        return recipe.hcl.includes(`monitor_type = "${MonitorType.Manual}"`);
      });

    expect(manual?.hcl).not.toContain("monitor_steps");
  });
});
