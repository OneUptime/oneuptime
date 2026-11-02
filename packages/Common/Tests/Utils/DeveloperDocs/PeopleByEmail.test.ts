import { describe, expect, test } from "@jest/globals";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Models from "../../../Models/DatabaseModels/Index";
import MonitorOwnerRule from "../../../Models/DatabaseModels/MonitorOwnerRule";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import {
  DECIDED_BY_ONEUPTIME_IN_EVERY_TABLE,
  DECIDED_BY_THE_PERSON_INVITED,
  EXAMPLE_PERSON_EMAIL,
  getPersonEmailColumnName,
  INVITATION_EMAIL_FIELD,
  INVITED_BY_EMAIL,
  isDecidedBySomeoneElse,
  isDecidedByThePersonInvited,
  isInvitedByEmail,
  getMembershipImport,
  isPersonRelation,
  MEMBERSHIP_IMPORTS,
  MembershipImport,
  MembershipKind,
  normalizePersonEmail,
  OWNER_ROW_SUFFIXES,
  PERSON_TABLE_NAME,
  PersonColumnKind,
} from "../../../Utils/DeveloperDocs/PeopleByEmail";
import {
  getColumnsRequiredOnCreate,
  getTerraformAttributes,
  isRequiredInTerraform,
  TerraformAttributeDescriptor,
} from "../../../Utils/DeveloperDocs/TerraformSchema";

/*
 * The rules every client OneUptime publishes follows to name a person by
 * email address (Utils/DeveloperDocs/PeopleByEmail.ts): the provider's
 * generator reads them (Scripts/TerraformProvider/Core/OpenAPIParser.ts), and
 * so does the dashboard's view of the provider (TerraformSchema.ts), which
 * TerraformProviderSchemaContract holds to it resource by resource. These pin
 * the rules themselves, and what they make of the models people use most.
 */

function attributes(
  modelType: DatabaseBaseModelType,
): Map<string, TerraformAttributeDescriptor> {
  return new Map(
    getTerraformAttributes(modelType).map(
      (
        descriptor: TerraformAttributeDescriptor,
      ): [string, TerraformAttributeDescriptor] => {
        return [descriptor.attributeName, descriptor];
      },
    ),
  );
}

// "owns" or "own" as a word, in an owner row's column descriptions.
const OWNS: RegExp = /\bowns?\b/;
// The words of a table description, and one with a capital inside it.
const LETTER_RUNS: RegExp = /[A-Za-z]+/g;
const CAPITAL_INSIDE_A_WORD: RegExp = /[a-z][A-Z]/;

describe("the address beside a person column", () => {
  test.each([
    ["userId", PersonColumnKind.One, "userEmail"],
    ["assignedToUserId", PersonColumnKind.One, "assignedToUserEmail"],
    ["overrideUserId", PersonColumnKind.One, "overrideUserEmail"],
    ["routeAlertsToUserId", PersonColumnKind.One, "routeAlertsToUserEmail"],
    ["assignToUserId", PersonColumnKind.One, "assignToUserEmail"],
    ["ownerUsers", PersonColumnKind.Many, "ownerUserEmails"],
    ["episodeOwnerUsers", PersonColumnKind.Many, "episodeOwnerUserEmails"],
    ["notifyUsers", PersonColumnKind.Many, "notifyUserEmails"],
    ["alertOwnerUsers", PersonColumnKind.Many, "alertOwnerUserEmails"],
    // Names that do not end the usual way still get a companion.
    ["approver", PersonColumnKind.One, "approverEmail"],
    ["reviewers", PersonColumnKind.Many, "reviewersEmails"],
    // A bare suffix is a name of its own, not a suffix.
    ["Id", PersonColumnKind.One, "IdEmail"],
    ["Users", PersonColumnKind.Many, "UsersEmails"],
  ])(
    "%s (%s) -> %s",
    (column: string, kind: PersonColumnKind, email: string) => {
      expect(getPersonEmailColumnName(column, kind)).toBe(email);
    },
  );

  test("a person is a User", () => {
    expect(PERSON_TABLE_NAME).toBe(new User().tableName);
    expect(isPersonRelation("User")).toBe(true);
    expect(isPersonRelation("Team")).toBe(false);
    expect(isPersonRelation(undefined)).toBe(false);
    expect(isPersonRelation(null)).toBe(false);
  });

  test("addresses compare trimmed and in any case, as OneUptime stores them", () => {
    expect(normalizePersonEmail("  Alice.Smith@Example.COM ")).toBe(
      "alice.smith@example.com",
    );
    expect(EXAMPLE_PERSON_EMAIL).toBe(
      normalizePersonEmail(EXAMPLE_PERSON_EMAIL),
    );
  });
});

describe("only a team member invites by address", () => {
  test("the rule", () => {
    expect(INVITED_BY_EMAIL).toEqual({ TeamMember: "userId" });
    expect(isInvitedByEmail("TeamMember", "userId")).toBe(true);
    expect(isInvitedByEmail("TeamMember", "teamId")).toBe(false);
    expect(isInvitedByEmail("MonitorOwnerUser", "userId")).toBe(false);
  });

  test("it sends the address as the dashboard's Invite does", () => {
    // TeamMemberService.onBeforeCreate reads createBy.miscDataProps["email"].
    expect(INVITATION_EMAIL_FIELD).toBe("email");
  });

  test("every rule names a real column of a real model", () => {
    const tables: Map<string, DatabaseBaseModelType> = new Map(
      Models.map(
        (modelType: DatabaseBaseModelType): [string, DatabaseBaseModelType] => {
          return [new modelType().tableName || "", modelType];
        },
      ),
    );

    const columns: Array<[string, string]> = [
      ...Object.entries(INVITED_BY_EMAIL),
      ...Object.entries(DECIDED_BY_THE_PERSON_INVITED).flatMap(
        ([table, names]: [string, ReadonlyArray<string>]) => {
          return names.map((name: string): [string, string] => {
            return [table, name];
          });
        },
      ),
      ...Object.entries(MEMBERSHIP_IMPORTS).flatMap(
        ([table, rule]: [
          string,
          { parentColumn: string; personColumn: string },
        ]) => {
          return [
            [table, rule.parentColumn],
            [table, rule.personColumn],
          ] as Array<[string, string]>;
        },
      ),
    ];

    expect(columns.length).toBeGreaterThan(4);
    for (const [table, column] of columns) {
      const modelType: DatabaseBaseModelType | undefined = tables.get(table);
      expect({ table, found: Boolean(modelType) }).toEqual({
        table,
        found: true,
      });
      expect({
        table,
        column,
        found: Boolean(getTableColumns(new modelType!())[column]),
      }).toEqual({ table, column, found: true });
    }
  });
});

describe("what someone else decides", () => {
  test("the invitee decides whether they accepted, and when", () => {
    expect(
      isDecidedByThePersonInvited("TeamMember", "hasAcceptedInvitation"),
    ).toBe(true);
    expect(
      isDecidedByThePersonInvited("TeamMember", "invitationAcceptedAt"),
    ).toBe(true);
    expect(isDecidedByThePersonInvited("TeamMember", "userId")).toBe(false);
    expect(
      isDecidedByThePersonInvited("Monitor", "hasAcceptedInvitation"),
    ).toBe(false);
  });

  test("OneUptime decides whether it has told the owners, on every table", () => {
    expect(DECIDED_BY_ONEUPTIME_IN_EVERY_TABLE).toEqual(["isOwnerNotified"]);
    expect(isDecidedBySomeoneElse("MonitorOwnerUser", "isOwnerNotified")).toBe(
      true,
    );
    expect(
      isDecidedBySomeoneElse("IncidentStateTimeline", "isOwnerNotified"),
    ).toBe(true);
    expect(isDecidedBySomeoneElse("TeamMember", "hasAcceptedInvitation")).toBe(
      true,
    );
    expect(isDecidedBySomeoneElse("MonitorOwnerUser", "userId")).toBe(false);
  });

  test("every model with an owner notification has it in the API, and so as no attribute", () => {
    const withColumn: Array<DatabaseBaseModelType> = Models.filter(
      (modelType: DatabaseBaseModelType): boolean => {
        return Boolean(getTableColumns(new modelType())["isOwnerNotified"]);
      },
    );

    // The owner rows of every product, and the state timelines.
    expect(withColumn.length).toBeGreaterThan(80);
    for (const modelType of withColumn) {
      expect({
        model: modelType.name,
        hasAttribute: attributes(modelType).has("is_owner_notified"),
      }).toEqual({ model: modelType.name, hasAttribute: false });
    }
  });
});

describe("the dashboard's view of the provider", () => {
  test("a team member: the person by ID or address, the team required, nothing the invitee decides", () => {
    const member: Map<string, TerraformAttributeDescriptor> =
      attributes(TeamMember);

    // project_id is the API key's, filled in by the server.
    expect([...member.keys()].sort()).toEqual([
      "project_id",
      "team_id",
      "user_id",
    ]);
    expect(member.get("project_id")!.isServerManaged).toBe(true);
    expect(member.get("user_id")!.personEmail).toEqual({
      attributeName: "user_email",
      isList: false,
      invitesByEmail: true,
    });
    expect(isRequiredInTerraform(member.get("user_id")!)).toBe(false);
    expect(isRequiredInTerraform(member.get("team_id")!)).toBe(true);
    expect(member.get("team_id")!.personEmail).toBeUndefined();
  });

  test("the API reference still badges the person Required, as the API requires them", () => {
    expect(getColumnsRequiredOnCreate(TeamMember).sort()).toEqual([
      "teamId",
      "userId",
    ]);
  });

  test("an owner, an on-call layer member and a case worker are found, never invited", () => {
    for (const modelType of [
      MonitorOwnerUser,
      IncidentOwnerUser,
      OnCallDutyPolicyScheduleLayerUser,
    ]) {
      expect(attributes(modelType).get("user_id")!.personEmail).toEqual({
        attributeName: "user_email",
        isList: false,
        invitesByEmail: false,
      });
    }
    expect(
      attributes(SecurityCase).get("assigned_to_user_id")!.personEmail,
    ).toEqual({
      attributeName: "assigned_to_user_email",
      isList: false,
      invitesByEmail: false,
    });
  });

  test("an override names two people, each with an address", () => {
    const override: Map<string, TerraformAttributeDescriptor> = attributes(
      OnCallDutyPolicyUserOverride,
    );
    expect(override.get("override_user_id")!.personEmail?.attributeName).toBe(
      "override_user_email",
    );
    expect(
      override.get("route_alerts_to_user_id")!.personEmail?.attributeName,
    ).toBe("route_alerts_to_user_email");
  });

  test("a rule's owners are a set of addresses", () => {
    expect(
      attributes(MonitorOwnerRule).get("owner_users")!.personEmail,
    ).toEqual({
      attributeName: "owner_user_emails",
      isList: true,
      invitesByEmail: false,
    });
    expect(
      attributes(AlertGroupingRule).get("episode_owner_users")!.personEmail
        ?.attributeName,
    ).toBe("episode_owner_user_emails");
  });

  test("a state timeline names nobody, and its owner notification is no attribute", () => {
    const timeline: Map<string, TerraformAttributeDescriptor> = attributes(
      IncidentStateTimeline,
    );
    for (const descriptor of timeline.values()) {
      expect(descriptor.personEmail).toBeUndefined();
    }
    expect(timeline.has("is_owner_notified")).toBe(false);
  });

  test("a column that names someone else than a person has no address", () => {
    for (const modelType of Models) {
      for (const descriptor of getTerraformAttributes(modelType)) {
        if (!descriptor.personEmail) {
          continue;
        }
        expect({
          model: modelType.name,
          column: descriptor.columnName,
          relatedTable: new descriptor.relatedModelType!().tableName,
        }).toEqual({
          model: modelType.name,
          column: descriptor.columnName,
          relatedTable: "User",
        });
      }
    }
  });

  test("people are named by address across the provider", () => {
    let count: number = 0;
    for (const modelType of Models) {
      for (const descriptor of getTerraformAttributes(modelType)) {
        if (descriptor.personEmail) {
          count++;
        }
      }
    }
    // Team members, on-call, owners and owner rules of every product, feeds...
    expect(count).toBeGreaterThan(100);
  });
});

describe("rows imported by what they join", () => {
  /*
   * The relation columns a create of a model's row names, as the API's
   * create schema has them: the ID columns of its relations a caller may
   * write (monitorId, userId) - not who made it (createdByUserId).
   */
  function relationColumns(modelType: DatabaseBaseModelType): Array<string> {
    const model: InstanceType<DatabaseBaseModelType> = new modelType();
    const columns: ReturnType<typeof getTableColumns> = getTableColumns(model);
    const accessControl: ReturnType<
      typeof model.getColumnAccessControlForAllColumns
    > = model.getColumnAccessControlForAllColumns();
    return Object.values(columns)
      .map((column: (typeof columns)[string] | undefined) => {
        return column?.manyToOneRelationColumn || "";
      })
      .filter((name: string) => {
        return (
          Boolean(name) &&
          !columns[name]?.computed &&
          (accessControl[name]?.create || []).length > 0
        );
      });
  }

  test("a membership, the on-call rows and every owner row import by what they join", () => {
    const imported: Array<string> = [];
    const owners: Array<string> = [];

    for (const modelType of Models) {
      const table: string = new modelType().tableName || "";
      if (!table) {
        continue;
      }
      const rule: MembershipImport | undefined = getMembershipImport(
        table,
        relationColumns(modelType),
      );
      if (!rule) {
        continue;
      }
      imported.push(table);
      if (rule.kind === MembershipKind.Owner) {
        owners.push(table);
      }

      // Both columns are the model's, and relations.
      const columns: ReturnType<typeof getTableColumns> = getTableColumns(
        new modelType(),
      );
      expect({ table, parent: Boolean(columns[rule.parentColumn]) }).toEqual({
        table,
        parent: true,
      });
      expect({ table, member: Boolean(columns[rule.personColumn]) }).toEqual({
        table,
        member: true,
      });
      expect(rule.parentColumn).not.toBe(rule.personColumn);
      expect(rule.parentColumn).not.toBe("projectId");
    }

    /*
     * Every <Thing>OwnerUser and <Thing>OwnerTeam, and nothing else, is an
     * owner row - none left out for want of a parent.
     */
    const ownerTables: Array<string> = Models.map(
      (modelType: DatabaseBaseModelType): string => {
        return new modelType().tableName || "";
      },
    ).filter((table: string) => {
      return Object.keys(OWNER_ROW_SUFFIXES).some((suffix: string) => {
        return table.endsWith(suffix);
      });
    });
    expect([...owners].sort()).toEqual([...ownerTables].sort());
    expect(owners.length).toBeGreaterThanOrEqual(76);

    for (const table of Object.keys(MEMBERSHIP_IMPORTS)) {
      expect(imported).toContain(table);
    }
  });

  /*
   * The two IDs of such a row are what a client asks for (user_id and
   * monitor_id beside each other on oneuptime_monitor_user_owner), so each
   * says what it is: the owner and what they own, the person and the layer
   * they take turns in - never the boilerplate every column was given ("ID
   * of your OneUptime User in which this object belongs"), nor another
   * row's words ("where this escalation rule belongs" on a layer).
   */
  test("the two IDs of a row that joins two records say what each is", () => {
    const BOILERPLATE: RegExp =
      /in which this object belongs|where this (?:escalation rule|user) belongs/;
    const wrong: Array<string> = [];
    let rows: number = 0;

    for (const modelType of Models) {
      const table: string = new modelType().tableName || "";
      const rule: MembershipImport | undefined = table
        ? getMembershipImport(table, relationColumns(modelType))
        : undefined;
      if (!rule) {
        continue;
      }
      rows++;
      const columns: ReturnType<typeof getTableColumns> = getTableColumns(
        new modelType(),
      );

      for (const column of [rule.parentColumn, rule.personColumn]) {
        const description: string = columns[column]?.description || "";
        if (!description || BOILERPLATE.test(description)) {
          wrong.push(`${table}.${column}: ${description}`);
        }
      }

      // An owner row names its owner and what they own.
      if (rule.kind === MembershipKind.Owner) {
        for (const column of [rule.parentColumn, rule.personColumn]) {
          if (!OWNS.test(columns[column]?.description || "")) {
            wrong.push(`${table}.${column} does not say who owns what`);
          }
        }
      }

      /*
       * The table says what the row adds, in words: "Add teams as owners to
       * your on-call policies.", never a code name ("onCallDutyPolicys",
       * "DockerSwarm") - brand names that are written so excepted.
       */
      const tableDescription: string = new modelType().tableDescription || "";
      const codeNames: Array<string> = (
        tableDescription.match(LETTER_RUNS) || []
      ).filter((word: string) => {
        return (
          CAPITAL_INSIDE_A_WORD.test(word) &&
          !["IoT", "vCenters"].includes(word)
        );
      });
      if (!tableDescription.endsWith(".") || codeNames.length > 0) {
        wrong.push(`${table}: ${tableDescription}`);
      }
      if (rule.kind === MembershipKind.Owner) {
        const owners: string = table.endsWith("OwnerTeam") ? "teams" : "users";
        if (!tableDescription.startsWith(`Add ${owners} as owners to your `)) {
          wrong.push(`${table}: ${tableDescription}`);
        }
      }
    }

    expect(wrong).toEqual([]);
    expect(rows).toBeGreaterThanOrEqual(80);
  });

  test("an owner row's parent is what it owns, and its member the person or the team", () => {
    expect(
      getMembershipImport("MonitorOwnerUser", [
        "monitorId",
        "userId",
        "projectId",
      ]),
    ).toEqual({
      parentColumn: "monitorId",
      personColumn: "userId",
      kind: MembershipKind.Owner,
    });
    expect(
      getMembershipImport("StatusPageOwnerTeam", [
        "projectId",
        "teamId",
        "statusPageId",
      ]),
    ).toEqual({
      parentColumn: "statusPageId",
      personColumn: "teamId",
      kind: MembershipKind.Owner,
    });

    // A row of two parents is no owner row to guess at.
    expect(
      getMembershipImport("MonitorOwnerUser", [
        "monitorId",
        "monitorGroupId",
        "userId",
      ]),
    ).toBeUndefined();
    // Nor is a table that is only called so.
    expect(getMembershipImport("OwnerUser", ["userId", "teamId"])).toBe(
      undefined,
    );
    expect(getMembershipImport("Monitor", ["monitorGroupId"])).toBe(undefined);
  });

  test("the on-call rows: a layer's people, and an escalation rule's people, teams and schedules", () => {
    expect(
      getMembershipImport("OnCallDutyPolicyScheduleLayerUser", []),
    ).toEqual({
      parentColumn: "onCallDutyPolicyScheduleLayerId",
      personColumn: "userId",
      kind: MembershipKind.OnCall,
    });
    for (const [table, member] of [
      ["OnCallDutyPolicyEscalationRuleUser", "userId"],
      ["OnCallDutyPolicyEscalationRuleTeam", "teamId"],
      ["OnCallDutyPolicyEscalationRuleSchedule", "onCallDutyPolicyScheduleId"],
    ] as Array<[string, string]>) {
      expect(getMembershipImport(table, [])).toEqual({
        parentColumn: "onCallDutyPolicyEscalationRuleId",
        personColumn: member,
        kind: MembershipKind.OnCall,
      });
    }
    expect(getMembershipImport("TeamMember", [])?.kind).toBe(
      MembershipKind.Member,
    );
  });
});
