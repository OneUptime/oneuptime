import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The project half of the private-network webhook opt-in (issue #3424).
 *
 * Every outbound webhook, workflow API step and sandboxed axios call runs
 * through this, so it has to be cheap on the deployments where the answer can
 * only ever be false — and it has to fail closed when anything goes wrong,
 * because the caller is about to decide whether to open a socket into the
 * operator's private network.
 */

const ALLOW_ENV: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";
const ALLOWLIST_ENV: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";

type FindOneByIdSpy = jest.SpiedFunction<
  (data: unknown) => Promise<Project | null>
>;

describe("ProjectService.isPrivateNetworkWebhookAllowed", () => {
  let findOneByIdSpy: FindOneByIdSpy;
  let originalAllow: string | undefined;
  let originalAllowlist: string | undefined;

  const projectId: ObjectID = ObjectID.generate();

  const projectWith: (allowed: boolean) => Project = (
    allowed: boolean,
  ): Project => {
    const project: Project = new Project();
    project.allowPrivateNetworkWebhooks = allowed;
    return project;
  };

  beforeEach(() => {
    originalAllow = process.env[ALLOW_ENV];
    originalAllowlist = process.env[ALLOWLIST_ENV];
    delete process.env[ALLOW_ENV];
    delete process.env[ALLOWLIST_ENV];

    findOneByIdSpy = jest.spyOn(
      ProjectService,
      "findOneById",
    ) as unknown as FindOneByIdSpy;
    findOneByIdSpy.mockResolvedValue(projectWith(true));
  });

  afterEach(() => {
    jest.restoreAllMocks();

    /*
     * The answer is cached for 60s per project, so a case that populated the
     * cache would otherwise decide the next case's result.
     */
    (
      ProjectService as unknown as {
        allowPrivateNetworkWebhooksCache: { clear: () => void };
      }
    ).allowPrivateNetworkWebhooksCache.clear();

    if (originalAllow === undefined) {
      delete process.env[ALLOW_ENV];
    } else {
      process.env[ALLOW_ENV] = originalAllow;
    }

    if (originalAllowlist === undefined) {
      delete process.env[ALLOWLIST_ENV];
    } else {
      process.env[ALLOWLIST_ENV] = originalAllowlist;
    }
  });

  test("is false without a project id, and reads nothing", async () => {
    process.env[ALLOW_ENV] = "true";

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(undefined),
    ).resolves.toBe(false);
    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(null),
    ).resolves.toBe(false);
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  /*
   * The SaaS case. The flag cannot grant anything, so it must not cost a query
   * per webhook either.
   */
  test("is false — and skips the query — when the instance configured nothing", async () => {
    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(false);
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  test("reads the project when the instance allows private networks", async () => {
    process.env[ALLOW_ENV] = "true";

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(true);
    expect(findOneByIdSpy).toHaveBeenCalledTimes(1);
  });

  test("reads the project when the instance has only an allowlist", async () => {
    process.env[ALLOWLIST_ENV] = "mattermost.internal";

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(true);
    expect(findOneByIdSpy).toHaveBeenCalledTimes(1);
  });

  test("is false when the project has not opted in", async () => {
    process.env[ALLOW_ENV] = "true";
    findOneByIdSpy.mockResolvedValue(projectWith(false));

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(false);
  });

  test("is false when the project cannot be found", async () => {
    process.env[ALLOW_ENV] = "true";
    findOneByIdSpy.mockResolvedValue(null);

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(false);
  });

  // Fails closed: a database blip must narrow the policy, never widen it.
  test("is false when the read throws", async () => {
    process.env[ALLOW_ENV] = "true";
    findOneByIdSpy.mockRejectedValue(new Error("Database not connected"));

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(false);
  });

  test("does not cache a failed read", async () => {
    process.env[ALLOW_ENV] = "true";
    findOneByIdSpy.mockRejectedValueOnce(new Error("Database not connected"));

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(false);

    findOneByIdSpy.mockResolvedValue(projectWith(true));

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(true);
  });

  test("caches the answer per project", async () => {
    process.env[ALLOW_ENV] = "true";

    await ProjectService.isPrivateNetworkWebhookAllowed(projectId);
    await ProjectService.isPrivateNetworkWebhookAllowed(projectId);
    await ProjectService.isPrivateNetworkWebhookAllowed(projectId);

    expect(findOneByIdSpy).toHaveBeenCalledTimes(1);
  });

  test("caches separately per project", async () => {
    process.env[ALLOW_ENV] = "true";

    const otherProjectId: ObjectID = ObjectID.generate();
    findOneByIdSpy.mockResolvedValueOnce(projectWith(true));
    findOneByIdSpy.mockResolvedValueOnce(projectWith(false));

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(true);
    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(otherProjectId),
    ).resolves.toBe(false);
    expect(findOneByIdSpy).toHaveBeenCalledTimes(2);
  });

  test("an update to the setting drops the cached answer", async () => {
    process.env[ALLOW_ENV] = "true";

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(true);

    findOneByIdSpy.mockResolvedValue(projectWith(false));

    await (
      ProjectService as unknown as {
        onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
      }
    ).onBeforeUpdate({
      data: { allowPrivateNetworkWebhooks: false },
      query: {},
      props: { isRoot: true },
    });

    await expect(
      ProjectService.isPrivateNetworkWebhookAllowed(projectId),
    ).resolves.toBe(false);
  });
});
