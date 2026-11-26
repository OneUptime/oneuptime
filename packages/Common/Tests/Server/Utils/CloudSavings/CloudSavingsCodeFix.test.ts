import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskGate from "../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
} from "../../../../Server/Utils/AI/Remediation/DeclaredCodeOwner";
import CloudSavingsActions, {
  CloudSavingContext,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsActions";
import CloudSavingsCodeFix, {
  getCloudSavingsCodeFixRequest,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsCodeFix";
import CloudSavingsOwners from "../../../../Server/Utils/CloudSavings/CloudSavingsOwners";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudSavingsActionKind,
  CloudSavingsActionPlan,
  CloudSavingsTargetType,
} from "../../../../Types/Cloud/CloudSavingsAction";
import {
  CloudSavingsDeclaredCode,
  CloudSavingsFixInCodeResult,
} from "../../../../Types/Cloud/CloudSavingsApiTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  DeclaredCodeKind,
  DeclaredCodeOwnerReason,
} from "../../../../Utils/AiRemediation/DeclaredCodeChange";

/*
 * A SAVING ON A RESOURCE DECLARED IN CODE IS MADE IN THAT CODE (#11010).
 *
 * "A resource declared in Terraform gets a pull request instead of an API
 * change": a resource whose tags say Terraform, CloudFormation, Pulumi or
 * Bicep declares it (CloudAiTargets.getManagedAsCode) is offered a pull
 * request first, or the next deploy puts the resource back as it was.
 * These pin both halves:
 *
 *   - whether a resource is declared in code, and in which repository
 *     (CloudSavingsActions.getDeclaredInCode): its tags decide, the
 *     repository finder (DeclaredCodeOwner) only says where, and a finder
 *     that fails still says the resource is declared in code;
 *   - the pull request (CloudSavingsCodeFix.start): a Code task started as
 *     the person, in the repository they picked or the one OneUptime
 *     found, gated as asking in Code is - and nothing asked of the cloud:
 *     no change is applied, approved or recorded for it. Each refusal comes
 *     before anything is started, and says what to do instead.
 *
 * The services, the repository finder and Code's task runner are
 * stood in for; the request a task is asked is read as it is written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5b6c1a10-7f2e-4a0b-9a51-2d1f6a0c1010",
);
const USER_ID: ObjectID = new ObjectID("8c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e");
const RECOMMENDATION_ID: ObjectID = new ObjectID(
  "0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const DECLARED_REPOSITORY_ID: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const PICKED_REPOSITORY_ID: string = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

const PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

function planOf(
  kind: CloudSavingsActionKind,
  extra?: Partial<CloudSavingsActionPlan>,
): CloudSavingsActionPlan {
  return {
    kind,
    target: {
      provider: CloudProvider.AWS,
      type: CloudSavingsTargetType.Volume,
      id: "vol-0abc1234",
      location: "eu-west-1",
      account: "123456789012",
    },
    restarts: false,
    ...(extra || {}),
  };
}

function resourceOf(tags: Record<string, string> | null): CloudResource {
  const resource: CloudResource = new CloudResource();
  resource.name = "web-data";
  resource.cloudTags = tags as never;
  return resource;
}

function savingOf(data: {
  plan?: CloudSavingsActionPlan | undefined;
  resource?: CloudResource | null | undefined;
}): CloudSavingContext {
  return {
    recommendation: {
      resourceName: "web-data",
      resourceId: "vol-0abc1234",
      monthlySavings: 12.5,
      currency: "usd",
    },
    resource:
      data.resource === undefined
        ? resourceOf({ terraform: "true" })
        : data.resource,
    planResult: { plan: data.plan },
  } as unknown as CloudSavingContext;
}

function repositoryOf(id: string): CodeRepository {
  const repository: CodeRepository = new CodeRepository();
  repository.id = new ObjectID(id);
  repository.name = "Infrastructure";
  repository.organizationName = "acme";
  repository.repositoryName = "infra";
  return repository;
}

function candidateOf(id: string): DeclaredCodeOwnerCandidate {
  return {
    repository: {
      id,
      name: "Infrastructure",
      organizationName: "acme",
      repositoryName: "infra",
      mainBranchName: "main",
      gitHubAppInstallationId: "42",
    },
    reason: DeclaredCodeOwnerReason.HasCodeOfKind,
    matchedPaths: ["terraform/storage.tf"],
    score: 10,
  };
}

describe("the request a Code task is asked", () => {
  test("names the code, the resource, the change and what it saves", () => {
    const request: string = getCloudSavingsCodeFixRequest({
      plan: planOf(CloudSavingsActionKind.DeleteVolume),
      resourceName: "web-data",
      resourceId: "vol-0abc1234",
      managedAs: "Terraform",
      monthlySavings: "12.50 USD",
    });

    expect(request).toContain(
      "Make this cloud cost saving in the infrastructure code that declares the resource (Terraform), so the next deploy keeps it:",
    );
    expect(request).toContain(
      "Remove the unattached disk web-data (vol-0abc1234).",
    );
    expect(request).toContain("Keep a final snapshot of it");
    expect(request).toContain("It saves about 12.50 USD a month.");
    expect(request).toContain(
      "leave the resource's name and everything else as it is",
    );
  });

  test.each(Object.values(CloudSavingsActionKind))(
    "says what to change for %s, naming the resource",
    (kind: CloudSavingsActionKind) => {
      const request: string = getCloudSavingsCodeFixRequest({
        plan: planOf(kind, { from: "m5.2xlarge", to: "m5.xlarge" }),
        resourceName: "web-data",
        resourceId: "vol-0abc1234",
        managedAs: 'CloudFormation stack "web"',
        monthlySavings: "12.50 USD",
      });

      expect(request).toContain("web-data (vol-0abc1234)");
      expect(request).toContain('(CloudFormation stack "web")');
    },
  );

  test("every kind of change asks for a change of its own", () => {
    const changes: Set<string> = new Set(
      Object.values(CloudSavingsActionKind).map(
        (kind: CloudSavingsActionKind): string => {
          return getCloudSavingsCodeFixRequest({
            plan: planOf(kind),
            resourceName: "web-data",
            resourceId: "vol-0abc1234",
            managedAs: "Terraform",
            monthlySavings: "12.50 USD",
          }).split("\n\n")[0]!;
        },
      ),
    );

    expect(changes.size).toBe(Object.values(CloudSavingsActionKind).length);
  });

  test("a resize names both sizes, and a type change keeps the size and its speed", () => {
    expect(
      getCloudSavingsCodeFixRequest({
        plan: planOf(CloudSavingsActionKind.ResizeInstance, {
          from: "m5.2xlarge",
          to: "m5.xlarge",
        }),
        resourceName: "api-1",
        resourceId: "i-0abc",
        managedAs: "Terraform",
        monthlySavings: "60.00 USD",
      }),
    ).toContain(
      "Resize the instance api-1 (i-0abc) from m5.2xlarge to m5.xlarge.",
    );

    expect(
      getCloudSavingsCodeFixRequest({
        plan: planOf(CloudSavingsActionKind.ChangeVolumeType, {
          from: "gp2",
          to: "gp3",
        }),
        resourceName: "web-data",
        resourceId: "vol-0abc1234",
        managedAs: "Terraform",
        monthlySavings: "4.00 USD",
      }),
    ).toContain(
      "Change the volume web-data (vol-0abc1234) from gp2 to gp3, keeping its size, with at least the IOPS and throughput it has now.",
    );
  });
});

describe("whether a resource is declared in code, and where", () => {
  let findCandidates: SpyInstance<typeof DeclaredCodeOwner.findCandidates>;

  beforeEach(() => {
    findCandidates = jest
      .spyOn(DeclaredCodeOwner, "findCandidates")
      .mockResolvedValue([candidateOf(DECLARED_REPOSITORY_ID)]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a Terraform tag: declared in Terraform, in the repository that holds its code", async () => {
    const declared: CloudSavingsDeclaredCode | undefined =
      await CloudSavingsActions.getDeclaredInCode({
        projectId: PROJECT_ID,
        resource: resourceOf({ terraform: "true", env: "dev" }),
      });

    expect(declared).toEqual({
      managedAs: "Terraform",
      codeRepositoryId: DECLARED_REPOSITORY_ID,
      codeRepositoryName: "acme/infra",
    });
    expect(findCandidates).toHaveBeenCalledTimes(1);
    expect(findCandidates.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      declaredCode: {
        kind: DeclaredCodeKind.Terraform,
        name: "Terraform",
        stackName: null,
      },
      resource: { name: "web-data", tags: { terraform: "true", env: "dev" } },
    });
  });

  test.each([
    [{ "aws:cloudformation:stack-name": "web" }, 'CloudFormation stack "web"'],
    [{ "pulumi:project": "storage" }, "Pulumi"],
    [{ "managed-by": "Bicep" }, "Bicep"],
    [{ "goog-terraform-provisioned": "true" }, "Terraform"],
  ])(
    "tags %j: declared in %s",
    async (tags: Record<string, string>, managedAs: string) => {
      const declared: CloudSavingsDeclaredCode | undefined =
        await CloudSavingsActions.getDeclaredInCode({
          projectId: PROJECT_ID,
          resource: resourceOf(tags),
        });

      expect(declared?.managedAs).toBe(managedAs);
      expect(declared?.codeRepositoryId).toBe(DECLARED_REPOSITORY_ID);
    },
  );

  test.each([
    ["no tags", null],
    ["tags that name no code", { env: "dev", team: "storage" }],
    ["a Terraform tag that says false", { terraform: "false" }],
  ])(
    "%s: not declared in code, and no repository is looked for",
    async (_case: string, tags: Record<string, string> | null) => {
      expect(
        await CloudSavingsActions.getDeclaredInCode({
          projectId: PROJECT_ID,
          resource: resourceOf(tags),
        }),
      ).toBeUndefined();
      expect(findCandidates).not.toHaveBeenCalled();
    },
  );

  test("no resource in OneUptime: nothing to say it is declared in code", async () => {
    expect(
      await CloudSavingsActions.getDeclaredInCode({
        projectId: PROJECT_ID,
        resource: null,
      }),
    ).toBeUndefined();
    expect(findCandidates).not.toHaveBeenCalled();
  });

  test("no repository holds its code: declared in code still, with no repository named", async () => {
    findCandidates.mockResolvedValue([
      {
        ...candidateOf(DECLARED_REPOSITORY_ID),
        reason: DeclaredCodeOwnerReason.NoEvidence,
      },
    ]);

    expect(
      await CloudSavingsActions.getDeclaredInCode({
        projectId: PROJECT_ID,
        resource: resourceOf({ terraform: "true" }),
      }),
    ).toEqual({ managedAs: "Terraform" });
  });

  test("a finder that fails still says the resource is declared in code", async () => {
    findCandidates.mockRejectedValue(new Error("GitHub is down"));

    expect(
      await CloudSavingsActions.getDeclaredInCode({
        projectId: PROJECT_ID,
        resource: resourceOf({ terraform: "true" }),
      }),
    ).toEqual({ managedAs: "Terraform" });
  });
});

describe("a saving made in code", () => {
  let readSaving: SpyInstance<typeof CloudSavingsActions.readSaving>;
  let getDeclaredInCode: SpyInstance<
    typeof CloudSavingsActions.getDeclaredInCode
  >;
  let apply: SpyInstance<typeof CloudSavingsActions.apply>;
  let canRequest: SpyInstance<typeof CloudSavingsOwners.canRequest>;
  let getReadableRepository: SpyInstance<
    typeof CodeTaskAccess.getReadableRepository
  >;
  let canAskInRepository: SpyInstance<typeof CodeTaskAccess.canAskInRepository>;
  let assertCanStart: SpyInstance<typeof CodeTaskGate.assertCanStart>;
  let startTask: SpyInstance<typeof CodeTaskRuns.start>;

  beforeEach(() => {
    readSaving = jest
      .spyOn(CloudSavingsActions, "readSaving")
      .mockResolvedValue(
        savingOf({ plan: planOf(CloudSavingsActionKind.DeleteVolume) }),
      );
    getDeclaredInCode = jest
      .spyOn(CloudSavingsActions, "getDeclaredInCode")
      .mockResolvedValue({
        managedAs: "Terraform",
        codeRepositoryId: DECLARED_REPOSITORY_ID,
        codeRepositoryName: "acme/infra",
      });
    apply = jest
      .spyOn(CloudSavingsActions, "apply")
      .mockRejectedValue(new Error("Nothing may be applied in the cloud."));
    canRequest = jest
      .spyOn(CloudSavingsOwners, "canRequest")
      .mockReturnValue(true);
    getReadableRepository = jest
      .spyOn(CodeTaskAccess, "getReadableRepository")
      .mockImplementation(
        async (data: { repositoryId: ObjectID }): Promise<CodeRepository> => {
          return repositoryOf(data.repositoryId.toString());
        },
      );
    canAskInRepository = jest
      .spyOn(CodeTaskAccess, "canAskInRepository")
      .mockResolvedValue(true);
    assertCanStart = jest
      .spyOn(CodeTaskGate, "assertCanStart")
      .mockResolvedValue(undefined);
    startTask = jest
      .spyOn(CodeTaskRuns, "start")
      .mockImplementation(async (): Promise<AIRun> => {
        const run: AIRun = new AIRun();
        run.id = new ObjectID("3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f");
        return run;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function refusal(
    data?: Partial<{
      props: DatabaseCommonInteractionProps;
      codeRepositoryId: unknown;
    }>,
  ): Promise<string> {
    try {
      await CloudSavingsCodeFix.start({
        props: PROPS,
        projectId: PROJECT_ID,
        cloudCostRecommendationId: RECOMMENDATION_ID,
        ...(data || {}),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return (error as Error).message;
    }

    throw new Error("It was not refused.");
  }

  test("a resource declared in Terraform gets a pull request, as the person, and nothing in the cloud changes", async () => {
    const result: CloudSavingsFixInCodeResult = await CloudSavingsCodeFix.start(
      {
        props: PROPS,
        projectId: PROJECT_ID,
        cloudCostRecommendationId: RECOMMENDATION_ID,
      },
    );

    expect(result).toEqual({
      aiRunId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      codeRepositoryName: "acme/infra",
    });

    // The repository OneUptime found, read as the person, gated as asking in Code is.
    expect(getReadableRepository.mock.calls[0]![0]).toEqual({
      props: PROPS,
      projectId: PROJECT_ID,
      repositoryId: new ObjectID(DECLARED_REPOSITORY_ID),
    });
    expect(canAskInRepository).toHaveBeenCalledTimes(1);
    expect(assertCanStart.mock.calls[0]![0]).toMatchObject({
      props: PROPS,
      projectId: PROJECT_ID,
      canAsk: true,
    });

    // The Code task is the person's own, asking for the saving in its code.
    expect(startTask).toHaveBeenCalledTimes(1);
    const started: Parameters<typeof CodeTaskRuns.start>[0] =
      startTask.mock.calls[0]![0];
    expect(started.userId).toEqual(USER_ID);
    expect(started.projectId).toEqual(PROJECT_ID);
    expect(started.repository.id?.toString()).toBe(DECLARED_REPOSITORY_ID);
    expect(started.message).toContain(
      "in the infrastructure code that declares the resource (Terraform)",
    );
    expect(started.message).toContain(
      "Remove the unattached disk web-data (vol-0abc1234).",
    );
    expect(started.message).toContain("It saves about 12.50 USD a month.");

    // No API change: nothing applied in the cloud.
    expect(apply).not.toHaveBeenCalled();
  });

  test("the repository the person picks wins over the one OneUptime found", async () => {
    const result: CloudSavingsFixInCodeResult = await CloudSavingsCodeFix.start(
      {
        props: PROPS,
        projectId: PROJECT_ID,
        cloudCostRecommendationId: RECOMMENDATION_ID,
        codeRepositoryId: PICKED_REPOSITORY_ID,
      },
    );

    expect(getReadableRepository.mock.calls[0]![0].repositoryId).toEqual(
      new ObjectID(PICKED_REPOSITORY_ID),
    );
    expect(startTask.mock.calls[0]![0].repository.id?.toString()).toBe(
      PICKED_REPOSITORY_ID,
    );
    expect(result.codeRepositoryName).toBe("acme/infra");
  });

  test("a picked repository that is no id is not taken: the one OneUptime found is", async () => {
    await CloudSavingsCodeFix.start({
      props: PROPS,
      projectId: PROJECT_ID,
      cloudCostRecommendationId: RECOMMENDATION_ID,
      codeRepositoryId: "../other-project",
    });

    expect(getReadableRepository.mock.calls[0]![0].repositoryId).toEqual(
      new ObjectID(DECLARED_REPOSITORY_ID),
    );
  });

  test("no one signed in: refused before anything is read", async () => {
    expect(
      await refusal({
        props: { tenantId: PROJECT_ID } as DatabaseCommonInteractionProps,
      }),
    ).toBe("Sign in to open a pull request.");
    expect(readSaving).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
  });

  test("someone who may not edit the project's cloud resources: refused before anything is read", async () => {
    canRequest.mockReturnValue(false);

    expect(await refusal()).toBe(
      "You may not act on this project's savings: it takes permission to edit its cloud resources.",
    );
    expect(readSaving).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
  });

  test("a saving that is no change OneUptime can describe: made in the console instead", async () => {
    readSaving.mockResolvedValue(savingOf({ plan: undefined }));

    expect(await refusal()).toBe(
      "This saving is not a change OneUptime can describe for code. Make it in your cloud's console.",
    );
    expect(getDeclaredInCode).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
  });

  test("a resource nothing says is declared in code: applied in the cloud instead", async () => {
    getDeclaredInCode.mockResolvedValue(undefined);

    expect(await refusal()).toBe(
      "Nothing says this resource is declared in code, so there is no code to change. Apply it in the cloud instead.",
    );
    expect(getReadableRepository).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
  });

  test("no repository found and none picked: the person is asked to choose one", async () => {
    getDeclaredInCode.mockResolvedValue({ managedAs: "Terraform" });

    expect(await refusal()).toBe(
      "OneUptime found no repository that declares this resource. Choose the repository the pull request goes to.",
    );
    expect(getReadableRepository).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
  });

  test("a repository the person cannot read starts nothing", async () => {
    getReadableRepository.mockRejectedValue(
      new BadDataException("You may not read this repository."),
    );

    expect(await refusal()).toBe("You may not read this repository.");
    expect(assertCanStart).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
  });

  test("Code's gate refusing the person starts nothing", async () => {
    canAskInRepository.mockResolvedValue(false);
    assertCanStart.mockRejectedValue(
      new BadDataException("You may not ask OneUptime AI to change code here."),
    );

    expect(await refusal()).toBe(
      "You may not ask OneUptime AI to change code here.",
    );
    expect(assertCanStart.mock.calls[0]![0].canAsk).toBe(false);
    expect(startTask).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
