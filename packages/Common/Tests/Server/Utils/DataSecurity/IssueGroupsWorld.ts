import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../../Models/DatabaseModels/DataSecurityIssueGroup";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataSecurityIssueGroupService from "../../../../Server/Services/DataSecurityIssueGroupService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { jest } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A PROJECT'S ISSUES, STORES AND GROUPS, IN MEMORY (#10370): what the
 * grouping, the group routes and the group's fix read and write, answered
 * as the database would - equality, In, IS NULL and IS NOT NULL - so a test
 * sees the rows a run leaves behind. Each test makes its own world.
 */

export interface WorldIssue {
  id: string;
  projectId: string;
  checkId: string;
  checkGroup?: string;
  dataStoreId: string;
  status: DataSecurityIssueStatus;
  severity?: string;
  riskScore?: number;
  title?: string;
  dataSecurityIssueGroupId?: string | null;
  aiAnalysis?: JSONObject | null;
  aiVerdict?: string | null;
  securityCaseId?: string | null;
}

export interface WorldStore {
  id: string;
  projectId: string;
  name: string;
  // Each may be set to undefined, to take away what the world gives a store by default.
  kind?: string | undefined;
  provider?: string | undefined;
  region?: string | undefined;
  cloudAccountNumber?: string | undefined;
  cloudTags?: Record<string, string> | undefined;
  providerResourceId?: string | undefined;
  cloudResourceId?: string | undefined;
  cloudConnectionId?: string | undefined;
  isArchived?: boolean | undefined;
  isPublicByDesign?: boolean | undefined;
}

export interface WorldGroup extends JSONObject {
  id: string;
  projectId: string;
  groupKey: string;
  checkId: string;
  cause: string;
  facts: JSONObject | null;
  name: string | null;
  nameFactsHash: string | null;
  nameLanguage: string | null;
  namedAt: string | null;
  issueCount: number;
  openIssueCount: number;
  fixedAt: string | null;
  groupedAt: string | null;
  codeTaskId: string | null;
  fixRequestedAt: string | null;
  fixRequestedByUserId: string | null;
}

let nextId: number = 1;

export function makeId(): string {
  const id: string = (nextId++).toString(16).padStart(12, "0");

  return `00000000-0000-4000-8000-${id}`;
}

function text(value: unknown): string {
  if (value instanceof ObjectID) {
    return value.toString().toLowerCase();
  }

  return typeof value === "string" ? value.toLowerCase() : String(value);
}

const COMPARISON: RegExp = /^\(x (>=|<=|>|<) :[A-Za-z0-9]+\)$/;

// A number, or a moment, to compare.
function magnitude(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  const asDate: number = new Date(String(value)).getTime();

  return Number.isNaN(asDate) ? Number(value) : asDate;
}

function compare(rowValue: unknown, operator: string, bound: unknown): boolean {
  const left: number | null = magnitude(rowValue);
  const right: number | null = magnitude(bound);

  if (left === null || right === null) {
    return false;
  }

  switch (operator) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    default:
      return left <= right;
  }
}

// Whether a row's value matches one condition of a query.
function matches(rowValue: unknown, condition: unknown): boolean {
  if (condition instanceof FindOperator) {
    const type: string = condition.type;

    if (type === "in") {
      const values: Array<unknown> = condition.value as Array<unknown>;

      return values.some((value: unknown): boolean => {
        return text(value) === text(rowValue);
      });
    }

    if (type === "raw") {
      const raw: {
        getSql: (alias: string) => string;
        objectLiteralParameters?: Record<string, unknown>;
      } = condition as unknown as {
        getSql: (alias: string) => string;
        objectLiteralParameters?: Record<string, unknown>;
      };
      const sql: string = raw.getSql("x");

      // QueryHelper.any: "(x IN (:...rid))" with its values as the parameter.
      if (sql.includes(" IN (:...")) {
        const values: Array<unknown> = Object.values(
          raw.objectLiteralParameters || {},
        ).flat() as Array<unknown>;

        return values.some((value: unknown): boolean => {
          return text(value) === text(rowValue);
        });
      }

      if (sql.includes("TRUE = FALSE")) {
        return false;
      }

      // QueryHelper's comparisons: "(x > :rid)", "(x >= :rid)" and the like.
      const comparison: RegExpMatchArray | null = sql.match(COMPARISON);

      if (comparison) {
        const bound: unknown = Object.values(
          raw.objectLiteralParameters || {},
        )[0];

        return compare(rowValue, comparison[1]!, bound);
      }

      if (sql.includes("IS NOT NULL")) {
        return rowValue !== null && rowValue !== undefined;
      }

      if (sql.includes("IS NULL")) {
        return rowValue === null || rowValue === undefined;
      }
    }

    throw new Error(`The world cannot read a ${type} condition.`);
  }

  if (condition === null) {
    return rowValue === null || rowValue === undefined;
  }

  if (rowValue === null || rowValue === undefined) {
    return false;
  }

  return text(rowValue) === text(condition);
}

function matchesQuery(
  row: Record<string, unknown>,
  query: JSONObject,
): boolean {
  return Object.keys(query).every((key: string): boolean => {
    const column: string = key === "_id" ? "id" : key;

    return matches(row[column], query[key]);
  });
}

function asModel<T>(make: () => T, row: Record<string, unknown>): T {
  const model: T = make();

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (
      key === "id" ||
      key.endsWith("Id") ||
      (typeof value === "string" &&
        ObjectID.isValidUUID(value) &&
        key !== "name")
    ) {
      (model as Record<string, unknown>)[key] =
        typeof value === "string" && ObjectID.isValidUUID(value)
          ? new ObjectID(value)
          : value;
    } else if (key.endsWith("At") && typeof value === "string") {
      (model as Record<string, unknown>)[key] = new Date(value);
    } else {
      (model as Record<string, unknown>)[key] = value;
    }
  }

  (model as Record<string, unknown>)["_id"] = row["id"];

  return model;
}

function written(value: unknown): unknown {
  if (value instanceof ObjectID) {
    return value.toString().toLowerCase();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export default class IssueGroupsWorld {
  public readonly projectId: string = makeId();
  public issues: Array<WorldIssue> = [];
  public stores: Array<WorldStore> = [];
  public groups: Array<WorldGroup> = [];

  public addStore(store: Partial<WorldStore> & { name: string }): WorldStore {
    const made: WorldStore = {
      id: makeId(),
      projectId: this.projectId,
      kind: "AWS S3 Bucket",
      provider: "aws",
      region: "us-east-1",
      cloudAccountNumber: "111122223333",
      cloudTags: {},
      ...store,
    };

    this.stores.push(made);

    return made;
  }

  public addIssue(
    issue: Partial<WorldIssue> & { dataStoreId: string },
  ): WorldIssue {
    const made: WorldIssue = {
      id: makeId(),
      projectId: this.projectId,
      checkId: "access-not-logged",
      status: DataSecurityIssueStatus.Open,
      severity: "High",
      riskScore: 60,
      dataSecurityIssueGroupId: null,
      ...issue,
    };

    this.issues.push(made);

    return made;
  }

  // A store and its open issue of a check.
  public addStoreWithIssue(
    store: Partial<WorldStore> & { name: string },
    issue?: Partial<WorldIssue>,
  ): { store: WorldStore; issue: WorldIssue } {
    const made: WorldStore = this.addStore(store);

    return {
      store: made,
      issue: this.addIssue({ dataStoreId: made.id, ...issue }),
    };
  }

  public groupOf(issue: WorldIssue): WorldGroup | undefined {
    return this.groups.find((group: WorldGroup): boolean => {
      return group.id === this.issueById(issue.id)?.dataSecurityIssueGroupId;
    });
  }

  public issueById(id: string): WorldIssue | undefined {
    return this.issues.find((issue: WorldIssue): boolean => {
      return issue.id === id;
    });
  }

  public membersOf(group: WorldGroup): Array<WorldIssue> {
    return this.issues.filter((issue: WorldIssue): boolean => {
      return issue.dataSecurityIssueGroupId === group.id;
    });
  }

  public resolve(issue: WorldIssue): void {
    this.issueById(issue.id)!.status = DataSecurityIssueStatus.Resolved;
  }

  // Answers the services' reads and writes from the world.
  public install(): void {
    jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockImplementation((async (findBy: {
        query: JSONObject;
        skip?: number;
        limit?: number;
      }) => {
        const rows: Array<WorldIssue> = this.issues.filter(
          (issue: WorldIssue) => {
            return matchesQuery(
              issue as unknown as Record<string, unknown>,
              findBy.query,
            );
          },
        );
        const skip: number = Number(findBy.skip || 0);
        const limit: number = Number(findBy.limit || rows.length);

        return rows.slice(skip, skip + limit).map((row: WorldIssue) => {
          return asModel(
            () => {
              return new DataSecurityIssue();
            },
            row as unknown as Record<string, unknown>,
          );
        });
      }) as never);

    jest
      .spyOn(DataSecurityIssueService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        const row: WorldIssue | undefined = this.issues.find(
          (issue: WorldIssue) => {
            return matchesQuery(
              issue as unknown as Record<string, unknown>,
              findOneBy.query,
            );
          },
        );

        return row
          ? asModel(
              () => {
                return new DataSecurityIssue();
              },
              row as unknown as Record<string, unknown>,
            )
          : null;
      }) as never);

    jest
      .spyOn(DataSecurityIssueService, "countBy")
      .mockImplementation((async (countBy: { query: JSONObject }) => {
        return new PositiveNumber(
          this.issues.filter((issue: WorldIssue) => {
            return matchesQuery(
              issue as unknown as Record<string, unknown>,
              countBy.query,
            );
          }).length,
        );
      }) as never);

    jest
      .spyOn(DataSecurityIssueService, "updateBy")
      .mockImplementation((async (updateBy: {
        query: JSONObject;
        data: JSONObject;
      }) => {
        let count: number = 0;

        for (const issue of this.issues) {
          if (
            matchesQuery(
              issue as unknown as Record<string, unknown>,
              updateBy.query,
            )
          ) {
            for (const [key, value] of Object.entries(updateBy.data)) {
              (issue as unknown as Record<string, unknown>)[key] =
                written(value);
            }
            count++;
          }
        }

        return count;
      }) as never);

    jest.spyOn(DataStoreService, "findBy").mockImplementation((async (findBy: {
      query: JSONObject;
    }) => {
      return this.stores
        .filter((store: WorldStore) => {
          return matchesQuery(
            store as unknown as Record<string, unknown>,
            findBy.query,
          );
        })
        .map((row: WorldStore) => {
          return asModel(
            () => {
              return new DataStore();
            },
            row as unknown as Record<string, unknown>,
          );
        });
    }) as never);

    jest
      .spyOn(DataStoreService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        const row: WorldStore | undefined = this.stores.find(
          (store: WorldStore) => {
            return matchesQuery(
              store as unknown as Record<string, unknown>,
              findOneBy.query,
            );
          },
        );

        return row
          ? asModel(
              () => {
                return new DataStore();
              },
              row as unknown as Record<string, unknown>,
            )
          : null;
      }) as never);

    const toGroup: (row: WorldGroup) => DataSecurityIssueGroup = (
      row: WorldGroup,
    ): DataSecurityIssueGroup => {
      return asModel(
        () => {
          return new DataSecurityIssueGroup();
        },
        row as unknown as Record<string, unknown>,
      );
    };

    jest
      .spyOn(DataSecurityIssueGroupService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        return this.groups
          .filter((group: WorldGroup) => {
            return matchesQuery(group, findBy.query);
          })
          .map(toGroup);
      }) as never);

    jest
      .spyOn(DataSecurityIssueGroupService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        const row: WorldGroup | undefined = this.groups.find(
          (group: WorldGroup) => {
            return matchesQuery(group, findOneBy.query);
          },
        );

        return row ? toGroup(row) : null;
      }) as never);

    jest
      .spyOn(DataSecurityIssueGroupService, "create")
      .mockImplementation((async (create: { data: DataSecurityIssueGroup }) => {
        const data: DataSecurityIssueGroup = create.data;
        const row: WorldGroup = {
          id: makeId(),
          projectId: text(data.projectId),
          groupKey: data.groupKey || "",
          checkId: data.checkId || "",
          cause: data.cause || "",
          facts: (data.facts as JSONObject) || null,
          name: data.name || null,
          nameFactsHash: data.nameFactsHash || null,
          nameLanguage: data.nameLanguage || null,
          namedAt: null,
          issueCount: data.issueCount || 0,
          openIssueCount: data.openIssueCount || 0,
          fixedAt: null,
          groupedAt: data.groupedAt
            ? new Date(data.groupedAt).toISOString()
            : null,
          codeTaskId: null,
          fixRequestedAt: null,
          fixRequestedByUserId: null,
        };

        if (
          this.groups.some((group: WorldGroup): boolean => {
            return (
              group.projectId === row.projectId &&
              group.groupKey === row.groupKey
            );
          })
        ) {
          throw new Error(`A group of key ${row.groupKey} is there already.`);
        }

        this.groups.push(row);

        return toGroup(row);
      }) as never);

    jest
      .spyOn(DataSecurityIssueGroupService, "updateOneById")
      .mockImplementation((async (updateOneById: {
        id: ObjectID;
        data: JSONObject;
      }) => {
        const row: WorldGroup | undefined = this.groups.find(
          (group: WorldGroup) => {
            return group.id === text(updateOneById.id);
          },
        );

        if (!row) {
          return 0;
        }

        for (const [key, value] of Object.entries(updateOneById.data)) {
          (row as Record<string, unknown>)[key] = written(value);
        }

        return 1;
      }) as never);

    jest
      .spyOn(DataSecurityIssueGroupService, "updateOneBy")
      .mockImplementation((async (updateOneBy: {
        query: JSONObject;
        data: JSONObject;
      }) => {
        const row: WorldGroup | undefined = this.groups.find(
          (group: WorldGroup) => {
            return matchesQuery(group, updateOneBy.query);
          },
        );

        if (!row) {
          return 0;
        }

        for (const [key, value] of Object.entries(updateOneBy.data)) {
          (row as Record<string, unknown>)[key] = written(value);
        }

        return 1;
      }) as never);

    jest
      .spyOn(DataSecurityIssueGroupService, "hardDeleteBy")
      .mockImplementation((async (deleteBy: { query: JSONObject }) => {
        const before: number = this.groups.length;

        this.groups = this.groups.filter((group: WorldGroup) => {
          return !matchesQuery(group, deleteBy.query);
        });

        // The key sets each issue's group to null with it.
        for (const issue of this.issues) {
          if (
            issue.dataSecurityIssueGroupId &&
            !this.groups.some((group: WorldGroup): boolean => {
              return group.id === issue.dataSecurityIssueGroupId;
            })
          ) {
            issue.dataSecurityIssueGroupId = null;
          }
        }

        return before - this.groups.length;
      }) as never);
  }
}
