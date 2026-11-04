import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT,
  OpenStackBlastRadius,
  buildOpenStackBlastRadius,
  describeOpenStackBlastRadius,
  describeOpenStackBlastRadiusCounts,
  getOpenStackDomainMarker,
  getOpenStackProjectMarker,
  getEmptyOpenStackBlastRadius,
  isOpenStackBlastRadiusEmpty,
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
      },
      {
        projectId: "payments",
        name: "Payments team",
        instanceCount: 3,
        volumeCount: 0,
        routerCount: 0,
        floatingIpCount: 0,
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
          byProject: Array.from({ length: projects }, (_: unknown, i: number) => {
            return { projectId: `project-${i}`, count: i + 1 };
          }),
        },
      ],
    });
    expect(radius.projectCount).toBe(projects);
    expect(radius.projects).toHaveLength(OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT);
    // The most affected are the ones that stay.
    expect(radius.projects[0]?.instanceCount).toBe(projects);
  });

  test("projects hit equally stay in a stable order", () => {
    const build = (): Array<string> => {
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
