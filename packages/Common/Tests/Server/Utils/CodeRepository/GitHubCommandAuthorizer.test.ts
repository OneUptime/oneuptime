import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import ProjectService from "../../../../Server/Services/ProjectService";
import GitHubCommandAuthorizer, {
  GitHubAuthorizationOutcome,
  GitHubAuthorizationResult,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandAuthorizer";
import GitHubConversation, {
  GitHubRepositoryPermission,
} from "../../../../Server/Utils/CodeRepository/GitHub/GitHubConversation";
import GitHubInstallationBinding from "../../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import Project from "../../../../Models/DatabaseModels/Project";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * GitHubCommandAuthorizer is the ONLY thing standing between "@oneuptime
 * implement this" typed by a stranger and an agent run that pushes commits,
 * opens pull requests and spends a project's AI budget.
 *
 * Every command arrives from an untrusted party: a connected repository's
 * issue tracker is open to anyone with a GitHub account, and a mention costs
 * nothing to write. So there are four invariants here, and each one is a
 * different incident when it regresses.
 *
 *   1. BOTS ARE NEVER OBEYED, AND NEVER ANSWERED. The app's own comments come
 *      back as webhooks. If a bot sender ever reached the resolver, two apps
 *      mentioning each other would burn a budget overnight. The guard has to
 *      fire before ANY service call — a bot must not even cause a database
 *      read.
 *
 *   2. THE ROW'S INSTALLATION ID IS NOT AUTHORITY (GHSA-xx95-gmcf-7q86). A
 *      CodeRepository row carries an installation ID, and the single GitHub
 *      App JWT this instance holds will mint a write-scoped token for whatever
 *      installation it is handed. Whether an installation may act for a
 *      project is answered by GitHubInstallationBinding and nowhere else, so
 *      an unbound candidate row must be SKIPPED rather than used.
 *
 *   3. ONE COMMENT PRODUCES AT MOST ONE RUN. A repository can be imported by
 *      several projects. Acting for all of them turns one mention into several
 *      projects' pull requests, so the query is ordered oldest-first and the
 *      first bound candidate wins — deterministically, and identically across
 *      webhook redeliveries.
 *
 *   4. SILENCE VS. REPLY IS PART OF THE BOUNDARY. A collaborator who hits a
 *      switched-off repository gets a reason to show them. Someone WITHOUT
 *      write access gets no reason at all, because a guaranteed reply per
 *      mention is exactly the amplifier an open issue tracker would hand to
 *      anyone with an account. These tests assert the presence and the ABSENCE
 *      of `reason` as carefully as they assert the outcome.
 * ---------------------------------------------------------------------------
 */

const ORGANIZATION: string = "acme";
const REPOSITORY: string = "checkout";
const INSTALLATION_ID: string = "12345678";

// The shape of the single argument CodeRepositoryService.findBy is handed.
interface FindByCallArguments {
  query: {
    organizationName?: string | undefined;
    repositoryName?: string | undefined;
    repositoryHostedAt?: CodeRepositoryType | undefined;
    gitHubAppInstallationId?: string | undefined;
  };
  sort: {
    createdAt?: SortOrder | undefined;
  };
  props: {
    isRoot?: boolean | undefined;
  };
  limit?: number | undefined;
  skip?: number | undefined;
}

interface BindingCallArguments {
  projectId: ObjectID;
  installationId: string;
}

interface PermissionCallArguments {
  installationId: string;
  organizationName: string;
  repositoryName: string;
  username: string;
}

describe("GitHubCommandAuthorizer", () => {
  let projectId: ObjectID;
  let findBySpy: jest.SpyInstance;
  let isBoundSpy: jest.SpyInstance;
  let permissionSpy: jest.SpyInstance;
  let findOneByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    projectId = ObjectID.generate();

    // Default world: nothing connected, everything else permissive.
    findBySpy = jest.spyOn(CodeRepositoryService, "findBy");
    findBySpy.mockResolvedValue([]);

    isBoundSpy = jest.spyOn(
      GitHubInstallationBinding,
      "isInstallationBoundToProject",
    );
    isBoundSpy.mockResolvedValue(true);

    permissionSpy = jest.spyOn(
      GitHubConversation,
      "getUserRepositoryPermission",
    );
    permissionSpy.mockResolvedValue(GitHubRepositoryPermission.Admin);

    findOneByIdSpy = jest.spyOn(ProjectService, "findOneById");
    findOneByIdSpy.mockResolvedValue(namedProject("Acme Production"));
  });

  /*
   * Required, not cosmetic: these spies mutate shared module singletons that
   * outlive the test and would leak into every other test in this worker.
   */
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function namedProject(name: string): Project {
    const project: Project = new Project();
    project.id = projectId;
    project.name = name;
    return project;
  }

  // A row with the identity fields set but neither project nor installation.
  function bareRepository(): CodeRepository {
    const repository: CodeRepository = new CodeRepository();
    repository.id = ObjectID.generate();
    repository.organizationName = ORGANIZATION;
    repository.repositoryName = REPOSITORY;
    repository.mainBranchName = "main";
    repository.repositoryHostedAt = CodeRepositoryType.GitHub;
    return repository;
  }

  function connectedRepository(data?: {
    projectId?: ObjectID | undefined;
    installationId?: string | undefined;
  }): CodeRepository {
    const repository: CodeRepository = bareRepository();
    repository.projectId = data?.projectId || projectId;
    repository.gitHubAppInstallationId =
      data?.installationId || INSTALLATION_ID;
    return repository;
  }

  /*
   * The commands switch is a nullable boolean column, and "null" is a state
   * TypeScript will not let us assign through the model's own typing. Tests
   * that pin the null-means-enabled semantics need to produce it anyway.
   */
  function setCommandsColumn(
    repository: CodeRepository,
    value: boolean | null | undefined,
  ): void {
    (repository as unknown as Record<string, boolean | null | undefined>)[
      "isGitHubCommandsEnabled"
    ] = value;
  }

  function mockCandidates(candidates: Array<CodeRepository>): void {
    findBySpy.mockResolvedValue(candidates);
  }

  function authorize(overrides?: {
    senderLogin?: string | undefined;
    senderType?: string | undefined;
    installationId?: string | undefined;
  }): Promise<GitHubAuthorizationResult> {
    return GitHubCommandAuthorizer.authorize({
      organizationName: ORGANIZATION,
      repositoryName: REPOSITORY,
      installationId: overrides?.installationId ?? INSTALLATION_ID,
      senderLogin: overrides?.senderLogin ?? "octo-dev",
      senderType: overrides?.senderType ?? "User",
    });
  }

  function resolve(): Promise<CodeRepository | null> {
    return GitHubCommandAuthorizer.resolveConnectedRepository({
      organizationName: ORGANIZATION,
      repositoryName: REPOSITORY,
      installationId: INSTALLATION_ID,
    });
  }

  function findByCall(): FindByCallArguments {
    return findBySpy.mock.calls[0]![0] as FindByCallArguments;
  }

  function bindingCall(callNumber: number): BindingCallArguments {
    return isBoundSpy.mock.calls[callNumber - 1]![0] as BindingCallArguments;
  }

  function permissionCall(): PermissionCallArguments {
    return permissionSpy.mock.calls[0]![0] as PermissionCallArguments;
  }

  function expectNoServiceCallsAtAll(): void {
    expect(findBySpy).not.toHaveBeenCalled();
    expect(isBoundSpy).not.toHaveBeenCalled();
    expect(permissionSpy).not.toHaveBeenCalled();
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  }

  /*
   * Invariant 1. The app's own comment arrives here as a webhook, as does
   * every other app's. A single reply to a bot is the first half of a loop
   * that has no second half.
   */
  describe("the bot loop guard", () => {
    test("ignores a sender GitHub itself labels as a Bot", async () => {
      const result: GitHubAuthorizationResult = await authorize({
        senderLogin: "dependabot",
        senderType: "Bot",
      });

      expect(result.outcome).toBe(GitHubAuthorizationOutcome.Ignore);
    });

    test("ignores a login ending in [bot] even when the sender type says User", async () => {
      const result: GitHubAuthorizationResult = await authorize({
        senderLogin: "oneuptime[bot]",
        senderType: "User",
      });

      expect(result.outcome).toBe(GitHubAuthorizationOutcome.Ignore);
    });

    test("ignores its own bot login whatever case GitHub sends it in", async () => {
      const result: GitHubAuthorizationResult = await authorize({
        senderLogin: "OneUptime[BOT]",
        senderType: "User",
      });

      expect(result.outcome).toBe(GitHubAuthorizationOutcome.Ignore);
    });

    test("ignores an empty sender login", async () => {
      const result: GitHubAuthorizationResult = await authorize({
        senderLogin: "",
        senderType: "User",
      });

      expect(result.outcome).toBe(GitHubAuthorizationOutcome.Ignore);
    });

    test("ignores an empty login even when the webhook omits the sender type", async () => {
      const result: GitHubAuthorizationResult =
        await GitHubCommandAuthorizer.authorize({
          organizationName: ORGANIZATION,
          repositoryName: REPOSITORY,
          installationId: INSTALLATION_ID,
          senderLogin: "",
          senderType: undefined,
        });

      expect(result.outcome).toBe(GitHubAuthorizationOutcome.Ignore);
    });

    /*
     * The mirror image, and the more dangerous direction. A webhook that
     * carries no sender.type is not evidence of a bot, and treating it as one
     * would silently drop a collaborator's command.
     */
    test("still serves a human whose webhook carries no sender type", async () => {
      mockCandidates([connectedRepository()]);

      const result: GitHubAuthorizationResult =
        await GitHubCommandAuthorizer.authorize({
          organizationName: ORGANIZATION,
          repositoryName: REPOSITORY,
          installationId: INSTALLATION_ID,
          senderLogin: "octo-dev",
          senderType: undefined,
        });

      expect(result.outcome).toBe(GitHubAuthorizationOutcome.Allowed);
    });

    /*
     * The guard is worth nothing if it fires AFTER the work. A bot comment
     * must not cost a database read, a binding check or a GitHub API call —
     * otherwise two chatty apps still generate load in a tight loop even
     * though neither is obeyed.
     */
    test("makes no service call at all for a bot, even on a connected repository", async () => {
      mockCandidates([connectedRepository()]);

      await authorize({ senderLogin: "renovate[bot]", senderType: "Bot" });

      expectNoServiceCallsAtAll();
    });

    test("makes no service call at all for an empty sender login", async () => {
      mockCandidates([connectedRepository()]);

      await authorize({ senderLogin: "", senderType: "User" });

      expectNoServiceCallsAtAll();
    });

    test("returns no repository to act on when it ignores a bot", async () => {
      mockCandidates([connectedRepository()]);

      const result: GitHubAuthorizationResult = await authorize({
        senderLogin: "oneuptime[bot]",
        senderType: "Bot",
      });

      expect(result.codeRepository).toBeUndefined();
      expect(result.projectName).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    /*
     * The other half of the guard: it must not be so broad that it silently
     * swallows real people. A dropped command from a human reads to them as
     * "the integration is broken", and there is no log line in their thread.
     */
    test("does not mistake a human whose login merely contains 'bot' for a bot", async () => {
      mockCandidates([connectedRepository()]);

      const result: GitHubAuthorizationResult = await authorize({
        senderLogin: "robotnik",
        senderType: "User",
      });

      expect(result.outcome).toBe(GitHubAuthorizationOutcome.Allowed);
      expect(findBySpy).toHaveBeenCalled();
    });

    test("does not ignore a login with [bot] in the middle rather than at the end", async () => {
      mockCandidates([connectedRepository()]);

      const result: GitHubAuthorizationResult = await authorize({
        senderLogin: "not-a[bot]-account",
        senderType: "User",
      });

      expect(result.outcome).toBe(GitHubAuthorizationOutcome.Allowed);
    });
  });

  describe("resolveConnectedRepository", () => {
    /*
     * All four filters matter. Dropping the installation would let any
     * installation act on a repository name it does not own; dropping
     * repositoryHostedAt would match a GitLab row of the same name.
     */
    test("filters on organization, repository, GitHub and installation together", async () => {
      await resolve();

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(findByCall().query.organizationName).toBe(ORGANIZATION);
      expect(findByCall().query.repositoryName).toBe(REPOSITORY);
      expect(findByCall().query.repositoryHostedAt).toBe(
        CodeRepositoryType.GitHub,
      );
      expect(findByCall().query.gitHubAppInstallationId).toBe(INSTALLATION_ID);
    });

    /*
     * Invariant 3. Ascending createdAt is what makes "the oldest connection
     * wins" a fact rather than a coin flip. Flip this to Descending and a
     * webhook redelivery can land in a different project than the first
     * delivery did.
     */
    test("asks for the candidates oldest first, so the winner is deterministic", async () => {
      await resolve();

      expect(findByCall().sort.createdAt).toBe(SortOrder.Ascending);
    });

    test("reads as root, so nobody's permissions can hide a connection", async () => {
      await resolve();

      expect(findByCall().props.isRoot).toBe(true);
    });

    test("returns null when the repository is connected to no project", async () => {
      mockCandidates([]);

      await expect(resolve()).resolves.toBeNull();
    });

    test("returns the candidate when its installation is bound to its project", async () => {
      const repository: CodeRepository = connectedRepository();
      mockCandidates([repository]);

      await expect(resolve()).resolves.toBe(repository);
    });

    /*
     * Invariant 2, the core of it. The row says which installation it belongs
     * to; the row is not allowed to be believed. A row whose installation ID
     * was planted must be stepped over, and a legitimate row behind it must
     * still be found.
     */
    test("skips an unbound candidate and uses the bound one behind it", async () => {
      const plantedProjectId: ObjectID = ObjectID.generate();
      const planted: CodeRepository = connectedRepository({
        projectId: plantedProjectId,
      });
      const legitimate: CodeRepository = connectedRepository();

      mockCandidates([planted, legitimate]);
      isBoundSpy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(resolve()).resolves.toBe(legitimate);
    });

    test("returns null when no candidate's installation is bound to its project", async () => {
      mockCandidates([
        connectedRepository({ projectId: ObjectID.generate() }),
        connectedRepository({ projectId: ObjectID.generate() }),
      ]);
      isBoundSpy.mockResolvedValue(false);

      await expect(resolve()).resolves.toBeNull();
    });

    test("asks the binding about the candidate's OWN project and installation", async () => {
      mockCandidates([
        connectedRepository({
          projectId: projectId,
          installationId: INSTALLATION_ID,
        }),
      ]);

      await resolve();

      expect(isBoundSpy).toHaveBeenCalledTimes(1);
      expect(bindingCall(1).projectId.toString()).toBe(projectId.toString());
      expect(bindingCall(1).installationId).toBe(INSTALLATION_ID);
    });

    /*
     * Invariant 3 again, at the point it actually bites. Three projects have
     * imported this repository and all three bindings are genuine. Only the
     * oldest may act, and the loop must stop the moment it finds it — one
     * mention, one run, one pull request.
     */
    test("stops at the FIRST bound candidate when several are bound", async () => {
      const oldest: CodeRepository = connectedRepository({
        projectId: projectId,
      });
      const middle: CodeRepository = connectedRepository({
        projectId: ObjectID.generate(),
      });
      const newest: CodeRepository = connectedRepository({
        projectId: ObjectID.generate(),
      });

      mockCandidates([oldest, middle, newest]);

      const resolved: CodeRepository | null = await resolve();

      expect(resolved).toBe(oldest);
      expect(resolved).not.toBe(middle);
      expect(resolved).not.toBe(newest);
      expect(isBoundSpy).toHaveBeenCalledTimes(1);
    });

    // A half-populated row cannot be permitted by accident.
    test("skips a row carrying no project id, without asking the binding about it", async () => {
      const orphan: CodeRepository = bareRepository();
      orphan.gitHubAppInstallationId = INSTALLATION_ID;
      const legitimate: CodeRepository = connectedRepository();

      mockCandidates([orphan, legitimate]);

      await expect(resolve()).resolves.toBe(legitimate);
      expect(isBoundSpy).toHaveBeenCalledTimes(1);
      expect(bindingCall(1).projectId.toString()).toBe(projectId.toString());
    });

    test("skips a row carrying no installation id, without asking the binding about it", async () => {
      const halfPopulated: CodeRepository = bareRepository();
      halfPopulated.projectId = ObjectID.generate();
      const legitimate: CodeRepository = connectedRepository();

      mockCandidates([halfPopulated, legitimate]);

      await expect(resolve()).resolves.toBe(legitimate);
      expect(isBoundSpy).toHaveBeenCalledTimes(1);
    });

    test("returns null when the only candidate is half-populated", async () => {
      mockCandidates([bareRepository()]);

      await expect(resolve()).resolves.toBeNull();
      expect(isBoundSpy).not.toHaveBeenCalled();
    });
  });

  /*
   * The switch was added after the repositories were. Defaulting existing
   * rows to "off" would mean the feature does nothing anywhere until every
   * repository is visited by hand, so a null/absent column reads as enabled.
   * Only an explicit `false` turns it off.
   */
  describe("areCommandsEnabled", () => {
    test("treats an untouched column as ENABLED", () => {
      const repository: CodeRepository = connectedRepository();

      expect(repository.isGitHubCommandsEnabled).toBeUndefined();
      expect(GitHubCommandAuthorizer.areCommandsEnabled(repository)).toBe(true);
    });

    test("treats a NULL column as enabled, not as disabled", () => {
      const repository: CodeRepository = connectedRepository();
      setCommandsColumn(repository, null);

      expect(GitHubCommandAuthorizer.areCommandsEnabled(repository)).toBe(true);
    });

    test("treats an explicitly undefined column as enabled", () => {
      const repository: CodeRepository = connectedRepository();
      setCommandsColumn(repository, undefined);

      expect(GitHubCommandAuthorizer.areCommandsEnabled(repository)).toBe(true);
    });

    test("returns true when the column is explicitly true", () => {
      const repository: CodeRepository = connectedRepository();
      setCommandsColumn(repository, true);

      expect(GitHubCommandAuthorizer.areCommandsEnabled(repository)).toBe(true);
    });

    // The one and only value that switches the feature off.
    test("returns false only for an explicit false", () => {
      const repository: CodeRepository = connectedRepository();
      setCommandsColumn(repository, false);

      expect(GitHubCommandAuthorizer.areCommandsEnabled(repository)).toBe(
        false,
      );
    });
  });

  describe("authorize", () => {
    describe("a repository this instance has no standing in", () => {
      test("ignores a command on a repository connected to no project", async () => {
        mockCandidates([]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.outcome).toBe(GitHubAuthorizationOutcome.Ignore);
        expect(result.codeRepository).toBeUndefined();
      });

      /*
       * Silence, not a reply. The app is installed somewhere it was never
       * connected — commenting there would be an uninvited bot posting in
       * someone else's repository.
       */
      test("says nothing back when the repository is not connected", async () => {
        mockCandidates([]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.reason).toBeUndefined();
      });

      test("never asks GitHub about the sender when nothing is connected", async () => {
        mockCandidates([]);

        await authorize();

        expect(permissionSpy).not.toHaveBeenCalled();
      });

      /*
       * Invariant 2 end to end: an unbound row must produce exactly the same
       * silence as no row at all, and must never reach the permission check
       * with somebody else's installation.
       */
      test("ignores a command whose only candidate row is unbound", async () => {
        mockCandidates([connectedRepository()]);
        isBoundSpy.mockResolvedValue(false);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.outcome).toBe(GitHubAuthorizationOutcome.Ignore);
        expect(result.codeRepository).toBeUndefined();
        expect(permissionSpy).not.toHaveBeenCalled();
      });
    });

    describe("a repository with commands switched off", () => {
      function disabledRepository(): CodeRepository {
        const repository: CodeRepository = connectedRepository();
        setCommandsColumn(repository, false);
        return repository;
      }

      test("returns CommandsDisabled", async () => {
        mockCandidates([disabledRepository()]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.outcome).toBe(
          GitHubAuthorizationOutcome.CommandsDisabled,
        );
      });

      /*
       * This outcome IS answered in the thread — a collaborator who gets
       * silence assumes the integration is broken and files a bug — so the
       * reason has to exist and has to say where the switch lives.
       */
      test("carries a reason that points the collaborator at the switch", async () => {
        mockCandidates([disabledRepository()]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.reason).toBeDefined();
        expect(result.reason!.length).toBeGreaterThan(0);
        expect(result.reason).toContain("OneUptime");
      });

      test("carries the repository, so the reply can name what it refused", async () => {
        const repository: CodeRepository = disabledRepository();
        mockCandidates([repository]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.codeRepository).toBe(repository);
      });

      /*
       * The switch is checked BEFORE GitHub is asked anything. A disabled
       * repository must not turn every drive-by mention into an API call
       * against someone's rate limit.
       */
      test("never asks GitHub for the sender's permission", async () => {
        mockCandidates([disabledRepository()]);

        await authorize();

        expect(permissionSpy).not.toHaveBeenCalled();
      });

      test("still runs when the column is null, because null means enabled", async () => {
        const repository: CodeRepository = connectedRepository();
        setCommandsColumn(repository, null);
        mockCandidates([repository]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.outcome).toBe(GitHubAuthorizationOutcome.Allowed);
      });
    });

    describe("the repository permission matrix", () => {
      /*
       * Write is the floor: it is the permission that lets a person push to
       * the branch the agent would push to, so anyone who could do the work by
       * hand may ask the app to do it.
       */
      test.each([
        GitHubRepositoryPermission.Admin,
        GitHubRepositoryPermission.Maintain,
        GitHubRepositoryPermission.Write,
      ])(
        "allows a command from a collaborator with %s access",
        async (permission: GitHubRepositoryPermission) => {
          mockCandidates([connectedRepository()]);
          permissionSpy.mockResolvedValue(permission);

          const result: GitHubAuthorizationResult = await authorize();

          expect(result.outcome).toBe(GitHubAuthorizationOutcome.Allowed);
        },
      );

      /*
       * Read and triage can both comment on the thread, which is exactly why
       * neither may command the app: commenting is not a permission to push.
       */
      test.each([
        GitHubRepositoryPermission.Read,
        GitHubRepositoryPermission.Triage,
        GitHubRepositoryPermission.None,
      ])(
        "refuses a command from someone with only %s access",
        async (permission: GitHubRepositoryPermission) => {
          mockCandidates([connectedRepository()]);
          permissionSpy.mockResolvedValue(permission);

          const result: GitHubAuthorizationResult = await authorize();

          expect(result.outcome).toBe(
            GitHubAuthorizationOutcome.InsufficientPermission,
          );
        },
      );

      /*
       * Invariant 4. No reason means the caller has nothing to post, which is
       * the whole point: a guaranteed reply per mention would make the app a
       * comment-poster any GitHub account could drive.
       */
      test.each([
        GitHubRepositoryPermission.Read,
        GitHubRepositoryPermission.Triage,
        GitHubRepositoryPermission.None,
      ])(
        "gives the caller nothing to say back to someone with %s access",
        async (permission: GitHubRepositoryPermission) => {
          mockCandidates([connectedRepository()]);
          permissionSpy.mockResolvedValue(permission);

          const result: GitHubAuthorizationResult = await authorize();

          expect(result.reason).toBeUndefined();
        },
      );

      // The caller still needs the row — to react on the comment, not to reply.
      test("still returns the repository when the permission is insufficient", async () => {
        const repository: CodeRepository = connectedRepository();
        mockCandidates([repository]);
        permissionSpy.mockResolvedValue(GitHubRepositoryPermission.Read);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.codeRepository).toBe(repository);
      });

      /*
       * A refused sender must not learn which OneUptime project the
       * repository belongs to — that is internal naming, and the refusal is
       * not answered in the thread anyway.
       */
      test("does not attribute a project to a refused sender", async () => {
        mockCandidates([connectedRepository()]);
        permissionSpy.mockResolvedValue(GitHubRepositoryPermission.Triage);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.projectName).toBeUndefined();
      });

      test("asks GitHub about the exact sender, repository and installation", async () => {
        mockCandidates([connectedRepository()]);

        await authorize({ senderLogin: "octo-dev" });

        expect(permissionSpy).toHaveBeenCalledTimes(1);
        expect(permissionCall().username).toBe("octo-dev");
        expect(permissionCall().organizationName).toBe(ORGANIZATION);
        expect(permissionCall().repositoryName).toBe(REPOSITORY);
        expect(permissionCall().installationId).toBe(INSTALLATION_ID);
      });

      /*
       * GitHub logins are matched exactly by the collaborator API. Any
       * normalisation applied here — casing, trimming, stripping non-ASCII —
       * would ask about a DIFFERENT account than the one that commented, and
       * that account may have write access when the commenter does not.
       */
      test("passes an unusual sender login through to GitHub untouched", async () => {
        mockCandidates([connectedRepository()]);

        await authorize({ senderLogin: "Ünïcodé-Dev" });

        expect(permissionCall().username).toBe("Ünïcodé-Dev");
      });

      test("does not lowercase a mixed-case sender login before checking it", async () => {
        mockCandidates([connectedRepository()]);

        await authorize({ senderLogin: "OctoDev" });

        expect(permissionCall().username).toBe("OctoDev");
      });
    });

    describe("project attribution on an allowed command", () => {
      test("names the project the app is about to act for", async () => {
        mockCandidates([connectedRepository()]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.outcome).toBe(GitHubAuthorizationOutcome.Allowed);
        expect(result.projectName).toBe("Acme Production");
      });

      /*
       * Attribution follows the WINNING candidate. Naming the first row's
       * project while acting for the second one's would tell a team the wrong
       * budget was about to be spent.
       */
      test("names the project of the bound candidate, not of a skipped one", async () => {
        const skippedProjectId: ObjectID = ObjectID.generate();
        mockCandidates([
          connectedRepository({ projectId: skippedProjectId }),
          connectedRepository({ projectId: projectId }),
        ]);
        isBoundSpy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        await authorize();

        const lookup: { id: ObjectID } = findOneByIdSpy.mock.calls[0]![0] as {
          id: ObjectID;
        };

        expect(lookup.id.toString()).toBe(projectId.toString());
        expect(lookup.id.toString()).not.toBe(skippedProjectId.toString());
      });

      /*
       * A name is a nicety. Refusing to run a command a collaborator is
       * entitled to, because a display-name lookup failed, would be a far
       * worse bug than an unattributed acknowledgement.
       */
      test("still allows the command when the project lookup throws", async () => {
        mockCandidates([connectedRepository()]);
        findOneByIdSpy.mockRejectedValue(new Error("database unreachable"));

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.outcome).toBe(GitHubAuthorizationOutcome.Allowed);
        expect(result.projectName).toBeUndefined();
      });

      test("still allows the command when the project row is missing", async () => {
        mockCandidates([connectedRepository()]);
        findOneByIdSpy.mockResolvedValue(null);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.outcome).toBe(GitHubAuthorizationOutcome.Allowed);
        expect(result.projectName).toBeUndefined();
      });

      // An empty name is not a name — it would render as an empty attribution.
      test("reports no project name rather than an empty one", async () => {
        mockCandidates([connectedRepository()]);
        findOneByIdSpy.mockResolvedValue(namedProject(""));

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.projectName).toBeUndefined();
      });

      // A row with no project has no budget to bill and no project to name.
      test("skips the lookup entirely for a row with no project id", async () => {
        const orphan: CodeRepository = bareRepository();
        orphan.gitHubAppInstallationId = INSTALLATION_ID;
        mockCandidates([orphan]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.outcome).toBe(GitHubAuthorizationOutcome.Ignore);
        expect(findOneByIdSpy).not.toHaveBeenCalled();
      });

      test("returns the repository the command should run against", async () => {
        const repository: CodeRepository = connectedRepository();
        mockCandidates([repository]);

        const result: GitHubAuthorizationResult = await authorize();

        expect(result.codeRepository).toBe(repository);
      });
    });
  });
});
