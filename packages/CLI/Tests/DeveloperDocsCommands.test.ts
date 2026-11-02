import { ApiRequestOptions } from "../Core/ApiClient";

const mockExecuteApiRequest: jest.Mock = jest.fn();
jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: unknown[]): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

import {
  clearTestCredentials,
  CliRun,
  runCli,
  useTestCredentials,
} from "./Helpers/RunCli";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";
import {
  CliOperation,
  getCliDatabaseOperations,
} from "Common/Utils/DeveloperDocs/CliCommands";
import {
  CliExample,
  getCliCreateExample,
  getCliGetExample,
  getCliListExample,
  getCliUpdateExample,
} from "Common/Utils/DeveloperDocs/CliExamples";
import {
  DeveloperDocsApiBody,
  DeveloperDocsApiFilter,
  DeveloperDocsApiTask,
  DeveloperDocsClient,
  DeveloperDocsExampleContext,
  getApiCreateExample,
  getApiFilters,
  getApiReadSelect,
  getApiTasks,
  getApiUpdateExample,
} from "Common/Utils/DeveloperDocs/ExampleBuilder";
import { DEVELOPER_DOCS_PROFILES } from "Common/Utils/DeveloperDocs/ResourceProfiles";
import {
  FIXTURE_RECORD_ID,
  FIXTURE_USER_EMAIL,
  FIXTURE_USER_ID,
  getFixtureLiveData,
} from "Common/Tests/Utils/DeveloperDocs/DeveloperDocsLiveFixture";

/*
 * THE DASHBOARD'S CLI PAGES SHOW COMMANDS THE CLI RUNS
 *
 * Developer > CLI shows the API page's requests as CLI commands, written by
 * Common/Utils/DeveloperDocs/CliExamples from the same example data
 * (ExampleBuilder). This runs every such command - for every resource with
 * a profile: its create, its filters, its change, its read and its tasks -
 * through the CLI's real program, and holds the request each sends to the
 * request the API page shows for it. So a page can never show a flag the
 * CLI lacks, or a command that sends anything else than its curl.
 *
 * And each command, as a reader copies it, is the same words the program
 * was given: the line the page shows is read back as a shell reads it.
 */

const EMAILS_BY_ID: Record<string, string> = {
  [FIXTURE_USER_ID]: FIXTURE_USER_EMAIL,
};

function modelOf(tableName: string): DatabaseBaseModelType {
  return DatabaseModels.find((candidate: DatabaseBaseModelType): boolean => {
    return new candidate().tableName === tableName;
  }) as DatabaseBaseModelType;
}

// The profiled resources the CLI has commands for.
const PROFILED: Array<[string, DatabaseBaseModelType]> = Object.keys(
  DEVELOPER_DOCS_PROFILES,
)
  .map((tableName: string): [string, DatabaseBaseModelType] => {
    return [tableName, modelOf(tableName)];
  })
  .filter(([, modelType]: [string, DatabaseBaseModelType]): boolean => {
    return Boolean(modelType) && getCliDatabaseOperations(modelType).length > 0;
  });

function listContext(): DeveloperDocsExampleContext {
  return { live: getFixtureLiveData() };
}

function viewContext(): DeveloperDocsExampleContext {
  return {
    live: getFixtureLiveData(),
    record: { id: FIXTURE_RECORD_ID, displayName: "Checkout", json: {} },
  };
}

// The CLI finding a person by address (Utils/People), not the command's own request.
function isPeopleLookup(request: ApiRequestOptions): boolean {
  return (
    request.apiPath === "/team-member" &&
    request.operation === "list" &&
    Boolean((request.query?.["user"] as JSONObject | undefined)?.["email"])
  );
}

// Answers like OneUptime: the viewer is the project's one member.
function answerLikeOneUptime(): void {
  mockExecuteApiRequest.mockImplementation(
    async (options: ApiRequestOptions): Promise<unknown> => {
      if (isPeopleLookup(options)) {
        return [
          {
            userId: FIXTURE_USER_ID,
            user: { _id: FIXTURE_USER_ID, email: FIXTURE_USER_EMAIL },
          },
        ];
      }

      return options.operation === "list" ? [] : { _id: FIXTURE_RECORD_ID };
    },
  );
}

// The request a command made, besides any lookup of people.
async function requestOf(command: CliExample): Promise<ApiRequestOptions> {
  mockExecuteApiRequest.mockClear();

  const run: CliRun = await runCli(command.args);

  expect({
    command: command.command,
    exitCode: run.exitCode,
    errors: run.errors,
  }).toEqual({
    command: command.command,
    exitCode: undefined,
    errors: [],
  });

  const requests: Array<ApiRequestOptions> = mockExecuteApiRequest.mock.calls
    .map((call: Array<unknown>): ApiRequestOptions => {
      return call[0] as ApiRequestOptions;
    })
    .filter((request: ApiRequestOptions): boolean => {
      return !isPeopleLookup(request);
    });

  return requests[requests.length - 1] as ApiRequestOptions;
}

/*
 * The words a POSIX shell reads out of a command as the page shows it:
 * single-quoted words (with '\'' for a quote inside), and lines continued
 * with a backslash.
 */
function shellWords(command: string): Array<string> {
  const text: string = command.split(" \\\n").join(" ");
  const words: Array<string> = [];
  let word: string = "";
  let inWord: boolean = false;
  let index: number = 0;

  while (index < text.length) {
    const character: string = text.charAt(index);

    if (character === "'") {
      const end: number = text.indexOf("'", index + 1);

      word += text.slice(index + 1, end);
      inWord = true;
      index = end + 1;
      continue;
    }

    if (character === "\\" && text.charAt(index + 1) === "'") {
      word += "'";
      inWord = true;
      index += 2;
      continue;
    }

    if (character === " " || character === "\n") {
      if (inWord) {
        words.push(word);
      }

      word = "";
      inWord = false;
      index++;
      continue;
    }

    word += character;
    inWord = true;
    index++;
  }

  if (inWord) {
    words.push(word);
  }

  return words;
}

function expectReadsBack(command: CliExample): void {
  expect(shellWords(command.command)).toEqual(["oneuptime", ...command.args]);
}

describe("the Developer > CLI pages' commands", () => {
  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    answerLikeOneUptime();
    useTestCredentials();
  });

  afterEach(() => {
    clearTestCredentials();
  });

  it("are for many resources", () => {
    expect(PROFILED.length).toBeGreaterThan(30);
  });

  it.each(PROFILED)(
    "create %s with the data the API page sends",
    async (_tableName: string, modelType: DatabaseBaseModelType) => {
      if (!getCliDatabaseOperations(modelType).includes(CliOperation.Create)) {
        return;
      }

      const api: DeveloperDocsApiBody = getApiCreateExample({
        modelType,
        context: listContext(),
      });

      if (Object.keys(api.body).length === 0) {
        return;
      }

      const command: CliExample = getCliCreateExample({
        modelType,
        values: api.body,
        emailsById: EMAILS_BY_ID,
      });

      expectReadsBack(command);

      const request: ApiRequestOptions = await requestOf(command);

      expect(request.operation).toBe("create");
      expect(request.data).toEqual(api.body);
    },
  );

  it.each(PROFILED)(
    "filter %s with the query, fields and order the API page sends",
    async (_tableName: string, modelType: DatabaseBaseModelType) => {
      const filters: Array<DeveloperDocsApiFilter> = getApiFilters({
        modelType,
        context: listContext(),
      });

      for (const filter of filters) {
        const command: CliExample = getCliListExample({
          modelType,
          query: filter.body["query"] as JSONObject,
          select: filter.body["select"] as JSONObject,
          sort: filter.body["sort"] as JSONObject,
          limit: 10,
        });

        expectReadsBack(command);

        const request: ApiRequestOptions = await requestOf(command);

        expect({
          filter: filter.title,
          query: request.query,
          select: request.select,
          limit: request.limit,
        }).toEqual({
          filter: filter.title,
          query: filter.body["query"],
          select: filter.body["select"],
          limit: 10,
        });

        // Newest first is the CLI's own order: left out, it is no sort.
        const sort: JSONObject = filter.body["sort"] as JSONObject;

        if (JSON.stringify(sort) !== JSON.stringify({ createdAt: "DESC" })) {
          expect(request.sort).toEqual(sort);
        }
      }
    },
  );

  it.each(PROFILED)(
    "read %s with the fields the API page asks for",
    async (_tableName: string, modelType: DatabaseBaseModelType) => {
      if (!getCliDatabaseOperations(modelType).includes(CliOperation.Get)) {
        return;
      }

      const select: JSONObject = getApiReadSelect(modelType);
      const command: CliExample = getCliGetExample({
        modelType,
        id: FIXTURE_RECORD_ID,
        select,
      });

      expectReadsBack(command);

      const request: ApiRequestOptions = await requestOf(command);

      expect(request.operation).toBe("read");
      expect(request.id).toBe(FIXTURE_RECORD_ID);
      expect(request.select).toEqual(select);
    },
  );

  it.each(PROFILED)(
    "change %s as the API page does",
    async (_tableName: string, modelType: DatabaseBaseModelType) => {
      if (!getCliDatabaseOperations(modelType).includes(CliOperation.Update)) {
        return;
      }

      // As the CLI page asks for it: its new description names the CLI.
      const update: { data: JSONObject; description: string } | null =
        getApiUpdateExample({
          modelType,
          context: viewContext(),
          client: DeveloperDocsClient.Cli,
        });

      if (!update) {
        return;
      }

      const command: CliExample = getCliUpdateExample({
        modelType,
        id: FIXTURE_RECORD_ID,
        values: update.data,
        emailsById: EMAILS_BY_ID,
      });

      expectReadsBack(command);

      const request: ApiRequestOptions = await requestOf(command);

      expect(request.operation).toBe("update");
      expect(request.data).toEqual(update.data);
    },
  );

  it.each(PROFILED)(
    "run %s's tasks as the API page does, where the CLI has no button of its own for them",
    async (_tableName: string, modelType: DatabaseBaseModelType) => {
      const tasks: Array<DeveloperDocsApiTask> = getApiTasks({
        modelType,
        scope: "view",
        context: viewContext(),
      });

      for (const task of tasks) {
        if (getCliDatabaseOperations(task.modelType).length === 0) {
          continue;
        }

        if (task.operation === "create") {
          const command: CliExample = getCliCreateExample({
            modelType: task.modelType,
            values: task.body["data"] as JSONObject,
            emailsById: EMAILS_BY_ID,
          });

          expectReadsBack(command);
          expect((await requestOf(command)).data).toEqual(task.body["data"]);
          continue;
        }

        const command: CliExample = getCliListExample({
          modelType: task.modelType,
          query: task.body["query"] as JSONObject,
          select: task.body["select"] as JSONObject,
          sort: task.body["sort"] as JSONObject,
          limit: 10,
        });

        expectReadsBack(command);

        const request: ApiRequestOptions = await requestOf(command);

        expect({
          task: task.title,
          query: request.query,
          select: request.select,
        }).toEqual({
          task: task.title,
          query: task.body["query"],
          select: task.body["select"],
        });
      }
    },
  );

  it("name a person by the viewer's address, and send their ID", async () => {
    const command: CliExample = getCliCreateExample({
      modelType: modelOf("TeamMember"),
      values: { teamId: FIXTURE_RECORD_ID, userId: FIXTURE_USER_ID },
      emailsById: EMAILS_BY_ID,
    });

    expect(command.args).toEqual([
      "team-member",
      "create",
      "--team-id",
      FIXTURE_RECORD_ID,
      "--user-email",
      FIXTURE_USER_EMAIL,
      "--json",
    ]);
    expect((await requestOf(command)).data).toEqual({
      teamId: FIXTURE_RECORD_ID,
      userId: FIXTURE_USER_ID,
    });
  });
});
