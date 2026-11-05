import { afterEach, describe, expect, jest, test } from "@jest/globals";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudLabelRule from "../../../../Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudOwnerRule from "../../../../Models/DatabaseModels/OpenStackCloudOwnerRule";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import Team from "../../../../Models/DatabaseModels/Team";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentOwnerTeamService from "../../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../../Server/Services/IncidentService";
import LabelService from "../../../../Server/Services/LabelService";
import OpenStackCloudFeedService from "../../../../Server/Services/OpenStackCloudFeedService";
import OpenStackCloudLabelRuleEngineService from "../../../../Server/Services/OpenStackCloudLabelRuleEngineService";
import OpenStackCloudLabelRuleService from "../../../../Server/Services/OpenStackCloudLabelRuleService";
import OpenStackCloudOwnerRuleEngineService from "../../../../Server/Services/OpenStackCloudOwnerRuleEngineService";
import OpenStackCloudOwnerRuleService from "../../../../Server/Services/OpenStackCloudOwnerRuleService";
import OpenStackCloudOwnerTeamService from "../../../../Server/Services/OpenStackCloudOwnerTeamService";
import OpenStackCloudOwnerUserService from "../../../../Server/Services/OpenStackCloudOwnerUserService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import OpenStackAlertContext, {
  OpenStackSeriesDescription,
  getOpenStackProjectsReached,
} from "../../../../Server/Utils/OpenStack/OpenStackAlertContext";
import OpenStackScopedRules, {
  OpenStackScopedRulesMatch,
} from "../../../../Server/Utils/OpenStack/OpenStackScopedRules";
import { RuleApplicationResult } from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import RuleRecordScope from "../../../../Server/Utils/Rules/RuleRecordScope";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT,
  OpenStackBlastRadius,
  OpenStackBlastRadiusCount,
  buildOpenStackBlastRadius,
} from "../../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackReachedProject,
  doesOpenStackRuleReach,
  isOpenStackRuleScoped,
} from "../../../../Types/OpenStack/OpenStackScopedRule";

/*
 * #5728's done-when: an owner rule on a test project assigns its team to an alert on one of
 * its instances. Through what a monitor runs for the series it is opening an alert about
 * (OpenStackAlertContext.describeSeries, then OpenStackScopedRules), with the rule
 * evaluated by the cloud rule engine. Reads and writes are stood in for here, and
 * Scripts/Postgres/CheckSchemaDrift.sh holds the two columns to their migration.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const OU_PAYMENTS: string = "f3a1c0d2e4b64f7c8a9d0e1f2a3b4c5d";
const OU_RESEARCH: string = "9bc2d1e0f4a64b3c8d7e6f5a4b3c2d1e";
const INSTANCE: string = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";

function withId<T extends { _id?: string; id: ObjectID | null }>(row: T): T {
  row._id = ObjectID.generate().toString();
  row.id = new ObjectID(row._id);
  return row;
}

const TEAM: Team = withId(new Team());
TEAM.name = "Payments";

const LABEL: Label = withId(new Label());
LABEL.name = "payments";

function ownerRule(
  fields: Partial<OpenStackCloudOwnerRule>,
): OpenStackCloudOwnerRule {
  const rule: OpenStackCloudOwnerRule = withId(new OpenStackCloudOwnerRule());
  rule.name = "ou-payments owners";
  rule.ownerTeams = [TEAM];
  rule.ownerUsers = [];
  return Object.assign(rule, fields);
}

function labelRule(
  fields: Partial<OpenStackCloudLabelRule>,
): OpenStackCloudLabelRule {
  const rule: OpenStackCloudLabelRule = withId(new OpenStackCloudLabelRule());
  rule.name = "ou-payments labels";
  rule.labelsToAdd = [LABEL];
  return Object.assign(rule, fields);
}

function cloud(name: string = "prod"): OpenStackCloud {
  const row: OpenStackCloud = new OpenStackCloud();
  row.id = CLOUD_ID;
  row._id = CLOUD_ID.toString();
  row.name = name;
  row.labels = [];
  return row;
}

// The rules a project holds, and the inventory a series is looked up in.
function standIn(data: {
  ownerRules?: Array<OpenStackCloudOwnerRule>;
  labelRules?: Array<OpenStackCloudLabelRule>;
  cloudName?: string;
  radius?: OpenStackBlastRadius;
}): void {
  jest
    .spyOn(OpenStackCloudOwnerRuleService, "findBy")
    .mockResolvedValue(data.ownerRules || []);
  jest
    .spyOn(OpenStackCloudLabelRuleService, "findBy")
    .mockResolvedValue(data.labelRules || []);
  jest
    .spyOn(OpenStackCloudService, "findOneById")
    .mockResolvedValue(cloud(data.cloudName));
  jest
    .spyOn(RuleRecordScope, "keepIdsInProject")
    .mockImplementation(async (scope: { ids: Array<string> }) => {
      return scope.ids;
    });
  jest
    .spyOn(OpenStackResourceService, "findOneBy")
    .mockImplementation((async (read: {
      query: { kind: string; externalId: string };
    }) => {
      const row: OpenStackResource = new OpenStackResource();
      row.kind = read.query.kind as never;
      row.externalId = read.query.externalId;
      if (read.query.kind === "Project") {
        row.name = read.query.externalId === OU_PAYMENTS ? "ou-payments" : "x";
        row.facts = { domainId: "acme" };
        return row;
      }
      if (
        read.query.kind === "Instance" &&
        read.query.externalId === INSTANCE
      ) {
        row.name = "web-1";
        row.openStackProjectId = OU_PAYMENTS;
        return row;
      }
      if (read.query.kind === "Hypervisor") {
        row.name = "compute-1";
        row.hypervisorName = "compute-1";
        return row;
      }
      return null;
    }) as never);
  if (data.radius) {
    jest
      .spyOn(OpenStackResourceService, "getBlastRadius")
      .mockResolvedValue(data.radius);
  }
}

async function describeInstance(
  labels: JSONObject = {
    uuid: INSTANCE,
    "openstack.region.name": "RegionOne",
  },
): Promise<OpenStackSeriesDescription> {
  return await OpenStackAlertContext.describeSeries({
    description: "An instance went into ERROR.",
    projectId: PROJECT_ID,
    clouds: [cloud()],
    seriesLabels: labels,
  });
}

async function matchFor(
  series: OpenStackSeriesDescription,
): Promise<OpenStackScopedRulesMatch> {
  return await OpenStackScopedRules.read({
    projectId: PROJECT_ID,
    openStackCloudId: series.openStackCloudId,
    reached: series.reached,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a rule says it is about", () => {
  test("a rule naming neither owns whole clouds, and reaches nothing", () => {
    expect(isOpenStackRuleScoped({})).toBe(false);
    expect(isOpenStackRuleScoped({ openStackProjectId: "  " })).toBe(false);
    expect(
      doesOpenStackRuleReach({}, [
        { projectId: OU_PAYMENTS, domainId: "acme" },
      ]),
    ).toBe(false);
  });

  test("a project, a domain, or a project only while it is in that domain", () => {
    const reached: Array<OpenStackReachedProject> = [
      { projectId: OU_PAYMENTS, domainId: "acme" },
      { projectId: OU_RESEARCH },
    ];

    expect(
      doesOpenStackRuleReach({ openStackProjectId: OU_PAYMENTS }, reached),
    ).toBe(true);
    expect(
      doesOpenStackRuleReach({ openStackProjectId: "another" }, reached),
    ).toBe(false);
    expect(doesOpenStackRuleReach({ openStackDomainId: "acme" }, reached)).toBe(
      true,
    );
    expect(
      doesOpenStackRuleReach({ openStackDomainId: "default" }, reached),
    ).toBe(false);
    expect(
      doesOpenStackRuleReach(
        { openStackProjectId: OU_PAYMENTS, openStackDomainId: "acme" },
        reached,
      ),
    ).toBe(true);
    // Each is true of something, but not of the same project.
    expect(
      doesOpenStackRuleReach(
        { openStackProjectId: OU_RESEARCH, openStackDomainId: "acme" },
        reached,
      ),
    ).toBe(false);
  });

  test("one ID that begins another is not taken for it", () => {
    expect(
      doesOpenStackRuleReach(
        { openStackProjectId: OU_PAYMENTS.substring(0, 12) },
        [{ projectId: OU_PAYMENTS }],
      ),
    ).toBe(false);
  });
});

describe("an owner rule on a project", () => {
  test("assigns its team to an alert on one of its instances, and says so", async () => {
    standIn({ ownerRules: [ownerRule({ openStackProjectId: OU_PAYMENTS })] });
    const addOwners: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertService, "addOwners")
      .mockResolvedValue(undefined);
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    jest.spyOn(AlertOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertOwnerTeamService, "findBy").mockResolvedValue([]);
    jest.spyOn(TeamService, "findBy").mockResolvedValue([TEAM]);
    jest.spyOn(UserService, "findBy").mockResolvedValue([]);

    const series: OpenStackSeriesDescription = await describeInstance();
    const alertId: ObjectID = ObjectID.generate();

    expect(series.description).toContain("ou-payments");
    expect(series.reached).toEqual([
      { projectId: OU_PAYMENTS, domainId: "acme" },
    ]);

    await OpenStackScopedRules.finishAlert({
      projectId: PROJECT_ID,
      alertId,
      match: await matchFor(series),
    });

    expect(addOwners).toHaveBeenCalledTimes(1);
    const call: Array<unknown> = addOwners.mock.calls[0] as Array<unknown>;
    expect(call[0]).toBe(PROJECT_ID);
    expect(call[1]).toBe(alertId);
    expect(call[2]).toEqual([]);
    expect((call[3] as Array<ObjectID>).map(String)).toEqual([
      TEAM.id!.toString(),
    ]);
    expect(call[4]).toBe(true);
    expect(feed).toHaveBeenCalledTimes(1);
    const said: string = (
      feed.mock.calls[0] as Array<{ feedInfoInMarkdown: string }>
    )[0]!.feedInfoInMarkdown;
    expect(said).toContain("OpenStack Owner Rule");
    expect(said).toContain("ou-payments owners");
    expect(said).toContain("Payments");
  });

  test("does not on an alert on another project's instance", async () => {
    standIn({ ownerRules: [ownerRule({ openStackProjectId: OU_RESEARCH })] });

    const match: OpenStackScopedRulesMatch = await matchFor(
      await describeInstance(),
    );

    expect(match.owners).toEqual([]);
    expect(match.ownerRuleNames).toEqual([]);
  });

  test("does not tell the owners of a rule that asks not to", async () => {
    standIn({
      ownerRules: [
        ownerRule({ openStackProjectId: OU_PAYMENTS, notifyOwners: false }),
      ],
    });

    const match: OpenStackScopedRulesMatch = await matchFor(
      await describeInstance(),
    );

    expect(match.owners).toEqual([
      { notify: false, userIds: [], teamIds: [TEAM.id!.toString()] },
    ]);
  });

  test("reaches an incident too, and an owner it already has is not said to be added", async () => {
    const addOwners: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentService, "addOwners")
      .mockResolvedValue(undefined);
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([]);
    const already: AlertOwnerTeam = new AlertOwnerTeam();
    already.teamId = TEAM.id!;
    jest
      .spyOn(IncidentOwnerTeamService, "findBy")
      .mockResolvedValue([already] as never);

    await OpenStackScopedRules.finishIncident({
      projectId: PROJECT_ID,
      incidentId: ObjectID.generate(),
      match: {
        labelIds: [],
        labelRuleNames: [],
        owners: [{ notify: true, userIds: [], teamIds: [TEAM.id!.toString()] }],
        ownerRuleNames: ["ou-payments owners"],
      },
    });

    expect(addOwners).toHaveBeenCalledTimes(1);
    expect(feed).not.toHaveBeenCalled();
  });
});

describe("a rule on a project a host's outage reaches", () => {
  const manyProjects: Array<{ projectId: string; count: number }> = Array.from(
    { length: OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT + 10 },
    (_: unknown, index: number): { projectId: string; count: number } => {
      return { projectId: `project-${index}`, count: 1000 - index };
    },
  );
  const radiusOf: (includeEveryProject: boolean) => OpenStackBlastRadius = (
    includeEveryProject: boolean,
  ): OpenStackBlastRadius => {
    return buildOpenStackBlastRadius({
      counts: [
        {
          count: "instanceCount" as OpenStackBlastRadiusCount,
          byProject: manyProjects,
        },
      ],
      projectDomains: { "project-59": "acme" },
      includeEveryProject,
    });
  };

  test("reaches past the fifty a description names", async () => {
    const radius: OpenStackBlastRadius = radiusOf(true);
    expect(radius.projects).toHaveLength(OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT);
    expect(
      radius.projects.map((one: { projectId: string }) => {
        return one.projectId;
      }),
    ).not.toContain("project-59");

    standIn({
      ownerRules: [ownerRule({ openStackProjectId: "project-59" })],
      labelRules: [labelRule({ openStackDomainId: "acme" })],
      radius,
    });

    const series: OpenStackSeriesDescription = await describeInstance({
      hypervisor_hostname: "compute-1",
      "openstack.region.name": "RegionOne",
    });
    const match: OpenStackScopedRulesMatch = await matchFor(series);

    expect(series.reached).toHaveLength(manyProjects.length);
    expect(match.owners[0]?.teamIds).toEqual([TEAM.id!.toString()]);
    expect(match.labelIds).toEqual([LABEL.id!.toString()]);
  });

  test("a page's radius does not carry every project", () => {
    expect(radiusOf(false).everyProject).toBeUndefined();
  });

  test("a radius without the full list still reaches what it names", () => {
    const radius: OpenStackBlastRadius = radiusOf(false);

    expect(
      getOpenStackProjectsReached({
        radius,
        projectId: null,
        projectName: null,
        domainId: null,
        partKind: null,
      }),
    ).toHaveLength(OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT);
  });
});

describe("a rule on a domain", () => {
  test("reaches every project in it, on the clouds its other conditions allow", async () => {
    standIn({
      cloudName: "prod",
      ownerRules: [
        ownerRule({
          openStackDomainId: "acme",
          openStackCloudNamePattern: "^prod$",
        }),
      ],
    });

    expect(
      (await matchFor(await describeInstance())).owners[0]?.teamIds,
    ).toEqual([TEAM.id!.toString()]);
  });

  test("not on another cloud's domain of the same name", async () => {
    standIn({
      cloudName: "staging",
      ownerRules: [
        ownerRule({
          openStackDomainId: "acme",
          openStackCloudNamePattern: "^prod$",
        }),
      ],
    });

    expect((await matchFor(await describeInstance())).owners).toEqual([]);
  });
});

describe("a label rule on a project", () => {
  test("its labels go on the row before it is created, beside the criteria's", async () => {
    standIn({ labelRules: [labelRule({ openStackProjectId: OU_PAYMENTS })] });

    const match: OpenStackScopedRulesMatch = await matchFor(
      await describeInstance(),
    );

    const fromCriteria: Label = withId(new Label());
    const incident: Incident = new Incident();
    incident.labels = [fromCriteria];
    OpenStackScopedRules.addLabels(incident, match);
    OpenStackScopedRules.addLabels(incident, match);

    expect(
      incident.labels.map((label: Label) => {
        return label._id;
      }),
    ).toEqual([fromCriteria._id, LABEL._id]);
  });

  test("the feed names the rule and the labels", async () => {
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentOwnerTeamService, "findBy").mockResolvedValue([]);
    jest.spyOn(LabelService, "findBy").mockResolvedValue([LABEL]);

    await OpenStackScopedRules.finishIncident({
      projectId: PROJECT_ID,
      incidentId: ObjectID.generate(),
      match: {
        labelIds: [LABEL.id!.toString()],
        labelRuleNames: ["ou-payments labels"],
        owners: [],
        ownerRuleNames: [],
      },
    });

    const said: string = (
      feed.mock.calls[0] as Array<{ feedInfoInMarkdown: string }>
    )[0]!.feedInfoInMarkdown;
    expect(said).toContain("OpenStack Label Rule");
    expect(said).toContain("ou-payments labels");
    expect(said).toContain("payments");
  });
});

describe("the cloud itself", () => {
  test("a rule on a project adds nothing to it, even from Run Now", async () => {
    standIn({});
    const addUser: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OpenStackCloudOwnerUserService,
      "findBy",
    );
    const addTeam: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OpenStackCloudOwnerTeamService,
      "findBy",
    );

    const result: RuleApplicationResult =
      await OpenStackCloudOwnerRuleEngineService.applyRulesToExistingResource({
        resource: Object.assign(cloud(), { projectId: PROJECT_ID }),
        rules: [ownerRule({ openStackProjectId: OU_PAYMENTS })],
        allowOwnerNotification: false,
      });

    expect(result.matched).toBe(false);
    expect(addUser).not.toHaveBeenCalled();
    expect(addTeam).not.toHaveBeenCalled();

    const labels: RuleApplicationResult =
      await OpenStackCloudLabelRuleEngineService.applyRulesToExistingResource({
        resource: Object.assign(cloud(), { projectId: PROJECT_ID }),
        rules: [labelRule({ openStackDomainId: "acme" })],
        allowOwnerNotification: false,
      });

    expect(labels.matched).toBe(false);
  });

  test("a rule naming neither still owns the cloud, as it always did", async () => {
    standIn({});
    jest.spyOn(OpenStackCloudOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(OpenStackCloudOwnerTeamService, "findBy").mockResolvedValue([]);
    const create: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackCloudOwnerTeamService, "create")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OpenStackCloudService, "getOpenStackCloudMarkdownLink")
      .mockResolvedValue("prod" as never);
    jest
      .spyOn(OpenStackCloudFeedService, "createOpenStackCloudFeedItem")
      .mockResolvedValue(undefined as never);

    const result: RuleApplicationResult =
      await OpenStackCloudOwnerRuleEngineService.applyRulesToExistingResource({
        resource: Object.assign(cloud(), { projectId: PROJECT_ID }),
        rules: [ownerRule({})],
        allowOwnerNotification: false,
      });

    expect(result.matched).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("never in the way of the alert", () => {
  test("a rule read that fails leaves it opening without them", async () => {
    standIn({});
    jest
      .spyOn(OpenStackCloudOwnerRuleService, "findBy")
      .mockRejectedValue(new Error("Postgres went away"));
    const logged: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    const match: OpenStackScopedRulesMatch = await matchFor(
      await describeInstance(),
    );

    expect(match.labelIds).toEqual([]);
    expect(match.owners).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });

  test("an alert on nothing in a cloud reads no rules at all", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OpenStackCloudOwnerRuleService,
      "findBy",
    );

    const series: OpenStackSeriesDescription =
      await OpenStackAlertContext.describeSeries({
        description: "A website went down.",
        projectId: PROJECT_ID,
        clouds: undefined,
        seriesLabels: { url: "https://example.com" },
      });

    expect(series.description).toBe("A website went down.");
    expect(
      await OpenStackScopedRules.read({
        projectId: PROJECT_ID,
        openStackCloudId: series.openStackCloudId,
        reached: series.reached,
      }),
    ).toEqual({
      labelIds: [],
      labelRuleNames: [],
      owners: [],
      ownerRuleNames: [],
    });
    expect(read).not.toHaveBeenCalled();
  });
});
