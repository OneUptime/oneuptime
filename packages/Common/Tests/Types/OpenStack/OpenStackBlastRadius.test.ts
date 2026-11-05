import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_BLAST_RADIUS_COUNTS,
  OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT,
  OPENSTACK_REACH_HEADING,
  OpenStackBlastRadius,
  OpenStackBlastRadiusProject,
  buildOpenStackBlastRadius,
  describeOpenStackBlastRadius,
  describeOpenStackBlastRadiusCounts,
  getOpenStackDomainMarker,
  getOpenStackProjectMarker,
  getEmptyOpenStackBlastRadius,
  isOpenStackBlastRadiusEmpty,
  mergeOpenStackBlastRadii,
  removeOpenStackReachFromDescription,
} from "../../../Types/OpenStack/OpenStackBlastRadius";

/*
 * The one answer to "what does this failure take with it, and whose is it?". The
 * queries behind it are in OpenStackResourcePostgres.test.ts, on a real database.
 */
describe("buildOpenStackBlastRadius", () => {
  test("adds each kind up, overall and per project", () => {
    const radius: OpenStackBlastRadius = buildOpenStackBlastRadius({
      counts: [
        {
          count: "instanceCount",
          byProject: [
            { projectId: "payments", count: 3 },
            { projectId: "research", count: 1 },
          ],
        },
        {
          count: "floatingIpCount",
          byProject: [{ projectId: "research", count: 4 }],
        },
      ],
      projectNames: { payments: "Payments team" },
    });
    expect(radius.instanceCount).toBe(4);
    expect(radius.floatingIpCount).toBe(4);
    expect(radius.projectCount).toBe(2);
    expect(radius.projects).toEqual([
      {
        projectId: "research",
        name: null,
        instanceCount: 1,
        volumeCount: 0,
        routerCount: 0,
        floatingIpCount: 4,
        stackCount: 0,
        shareCount: 0,
        databaseInstanceCount: 0,
        objectContainerCount: 0,
        dnsZoneCount: 0,
        containerClusterCount: 0,
      },
      {
        projectId: "payments",
        name: "Payments team",
        instanceCount: 3,
        volumeCount: 0,
        routerCount: 0,
        floatingIpCount: 0,
        stackCount: 0,
        shareCount: 0,
        databaseInstanceCount: 0,
        objectContainerCount: 0,
        dnsZoneCount: 0,
        containerClusterCount: 0,
      },
    ]);
  });

  test("something with no project counts, and nobody is named for it", () => {
    const radius: OpenStackBlastRadius = buildOpenStackBlastRadius({
      counts: [
        {
          count: "instanceCount",
          byProject: [{ projectId: null, count: 5 }],
        },
      ],
    });
    expect(radius.instanceCount).toBe(5);
    expect(radius.projectCount).toBe(0);
    expect(radius.projects).toEqual([]);
  });

  test("the list is capped, and the count is not", () => {
    const projects: number = OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT + 7;
    const radius: OpenStackBlastRadius = buildOpenStackBlastRadius({
      counts: [
        {
          count: "instanceCount",
          byProject: Array.from(
            { length: projects },
            (_: unknown, i: number) => {
              return { projectId: `project-${i}`, count: i + 1 };
            },
          ),
        },
      ],
    });
    expect(radius.projectCount).toBe(projects);
    expect(radius.projects).toHaveLength(OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT);
    // The most affected are the ones that stay.
    expect(radius.projects[0]?.instanceCount).toBe(projects);
  });

  test("projects hit equally stay in a stable order", () => {
    const build: () => Array<string> = (): Array<string> => {
      return buildOpenStackBlastRadius({
        counts: [
          {
            count: "instanceCount",
            byProject: [
              { projectId: "b", count: 1 },
              { projectId: "a", count: 1 },
            ],
          },
        ],
      }).projects.map((project: { projectId: string }) => {
        return project.projectId;
      });
    };
    expect(build()).toEqual(["a", "b"]);
  });

  test("says when what was collected cannot tell", () => {
    expect(buildOpenStackBlastRadius({ counts: [] }).isKnown).toBe(true);
    expect(
      buildOpenStackBlastRadius({ counts: [], isKnown: false }).isKnown,
    ).toBe(false);
    expect(getEmptyOpenStackBlastRadius(false).isKnown).toBe(false);
  });

  test("empty is empty, and anything at all is not", () => {
    expect(isOpenStackBlastRadiusEmpty(getEmptyOpenStackBlastRadius())).toBe(
      true,
    );
    for (const count of [
      "instanceCount",
      "volumeCount",
      "routerCount",
      "floatingIpCount",
    ] as const) {
      expect(
        isOpenStackBlastRadiusEmpty(
          buildOpenStackBlastRadius({
            counts: [{ count, byProject: [{ projectId: "p", count: 1 }] }],
          }),
        ),
      ).toBe(false);
    }
  });
});

describe("the words outside the Dashboard", () => {
  test("says only what there is, each counted right", () => {
    expect(
      describeOpenStackBlastRadiusCounts({
        instanceCount: 1,
        volumeCount: 0,
        routerCount: 2,
        floatingIpCount: 1,
      }),
    ).toBe("1 instance, 2 routers, 1 floating IP");
  });

  test("says in how many projects, when it knows", () => {
    expect(
      describeOpenStackBlastRadius({
        ...getEmptyOpenStackBlastRadius(),
        instanceCount: 42,
        projectCount: 7,
      }),
    ).toBe("42 instances in 7 projects");
    expect(
      describeOpenStackBlastRadius({
        ...getEmptyOpenStackBlastRadius(),
        instanceCount: 1,
        projectCount: 1,
      }),
    ).toBe("1 instance in 1 project");
    expect(
      describeOpenStackBlastRadius({
        ...getEmptyOpenStackBlastRadius(),
        routerCount: 1,
      }),
    ).toBe("1 router");
    expect(describeOpenStackBlastRadius(getEmptyOpenStackBlastRadius())).toBe(
      "",
    );
  });

  test("a project's domain comes with it when the inventory says", () => {
    const radius: OpenStackBlastRadius = buildOpenStackBlastRadius({
      counts: [
        {
          count: "instanceCount",
          byProject: [
            { projectId: "a", count: 1 },
            { projectId: "b", count: 1 },
          ],
        },
      ],
      projectDomains: { a: "acme" },
    });

    expect(radius.projects[0]?.domainId).toBe("acme");
    // An unknown domain is left out, rather than saying null.
    expect("domainId" in (radius.projects[1] || {})).toBe(false);
  });

  test("the markers a rule matches hold the ID, closed", () => {
    expect(getOpenStackProjectMarker("abc")).toBe("OpenStack project `abc`");
    expect(getOpenStackDomainMarker("abc")).toBe("OpenStack domain `abc`");
  });
});

describe("stacks and Kubernetes clusters", () => {
  const radius: OpenStackBlastRadius = buildOpenStackBlastRadius({
    counts: [
      {
        count: "stackCount",
        byProject: [
          { projectId: "payments", count: 2 },
          { projectId: "research", count: 1 },
        ],
      },
      {
        count: "containerClusterCount",
        byProject: [{ projectId: "payments", count: 1 }],
      },
    ],
  });

  test("add up as everything else does, most affected first", () => {
    expect(radius.stackCount).toBe(3);
    expect(radius.containerClusterCount).toBe(1);
    expect(radius.projectCount).toBe(2);
    expect(radius.projects[0]).toMatchObject({
      projectId: "payments",
      stackCount: 2,
      containerClusterCount: 1,
    });
  });

  test("say what they are in words", () => {
    expect(describeOpenStackBlastRadius(radius)).toBe(
      "3 stacks, 1 Kubernetes cluster in 2 projects",
    );
  });

  test("count towards a radius not being empty", () => {
    expect(isOpenStackBlastRadiusEmpty(radius)).toBe(false);
    expect(isOpenStackBlastRadiusEmpty(getEmptyOpenStackBlastRadius())).toBe(
      true,
    );
  });

  test("every count a radius holds is in the table a page and an alert read", () => {
    const counted: Array<string> = OPENSTACK_BLAST_RADIUS_COUNTS.map(
      (entry: { count: string }): string => {
        return entry.count;
      },
    ).sort();
    const held: Array<string> = Object.keys(getEmptyOpenStackBlastRadius())
      .filter((key: string): boolean => {
        return key.endsWith("Count") && key !== "projectCount";
      })
      .sort();
    expect(counted).toEqual(held);
  });
});

describe("what several parts take with them", () => {
  test("a project on two hosts is one project, holding what it holds on both", () => {
    const merged: OpenStackBlastRadius = mergeOpenStackBlastRadii([
      buildOpenStackBlastRadius({
        counts: [
          {
            count: "instanceCount",
            byProject: [
              { projectId: "payments", count: 3 },
              { projectId: null, count: 1 },
            ],
          },
        ],
        projectNames: { payments: "ou-payments" },
        includeEveryProject: true,
      }),
      buildOpenStackBlastRadius({
        counts: [
          {
            count: "instanceCount",
            byProject: [
              { projectId: "payments", count: 2 },
              { projectId: "research", count: 1 },
            ],
          },
        ],
        projectNames: { research: "ou-research" },
        includeEveryProject: true,
      }),
    ]);

    expect(merged.instanceCount).toBe(7);
    expect(merged.projectCount).toBe(2);
    expect(
      merged.everyProject?.map((project: OpenStackBlastRadiusProject) => {
        return [project.projectId, project.name, project.instanceCount];
      }),
    ).toEqual([
      ["payments", "ou-payments", 5],
      ["research", "ou-research", 1],
    ]);
    expect(merged.isKnown).toBe(true);
  });

  test("past the cap, each project still holds what it holds", () => {
    const byProject: Array<{ projectId: string; count: number }> = [];
    for (let index: number = 0; index < 60; index++) {
      byProject.push({ projectId: `p${index}`, count: 100 - index });
    }
    const merged: OpenStackBlastRadius = mergeOpenStackBlastRadii([
      buildOpenStackBlastRadius({
        counts: [{ count: "instanceCount", byProject }],
        includeEveryProject: true,
      }),
    ]);

    expect(merged.projects).toHaveLength(OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT);
    expect(merged.everyProject).toHaveLength(60);
    expect(merged.projectCount).toBe(60);
  });

  test("known only when every part's reach is", () => {
    expect(
      mergeOpenStackBlastRadii([
        getEmptyOpenStackBlastRadius(true),
        getEmptyOpenStackBlastRadius(false),
      ]).isKnown,
    ).toBe(false);
  });
});

describe("what an incident's description keeps from a status page", () => {
  test("everything from the heading on is for the team", () => {
    const description: string = `A compute host stopped.\n\n${OPENSTACK_REACH_HEADING}\n\n**What this affects:** 3 instances in 1 project.\n\n- ou-payments: 3 instances`;

    expect(removeOpenStackReachFromDescription(description)).toBe(
      "A compute host stopped.",
    );
  });

  test.each<[string, string | null | undefined, string]>([
    ["nothing to cut", "A compute host stopped.", "A compute host stopped."],
    ["no description", undefined, ""],
    ["a null description", null, ""],
    [
      "only what the heading holds",
      `${OPENSTACK_REACH_HEADING}\n\n- ou-payments`,
      "",
    ],
    [
      "an edit above the heading stays",
      `Edited by a person.\n\n${OPENSTACK_REACH_HEADING}\n\nx`,
      "Edited by a person.",
    ],
    [
      "an edit below the heading does not",
      `Above.\n\n${OPENSTACK_REACH_HEADING}\n\nx\n\nBelow, by a person.`,
      "Above.",
    ],
  ])("%s", (
    _name: string,
    description: string | null | undefined,
    expected: string,
  ) => {
    expect(removeOpenStackReachFromDescription(description)).toBe(expected);
  });

  test("a description of megabytes on one line is cut without a quantifier", () => {
    const long: string = "x".repeat(4 * 1024 * 1024);

    expect(
      removeOpenStackReachFromDescription(
        `${long}\n\n${OPENSTACK_REACH_HEADING}\n\nsecret`,
      ),
    ).toBe(long);
  });
});
