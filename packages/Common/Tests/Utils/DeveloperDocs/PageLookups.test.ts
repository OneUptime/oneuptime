import { describe, expect, test } from "@jest/globals";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import { DeveloperDocsLookup } from "../../../Utils/DeveloperDocs/LiveData";
import {
  getDeveloperDocsLiveModels,
  getDeveloperDocsPageLookups,
  getDeveloperDocsRecordLookups,
} from "../../../Utils/DeveloperDocs/PageLookups";

/*
 * What each Developer page asks the server for before it shows its
 * examples. Every request costs the viewer a little time, and one for a
 * table the page does not use is a request for nothing, so each page asks
 * for exactly the kinds of record its own examples point at.
 */

function tables(models: Array<DatabaseBaseModelType>): Array<string> {
  return models
    .map((modelType: DatabaseBaseModelType): string => {
      return new modelType().tableName || "";
    })
    .sort();
}

function describeLookups(lookups: Array<DeveloperDocsLookup>): Array<string> {
  return lookups
    .map((lookup: DeveloperDocsLookup): string => {
      return lookup.ids
        ? `${lookup.tableName}:${lookup.ids.join(",")}`
        : lookup.tableName;
    })
    .sort();
}

describe("the kinds of record a page's examples point at", () => {
  test("Incidents > Terraform: the severity, monitors, status and labels of a new incident, and the owner team of a recipe", () => {
    expect(
      tables(
        getDeveloperDocsLiveModels({
          modelType: Incident,
          scope: "list",
          page: "terraform",
        }),
      ),
    ).toEqual([
      "IncidentSeverity",
      "Label",
      "Monitor",
      "MonitorStatus",
      "Team",
    ]);
  });

  test("Incidents > API: what a new incident and the filters use, and no recipe's", () => {
    expect(
      tables(
        getDeveloperDocsLiveModels({
          modelType: Incident,
          scope: "list",
          page: "api",
        }),
      ),
    ).toEqual([
      "IncidentSeverity",
      "IncidentState",
      "Label",
      "Monitor",
      "MonitorStatus",
    ]);
  });

  test("an incident's API page: another severity to move it to, and the states to acknowledge and resolve it with", () => {
    expect(
      tables(
        getDeveloperDocsLiveModels({
          modelType: Incident,
          scope: "view",
          page: "api",
        }),
      ),
    ).toEqual(["IncidentSeverity", "IncidentState"]);
  });

  test("Monitors > Terraform: the statuses and severities a new monitor's criteria use", () => {
    expect(
      tables(
        getDeveloperDocsLiveModels({
          modelType: Monitor,
          scope: "list",
          page: "terraform",
        }),
      ),
    ).toEqual(["AlertSeverity", "IncidentSeverity", "Label", "MonitorStatus"]);
  });

  test("a monitor's Terraform page: what its recipes add it to", () => {
    expect(
      tables(
        getDeveloperDocsLiveModels({
          modelType: Monitor,
          scope: "view",
          page: "terraform",
        }),
      ),
    ).toEqual(["MonitorGroup", "StatusPage", "Team"]);
  });

  test("a status page's Terraform page: a monitor for its group", () => {
    expect(
      tables(
        getDeveloperDocsLiveModels({
          modelType: StatusPage,
          scope: "view",
          page: "terraform",
        }),
      ),
    ).toEqual(["Monitor"]);
  });

  test("an on-call policy's Terraform page: a team and a schedule to page", () => {
    expect(
      tables(
        getDeveloperDocsLiveModels({
          modelType: OnCallDutyPolicy,
          scope: "view",
          page: "terraform",
        }),
      ),
    ).toEqual(["OnCallDutyPolicySchedule", "Team"]);
  });

  test("the AI Assistants page looks nothing up", () => {
    for (const scope of ["list", "view"] as const) {
      expect(
        getDeveloperDocsLiveModels({
          modelType: Incident,
          scope,
          page: "ai-assistants",
        }),
      ).toEqual([]);
    }
  });
});

describe("the records a resource's own ids point at", () => {
  test("an incident's severity, status, monitors and labels, whatever shape the API gave them in; not ids its configuration leaves out", () => {
    expect(
      describeLookups(
        getDeveloperDocsRecordLookups({
          modelType: Incident,
          json: {
            _id: "i1",
            title: "Checkout",
            incidentSeverityId: { _type: "ObjectID", value: "s1" },
            changeMonitorStatusToId: "d2",
            monitors: [{ _id: "m2" }, { _id: "m1" }],
            labels: [{ _id: "l1" }],
            createdByUserId: { _type: "ObjectID", value: "u1" },
            currentIncidentStateId: { _type: "ObjectID", value: "c2" },
          },
        }),
      ),
    ).toEqual([
      "IncidentSeverity:s1",
      "Label:l1",
      "Monitor:m1,m2",
      "MonitorStatus:d2",
    ]);
  });

  test("the statuses, severities, labels and teams inside a monitor's steps", () => {
    expect(
      describeLookups(
        getDeveloperDocsRecordLookups({
          modelType: Monitor,
          json: {
            _id: "m1",
            name: "Website",
            monitorSteps: {
              _type: "MonitorSteps",
              value: {
                monitorStepsInstanceArray: [
                  {
                    _type: "MonitorStep",
                    value: {
                      monitorCriteria: {
                        _type: "MonitorCriteria",
                        value: {
                          monitorCriteriaInstanceArray: [
                            {
                              _type: "MonitorCriteriaInstance",
                              value: {
                                monitorStatusId: "d3",
                                incidents: [
                                  {
                                    incidentSeverityId: {
                                      _type: "ObjectID",
                                      value: "s1",
                                    },
                                    labelIds: ["l1"],
                                    ownerTeamIds: ["t1"],
                                    onCallPolicyIds: ["p1"],
                                  },
                                ],
                                alerts: [{ alertSeverityId: "b1" }],
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    ).toEqual([
      "AlertSeverity:b1",
      "IncidentSeverity:s1",
      "Label:l1",
      "MonitorStatus:d3",
      "OnCallDutyPolicy:p1",
      "Team:t1",
    ]);
  });

  /*
   * A record's labels are written by its Terraform configuration - the
   * provider keeps a label a rule adds later (#10134) - and left out of its
   * Crossplane manifest, which leaves them to OneUptime: only the Terraform
   * page names them.
   */
  test("labels are named for the Terraform page, which writes them, and not for the Crossplane page, which leaves them out", () => {
    const json: Record<string, unknown> = {
      _id: "i1",
      title: "Checkout",
      incidentSeverityId: "s1",
      labels: [{ _id: "l1" }],
    };

    expect(
      describeLookups(
        getDeveloperDocsRecordLookups({
          modelType: Incident,
          json,
          page: "terraform",
        }),
      ),
    ).toEqual(["IncidentSeverity:s1", "Label:l1"]);
    expect(
      describeLookups(
        getDeveloperDocsRecordLookups({
          modelType: Incident,
          json,
          page: "crossplane",
        }),
      ),
    ).toEqual(["IncidentSeverity:s1"]);
    expect(
      describeLookups(
        getDeveloperDocsPageLookups({
          modelType: Incident,
          scope: "view",
          page: "crossplane",
          json,
        }),
      ).filter((lookup: string): boolean => {
        return lookup.startsWith("Label");
      }),
    ).toEqual([]);
  });

  test("a record without ids needs no lookups", () => {
    expect(
      getDeveloperDocsRecordLookups({
        modelType: Workflow,
        json: { _id: "w1", name: "Report" },
      }),
    ).toEqual([]);
  });
});

describe("a page's lookups", () => {
  test("a resource's Terraform page names its own ids, and samples what its recipes use", () => {
    expect(
      describeLookups(
        getDeveloperDocsPageLookups({
          modelType: Monitor,
          scope: "view",
          page: "terraform",
          json: { _id: "m1", labels: [{ _id: "l1" }] },
        }),
      ),
    ).toEqual(["Label:l1", "MonitorGroup", "StatusPage", "Team"]);
  });

  test("its API page does not name its ids: no configuration to annotate", () => {
    expect(
      describeLookups(
        getDeveloperDocsPageLookups({
          modelType: Incident,
          scope: "view",
          page: "api",
          json: { _id: "i1", labels: [{ _id: "l1" }] },
        }),
      ),
    ).toEqual(["IncidentSeverity", "IncidentState"]);
  });

  test("each table is asked once", () => {
    const lookups: Array<DeveloperDocsLookup> = getDeveloperDocsPageLookups({
      modelType: Incident,
      scope: "list",
      page: "api",
    });

    expect(new Set(describeLookups(lookups)).size).toBe(lookups.length);
  });

  test("a lookup asks for ids, names and flags, never anything else", () => {
    for (const lookup of getDeveloperDocsPageLookups({
      modelType: Incident,
      scope: "list",
      page: "terraform",
    })) {
      for (const column of Object.keys(lookup.select)) {
        expect(
          column === "_id" ||
            column === "name" ||
            column === "title" ||
            column.startsWith("is"),
        ).toBe(true);
      }
    }
  });
});

/*
 * A CUSTOM ROLE'S PAGES (#10139). The role is a name and a description:
 * no id of its own to name. What its Terraform page builds beside it - a
 * permission, a team given it - points at one of the project's teams, and
 * nothing else; its API and CLI pages list and add its own rows, by its
 * id, so they look nothing up. What OneUptime keeps (how many permissions
 * it holds, its slug) is never an id to name.
 */
describe("a custom role's pages", () => {
  const ROLE_JSON: Record<string, unknown> = {
    _id: "r1",
    name: "Incident Responder",
    description: "Declares, works and resolves incidents.",
    slug: "incident-responder-r1",
    permissionCount: 3,
    projectId: { _type: "ObjectID", value: "p1" },
    createdByUserId: { _type: "ObjectID", value: "u1" },
  };

  test("its Terraform page samples the teams its recipe gives it to, and names no id of its own", () => {
    expect(
      describeLookups(
        getDeveloperDocsPageLookups({
          modelType: CustomRole,
          scope: "view",
          page: "terraform",
          json: ROLE_JSON,
        }),
      ),
    ).toEqual(["Team"]);
  });

  test.each(["crossplane", "api", "cli", "ai-assistants"] as const)(
    "its %s page looks nothing up",
    (page: "crossplane" | "api" | "cli" | "ai-assistants") => {
      expect(
        getDeveloperDocsPageLookups({
          modelType: CustomRole,
          scope: "view",
          page,
          json: ROLE_JSON,
        }),
      ).toEqual([]);
    },
  );

  test("its own ids are none the configuration writes: never the project, its creator, or what OneUptime keeps", () => {
    for (const page of ["terraform", "crossplane"] as const) {
      expect(
        getDeveloperDocsRecordLookups({
          modelType: CustomRole,
          json: ROLE_JSON,
          page,
        }),
      ).toEqual([]);
    }
  });

  test("the team lookup asks for ids and names only", () => {
    const [lookup] = getDeveloperDocsPageLookups({
      modelType: CustomRole,
      scope: "view",
      page: "terraform",
      json: ROLE_JSON,
    });

    expect(lookup?.select).toEqual({ _id: true, name: true });
    expect(lookup?.ids).toBeUndefined();
  });
});
