import Database from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import ProjectService from "Common/Server/Services/ProjectService";
import CodeRepositoryService from "Common/Server/Services/CodeRepositoryService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import GitHubWebhookQueue, {
  GitHubWebhookDelivery,
} from "Common/Server/Utils/CodeRepository/GitHub/GitHubWebhookQueue";
import GitHubUtil, {
  GitHubRepository,
} from "Common/Server/Utils/CodeRepository/GitHub/GitHub";
import GitHubWebhookProcessor from "Common/Server/Utils/CodeRepository/GitHub/GitHubWebhookProcessor";
import Project from "Common/Models/DatabaseModels/Project";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import ObjectID from "Common/Types/ObjectID";
import Color from "Common/Types/Color";
import { JSONObject } from "Common/Types/JSON";
import ComponentID from "Common/Types/Workflow/ComponentID";
import { ComponentType } from "Common/Types/Workflow/Component";
import { buildTemplateGraph } from "Common/Types/Workflow/Templates";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import { createHmac, randomUUID } from "crypto";

/*
 * Opt-in integration against an already running OneUptime app and its REAL
 * Postgres, Redis, and BullMQ workers. No service, queue, HTTP, or database mocks.
 * The reinstall fixture controls only the external GitHub repository listing;
 * its importer, installation binding checks, and database writes remain real.
 *
 * Run inside the review app container (inherits its isolated database/Redis and
 * webhook secret):
 * GITHUB_WEBHOOK_INTEGRATION=true GITHUB_WEBHOOK_INTEGRATION_BASE_URL=http://localhost:3002
 *   node --no-node-snapshot node_modules/.bin/jest --runInBand --runTestsByPath
 *   Tests/FeatureSet/Workflow/GitHubWebhookIntegration.test.ts
 *
 * Use a disposable environment. Fixtures are scoped to one generated project;
 * cleanup deletes only that project and this suite's delivery markers.
 */
const integration: typeof describe =
  process.env["GITHUB_WEBHOOK_INTEGRATION"] === "true"
    ? describe
    : describe.skip;
const projectId: ObjectID = ObjectID.generate();
const repositoryId: ObjectID = ObjectID.generate();
const workflowId: ObjectID = ObjectID.generate();
const incidentWorkflowId: ObjectID = ObjectID.generate();
const severityId: ObjectID = ObjectID.generate();
const installationId: string = String(Date.now());
const repositoryName: string = `integration-${randomUUID().slice(0, 8)}`;
const deliveries: Array<GitHubWebhookDelivery> = [];
const rootProps: { isRoot: true; ignoreHooks: true } = {
  isRoot: true,
  ignoreHooks: true,
};

async function eventually<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
): Promise<T> {
  const until: number = Date.now() + 45_000;
  let value: T = await read();
  while (!ready(value) && Date.now() < until) {
    await new Promise<void>(
      (resolve: (value: void | PromiseLike<void>) => void): void => {
        setTimeout(resolve, 200);
      },
    );
    value = await read();
  }
  expect(ready(value)).toBe(true);
  return value;
}

function delivery(
  overrides: JSONObject = {},
  event: string = "issues",
): GitHubWebhookDelivery {
  const value: GitHubWebhookDelivery = {
    event,
    deliveryId: randomUUID(),
    payload: {
      action: "opened",
      installation: { id: Number(installationId) },
      repository: {
        id: 900001,
        full_name: `integration-owner/${repositoryName}`,
        name: repositoryName,
        owner: { login: "integration-owner" },
      },
      sender: { id: 900002, login: "integration-user", type: "User" },
      issue: {
        id: 900003,
        number: 7,
        title: "Persisted GitHub delivery – café",
        body: "Whitespace and Unicode survive the signed HTTP request.",
        labels: [],
        html_url: `https://github.com/integration-owner/${repositoryName}/issues/7`,
      },
      ...overrides,
    },
  };
  deliveries.push(value);
  return value;
}

async function send(
  value: GitHubWebhookDelivery,
  validSignature: boolean = true,
): Promise<Response> {
  const raw: string = JSON.stringify(value.payload, null, 2);
  const secret: string = process.env["GITHUB_APP_WEBHOOK_SECRET"]!;
  const signature: string = createHmac(
    "sha256",
    validSignature ? secret : "wrong-integration-secret",
  )
    .update(raw)
    .digest("hex");
  return fetch(
    `${process.env["GITHUB_WEBHOOK_INTEGRATION_BASE_URL"]}/api/github/webhook`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": value.event,
        "x-github-delivery": value.deliveryId,
        "x-hub-signature-256": `sha256=${signature}`,
      },
      body: raw,
      signal: AbortSignal.timeout(15_000),
    },
  );
}

function logs(
  targetWorkflowId: ObjectID = workflowId,
): Promise<Array<WorkflowLog>> {
  return WorkflowLogService.findBy({
    query: { projectId, workflowId: targetWorkflowId },
    select: { _id: true, workflowStatus: true, logs: true },
    limit: 100,
    skip: 0,
    props: rootProps,
  });
}

async function processed(value: GitHubWebhookDelivery): Promise<void> {
  await eventually(
    async (): Promise<number> => {
      return Redis.getClient()!.exists(
        `github-webhook-completed:${GitHubWebhookQueue.getDeliveryKey(value)}`,
      );
    },
    (exists: number): boolean => {
      return exists === 1;
    },
  );
}

integration(
  "GitHub signed HTTP delivery through real queues and persisted workflow execution",
  () => {
    beforeAll(async (): Promise<void> => {
      if (
        !process.env["GITHUB_APP_WEBHOOK_SECRET"] ||
        !process.env["GITHUB_WEBHOOK_INTEGRATION_BASE_URL"]
      ) {
        throw new Error(
          "Set the review app's webhook secret, database/Redis environment, and GITHUB_WEBHOOK_INTEGRATION_BASE_URL before running this opt-in suite.",
        );
      }
      await Database.connect();
      await Redis.connect();
      await ProjectService.create({
        data: Object.assign(new Project(), {
          _id: projectId.toString(),
          name: `GitHub integration ${projectId.toString()}`,
          slug: `github-integration-${projectId.toString()}`,
          gitHubAppInstallationId: installationId,
        }),
        props: rootProps,
      });
      await CodeRepositoryService.create({
        data: Object.assign(new CodeRepository(), {
          _id: repositoryId.toString(),
          projectId,
          name: repositoryName,
          slug: repositoryName,
          organizationName: "integration-owner",
          repositoryName,
          repositoryHostedAt: CodeRepositoryType.GitHub,
          gitHubAppInstallationId: installationId,
          mainBranchName: "main",
        }),
        props: rootProps,
      });
      const triggerArguments: JSONObject = {
        event: "issues",
        actions: "opened",
        repository: repositoryId.toString(),
        ignoreBots: true,
      };
      const graph: JSONObject = buildTemplateGraph(
        {
          nodes: [
            {
              componentId: "github-event-1",
              metadataId: ComponentID.GitHubEvent,
              componentType: ComponentType.Trigger,
              position: { x: 0, y: 0 },
              args: triggerArguments,
            },
            {
              componentId: "log-1",
              metadataId: ComponentID.Log,
              componentType: ComponentType.Component,
              position: { x: 0, y: 150 },
              args: {
                value:
                  "Integration received: {{local.components.github-event-1.returnValues.title}}",
              },
            },
          ],
          edges: [
            {
              fromComponentId: "github-event-1",
              toComponentId: "log-1",
              fromPort: "success",
            },
          ],
        },
        randomUUID,
      );
      await WorkflowService.create({
        data: Object.assign(new Workflow(), {
          _id: workflowId.toString(),
          projectId,
          name: "GitHub integration test",
          slug: `github-integration-${workflowId.toString()}`,
          isEnabled: true,
          graph,
          triggerId: ComponentID.GitHubEvent,
          triggerArguments,
        }),
        props: rootProps,
      });
      await IncidentSeverityService.create({
        data: Object.assign(new IncidentSeverity(), {
          _id: severityId.toString(),
          projectId,
          name: "Integration severity",
          slug: "integration-severity",
          color: new Color("#dc2626"),
          order: 1,
        }),
        props: rootProps,
      });
      await IncidentStateService.create({
        data: Object.assign(new IncidentState(), {
          projectId,
          name: "Created",
          slug: "created",
          color: new Color("#dc2626"),
          order: 1,
          isCreatedState: true,
          isAcknowledgedState: false,
          isResolvedState: false,
        }),
        props: rootProps,
      });
      const commentArguments: JSONObject = {
        event: "issue_comment",
        actions: "created",
        repository: repositoryId.toString(),
        commentCommand: "@oneuptime incident",
        ignoreBots: true,
        requireWriteAccess: false,
      };
      /*
       * The separate authorization suites verify fresh GitHub collaborator
       * access. This isolated end-to-end fixture explicitly opts out so no
       * real GitHub installation, network request, or permission is needed.
       */
      const commentGraph: JSONObject = buildTemplateGraph(
        {
          nodes: [
            {
              componentId: "github-comment-1",
              metadataId: ComponentID.GitHubEvent,
              componentType: ComponentType.Trigger,
              position: { x: 0, y: 0 },
              args: commentArguments,
            },
            {
              componentId: "incident-create-1",
              metadataId: "incident-create-one",
              componentType: ComponentType.Component,
              position: { x: 0, y: 150 },
              args: {
                json: {
                  title:
                    "{{local.components.github-comment-1.returnValues.commandArguments}}",
                  description:
                    "Created from {{local.components.github-comment-1.returnValues.url}}",
                  incidentSeverityId: severityId.toString(),
                },
              },
            },
          ],
          edges: [
            {
              fromComponentId: "github-comment-1",
              toComponentId: "incident-create-1",
              fromPort: "success",
            },
          ],
        },
        randomUUID,
      );
      await WorkflowService.create({
        data: Object.assign(new Workflow(), {
          _id: incidentWorkflowId.toString(),
          projectId,
          name: "GitHub comment creates incident",
          slug: `github-comment-${incidentWorkflowId.toString()}`,
          isEnabled: true,
          graph: commentGraph,
          triggerId: ComponentID.GitHubEvent,
          triggerArguments: commentArguments,
        }),
        props: rootProps,
      });
    }, 120_000);

    afterAll(async (): Promise<void> => {
      try {
        if (Database.isConnected()) {
          await ProjectService.hardDeleteBy({
            query: { _id: projectId.toString() },
            limit: 1,
            skip: 0,
            props: rootProps,
          });
        }
      } finally {
        try {
          if (Redis.isConnected()) {
            for (const value of deliveries) {
              await Redis.getClient()!.del(
                `github-webhook-completed:${GitHubWebhookQueue.getDeliveryKey(value)}`,
              );
            }
          }
        } finally {
          await Promise.all([Redis.disconnect(), Database.disconnect()]);
        }
      }
    }, 60_000);

    test("a genuinely signed noncanonical JSON body reaches BullMQ and completes a persisted workflow", async (): Promise<void> => {
      const value: GitHubWebhookDelivery = delivery();
      const response: Response = await send(value);
      expect(response.status).toBe(200);
      await processed(value);
      const completed: Array<WorkflowLog> = await eventually(
        logs,
        (rows: Array<WorkflowLog>): boolean => {
          return (
            rows.length === 1 &&
            rows[0]!.workflowStatus === WorkflowStatus.Success
          );
        },
      );
      expect(completed[0]!.logs).toContain(
        "Integration received: Persisted GitHub delivery – café",
      );
    }, 60_000);

    test("a signed issue comment command creates a real incident and redelivery cannot duplicate that side effect", async (): Promise<void> => {
      const title: string = `Comment-created incident ${randomUUID()}`;
      const value: GitHubWebhookDelivery = delivery(
        {
          action: "created",
          comment: {
            id: 900010,
            body: `@oneuptime incident ${title}`,
            html_url: `https://github.com/integration-owner/${repositoryName}/issues/7#issuecomment-900010`,
          },
        },
        "issue_comment",
      );
      expect((await send(value)).status).toBe(200);
      await processed(value);
      const incidentRows: () => Promise<Array<Incident>> = (): Promise<
        Array<Incident>
      > => {
        return IncidentService.findBy({
          query: { projectId, title },
          select: {
            _id: true,
            title: true,
            description: true,
            incidentSeverityId: true,
          },
          limit: 10,
          skip: 0,
          props: rootProps,
        });
      };
      const incidents: Array<Incident> = await eventually(
        incidentRows,
        (rows: Array<Incident>): boolean => {
          return rows.length === 1;
        },
      );
      expect(incidents[0]!.title).toBe(title);
      expect(incidents[0]!.description).toContain("#issuecomment-900010");
      expect(incidents[0]!.incidentSeverityId?.toString()).toBe(
        severityId.toString(),
      );
      await eventually(
        (): Promise<Array<WorkflowLog>> => {
          return logs(incidentWorkflowId);
        },
        (rows: Array<WorkflowLog>): boolean => {
          return (
            rows.length === 1 &&
            rows[0]!.workflowStatus === WorkflowStatus.Success
          );
        },
      );
      const repeated: Array<Response> = await Promise.all([
        send(value),
        send(value),
        send(value),
      ]);
      expect(
        repeated.every((response: Response): boolean => {
          return response.status === 200;
        }),
      ).toBe(true);
      expect(await incidentRows()).toHaveLength(1);
      expect(await logs(incidentWorkflowId)).toHaveLength(1);
    }, 60_000);

    test("concurrent deliveries and subsequent redelivery produce exactly one persisted run for that delivery", async (): Promise<void> => {
      const before: number = (await logs()).length;
      const value: GitHubWebhookDelivery = delivery();
      const responses: Array<Response> = await Promise.all(
        Array.from({ length: 8 }, async (): Promise<Response> => {
          return send(value);
        }),
      );
      expect(
        responses.map((response: Response): number => {
          return response.status;
        }),
      ).toEqual(Array(8).fill(200));
      await processed(value);
      await eventually(logs, (rows: Array<WorkflowLog>): boolean => {
        return (
          rows.length === before + 1 &&
          rows.every((row: WorkflowLog): boolean => {
            return row.workflowStatus === WorkflowStatus.Success;
          })
        );
      });
      const repeat: Response = await send(value);
      expect(repeat.status).toBe(200);
      expect((await logs()).length).toBe(before + 1);
    }, 60_000);

    test("GitHub owner and repository casing variations route to the same persisted repository", async (): Promise<void> => {
      const before: number = (await logs()).length;
      const value: GitHubWebhookDelivery = delivery({
        repository: {
          id: 900001,
          full_name: `Integration-Owner/${repositoryName.toUpperCase()}`,
          name: repositoryName.toUpperCase(),
          owner: { login: "Integration-Owner" },
        },
      });
      expect((await send(value)).status).toBe(200);
      await processed(value);
      await eventually(logs, (rows: Array<WorkflowLog>): boolean => {
        return (
          rows.length === before + 1 &&
          rows.every((row: WorkflowLog): boolean => {
            return row.workflowStatus === WorkflowStatus.Success;
          })
        );
      });
    }, 60_000);

    test("an invalid signature is rejected without scheduling a run", async (): Promise<void> => {
      const before: number = (await logs()).length;
      const value: GitHubWebhookDelivery = delivery();
      const response: Response = await send(value, false);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect((await logs()).length).toBe(before);
      expect(
        await Redis.getClient()!.exists(
          `github-webhook-completed:${GitHubWebhookQueue.getDeliveryKey(value)}`,
        ),
      ).toBe(0);
    });

    test.each(["repository", "installation"])(
      "a valid delivery with an unrelated %s cannot execute this project's workflow",
      async (kind: string): Promise<void> => {
        const before: number = (await logs()).length;
        const value: GitHubWebhookDelivery = delivery(
          kind === "repository"
            ? {
                repository: {
                  id: 900099,
                  full_name: "unconnected-owner/private-repo",
                },
              }
            : { installation: { id: Number(installationId) + 1 } },
        );
        expect((await send(value)).status).toBe(200);
        await processed(value);
        expect((await logs()).length).toBe(before);
      },
      60_000,
    );

    test("a disabled workflow receives no run; re-enabling permits a new delivery", async (): Promise<void> => {
      const before: number = (await logs()).length;
      await WorkflowService.updateOneById({
        id: workflowId,
        data: { isEnabled: false },
        props: rootProps,
      });
      const disabled: GitHubWebhookDelivery = delivery();
      expect((await send(disabled)).status).toBe(200);
      await processed(disabled);
      expect((await logs()).length).toBe(before);
      await WorkflowService.updateOneById({
        id: workflowId,
        data: { isEnabled: true },
        props: rootProps,
      });
      const enabled: GitHubWebhookDelivery = delivery();
      expect((await send(enabled)).status).toBe(200);
      await processed(enabled);
      await eventually(logs, (rows: Array<WorkflowLog>): boolean => {
        return (
          rows.length === before + 1 &&
          rows.every((row: WorkflowLog): boolean => {
            return row.workflowStatus === WorkflowStatus.Success;
          })
        );
      });
    }, 60_000);

    test("a signed installation deletion clears persisted bindings and prevents further issue or comment effects", async (): Promise<void> => {
      const issueRunsBefore: number = (await logs()).length;
      const commentRunsBefore: number = (await logs(incidentWorkflowId)).length;
      const incidentCount: () => Promise<number> =
        async (): Promise<number> => {
          return (
            await IncidentService.countBy({
              query: { projectId },
              props: rootProps,
            })
          ).toNumber();
        };
      const incidentsBefore: number = await incidentCount();
      const deleted: GitHubWebhookDelivery = delivery(
        { action: "deleted" },
        "installation",
      );
      expect((await send(deleted)).status).toBe(200);
      await processed(deleted);

      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { _id: true, gitHubAppInstallationId: true },
        props: rootProps,
      });
      const repository: CodeRepository | null =
        await CodeRepositoryService.findOneById({
          id: repositoryId,
          select: { _id: true, gitHubAppInstallationId: true },
          props: rootProps,
        });
      expect(project).not.toBeNull();
      expect(repository).not.toBeNull();
      expect(project!.gitHubAppInstallationId).toBeNull();
      expect(repository!.gitHubAppInstallationId).toBeNull();

      const issue: GitHubWebhookDelivery = delivery();
      const comment: GitHubWebhookDelivery = delivery(
        {
          action: "created",
          comment: {
            id: 900011,
            body: "@oneuptime incident This uninstalled integration must not run",
            html_url: `https://github.com/integration-owner/${repositoryName}/issues/7#issuecomment-900011`,
          },
        },
        "issue_comment",
      );
      for (const value of [issue, comment]) {
        expect((await send(value)).status).toBe(200);
        await processed(value);
      }
      expect(await logs()).toHaveLength(issueRunsBefore);
      expect(await logs(incidentWorkflowId)).toHaveLength(commentRunsBefore);
      expect(await incidentCount()).toBe(incidentsBefore);

      /*
       * Lifecycle redelivery is also safe after the authoritative binding has
       * already been cleared and cannot restore repository access.
       */
      expect((await send(deleted)).status).toBe(200);
      expect(await incidentCount()).toBe(incidentsBefore);
    }, 60_000);

    test("reinstalling rebinds the retained repository through the real importer and restores comment automation", async (): Promise<void> => {
      const reinstallationId: string = String(Number(installationId) + 2);
      const listing: Array<GitHubRepository> = [
        {
          id: 900001,
          name: repositoryName.toUpperCase(),
          fullName: `Integration-Owner/${repositoryName.toUpperCase()}`,
          ownerLogin: "Integration-Owner",
          private: true,
          htmlUrl: `https://github.com/Integration-Owner/${repositoryName.toUpperCase()}`,
          description: "Current installation membership",
          defaultBranch: "different-upstream-default",
        },
      ];
      const listRepositories: jest.SpyInstance = jest
        .spyOn(GitHubUtil, "listRepositoriesForInstallation")
        .mockResolvedValue(listing);

      try {
        /*
         * A live listing cannot grant project ownership. The importer must
         * reject a disconnected project before contacting GitHub at all.
         */
        await expect(
          CodeRepositoryService.importReposFromInstallation({
            projectId,
            installationId: reinstallationId,
            strictImportErrors: true,
          }),
        ).rejects.toThrow();
        expect(listRepositories).not.toHaveBeenCalled();

        /*
         * The real install callback establishes this authoritative binding
         * after verifying GitHub ownership. The fixture supplies that result.
         */
        await ProjectService.updateOneById({
          id: projectId,
          data: { gitHubAppInstallationId: reinstallationId },
          props: rootProps,
        });
        await expect(
          CodeRepositoryService.importReposFromInstallation({
            projectId,
            installationId: reinstallationId,
            strictImportErrors: true,
          }),
        ).resolves.toEqual({ imported: 1, skipped: 0 });
        await expect(
          CodeRepositoryService.importReposFromInstallation({
            projectId,
            installationId: reinstallationId,
            strictImportErrors: true,
          }),
        ).resolves.toEqual({ imported: 0, skipped: 1 });
        expect(listRepositories).toHaveBeenCalledTimes(2);
        expect(listRepositories).toHaveBeenCalledWith(reinstallationId);
      } finally {
        listRepositories.mockRestore();
      }

      const repositories: Array<CodeRepository> =
        await CodeRepositoryService.findBy({
          query: { projectId },
          select: {
            _id: true,
            name: true,
            organizationName: true,
            repositoryName: true,
            mainBranchName: true,
            gitHubAppInstallationId: true,
          },
          limit: 10,
          skip: 0,
          props: rootProps,
        });
      expect(repositories).toHaveLength(1);
      expect(repositories[0]!.id?.toString()).toBe(repositoryId.toString());
      expect(repositories[0]!.gitHubAppInstallationId).toBe(reinstallationId);
      expect(repositories[0]!.name).toBe(repositoryName);
      expect(repositories[0]!.organizationName).toBe("integration-owner");
      expect(repositories[0]!.repositoryName).toBe(repositoryName);
      expect(repositories[0]!.mainBranchName).toBe("main");

      const before: number = (await logs(incidentWorkflowId)).length;
      const title: string = `Reinstalled comment incident ${randomUUID()}`;
      const comment: GitHubWebhookDelivery = delivery(
        {
          action: "created",
          installation: { id: Number(reinstallationId) },
          comment: {
            id: 900012,
            body: `@oneuptime incident ${title}`,
            html_url: `https://github.com/integration-owner/${repositoryName}/issues/7#issuecomment-900012`,
          },
        },
        "issue_comment",
      );
      expect((await send(comment)).status).toBe(200);
      await processed(comment);
      await eventually(
        (): Promise<Array<WorkflowLog>> => {
          return logs(incidentWorkflowId);
        },
        (rows: Array<WorkflowLog>): boolean => {
          return (
            rows.length === before + 1 &&
            rows.every((row: WorkflowLog): boolean => {
              return row.workflowStatus === WorkflowStatus.Success;
            })
          );
        },
      );
      expect(
        (
          await IncidentService.countBy({
            query: { projectId, title },
            props: rootProps,
          })
        ).toNumber(),
      ).toBe(1);
    }, 60_000);

    test("removing and re-adding repository access preserves its row and restores comment automation", async (): Promise<void> => {
      const activeInstallationId: string = String(Number(installationId) + 2);
      const before: number = (await logs(incidentWorkflowId)).length;
      const title: string = `Re-added repository incident ${randomUUID()}`;
      const listRepositories: jest.SpyInstance = jest
        .spyOn(GitHubUtil, "listRepositoriesForInstallation")
        .mockResolvedValue([]);

      try {
        const removed: GitHubWebhookDelivery = delivery(
          {
            action: "removed",
            installation: { id: Number(activeInstallationId) },
            repositories_removed: [
              {
                id: 900001,
                full_name: `INTEGRATION-OWNER/${repositoryName.toUpperCase()}`,
              },
            ],
            repositories_added: [],
          },
          "installation_repositories",
        );
        await GitHubWebhookProcessor.process(
          removed,
          async (): Promise<void> => {
            throw new Error(
              "A lifecycle delivery must not dispatch workflows.",
            );
          },
        );
        expect(listRepositories).toHaveBeenCalledWith(activeInstallationId);

        const retained: CodeRepository | null =
          await CodeRepositoryService.findOneById({
            id: repositoryId,
            select: {
              _id: true,
              name: true,
              mainBranchName: true,
              gitHubAppInstallationId: true,
            },
            props: rootProps,
          });
        expect(retained).not.toBeNull();
        expect(retained!.id?.toString()).toBe(repositoryId.toString());
        expect(retained!.gitHubAppInstallationId).toBeNull();
        expect(retained!.name).toBe(repositoryName);
        expect(retained!.mainBranchName).toBe("main");
        expect(
          (
            await ProjectService.findOneById({
              id: projectId,
              select: { _id: true, gitHubAppInstallationId: true },
              props: rootProps,
            })
          )?.gitHubAppInstallationId,
        ).toBe(activeInstallationId);

        const blocked: GitHubWebhookDelivery = delivery(
          {
            action: "created",
            installation: { id: Number(activeInstallationId) },
            comment: {
              id: 900013,
              body: `@oneuptime incident ${title}`,
              html_url: `https://github.com/integration-owner/${repositoryName}/issues/7#issuecomment-900013`,
            },
          },
          "issue_comment",
        );
        expect((await send(blocked)).status).toBe(200);
        await processed(blocked);
        expect(await logs(incidentWorkflowId)).toHaveLength(before);
        expect(
          (
            await IncidentService.countBy({
              query: { projectId, title },
              props: rootProps,
            })
          ).toNumber(),
        ).toBe(0);

        const listing: Array<GitHubRepository> = [
          {
            id: 900001,
            name: repositoryName.toUpperCase(),
            fullName: `Integration-Owner/${repositoryName.toUpperCase()}`,
            ownerLogin: "Integration-Owner",
            private: true,
            htmlUrl: `https://github.com/Integration-Owner/${repositoryName.toUpperCase()}`,
            description: "Restored repository access",
            defaultBranch: "different-upstream-default",
          },
        ];
        listRepositories.mockResolvedValue(listing);
        await expect(
          CodeRepositoryService.importReposFromInstallation({
            projectId,
            installationId: activeInstallationId,
            strictImportErrors: true,
          }),
        ).resolves.toEqual({ imported: 1, skipped: 0 });
      } finally {
        listRepositories.mockRestore();
      }

      const repositories: Array<CodeRepository> =
        await CodeRepositoryService.findBy({
          query: { projectId },
          select: {
            _id: true,
            name: true,
            organizationName: true,
            repositoryName: true,
            mainBranchName: true,
            gitHubAppInstallationId: true,
          },
          limit: 10,
          skip: 0,
          props: rootProps,
        });
      expect(repositories).toHaveLength(1);
      expect(repositories[0]!.id?.toString()).toBe(repositoryId.toString());
      expect(repositories[0]!.gitHubAppInstallationId).toBe(
        activeInstallationId,
      );
      expect(repositories[0]!.name).toBe(repositoryName);
      expect(repositories[0]!.organizationName).toBe("integration-owner");
      expect(repositories[0]!.repositoryName).toBe(repositoryName);
      expect(repositories[0]!.mainBranchName).toBe("main");

      const restored: GitHubWebhookDelivery = delivery(
        {
          action: "created",
          installation: { id: Number(activeInstallationId) },
          comment: {
            id: 900014,
            body: `@oneuptime incident ${title}`,
            html_url: `https://github.com/integration-owner/${repositoryName}/issues/7#issuecomment-900014`,
          },
        },
        "issue_comment",
      );
      expect((await send(restored)).status).toBe(200);
      await processed(restored);
      await eventually(
        (): Promise<Array<WorkflowLog>> => {
          return logs(incidentWorkflowId);
        },
        (rows: Array<WorkflowLog>): boolean => {
          return (
            rows.length === before + 1 &&
            rows.every((row: WorkflowLog): boolean => {
              return row.workflowStatus === WorkflowStatus.Success;
            })
          );
        },
      );
      expect(
        (
          await IncidentService.countBy({
            query: { projectId, title },
            props: rootProps,
          })
        ).toNumber(),
      ).toBe(1);
    }, 60_000);
  },
);
