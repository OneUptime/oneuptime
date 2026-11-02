import fs from "fs";
import os from "os";
import path from "path";
import { OpenAPIParser, HANDWRITTEN_DATA_SOURCES } from "../Core/OpenAPIParser";
import { ResourceGenerator } from "../Core/ResourceGenerator";
import { DataSourceGenerator } from "../Core/DataSourceGenerator";
import { DocumentationGenerator } from "../Core/DocumentationGenerator";
import { ProviderGenerator } from "../Core/ProviderGenerator";
import {
  TerraformAttribute,
  TerraformDataSource,
  TerraformResource,
} from "../Core/Types";
import { buildPeopleFixtureSpec } from "./PeopleFixtures";

/*
 * PEOPLE BY EMAIL ADDRESS, in the generator: which attributes name a
 * person, the companion that names them by address instead, what is
 * read-only because someone else decides it, the membership import, the
 * hand-written oneuptime_user data source - and the Go the generator emits
 * for all of it, held to the helpers people.go defines. The behaviour of
 * that Go, through the real protocol server, is people_plan_test.go.
 */

const STATIC_FILES: string = path.join(__dirname, "..", "StaticFiles");

let resources: Map<string, TerraformResource>;
let dataSources: Map<string, TerraformDataSource>;
let warnings: Array<string>;

beforeAll(() => {
  const parser: OpenAPIParser = new OpenAPIParser();
  parser.setSpec(buildPeopleFixtureSpec());
  resources = new Map(
    parser.getResources().map((resource: TerraformResource) => {
      return [resource.name, resource];
    }),
  );
  dataSources = new Map(
    parser.getDataSources().map((dataSource: TerraformDataSource) => {
      return [dataSource.name, dataSource];
    }),
  );
  warnings = parser.warnings;
});

function attribute(resourceName: string, name: string): TerraformAttribute {
  const found: TerraformAttribute | undefined =
    resources.get(resourceName)?.schema[name];
  if (!found) {
    throw new Error(`${resourceName} has no attribute ${name}`);
  }
  return found;
}

describe("the parser: a person, and the address beside them", () => {
  test("a required person is given by ID or by address, exactly one", () => {
    const userId: TerraformAttribute = attribute("team_member", "user_id");

    expect(userId.person).toEqual({
      emailAttribute: "user_email",
      isList: false,
      isRequired: true,
      invitesByEmail: true,
    });
    expect({
      required: userId.required,
      optional: userId.optional,
      computed: userId.computed,
    }).toEqual({ required: false, optional: true, computed: true });
    expect(userId.description).toContain(
      "Or name them by email address, in `user_email`.",
    );
  });

  test("the address is an attribute of the resource, never of a request", () => {
    const resource: TerraformResource = resources.get("team_member")!;
    const email: TerraformAttribute = attribute("team_member", "user_email");

    expect(email).toMatchObject({
      type: "string",
      required: false,
      optional: true,
      computed: true,
      personEmailOf: "user_id",
    });
    expect(email.description).toContain("is invited to it");
    expect(Object.keys(resource.operationSchemas?.create || {})).not.toContain(
      "user_email",
    );
    expect(Object.keys(resource.operationSchemas?.read || {})).not.toContain(
      "user_email",
    );
  });

  test("only a team member invites; everywhere else the person must be in the project", () => {
    expect(attribute("team_member", "user_id").person?.invitesByEmail).toBe(
      true,
    );
    expect(
      attribute("monitor_owner_user", "user_id").person?.invitesByEmail,
    ).toBe(false);
    expect(attribute("monitor_owner_user", "user_email").description).toBe(
      "The email address of the person in `user_id`, instead of their ID: someone in this project, or invited to it. Give one of the two.",
    );
  });

  test("a person the API cannot change replaces the resource; one it can is updated", () => {
    expect(attribute("monitor_owner_user", "user_id").forceNew).toBe(true);
    expect(
      attribute("on_call_duty_policy_schedule_layer_user", "user_id").forceNew,
    ).toBe(false);
  });

  test("a set of people has a set of addresses", () => {
    expect(attribute("monitor_owner_rule", "owner_users").person).toEqual({
      emailAttribute: "owner_user_emails",
      isList: true,
      isRequired: false,
      invitesByEmail: false,
    });
    expect(
      attribute("monitor_owner_rule", "owner_user_emails"),
    ).toMatchObject({
      type: "set",
      optional: true,
      computed: true,
      personEmailOf: "owner_users",
    });
    expect(
      attribute("monitor_owner_rule", "owner_user_emails").elementKind,
    ).toBeUndefined();
  });

  test("who created a record is the server's to say: no companion", () => {
    const note: TerraformResource = resources.get("incident_note")!;

    expect(note.schema["created_by_user_id"]?.person).toBeUndefined();
    expect(note.schema["created_by_user_email"]).toBeUndefined();
  });

  test("an ordered list of people, and a companion name that is taken, are left alone and said", () => {
    const note: TerraformResource = resources.get("incident_note")!;

    expect(note.schema["reviewers"]?.person).toBeUndefined();
    expect(note.schema["approver_user_id"]?.person).toBeUndefined();
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Resource "incident_note": reviewers is an ordered list of people, which has no email companion.',
        'Resource "incident_note": approver_user_id names a person, but approver_user_email is already an attribute, so it has no email companion.',
      ]),
    );
  });
});

describe("the parser: what someone else decides is read-only", () => {
  test("whether a member accepted, and when, are the invitee's", () => {
    const resource: TerraformResource = resources.get("team_member")!;

    for (const name of ["has_accepted_invitation", "invitation_accepted_at"]) {
      expect(resource.schema[name]).toMatchObject({
        computed: true,
        optional: false,
        required: false,
      });
      expect(Object.keys(resource.operationSchemas?.create || {})).not.toContain(
        name,
      );
    }
  });

  test("whether OneUptime has told an owner is OneUptime's", () => {
    const resource: TerraformResource = resources.get("monitor_owner_user")!;

    expect(resource.schema["is_owner_notified"]).toMatchObject({
      computed: true,
      optional: false,
      required: false,
    });
    expect(Object.keys(resource.operationSchemas?.create || {})).not.toContain(
      "is_owner_notified",
    );
    expect(
      ResourceGenerator.getSchemaFlags(
        "is_owner_notified",
        resource.schema["is_owner_notified"]!,
        resource,
      ),
    ).toEqual({ required: false, optional: false, computed: true });
  });

  test("the team is required: the API refuses a membership without one", () => {
    expect(attribute("team_member", "team_id").required).toBe(true);
  });
});

describe("the parser: a membership is imported by team and person", () => {
  test("team member", () => {
    expect(resources.get("team_member")!.membershipImport).toEqual({
      parentAttribute: "team_id",
      parentApiField: "teamId",
      personApiField: "userId",
      personEmailAttribute: "user_email",
      listPath: "/team-member/get-list",
    });
    expect(resources.get("team_member")!.tableName).toBe("TeamMember");
  });

  test("nothing else", () => {
    for (const [name, resource] of resources) {
      if (name !== "team_member") {
        expect({ name, membershipImport: resource.membershipImport }).toEqual({
          name,
          membershipImport: undefined,
        });
      }
    }
  });
});

describe("the parser: oneuptime_user is written by hand", () => {
  test("it replaces the one the spec gives", () => {
    const user: TerraformDataSource = dataSources.get("user")!;

    expect(user.staticFile).toBe("data_source_user.go");
    expect(Object.keys(user.schema).sort()).toEqual([
      "email",
      "has_accepted_invitation",
      "id",
      "name",
      "team_ids",
    ]);
    // Nothing of the User endpoint's columns (a password, a block) leaks in.
    expect(user.schema["password"]).toBeUndefined();
    expect(user.schema["is_blocked"]).toBeUndefined();
  });

  test("its schema here is the one data_source_user.go declares", () => {
    const source: string = fs.readFileSync(
      path.join(STATIC_FILES, "data_source_user.go"),
      "utf-8",
    );
    const declared: Array<string> = [];
    const attributeDeclaration: RegExp = new RegExp(
      '^\\s+"([a-z_]+)": schema\\.[A-Za-z]+Attribute\\{',
      "gm",
    );
    let match: RegExpExecArray | null = attributeDeclaration.exec(source);
    while (match) {
      declared.push(match[1]!);
      match = attributeDeclaration.exec(source);
    }

    expect(declared.sort()).toEqual(
      Object.keys(HANDWRITTEN_DATA_SOURCES["user"]!.schema).sort(),
    );

    for (const [name, attr] of Object.entries(
      HANDWRITTEN_DATA_SOURCES["user"]!.schema,
    )) {
      expect(source).toContain(
        `MarkdownDescription: "${attr.description!.replace(/"/g, '\\"')}"`,
      );
      expect(name).toBeTruthy();
    }
  });
});

describe("the Go the generator writes", () => {
  let outputDir: string;
  let teamMemberGo: string;
  let ownerGo: string;
  let layerUserGo: string;
  let ruleGo: string;
  let teamGo: string;
  let dataSourcesGo: string;

  beforeAll(async () => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-people-"));
    const config: {
      outputDir: string;
      providerName: string;
      providerVersion: string;
      goModuleName: string;
    } = {
      outputDir,
      providerName: "oneuptime",
      providerVersion: "14.0.0",
      goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
    };
    await new ResourceGenerator(
      config,
      buildPeopleFixtureSpec(),
    ).generateResources();
    await new DataSourceGenerator(
      config,
      buildPeopleFixtureSpec(),
    ).generateDataSources();

    const read: (file: string) => string = (file: string): string => {
      return fs.readFileSync(
        path.join(outputDir, "internal/provider", file),
        "utf-8",
      );
    };
    teamMemberGo = read("resource_team_member.go");
    ownerGo = read("resource_monitor_owner_user.go");
    layerUserGo = read("resource_on_call_duty_policy_schedule_layer_user.go");
    ruleGo = read("resource_monitor_owner_rule.go");
    teamGo = read("resource_team.go");
    dataSourcesGo = read("data_sources.go");
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  function between(source: string, from: string, to: string): string {
    const start: number = source.indexOf(from);
    const end: number = source.indexOf(to, start + from.length);
    if (start === -1 || end === -1) {
      throw new Error(`no ${from} ... ${to}`);
    }
    return source.substring(start, end);
  }

  test("the people helpers and their tests ship with the provider", () => {
    for (const file of [
      "people.go",
      "people_test.go",
      "people_plan_test.go",
      "data_source_user.go",
    ]) {
      expect(
        fs.existsSync(path.join(outputDir, "internal/provider", file)),
      ).toBe(true);
    }
  });

  test("the user data source is the hand-written one, registered under its name", () => {
    expect(
      fs.readFileSync(
        path.join(outputDir, "internal/provider/data_source_user.go"),
        "utf-8",
      ),
    ).toBe(fs.readFileSync(path.join(STATIC_FILES, "data_source_user.go"), "utf-8"));
    expect(dataSourcesGo).toContain("NewUserDataSource,");
  });

  test("the person's ID is planned by ModifyPlan, not by a plan modifier", () => {
    const userId: string = between(teamMemberGo, '"user_id": schema', "},\n");
    expect(userId).toContain("Optional: true");
    expect(userId).toContain("Computed: true");
    expect(userId).toContain(
      'Validators: personIDValidators("user_email", true)',
    );
    // A plan modifier runs on a schema built from an unconfigured resource:
    // no client to ask with.
    expect(userId).not.toContain("PlanModifiers");

    expect(teamMemberGo).toContain(
      "var _ resource.ResourceWithModifyPlan = &TeamMemberResource{}",
    );
    const modifyPlan: string = between(
      teamMemberGo,
      "func (r *TeamMemberResource) ModifyPlan",
      "\n}\n",
    );
    expect(modifyPlan).toContain("if req.Plan.Raw.IsNull()");
    expect(modifyPlan).toContain("planPersonID(ctx, r.client, req, resp");
    const teamMemberPerson: RegExp = new RegExp(
      'id:\\s+"user_id",\\s+email:\\s+"user_email",\\s+invites:\\s+true,\\s+replaces: true,',
    );
    expect(modifyPlan).toMatch(teamMemberPerson);
  });

  test("the address has the plan modifiers and validators of an address", () => {
    const email: string = between(teamMemberGo, '"user_email": schema', "},\n");
    expect(email).toContain('PlanModifiers: personEmailPlanModifiers("user_id")');
    expect(email).toContain("Validators: personEmailValidators()");
  });

  test("a team member named by address is invited by it", () => {
    const create: string = between(
      teamMemberGo,
      "func (r *TeamMemberResource) Create",
      "func (r *TeamMemberResource) Read",
    );
    expect(create).toContain('teamMemberRequest["miscDataProps"]');
    expect(create).toContain('"email": data.UserEmail.ValueString()');
    expect(create).toContain(
      'delete(teamMemberRequest["data"].(map[string]interface{}), "userId")',
    );
    // An invitation needs no ID: it is not looked up before the create.
    expect(create).not.toContain("personIDForWrite");
    // The person the API made the membership for, before the read-back.
    expect(create).toContain('apiStringValue(created["userId"])');
    expect(create).toContain(
      'alreadyInvitedHint(err, "oneuptime_team_member", "team_id")',
    );
    expect(create).toContain(
      "data.UserEmail = personEmailAfterWrite(ctx, r.client, data.UserId, data.UserEmail)",
    );
  });

  test("anyone else is found by address before the write", () => {
    const create: string = between(
      ownerGo,
      "func (r *MonitorOwnerUserResource) Create",
      "func (r *MonitorOwnerUserResource) Read",
    );
    expect(create).toContain(
      'if !personIDForWrite(ctx, r.client, &data.UserId, data.UserEmail, "user_email", &resp.Diagnostics)',
    );
    expect(create).not.toContain("miscDataProps");
    expect(create).not.toContain("alreadyInvitedHint");

    const update: string = between(
      layerUserGo,
      "func (r *OnCallDutyPolicyScheduleLayerUserResource) Update",
      "func (r *OnCallDutyPolicyScheduleLayerUserResource) Delete",
    );
    expect(update).toContain(
      'if !personIDForWrite(ctx, r.client, &data.UserId, data.UserEmail, "user_email", &resp.Diagnostics)',
    );
    expect(update).toContain(
      "data.UserEmail = personEmailAfterWrite(ctx, r.client, data.UserId, data.UserEmail)",
    );
  });

  test("a refresh keeps the address while the person is the same", () => {
    const read: string = between(
      ownerGo,
      "func (r *MonitorOwnerUserResource) Read",
      "func (r *MonitorOwnerUserResource) Update",
    );
    const prior: number = read.indexOf("priorUserId := data.UserId");
    const call: number = read.indexOf("PostWithSelect");
    expect(prior).toBeGreaterThan(-1);
    expect(prior).toBeLessThan(call);
    expect(read).toContain("priorUserEmail := data.UserEmail");
    expect(read).toContain(
      "data.UserEmail = personEmailAfterRead(ctx, r.client, priorUserId, data.UserId, priorUserEmail)",
    );
  });

  test("a set of people is planned, written and read as a set", () => {
    const owners: string = between(ruleGo, '"owner_users": schema', "},\n");
    expect(owners).toContain("schema.SetAttribute");
    expect(owners).toContain(
      'Validators: personIDsValidators("owner_user_emails", false)',
    );
    const emails: string = between(ruleGo, '"owner_user_emails": schema', "},\n");
    expect(emails).toContain("ElementType: types.StringType");
    expect(emails).toContain(
      'PlanModifiers: personEmailsPlanModifiers("owner_users")',
    );
    expect(emails).toContain("Validators: personEmailsValidators()");

    const ownerRulePeople: RegExp = new RegExp(
      'planPeopleIDs\\(ctx, r\\.client, req, resp, personAttribute\\{\\s+id:\\s+"owner_users",\\s+email:\\s+"owner_user_emails",\\s+invites:\\s+false,\\s+replaces: false,',
    );
    expect(ruleGo).toMatch(ownerRulePeople);
    expect(ruleGo).toContain(
      'personIDsForWrite(ctx, r.client, &data.OwnerUsers, data.OwnerUserEmails, "owner_user_emails", &resp.Diagnostics)',
    );
    expect(ruleGo).toContain(
      "data.OwnerUserEmails = personEmailsAfterRead(ctx, r.client, priorOwnerUsers, data.OwnerUsers, priorOwnerUserEmails)",
    );
    // A set the people helpers plan needs no setplanmodifier of its own.
    expect(ruleGo).not.toContain("setplanmodifier");
  });

  test("a resource that names nobody is as it was", () => {
    expect(teamGo).not.toContain("ModifyPlan");
    expect(teamGo).not.toContain("person");
  });

  test("a membership is imported by its ID, or by team and person", () => {
    const importState: string = between(
      teamMemberGo,
      "func (r *TeamMemberResource) ImportState",
      "\n}\n",
    );
    expect(importState).toContain("importIDOfMembership(ctx, r.client, req.ID");
    expect(importState).toContain('listPath:        "/team-member/get-list"');
    expect(importState).toContain('parentField:     "teamId"');
    expect(importState).toContain('personField:     "userId"');
    expect(importState).toContain(
      'resp.State.SetAttribute(ctx, path.Root("user_email"), email)',
    );
    expect(ownerGo).toContain(
      'resource.ImportStatePassthroughID(ctx, path.Root("id"), req, resp)',
    );
  });

  test("the owner notification and the invitation's acceptance are never sent", () => {
    expect(ownerGo).not.toContain('requestDataMap["isOwnerNotified"]');
    expect(teamMemberGo).not.toContain(
      'requestDataMap["hasAcceptedInvitation"]',
    );
    expect(teamMemberGo).not.toContain("booldefault");
  });

  test("every helper the generated Go calls is one people.go defines", () => {
    const peopleGo: string = fs.readFileSync(
      path.join(STATIC_FILES, "people.go"),
      "utf-8",
    );
    const generated: string = [teamMemberGo, ownerGo, layerUserGo, ruleGo].join(
      "\n",
    );
    const called: Set<string> = new Set<string>();
    const helperCall: RegExp = new RegExp(
      "\\b(person[A-Za-z]+|planPersonID|planPeopleIDs|importIDOfMembership|alreadyInvitedHint|apiStringValue)\\(",
      "g",
    );
    let match: RegExpExecArray | null = helperCall.exec(generated);
    while (match) {
      called.add(match[1]!);
      match = helperCall.exec(generated);
    }

    expect(called.size).toBeGreaterThan(10);
    for (const name of called) {
      expect({ name, defined: peopleGo.includes(`func ${name}(`) }).toEqual({
        name,
        defined: true,
      });
    }
    for (const field of [
      "listPath",
      "parentField",
      "parentAttribute",
      "personField",
    ]) {
      expect(peopleGo).toContain(`\t${field} `);
    }
    const personAttributeFields: RegExp = new RegExp(
      "type personAttribute struct \\{[^}]*\\bid\\b[^}]*\\bemail\\b[^}]*\\binvites\\b[^}]*\\breplaces\\b",
    );
    expect(peopleGo).toMatch(personAttributeFields);
  });
});

describe("the client remembers the people it found", () => {
  test("client.go's Client has the directory people.go keeps", async () => {
    const outputDir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "tfgen-people-client-"),
    );
    try {
      await new ProviderGenerator(
        {
          outputDir,
          providerName: "oneuptime",
          providerVersion: "14.0.0",
          goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
        },
        buildPeopleFixtureSpec(),
      ).generateProvider();
      const clientGo: string = fs.readFileSync(
        path.join(outputDir, "internal/provider/client.go"),
        "utf-8",
      );
      const peopleField: RegExp = new RegExp("\\n\\s+people peopleDirectory\\n");
      expect(clientGo).toMatch(peopleField);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

describe("the reference pages", () => {
  let docs: DocumentationGenerator;
  let outputDir: string;

  beforeAll(async () => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tfgen-people-docs-"));
    docs = new DocumentationGenerator(
      {
        outputDir,
        providerName: "oneuptime",
        providerVersion: "14.0.0",
        goModuleName: "github.com/oneuptime/terraform-provider-oneuptime",
      },
      buildPeopleFixtureSpec(),
    );
    await docs.generateDocumentation();
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  function page(name: string): string {
    return fs.readFileSync(path.join(outputDir, "docs", `${name}.md`), "utf-8");
  }

  test("a resource that needs a person names them by address in its example", () => {
    const teamMember: string = page("resources/team_member");
    const example: string = teamMember.substring(
      teamMember.indexOf("```terraform"),
      teamMember.indexOf("```\n", teamMember.indexOf("```terraform") + 3),
    );
    expect(example).toContain('user_email = "alice@example.com"');
    expect(example).toContain("team_id    = oneuptime_team.example.id");
    expect(example).not.toContain("user_id");
  });

  test("the user data source is looked up by email", () => {
    const user: string = page("data-sources/user");
    expect(user).toContain('email = "alice@example.com"');
    expect(user).toContain(
      "Look someone up by `email`, `name` or `id`: exactly one of them.",
    );
    expect(user).not.toContain("every argument you set must match");
  });
});
