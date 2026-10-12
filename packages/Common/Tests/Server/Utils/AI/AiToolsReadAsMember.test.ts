import { ListCodeRepositoriesTool } from "../../../../Server/Utils/AI/Toolbox/CodeTools";
import { QueryStatusPagesTool } from "../../../../Server/Utils/AI/Toolbox/StatusPageTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import MonitorService from "../../../../Server/Services/MonitorService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import GitHubInstallationBinding from "../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import logger from "../../../../Server/Utils/Logger";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { customDomainCaller } from "../../API/CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ASK AI'S TOOLS, AS THE MEMBERS THEY ARE OFFERED TO.
 *
 * Ask AI acts as the person who asked: its tools read with that person's
 * props. Two of them asked the permission layer for a column those people
 * may not read, so it refused the whole read - the same class of bug as the
 * LLM provider's Test button (CallerReadsReadableColumns finds them
 * statically; these run them):
 *
 *   - the code tools selected each repository's GitHub App installation,
 *     read by owners, admins and Read Code Repository alone, though the
 *     tools are offered to every reader of repositories: a Project Member,
 *     a Viewer and the settings roles were refused "You do not have
 *     permissions to select on - gitHubAppInstallationId";
 *   - the status page tool asked the monitor relation of a page's resources
 *     for isArchived, which no relation read reads: everyone but a server
 *     administrator was refused "Column isArchived on Monitor does not
 *     support read on relation query".
 *
 * Both now read what their readers may read with the reader's props, and
 * the rest - the installation a token is minted from, whether a monitor is
 * archived - as OneUptime, for the rows the reader's own read returned.
 * The permission layer runs for real; the tables are held in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REPOSITORY_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_REPOSITORY_ID: string = "44444444-4444-4444-8444-444444444444";
const PAGE_ID: string = "55555555-5555-4555-8555-555555555555";
const LIVE_MONITOR_ID: string = "66666666-6666-4666-8666-666666666666";
const ARCHIVED_MONITOR_ID: string = "77777777-7777-4777-8777-777777777777";

function memberContext(permissions: Array<Permission>): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: {
      ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
      ...ON_HIGHEST_PLAN,
    },
  };
}

function selectsOf(table: InMemoryTable): Array<JSONObject> {
  return (
    table.repository.find.mock.calls as Array<Array<{ select?: JSONObject }>>
  ).map((call: Array<{ select?: JSONObject }>): JSONObject => {
    return call[0]!.select || {};
  });
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the code tools, as every reader of code repositories", () => {
  let repositories: InMemoryTable;

  beforeEach(() => {
    repositories = useInMemoryTable(CodeRepositoryService, [
      {
        _id: REPOSITORY_ID,
        projectId: PROJECT_ID.toString(),
        name: "checkout",
        organizationName: "acme",
        repositoryName: "checkout",
        mainBranchName: "main",
        repositoryHostedAt: CodeRepositoryType.GitHub,
        gitHubAppInstallationId: "12345",
        version: 1,
      },
      {
        _id: OTHER_REPOSITORY_ID,
        projectId: OTHER_PROJECT_ID.toString(),
        name: "their-billing",
        organizationName: "other",
        repositoryName: "billing",
        mainBranchName: "main",
        repositoryHostedAt: CodeRepositoryType.GitHub,
        gitHubAppInstallationId: "99999",
        version: 1,
      },
    ]);

    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("12345");
  });

  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project admin", [Permission.ProjectAdmin]],
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
    ["a settings admin", [Permission.SettingsAdmin]],
    ["a settings member", [Permission.SettingsMember]],
    ["a settings viewer", [Permission.SettingsViewer]],
    ["someone holding Read Code Repository", [Permission.ReadCodeRepository]],
  ])(
    "%s lists the project's connected repository",
    async (_who: string, permissions: Array<Permission>) => {
      const result: ToolExecutionResult =
        await ListCodeRepositoriesTool.execute({}, memberContext(permissions));

      expect(result.rowCount).toBe(1);
      expect(result.dataForLlm).toContain("checkout");
      expect(result.dataForLlm).toContain(REPOSITORY_ID);
      // Another project's repository is never among them.
      expect(result.dataForLlm).not.toContain("their-billing");
    },
  );

  test("the reader's own read never asks for the installation; OneUptime reads it for those rows alone", async () => {
    await ListCodeRepositoriesTool.execute(
      {},
      memberContext([Permission.ProjectMember]),
    );

    const selects: Array<JSONObject> = selectsOf(repositories);

    expect(selects[0]!["gitHubAppInstallationId"]).toBeUndefined();
    expect(selects[0]!["repositoryHostedAt"]).toBe(true);

    const installationRead: { where?: JSONObject } | undefined = (
      repositories.repository.find.mock.calls as Array<
        Array<{ select?: JSONObject; where?: JSONObject }>
      >
    )
      .map((call: Array<{ select?: JSONObject; where?: JSONObject }>) => {
        return call[0]!;
      })
      .find((read: { select?: JSONObject }) => {
        return read.select?.["gitHubAppInstallationId"] === true;
      });

    expect(installationRead).toBeDefined();
    expect(JSON.stringify(installationRead!.where)).toContain(
      PROJECT_ID.toString(),
    );
  });

  test("the installation is still checked against the project's binding", async () => {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("55555");

    const result: ToolExecutionResult = await ListCodeRepositoriesTool.execute(
      {},
      memberContext([Permission.ProjectMember]),
    );

    expect(result.rowCount).toBe(0);
  });

  test("a member who may not read repositories still may not", async () => {
    await expect(
      ListCodeRepositoriesTool.execute(
        {},
        memberContext([Permission.ReadProjectIncident]),
      ),
    ).rejects.toThrow();
  });
});

describe("the status page tool, as the members it is offered to", () => {
  beforeEach(() => {
    useInMemoryTable(StatusPageService, [
      {
        _id: PAGE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Acme Status",
        description: "Customer-facing status page.",
        pageTitle: "Acme",
        pageDescription: "Is Acme up?",
        isPublicStatusPage: true,
        isArchived: false,
        version: 1,
      },
    ]);

    useInMemoryTable(StatusPageResourceService, [
      {
        _id: "88888888-8888-4888-8888-888888888881",
        projectId: PROJECT_ID.toString(),
        statusPageId: PAGE_ID,
        displayName: "Checkout",
        monitorId: LIVE_MONITOR_ID,
        monitor: { _id: LIVE_MONITOR_ID, name: "Checkout API" },
        order: 1,
        version: 1,
      },
      {
        _id: "88888888-8888-4888-8888-888888888882",
        projectId: PROJECT_ID.toString(),
        statusPageId: PAGE_ID,
        displayName: "Legacy API",
        monitorId: ARCHIVED_MONITOR_ID,
        monitor: { _id: ARCHIVED_MONITOR_ID, name: "Legacy" },
        order: 2,
        version: 1,
      },
    ]);

    useInMemoryTable(MonitorService, [
      {
        _id: LIVE_MONITOR_ID,
        projectId: PROJECT_ID.toString(),
        name: "Checkout API",
        isArchived: false,
        version: 1,
      },
      {
        _id: ARCHIVED_MONITOR_ID,
        projectId: PROJECT_ID.toString(),
        name: "Legacy",
        isArchived: true,
        version: 1,
      },
    ]);

    useInMemoryTable(StatusPageSubscriberService, []);

    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.acme.dev" as never);
  });

  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
  ])(
    "%s reads a page by id, without the resource whose monitor is archived",
    async (_who: string, permissions: Array<Permission>) => {
      const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
        { statusPageId: PAGE_ID },
        memberContext(permissions),
      );

      expect(result.dataForLlm).toContain("Acme Status");
      expect(result.dataForLlm).toContain("Checkout (monitor: Checkout API)");
      expect(result.dataForLlm).not.toContain("Legacy API");
      expect(result.dataForLlm).toContain("resourceCount=1");
    },
  );
});
