const mockExecuteApiRequest: jest.Mock = jest.fn();
jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: unknown[]): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

import { discoverResources } from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import {
  describeResource,
  DescribedField,
  ResourceDescription,
} from "../Utils/ResourceFields";
import {
  describeFlag,
  describeWrites,
  formatResourceFieldsTable,
} from "../Utils/ResourceFieldsTable";
import { CliRun, printedJson, runCli } from "./Helpers/RunCli";

/*
 * `oneuptime <resource> fields`: every field of a resource, read from the
 * models - no key, no request - with the flag that sets it, whether a
 * create must give it and whether a key may read it back. The CLI's answer
 * to the MCP server's oneuptime_describe_resource.
 */

const FIELD_KEYS: Array<string> = [
  "name",
  "title",
  "type",
  "description",
  "required",
  "create",
  "update",
  "read",
  "flag",
  "emailFlag",
  "relatedResource",
];

function resource(name: string): ResourceInfo {
  return discoverResources().find((candidate: ResourceInfo): boolean => {
    return candidate.name === name;
  }) as ResourceInfo;
}

function field(description: ResourceDescription, name: string): DescribedField {
  return description.fields.find((candidate: DescribedField): boolean => {
    return candidate.name === name;
  }) as DescribedField;
}

describe("a resource's fields", () => {
  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
  });

  it("are listed without a key, and without asking OneUptime", async () => {
    const run: CliRun = await runCli(["incident", "fields", "--json"]);

    expect(run.exitCode).toBeUndefined();
    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    expect(printedJson(run)).toEqual(describeResource(resource("incident")));
  });

  it("say what the resource is and every subcommand it has", () => {
    const incident: ResourceDescription = describeResource(resource("incident"));

    expect({
      resource: incident.resource,
      singularName: incident.singularName,
      pluralName: incident.pluralName,
      type: incident.type,
      apiPath: incident.apiPath,
      commands: incident.commands,
    }).toEqual({
      resource: "incident",
      singularName: "Incident",
      pluralName: "Incidents",
      type: "database",
      apiPath: "/incident",
      commands: [
        "list",
        "get",
        "create",
        "update",
        "delete",
        "count",
        "fields",
        "acknowledge",
        "resolve",
        "add-note",
      ],
    });
  });

  it("keep the same keys for every field of every resource, for scripts", () => {
    for (const each of discoverResources()) {
      for (const described of describeResource(each).fields) {
        expect(Object.keys(described)).toEqual(FIELD_KEYS);
      }
    }
  });

  it("say which a create must give, the flag that sets it, and the resource an ID is of", () => {
    const incident: ResourceDescription = describeResource(resource("incident"));

    expect(field(incident, "title")).toEqual(
      expect.objectContaining({
        required: true,
        create: true,
        update: true,
        read: true,
        flag: "--title",
      }),
    );
    expect(field(incident, "incidentSeverityId")).toEqual(
      expect.objectContaining({
        required: true,
        flag: "--incident-severity-id",
        relatedResource: "incident-severity",
      }),
    );
    expect(field(incident, "monitors")?.relatedResource).toBe("monitor");
    // Read, never written: no flag.
    expect(field(incident, "createdAt")).toEqual(
      expect.objectContaining({ read: true, create: false, update: false, flag: null }),
    );
    // The project comes from the key: no flag sets it.
    expect(field(incident, "projectId")?.flag).toBeNull();
  });

  it("name a person's flag by address beside its ID's", () => {
    const member: DescribedField = field(describeResource(resource("team-member")), "userId");

    expect(member).toEqual(
      expect.objectContaining({ flag: "--user-id", emailFlag: "--user-email" }),
    );
    expect(describeFlag(member)).toBe("--user-id or --user-email");
  });

  it("say a field whose name the CLI uses itself is set in --data", () => {
    const url: DescribedField = field(describeResource(resource("data-source")), "url");

    expect(url).toEqual(expect.objectContaining({ create: true, flag: null }));
    expect(describeFlag(url)).toBe("in --data");
  });

  it("list telemetry's columns, set in --data", () => {
    const log: ResourceDescription = describeResource(resource("log"));

    expect(log.type).toBe("analytics");
    expect(field(log, "body")).toEqual(
      expect.objectContaining({ read: true, create: true, flag: null }),
    );
    expect(log.commands).toEqual([
      "list",
      "get",
      "create",
      "update",
      "delete",
      "count",
      "fields",
    ]);
  });

  it("print as a table for people, with how to set a field without a flag", async () => {
    const run: CliRun = await runCli(["data-source", "fields"], { isTTY: true });
    const table: string = run.printed.join("\n");

    expect(table).toContain("Field");
    expect(table).toContain("Flag");
    expect(table).toContain("Required");
    expect(table).toContain("in --data");
    expect(table).toContain(
      `A field without a flag is set in --data, such as --data '{"<field>": <value>}'.`,
    );
    expect(table.split("\n")[0]).toBe(
      `${resource("data-source").pluralName}: oneuptime data-source list, get, create, update, delete, count, fields`,
    );
  });

  it("word what a field may be written by", () => {
    const base: DescribedField = field(describeResource(resource("incident")), "title");

    expect(describeWrites({ ...base, create: true, update: true })).toBe("create, update");
    expect(describeWrites({ ...base, create: true, update: false })).toBe("create");
    expect(describeWrites({ ...base, create: false, update: true })).toBe("update");
    expect(describeWrites({ ...base, create: false, update: false })).toBe("read only");
  });

  it("table every resource without an error", () => {
    for (const each of discoverResources()) {
      expect(() => {
        formatResourceFieldsTable(describeResource(each));
      }).not.toThrow();
    }
  });
});
