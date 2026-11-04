import { describe, expect, jest, test } from "@jest/globals";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertOwnerRule from "../../../../Models/DatabaseModels/AlertOwnerRule";
import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import Team from "../../../../Models/DatabaseModels/Team";
import AlertOwnerRuleEngineService from "../../../../Server/Services/AlertOwnerRuleEngineService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import { OwnerRulePlan } from "../../../../Server/Utils/Rules/OwnerRulePlan";
import OpenStackAlertContext, {
  OpenStackAlertContextResult,
  OpenStackSeriesPart,
  getOpenStackMetricNamesOfMonitor,
  getOpenStackPartOfSeries,
  getOpenStackProjectOfSeries,
} from "../../../../Server/Utils/OpenStack/OpenStackAlertContext";
import ObjectID from "../../../../Types/ObjectID";
import {
  OpenStackBlastRadius,
  describeOpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
} from "../../../../Types/OpenStack/OpenStackBlastRadius";
import { OPENSTACK_ANCHOR_METRIC_ALIAS } from "../../../../Types/Monitor/OpenStackAlertTemplates";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import { getOpenStackScopePattern } from "../../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackScopedRulesCard";

/*
 * What an alert on a part of an OpenStack cloud says it affects, and the done-when of
 * #5728: an owner rule on a project assigns its team to an alert on one of its instances,
 * through the rule engine every alert goes through.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const OU_PAYMENTS: string = "f3a1c0d2e4b64f7c8a9d0e1f2a3b4c5d";
const OU_RESEARCH: string = "9bc2d1e0f4a64b3c8d7e6f5a4b3c2d1e";

function radius(
  fields: Partial<OpenStackBlastRadius> = {},
): OpenStackBlastRadius {
  return {
    ...getEmptyOpenStackBlastRadius(),
    instanceCount: 3,
    projectCount: 2,
    projects: [
      {
        projectId: OU_PAYMENTS,
        name: "ou-payments",
        domainId: "default",
        instanceCount: 2,
        volumeCount: 0,
        routerCount: 0,
        floatingIpCount: 0,
      },
      {
        projectId: OU_RESEARCH,
        name: "ou-research",
        instanceCount: 1,
        volumeCount: 0,
        routerCount: 0,
        floatingIpCount: 0,
      },
    ],
    ...fields,
  };
}

function context(
  fields: Partial<OpenStackAlertContextResult> = {},
): OpenStackAlertContextResult {
  return {
    radius: null,
    projectId: null,
    projectName: null,
    domainId: null,
    partKind: null,
    ...fields,
  };
}

describe("which part a series is about", () => {
  const kinds: (parts: Array<OpenStackSeriesPart>) => Array<string> = (
    parts: Array<OpenStackSeriesPart>,
  ): Array<string> => {
    return parts.map((part: OpenStackSeriesPart) => {
      return `${part.kind}:${part.externalId}`;
    });
  };

  test("a worker, by its region, host and binary, in each family that could hold it", () => {
    expect(
      kinds(
        getOpenStackPartOfSeries({
          hostname: "compute-1",
          service: "nova-compute",
          "openstack.region.name": "RegionOne",
        }),
      ),
    ).toEqual([
      "Service:RegionOne/compute/compute-1/nova-compute",
      "Service:RegionOne/network/compute-1/nova-compute",
      "Service:RegionOne/volume/compute-1/nova-compute",
      "Hypervisor:RegionOne/compute-1",
    ]);
  });

  test("a hypervisor by its full name, in either label", () => {
    expect(
      kinds(
        getOpenStackPartOfSeries({
          hypervisor_hostname: "compute-1.example.internal",
          "openstack.region.name": "RegionTwo",
        }),
      ),
    ).toEqual(["Hypervisor:RegionTwo/compute-1.example.internal"]);
  });

  test("an ID could be a router, an instance or a volume, and the rows decide", () => {
    expect(kinds(getOpenStackPartOfSeries({ id: "x" }))).toEqual([
      "Router:x",
      "Instance:x",
      "Volume:x",
    ]);
  });

  test("a pool by the only shape that is a pool's", () => {
    expect(
      kinds(
        getOpenStackPartOfSeries({
          name: "host@lvm#lvm",
          "openstack.region.name": "RegionOne",
        }),
      ),
    ).toEqual(["StoragePool:RegionOne/host@lvm#lvm"]);
    expect(getOpenStackPartOfSeries({ name: "ou-running" })).toEqual([]);
  });

  test("a whole region is its API, by the metric the monitor reads", () => {
    expect(
      kinds(
        getOpenStackPartOfSeries({ "openstack.region.name": "RegionOne" }, [
          "openstack_nova_up",
        ]),
      ),
    ).toEqual(["Api:RegionOne/compute"]);
    expect(
      getOpenStackPartOfSeries({ "openstack.region.name": "RegionOne" }),
    ).toEqual([]);
  });

  test("a monitor that reads anything else as well is not about the API", () => {
    expect(
      getOpenStackPartOfSeries({ "openstack.region.name": "RegionOne" }, [
        "openstack_nova_server_status",
        "openstack_nova_up",
      ]),
    ).toEqual([]);
  });

  test("labels as ingest writes them are read too", () => {
    expect(
      kinds(getOpenStackPartOfSeries({ "resource.router_id": "r-1" })),
    ).toEqual(["Router:r-1"]);
  });

  test("a project a series names for itself", () => {
    expect(getOpenStackProjectOfSeries({ tenant_id: "a" })).toBe("a");
    expect(getOpenStackProjectOfSeries({ project_id: "b" })).toBe("b");
    expect(getOpenStackProjectOfSeries({})).toBeNull();
  });
});

describe("the metrics a monitor reads", () => {
  test("from its steps, whatever else they hold", () => {
    expect(
      getOpenStackMetricNamesOfMonitor({
        data: {
          monitorStepsInstanceArray: [
            {
              data: {
                openstackMonitor: {
                  metricViewConfig: {
                    queryConfigs: [
                      {
                        metricQueryData: {
                          filterData: { metricName: "openstack_nova_up" },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    ).toEqual(["openstack_nova_up"]);
  });

  test("not a template's anchor, which is no part of what it is about", () => {
    expect(
      getOpenStackMetricNamesOfMonitor({
        data: {
          monitorStepsInstanceArray: [
            {
              data: {
                openstackMonitor: {
                  metricViewConfig: {
                    queryConfigs: [
                      {
                        metricAliasData: {
                          metricVariable: OPENSTACK_ANCHOR_METRIC_ALIAS,
                        },
                        metricQueryData: {
                          filterData: { metricName: "openstack_nova_up" },
                        },
                      },
                      {
                        metricQueryData: {
                          filterData: {
                            metricName: "openstack_nova_server_status",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    ).toEqual(["openstack_nova_server_status"]);
  });

  test.each([
    [undefined],
    [null],
    [{}],
    [{ data: {} }],
    [{ data: { monitorStepsInstanceArray: "nope" } }],
    [{ data: { monitorStepsInstanceArray: [{}, { data: null }] } }],
  ])("step JSON is not schema-checked: %j", (steps: unknown) => {
    expect(getOpenStackMetricNamesOfMonitor(steps)).toEqual([]);
  });
});

describe("what a description says", () => {
  test("how many instances in which projects, the sentence #5730 asks for", () => {
    const text: string = OpenStackAlertContext.toMarkdown(
      context({ radius: radius() }),
    );

    expect(describeOpenStackBlastRadius(radius())).toBe(
      "3 instances in 2 projects",
    );
    expect(text).toContain("3 instances in 2 projects");
    expect(text).toContain("ou-payments");
    expect(text).toContain("ou-research");
    expect(text).toContain(`OpenStack project \`${OU_PAYMENTS}\``);
    expect(text).toContain("OpenStack domain `default`");
  });

  test("says how many are not named, past the cap", () => {
    expect(
      OpenStackAlertContext.toMarkdown(
        context({ radius: radius({ projectCount: 52 }) }),
      ),
    ).toContain("and 50 more");
  });

  test("nothing, when a radius cannot say or holds nothing", () => {
    expect(
      OpenStackAlertContext.toMarkdown(
        context({ radius: getEmptyOpenStackBlastRadius(false) }),
      ),
    ).toBe("");
    expect(
      OpenStackAlertContext.toMarkdown(
        context({ radius: getEmptyOpenStackBlastRadius(true) }),
      ),
    ).toBe("");
    expect(OpenStackAlertContext.toMarkdown(context())).toBe("");
  });

  test("a project's own series names it, with its domain", () => {
    const text: string = OpenStackAlertContext.toMarkdown(
      context({
        projectId: OU_PAYMENTS,
        projectName: "ou-payments",
        domainId: "default",
      }),
    );

    expect(text).toContain(`OpenStack project \`${OU_PAYMENTS}\``);
    expect(text).toContain("OpenStack domain `default`");
  });

  test("a tenant's name is written as text, never as Markdown", () => {
    const text: string = OpenStackAlertContext.toMarkdown(
      context({
        projectId: OU_PAYMENTS,
        projectName: "[click](http://evil.example) **now**",
      }),
    );

    expect(text).not.toContain("[click](http://evil.example)");
    expect(text).not.toContain("**now**");
  });
});

describe("adding it to a description", () => {
  const cloud: OpenStackCloud = new OpenStackCloud();
  cloud._id = CLOUD_ID.toString();
  cloud.id = CLOUD_ID;

  test("leaves one with no OpenStack cloud alone, and reads nothing", async () => {
    const spy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OpenStackResourceService,
      "findOneBy",
    );

    expect(
      await OpenStackAlertContext.addToDescription({
        description: "Down",
        projectId: PROJECT_ID,
        clouds: undefined,
        seriesLabels: { hostname: "h" },
      }),
    ).toBe("Down");
    expect(
      await OpenStackAlertContext.addToDescription({
        description: "Down",
        projectId: PROJECT_ID,
        clouds: [cloud],
        seriesLabels: undefined,
      }),
    ).toBe("Down");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test("a failed read never gets in the way of the alert", async () => {
    const spy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackResourceService, "findOneBy")
      .mockRejectedValue(new Error("database is gone") as never);

    expect(
      await OpenStackAlertContext.addToDescription({
        description: "Down",
        projectId: PROJECT_ID,
        clouds: [cloud],
        seriesLabels: { id: "x" },
      }),
    ).toBe("Down");
    spy.mockRestore();
  });

  test("the stopped nova-compute drill: says how many instances, in which projects", async () => {
    const findOneBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackResourceService, "findOneBy")
      .mockImplementation((async (data: {
        query: { kind: OpenStackResourceKind; externalId: string };
      }): Promise<OpenStackResource | null> => {
        if (
          data.query.kind === OpenStackResourceKind.Service &&
          data.query.externalId === "RegionOne/compute/compute-1/nova-compute"
        ) {
          return Object.assign(new OpenStackResource(), {
            kind: OpenStackResourceKind.Service,
            name: "nova-compute",
            regionName: "RegionOne",
            externalId: data.query.externalId,
            facts: { host: "compute-1" },
          });
        }
        return null;
      }) as never);
    const getBlastRadius: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackResourceService, "getBlastRadius")
      .mockResolvedValue(radius());

    const description: string | undefined =
      await OpenStackAlertContext.addToDescription({
        description: "nova-compute is down on compute-1.",
        projectId: PROJECT_ID,
        clouds: [cloud],
        seriesLabels: {
          hostname: "compute-1",
          service: "nova-compute",
          "openstack.region.name": "RegionOne",
        },
      });

    expect(description).toContain("nova-compute is down on compute-1.");
    expect(description).toContain("3 instances in 2 projects");
    expect(description).toContain("ou-payments");
    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    findOneBy.mockRestore();
    getBlastRadius.mockRestore();
  });
});

describe("an owner rule on a project assigns its team", () => {
  const team: Team = new Team();
  team._id = "70000000-0000-4000-8000-000000000001";
  team.id = new ObjectID(team._id);

  const ruleFor: (kind: "project" | "domain", id: string) => AlertOwnerRule = (
    kind: "project" | "domain",
    id: string,
  ): AlertOwnerRule => {
    const rule: AlertOwnerRule = new AlertOwnerRule();
    rule._id = ObjectID.generate().toString();
    rule.id = new ObjectID(rule._id);
    rule.name = "ou-payments owners";
    rule.alertDescriptionPattern = getOpenStackScopePattern({
      kind,
      id,
      name: "ou-payments",
    });
    rule.ownerTeams = [team];
    rule.ownerUsers = [];
    return rule;
  };

  const alertOn: (data: OpenStackAlertContextResult) => Alert = (
    data: OpenStackAlertContextResult,
  ): Alert => {
    const alert: Alert = new Alert();
    alert.projectId = PROJECT_ID;
    alert.description = `Instance failed.\n\n${OpenStackAlertContext.toMarkdown(data)}`;
    return alert;
  };

  const plan: (
    alert: Alert,
    rule: AlertOwnerRule,
  ) => Promise<OwnerRulePlan<AlertOwnerRule>> = async (
    alert: Alert,
    rule: AlertOwnerRule,
  ): Promise<OwnerRulePlan<AlertOwnerRule>> => {
    return await AlertOwnerRuleEngineService.planRules({
      alert,
      rules: [rule],
      allowOwnerNotification: true,
    });
  };

  test("on an alert on one of its instances", async () => {
    const result: OwnerRulePlan<AlertOwnerRule> = await plan(
      alertOn(
        context({
          projectId: OU_PAYMENTS,
          projectName: "ou-payments",
          partKind: OpenStackResourceKind.Instance,
        }),
      ),
      ruleFor("project", OU_PAYMENTS),
    );

    expect(result.anyRuleMatched).toBe(true);
    expect(result.allTeamIds.has(team._id!)).toBe(true);
  });

  test("and not on another project's", async () => {
    const result: OwnerRulePlan<AlertOwnerRule> = await plan(
      alertOn(context({ projectId: OU_RESEARCH })),
      ruleFor("project", OU_PAYMENTS),
    );

    expect(result.anyRuleMatched).toBe(false);
  });

  test("on an alert on a host holding its instances, among other projects'", async () => {
    const result: OwnerRulePlan<AlertOwnerRule> = await plan(
      alertOn(context({ radius: radius() })),
      ruleFor("project", OU_RESEARCH),
    );

    expect(result.anyRuleMatched).toBe(true);
  });

  test("by domain, on every project the alert reaches in it", async () => {
    const result: OwnerRulePlan<AlertOwnerRule> = await plan(
      alertOn(context({ radius: radius() })),
      ruleFor("domain", "default"),
    );

    expect(result.anyRuleMatched).toBe(true);
  });

  test("one ID that begins another is not taken for it", async () => {
    const result: OwnerRulePlan<AlertOwnerRule> = await plan(
      alertOn(context({ projectId: `${OU_PAYMENTS}ff` })),
      ruleFor("project", OU_PAYMENTS),
    );

    expect(result.anyRuleMatched).toBe(false);
  });

  test("a rename changes nothing, because the rule holds the ID", () => {
    expect(
      getOpenStackScopePattern({
        kind: "project",
        id: OU_PAYMENTS,
        name: "old name",
      }),
    ).toBe(
      getOpenStackScopePattern({
        kind: "project",
        id: OU_PAYMENTS,
        name: "new name",
      }),
    );
  });

  test("an ID with what a pattern reads as special is matched as written", async () => {
    const id: string = "a.b+c";
    const result: OwnerRulePlan<AlertOwnerRule> = await plan(
      alertOn(context({ projectId: id })),
      ruleFor("project", id),
    );

    expect(result.anyRuleMatched).toBe(true);
    expect(
      (
        await plan(
          alertOn(context({ projectId: "axb+c" })),
          ruleFor("project", id),
        )
      ).anyRuleMatched,
    ).toBe(false);
  });

  test("an incident's rule is written the same way", () => {
    const rule: IncidentOwnerRule = new IncidentOwnerRule();
    rule.incidentDescriptionPattern = getOpenStackScopePattern({
      kind: "project",
      id: OU_PAYMENTS,
      name: "ou-payments",
    });

    expect(rule.incidentDescriptionPattern).toContain(OU_PAYMENTS);
  });
});
