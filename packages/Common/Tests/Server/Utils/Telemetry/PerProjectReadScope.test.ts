import PerProjectReadScope from "../../../../Server/Utils/Telemetry/PerProjectReadScope";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../../Types/BaseDatabase/Query";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { describe, expect, jest, test } from "@jest/globals";
import { Mock } from "jest-mock";
import { FindOperator, Raw } from "typeorm";

/*
 * A read across the caller's projects (no project named, or several) is
 * scoped project by project: each project's rows follow the caller's scope
 * in THAT project, a project whose grants refuse the read contributes no
 * row, and one project's scope never lets rows of another through.
 */

type GetClauseInProject = (
  projectProps: DatabaseCommonInteractionProps,
) => Promise<FindWhereProperty<any> | null>;

type PropsForFunction = (
  projectIds: Array<ObjectID>,
  extra?: Partial<DatabaseCommonInteractionProps>,
) => DatabaseCommonInteractionProps;

const propsFor: PropsForFunction = (
  projectIds: Array<ObjectID>,
  extra?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: projectIds,
      globalPermissions: [Permission.CurrentUser],
    },
    ...(extra || {}),
  };
};

interface RenderedClause {
  sql: string;
  parameters: Record<string, unknown>;
}

type RenderFunction = (
  clause: FindWhereProperty<any> | null,
  alias?: string,
) => RenderedClause;

const render: RenderFunction = (
  clause: FindWhereProperty<any> | null,
  alias?: string,
): RenderedClause => {
  expect(clause).toBeInstanceOf(FindOperator);
  const operator: FindOperator<unknown> = clause as FindOperator<unknown>;
  expect(operator.type).toBe("raw");

  return {
    sql: operator.getSql!(alias || "alias_id"),
    parameters: (operator.objectLiteralParameters || {}) as Record<
      string,
      unknown
    >,
  };
};

// The name of the parameter whose value is exactly `[projectId]`.
type ParameterForProjectFunction = (
  rendered: RenderedClause,
  projectIds: Array<ObjectID>,
) => string;

const parameterFor: ParameterForProjectFunction = (
  rendered: RenderedClause,
  projectIds: Array<ObjectID>,
): string => {
  const expected: Array<string> = projectIds.map((id: ObjectID): string => {
    return id.toString();
  });

  const names: Array<string> = Object.keys(rendered.parameters).filter(
    (name: string): boolean => {
      const value: unknown = rendered.parameters[name];
      return (
        Array.isArray(value) &&
        value.length === expected.length &&
        [...value].sort().join(",") === [...expected].sort().join(",")
      );
    },
  );

  expect(names).toHaveLength(1);
  return names[0]!;
};

// Every project id that any parameter carries.
type ProjectIdsInParametersFunction = (
  rendered: RenderedClause,
) => Array<string>;

const projectIdsInParameters: ProjectIdsInParametersFunction = (
  rendered: RenderedClause,
): Array<string> => {
  const ids: Array<string> = [];

  for (const name of Object.keys(rendered.parameters)) {
    if (!name.startsWith("scope")) {
      continue;
    }

    ids.push(...(rendered.parameters[name] as Array<string>));
  }

  return ids;
};

// A project's own scope clause, as the services build it: a Raw on `_id`.
type ScopeClauseFunction = (
  marker: string,
  parameterValue?: unknown,
) => FindWhereProperty<any>;

const scopeClause: ScopeClauseFunction = (
  marker: string,
  parameterValue?: unknown,
): FindWhereProperty<any> => {
  if (parameterValue === undefined) {
    return Raw((alias: string): string => {
      return `${alias} = '${marker}'`;
    });
  }

  return Raw(
    (alias: string): string => {
      return `${alias} IN (:...${marker})`;
    },
    { [marker]: parameterValue },
  );
};

describe("PerProjectReadScope", () => {
  test("works out two projects at a time", () => {
    expect(PerProjectReadScope.PROJECT_CONCURRENCY).toBe(2);
  });

  describe("isAcrossProjects", () => {
    test("a read that names no project is across the caller's projects", () => {
      expect(PerProjectReadScope.isAcrossProjects({})).toBe(true);
      expect(
        PerProjectReadScope.isAcrossProjects({ userId: ObjectID.generate() }),
      ).toBe(true);
    });

    test("a read that names one project is not", () => {
      expect(
        PerProjectReadScope.isAcrossProjects({
          tenantId: ObjectID.generate(),
        }),
      ).toBe(false);
      expect(
        PerProjectReadScope.isAcrossProjects({
          tenantId: ObjectID.generate(),
          isMultiTenantRequest: false,
        }),
      ).toBe(false);
    });

    test("a multi-tenant read is across projects even when it names one", () => {
      expect(
        PerProjectReadScope.isAcrossProjects({
          tenantId: ObjectID.generate(),
          isMultiTenantRequest: true,
        }),
      ).toBe(true);
      expect(
        PerProjectReadScope.isAcrossProjects({ isMultiTenantRequest: true }),
      ).toBe(true);
    });
  });

  describe("getProjectProps", () => {
    test("acts in the given project alone", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = propsFor([projectId], {
        isMultiTenantRequest: true,
      });

      const projectProps: DatabaseCommonInteractionProps =
        PerProjectReadScope.getProjectProps(props, projectId);

      expect(projectProps.tenantId!.toString()).toBe(projectId.toString());
      expect(projectProps.isMultiTenantRequest).toBe(false);
      expect(PerProjectReadScope.isAcrossProjects(projectProps)).toBe(false);
      // The caller stays the same caller.
      expect(projectProps.userId).toBe(props.userId);
      expect(projectProps.userGlobalAccessPermission).toBe(
        props.userGlobalAccessPermission,
      );
    });

    test("leaves the caller's props as they were", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = propsFor([projectId], {
        isMultiTenantRequest: true,
        currentPlan: PlanType.Scale,
        isSubscriptionUnpaid: false,
      });

      const projectProps: DatabaseCommonInteractionProps =
        PerProjectReadScope.getProjectProps(props, projectId);

      expect(projectProps).not.toBe(props);
      expect(props.tenantId).toBeUndefined();
      expect(props.isMultiTenantRequest).toBe(true);
      expect(props.currentPlan).toBe(PlanType.Scale);
    });

    test("is one object per request and project", () => {
      const projectA: ObjectID = ObjectID.generate();
      const projectB: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = propsFor([
        projectA,
        projectB,
      ]);

      const first: DatabaseCommonInteractionProps =
        PerProjectReadScope.getProjectProps(props, projectA);

      // The same project, even through another ObjectID instance.
      expect(PerProjectReadScope.getProjectProps(props, projectA)).toBe(first);
      expect(
        PerProjectReadScope.getProjectProps(
          props,
          new ObjectID(projectA.toString()),
        ),
      ).toBe(first);

      // Another project gets props of its own.
      const second: DatabaseCommonInteractionProps =
        PerProjectReadScope.getProjectProps(props, projectB);
      expect(second).not.toBe(first);
      expect(second.tenantId!.toString()).toBe(projectB.toString());
      expect(first.tenantId!.toString()).toBe(projectA.toString());
    });

    test("another request's props never share the cached object", () => {
      const projectId: ObjectID = ObjectID.generate();
      const propsOne: DatabaseCommonInteractionProps = propsFor([projectId]);
      const propsTwo: DatabaseCommonInteractionProps = propsFor([projectId]);

      const one: DatabaseCommonInteractionProps =
        PerProjectReadScope.getProjectProps(propsOne, projectId);
      const two: DatabaseCommonInteractionProps =
        PerProjectReadScope.getProjectProps(propsTwo, projectId);

      expect(one).not.toBe(two);
      expect(one.userId).toBe(propsOne.userId);
      expect(two.userId).toBe(propsTwo.userId);
    });

    test("carries no plan of the project the request named into another project", () => {
      const namedProject: ObjectID = ObjectID.generate();
      const otherProject: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = propsFor(
        [namedProject, otherProject],
        {
          tenantId: namedProject,
          isMultiTenantRequest: true,
          currentPlan: PlanType.Enterprise,
          isSubscriptionUnpaid: false,
        },
      );

      const other: DatabaseCommonInteractionProps =
        PerProjectReadScope.getProjectProps(props, otherProject);

      expect("currentPlan" in other).toBe(false);
      expect("isSubscriptionUnpaid" in other).toBe(false);
    });

    test("keeps the plan in the project the request named", () => {
      const namedProject: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = propsFor([namedProject], {
        tenantId: namedProject,
        isMultiTenantRequest: true,
        currentPlan: PlanType.Growth,
        isSubscriptionUnpaid: true,
      });

      const named: DatabaseCommonInteractionProps =
        PerProjectReadScope.getProjectProps(props, namedProject);

      expect(named.currentPlan).toBe(PlanType.Growth);
      expect(named.isSubscriptionUnpaid).toBe(true);
    });

    test("carries no plan when the request named no project", () => {
      const projectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = propsFor([projectId], {
        currentPlan: PlanType.Enterprise,
      });

      expect(
        "currentPlan" in PerProjectReadScope.getProjectProps(props, projectId),
      ).toBe(false);
    });
  });

  describe("getClauseAcrossProjects", () => {
    test("a caller with no projects reads nothing to scope, and no project is asked", async () => {
      const getClauseInProject: Mock<GetClauseInProject> =
        jest.fn<GetClauseInProject>();

      await expect(
        PerProjectReadScope.getClauseAcrossProjects({
          props: {},
          tableName: "MetricType",
          getClauseInProject: getClauseInProject,
        }),
      ).resolves.toBeNull();

      await expect(
        PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([]),
          tableName: "MetricType",
          getClauseInProject: getClauseInProject,
        }),
      ).resolves.toBeNull();

      expect(getClauseInProject).not.toHaveBeenCalled();
    });

    test("asks each project with the caller's props in that project", async () => {
      const projectA: ObjectID = ObjectID.generate();
      const projectB: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = propsFor(
        [projectA, projectB],
        {
          tenantId: projectA,
          isMultiTenantRequest: true,
          currentPlan: PlanType.Scale,
        },
      );

      const seen: Array<DatabaseCommonInteractionProps> = [];

      await PerProjectReadScope.getClauseAcrossProjects({
        props: props,
        tableName: "MetricType",
        getClauseInProject: async (
          projectProps: DatabaseCommonInteractionProps,
        ): Promise<FindWhereProperty<any> | null> => {
          seen.push(projectProps);
          return null;
        },
      });

      expect(
        seen
          .map((projectProps: DatabaseCommonInteractionProps): string => {
            return projectProps.tenantId!.toString();
          })
          .sort(),
      ).toEqual([projectA.toString(), projectB.toString()].sort());

      for (const projectProps of seen) {
        expect(projectProps.isMultiTenantRequest).toBe(false);
        expect(projectProps.userId).toBe(props.userId);
        // The cached props of that project, the ones ModelPermission keys on.
        expect(projectProps).toBe(
          PerProjectReadScope.getProjectProps(props, projectProps.tenantId!),
        );
      }

      const inB: DatabaseCommonInteractionProps = seen.find(
        (projectProps: DatabaseCommonInteractionProps): boolean => {
          return projectProps.tenantId!.toString() === projectB.toString();
        },
      )!;
      // Project A's plan does not decide what is read in project B.
      expect(inB.currentPlan).toBeUndefined();
    });

    test("every project read in full: no condition", async () => {
      await expect(
        PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([ObjectID.generate(), ObjectID.generate()]),
          tableName: "MetricType",
          getClauseInProject: async (): Promise<null> => {
            return null;
          },
        }),
      ).resolves.toBeNull();
    });

    test("every project refused: no condition (the table check leaves them out)", async () => {
      await expect(
        PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([ObjectID.generate(), ObjectID.generate()]),
          tableName: "MetricType",
          getClauseInProject: async (): Promise<null> => {
            throw new NotAuthorizedException("refused");
          },
        }),
      ).resolves.toBeNull();
    });

    test("refused and full projects alone: no condition", async () => {
      const refused: ObjectID = ObjectID.generate();

      await expect(
        PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([refused, ObjectID.generate()]),
          tableName: "MetricType",
          getClauseInProject: async (
            projectProps: DatabaseCommonInteractionProps,
          ): Promise<null> => {
            if (projectProps.tenantId!.toString() === refused.toString()) {
              throw new NotAuthorizedException("refused");
            }
            return null;
          },
        }),
      ).resolves.toBeNull();
    });

    test("an error other than a refusal is not swallowed", async () => {
      const failing: ObjectID = ObjectID.generate();

      await expect(
        PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([ObjectID.generate(), failing]),
          tableName: "MetricType",
          getClauseInProject: async (
            projectProps: DatabaseCommonInteractionProps,
          ): Promise<FindWhereProperty<any> | null> => {
            if (projectProps.tenantId!.toString() === failing.toString()) {
              throw new BadDataException("database is down");
            }
            return scopeClause("rows");
          },
        }),
      ).rejects.toThrow("database is down");
    });

    test("a project with a narrower scope: its rows, where its condition holds", async () => {
      const projectId: ObjectID = ObjectID.generate();

      const clause: FindWhereProperty<any> | null =
        await PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([projectId]),
          tableName: "TelemetryException",
          getClauseInProject: async (): Promise<FindWhereProperty<any>> => {
            return scopeClause("readableIds", ["svc-1", "svc-2"]);
          },
        });

      const rendered: RenderedClause = render(clause, "te_id");
      const projectParameter: string = parameterFor(rendered, [projectId]);

      expect(rendered.sql).toBe(
        `((te_id IN (SELECT "TelemetryException"."_id" FROM "TelemetryException" WHERE "TelemetryException"."projectId" IN (:...${projectParameter})) AND te_id IN (:...readableIds)))`,
      );
      // The project's own parameters travel with the condition.
      expect(rendered.parameters["readableIds"]).toEqual(["svc-1", "svc-2"]);
    });

    test("a project's condition with no parameters of its own", async () => {
      const projectId: ObjectID = ObjectID.generate();

      const rendered: RenderedClause = render(
        await PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([projectId]),
          tableName: "MetricType",
          getClauseInProject: async (): Promise<FindWhereProperty<any>> => {
            return scopeClause("only-this");
          },
        }),
        "a",
      );

      expect(Object.keys(rendered.parameters)).toEqual([
        parameterFor(rendered, [projectId]),
      ]);
      expect(rendered.sql).toContain(" AND a = 'only-this')");
    });

    test("mixes full, narrower and refused projects, each on its own rows", async () => {
      const fullA: ObjectID = ObjectID.generate();
      const fullB: ObjectID = ObjectID.generate();
      const narrow: ObjectID = ObjectID.generate();
      const refused: ObjectID = ObjectID.generate();

      const rendered: RenderedClause = render(
        await PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([fullA, narrow, refused, fullB]),
          tableName: "MetricType",
          getClauseInProject: async (
            projectProps: DatabaseCommonInteractionProps,
          ): Promise<FindWhereProperty<any> | null> => {
            const id: string = projectProps.tenantId!.toString();
            if (id === refused.toString()) {
              throw new NotAuthorizedException("refused");
            }
            if (id === narrow.toString()) {
              return scopeClause("narrowIds", ["svc-n"]);
            }
            return null;
          },
        }),
        "m_id",
      );

      const wideParameter: string = parameterFor(rendered, [fullA, fullB]);
      const narrowParameter: string = parameterFor(rendered, [narrow]);

      const inProjects: (parameter: string) => string = (
        parameter: string,
      ): string => {
        return `m_id IN (SELECT "MetricType"."_id" FROM "MetricType" WHERE "MetricType"."projectId" IN (:...${parameter}))`;
      };

      expect(rendered.sql).toBe(
        `(${inProjects(wideParameter)} OR (${inProjects(narrowParameter)} AND m_id IN (:...narrowIds)))`,
      );

      // The full projects in one list, in the order the caller holds them.
      expect(rendered.parameters[wideParameter]).toEqual([
        fullA.toString(),
        fullB.toString(),
      ]);

      // A refused project's rows are reachable through no part of it.
      expect(projectIdsInParameters(rendered)).not.toContain(
        refused.toString(),
      );
      expect(rendered.sql).not.toContain(refused.toString());
    });

    test("one project's scope never lets another project's rows through", async () => {
      const projectA: ObjectID = ObjectID.generate();
      const projectB: ObjectID = ObjectID.generate();

      const rendered: RenderedClause = render(
        await PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([projectA, projectB]),
          tableName: "TelemetryException",
          getClauseInProject: async (
            projectProps: DatabaseCommonInteractionProps,
          ): Promise<FindWhereProperty<any>> => {
            return projectProps.tenantId!.toString() === projectA.toString()
              ? scopeClause("idsOfA", ["svc-a"])
              : scopeClause("idsOfB", ["svc-b"]);
          },
        }),
        "x",
      );

      const parameterA: string = parameterFor(rendered, [projectA]);
      const parameterB: string = parameterFor(rendered, [projectB]);

      // No wide part: every project is narrowed.
      expect(projectIdsInParameters(rendered).sort()).toEqual(
        [projectA.toString(), projectB.toString()].sort(),
      );

      const parts: Array<string> = rendered.sql
        .slice(1, -1)
        .split(" OR ")
        .map((part: string): string => {
          return part.trim();
        });
      expect(parts).toHaveLength(2);

      const partOfA: string = parts.find((part: string): boolean => {
        return part.includes(`:...${parameterA})`);
      })!;
      const partOfB: string = parts.find((part: string): boolean => {
        return part.includes(`:...${parameterB})`);
      })!;

      // Each project's condition is joined to that project's rows alone.
      expect(partOfA).toContain("AND x IN (:...idsOfA)");
      expect(partOfA).not.toContain("idsOfB");
      expect(partOfA).not.toContain(parameterB);
      expect(partOfB).toContain("AND x IN (:...idsOfB)");
      expect(partOfB).not.toContain("idsOfA");
      expect(partOfB).not.toContain(parameterA);

      expect(rendered.parameters["idsOfA"]).toEqual(["svc-a"]);
      expect(rendered.parameters["idsOfB"]).toEqual(["svc-b"]);
    });

    test("names its own parameters afresh on every read", async () => {
      const projectA: ObjectID = ObjectID.generate();
      const projectB: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = propsFor([
        projectA,
        projectB,
      ]);
      const getClauseInProject: GetClauseInProject = async (
        projectProps: DatabaseCommonInteractionProps,
      ): Promise<FindWhereProperty<any> | null> => {
        return projectProps.tenantId!.toString() === projectA.toString()
          ? scopeClause("idsOfA", ["svc-a"])
          : null;
      };

      const first: RenderedClause = render(
        await PerProjectReadScope.getClauseAcrossProjects({
          props: props,
          tableName: "MetricType",
          getClauseInProject: getClauseInProject,
        }),
      );
      const second: RenderedClause = render(
        await PerProjectReadScope.getClauseAcrossProjects({
          props: props,
          tableName: "MetricType",
          getClauseInProject: getClauseInProject,
        }),
      );

      const ownNames: (rendered: RenderedClause) => Array<string> = (
        rendered: RenderedClause,
      ): Array<string> => {
        return Object.keys(rendered.parameters).filter(
          (name: string): boolean => {
            return name.startsWith("scope");
          },
        );
      };

      expect(ownNames(first)).toHaveLength(2);
      for (const name of ownNames(first)) {
        expect(name).toMatch(/^scope(Wide|Project)_[A-Za-z]{10}$/);
        // Two clauses in one query cannot overwrite each other's lists.
        expect(ownNames(second)).not.toContain(name);
      }
    });

    test("renders the condition for whichever alias the query gives the id", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const aliasesSeen: Array<string> = [];

      const clause: FindWhereProperty<any> | null =
        await PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([projectId, ObjectID.generate()]),
          tableName: "MetricType",
          getClauseInProject: async (
            projectProps: DatabaseCommonInteractionProps,
          ): Promise<FindWhereProperty<any> | null> => {
            if (projectProps.tenantId!.toString() !== projectId.toString()) {
              return null;
            }
            return Raw((alias: string): string => {
              aliasesSeen.push(alias);
              return `${alias} IS NOT NULL`;
            });
          },
        });

      const sqlOne: string = render(clause, '"MetricType"."_id"').sql;
      const sqlTwo: string = render(clause, "other").sql;

      expect(aliasesSeen).toEqual(['"MetricType"."_id"', "other"]);
      expect(sqlOne).toContain('"MetricType"."_id" IN (SELECT');
      expect(sqlOne).toContain('AND "MetricType"."_id" IS NOT NULL)');
      expect(sqlTwo).not.toContain('"MetricType"."_id" IN (SELECT');
      expect(sqlTwo).toContain("other IN (SELECT");
    });

    test("quotes the table name as an identifier", async () => {
      const rendered: RenderedClause = render(
        await PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([ObjectID.generate()]),
          tableName: 'Odd"Table',
          getClauseInProject: async (): Promise<FindWhereProperty<any>> => {
            return scopeClause("rows");
          },
        }),
        "t",
      );

      expect(rendered.sql).toContain(
        'SELECT "Odd""Table"."_id" FROM "Odd""Table" WHERE "Odd""Table"."projectId" IN',
      );
      expect(rendered.sql).not.toContain('"Odd"Table"');
    });

    test("works out at most PROJECT_CONCURRENCY projects at the same time", async () => {
      const projectIds: Array<ObjectID> = [];
      for (let i: number = 0; i < 7; i++) {
        projectIds.push(ObjectID.generate());
      }

      let inFlight: number = 0;
      let mostInFlight: number = 0;
      const asked: Array<string> = [];

      const clause: FindWhereProperty<any> | null =
        await PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor(projectIds),
          tableName: "MetricType",
          getClauseInProject: async (
            projectProps: DatabaseCommonInteractionProps,
          ): Promise<FindWhereProperty<any> | null> => {
            inFlight++;
            mostInFlight = Math.max(mostInFlight, inFlight);
            asked.push(projectProps.tenantId!.toString());
            await new Promise<void>((resolve: () => void) => {
              setTimeout(resolve, 5);
            });
            inFlight--;
            return scopeClause(
              "ids_" + projectProps.tenantId!.toString().replace(/-/g, ""),
              ["x"],
            );
          },
        });

      expect(mostInFlight).toBe(PerProjectReadScope.PROJECT_CONCURRENCY);
      expect(asked.sort()).toEqual(
        projectIds
          .map((id: ObjectID): string => {
            return id.toString();
          })
          .sort(),
      );

      // Every project in, each once.
      const rendered: RenderedClause = render(clause);
      for (const projectId of projectIds) {
        parameterFor(rendered, [projectId]);
      }
    });

    test("parts come out in the caller's project order whatever order they finish in", async () => {
      const slow: ObjectID = ObjectID.generate();
      const fast: ObjectID = ObjectID.generate();

      const rendered: RenderedClause = render(
        await PerProjectReadScope.getClauseAcrossProjects({
          props: propsFor([slow, fast]),
          tableName: "MetricType",
          getClauseInProject: async (
            projectProps: DatabaseCommonInteractionProps,
          ): Promise<FindWhereProperty<any>> => {
            const isSlow: boolean =
              projectProps.tenantId!.toString() === slow.toString();
            await new Promise<void>((resolve: () => void) => {
              setTimeout(resolve, isSlow ? 20 : 0);
            });
            return scopeClause(isSlow ? "slowIds" : "fastIds", ["x"]);
          },
        }),
      );

      expect(rendered.sql.indexOf("slowIds")).toBeLessThan(
        rendered.sql.indexOf("fastIds"),
      );
    });
  });
});
