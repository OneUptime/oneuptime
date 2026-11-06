import GitCommandError, {
  MAX_GIT_SAYS_LENGTH,
} from "../../Utils/GitCommandError";
import RepositoryManager, {
  RepositoryConfig,
} from "../../Utils/RepositoryManager";
import SecretRedactor from "../../Utils/SecretRedactor";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What a failed git command says, for the person whose run it was (issue
 * #6144).
 *
 * A clone of an Azure DevOps Server repository failed with "Authentication
 * failed", and the run's message was Node's "Command failed: git -c
 * http.followRedirects=false -c http.curloptResolve=... clone -- <address>
 * <workspace path>", then "Cloning into ...": the command line, long enough
 * that the reason git gave came after the 500 characters the server keeps -
 * and longer than the column, which refused it. A failed git command is now
 * said by git's own reason lines, and a clone or a push that failed says
 * which repository, what to check, and what git said.
 */

const TOKEN: string = "azdo-pat-0123456789abcdefghijklmnopqrstuv";

const AZURE_DEVOPS_CLONE_ARGS: Array<string> = [
  "-c",
  "http.followRedirects=false",
  "-c",
  "http.curloptResolve=tfs.example.com:443:10.20.30.40",
  "clone",
  "--single-branch",
  "--branch",
  "main",
  "--",
  "https://deploy@tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter",
  "/tmp/oneuptime-ai-agent/task-1793957521407/DefaultCollection-ScriptVault-_git__InstantAccessReporter",
];

// A rejection as Node's execFile makes one: the command line, then stderr.
function execError(data: {
  args: Array<string>;
  stderr: string;
  killed?: boolean;
  signal?: string | null;
}): Error {
  const cmd: string = `git ${data.args.join(" ")}`;
  const error: Error & {
    cmd?: string;
    code?: number;
    killed?: boolean;
    signal?: string | null;
  } = new Error(`Command failed: ${cmd}\n${data.stderr}`);

  error.cmd = cmd;
  error.code = 128;
  error.killed = data.killed ?? false;
  error.signal = data.signal ?? null;

  return error;
}

function failure(stderr: string, args?: Array<string>): GitCommandError {
  return GitCommandError.fromExecError(
    args || AZURE_DEVOPS_CLONE_ARGS,
    execError({ args: args || AZURE_DEVOPS_CLONE_ARGS, stderr }),
  );
}

const AZURE_DEVOPS_REFUSAL: string = [
  "Cloning into '/tmp/oneuptime-ai-agent/task-1793957521407/DefaultCollection-ScriptVault-_git__InstantAccessReporter'...",
  "fatal: Authentication failed for 'https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter/'",
  "",
].join("\n");

afterEach(() => {
  SecretRedactor.clearRegistered();
  jest.restoreAllMocks();
});

describe("GitCommandError - which command failed", () => {
  test.each([
    [AZURE_DEVOPS_CLONE_ARGS, "clone"],
    [["push", "-u", "origin", "oneuptime/fix"], "push"],
    [["-c", "http.followRedirects=false", "push", "origin", "x"], "push"],
    [["-C", "/tmp/repo", "status", "--porcelain"], "status"],
    [["--no-pager", "log", "-1"], "log"],
    [[], "command"],
  ] as Array<[Array<string>, string]>)(
    "%p runs git %s",
    (args: Array<string>, command: string) => {
      expect(GitCommandError.readCommand(args)).toBe(command);
    },
  );
});

describe("GitCommandError - what git said", () => {
  test("the command line is left out, and git's fatal line is what is said", () => {
    const error: GitCommandError = failure(AZURE_DEVOPS_REFUSAL);

    expect(error.gitSays).toBe(
      "fatal: Authentication failed for 'https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter/'",
    );
    expect(error.message).toBe(`git clone failed. Git said: ${error.gitSays}`);
    expect(error.message).not.toContain("Command failed");
    expect(error.message).not.toContain("curloptResolve");
    expect(error.message).not.toContain("10.20.30.40");
    expect(error.message).not.toContain("Cloning into");
    expect(error.message).not.toContain("/tmp/oneuptime-ai-agent");
    expect(error.command).toBe("clone");
    expect(error.isTimeout).toBe(false);
  });

  test("a server's own explanation on remote: lines is kept, in git's order", () => {
    const error: GitCommandError = failure(
      [
        "Cloning into 'x'...",
        "remote: TF401019: The Git repository with name or identifier InstantAccessReporter does not exist or you do not have permissions for the operation you are attempting.",
        "fatal: repository 'https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter/' not found",
      ].join("\n"),
    );

    expect(error.gitSays.startsWith("remote: TF401019")).toBe(true);
    expect(error.gitSays).toContain("fatal: repository");
  });

  test("a rejected push says which ref was rejected and why, without git's hints", () => {
    const args: Array<string> = ["push", "-u", "origin", "oneuptime/fix"];
    const error: GitCommandError = failure(
      [
        "To https://github.com/acme/checkout.git",
        " ! [remote rejected] oneuptime/fix -> oneuptime/fix (pre-receive hook declined)",
        "error: failed to push some refs to 'https://github.com/acme/checkout.git'",
        "hint: Updates were rejected because the remote contains work that you do not",
        "hint: have locally.",
      ].join("\n"),
      args,
    );

    expect(error.command).toBe("push");
    expect(error.gitSays).toBe(
      "! [remote rejected] oneuptime/fix -> oneuptime/fix (pre-receive hook declined) error: failed to push some refs to 'https://github.com/acme/checkout.git'",
    );
    expect(error.gitSays).not.toContain("hint:");
    expect(error.gitSays).not.toContain("To https://");
  });

  test("git in another language keeps its last lines, rather than nothing", () => {
    const error: GitCommandError = failure(
      [
        "Klone nach 'x' ...",
        "Schwerwiegend: Authentifizierung fehlgeschlagen für 'https://tfs.example.com/x/'",
      ].join("\n"),
    );

    expect(error.gitSays).toBe(
      "Klone nach 'x' ... Schwerwiegend: Authentifizierung fehlgeschlagen für 'https://tfs.example.com/x/'",
    );
  });

  test("a commit message among the arguments is never read as what git said", () => {
    const args: Array<string> = [
      "commit",
      "--no-verify",
      "-m",
      "Fix the answer\n\nfatal: this line is part of the commit message",
    ];
    const error: GitCommandError = failure(
      "error: gpg failed to sign the data\nfatal: failed to write commit object\n",
      args,
    );

    expect(error.gitSays).toBe(
      "error: gpg failed to sign the data fatal: failed to write commit object",
    );
    expect(error.gitSays).not.toContain("part of the commit message");
  });

  test("a rejection without its command line still drops Node's first line", () => {
    const error: GitCommandError = GitCommandError.fromExecError(
      ["clone", "--", "https://x-access-token@github.com/acme/checkout.git"],
      new Error(
        `Command failed: git clone -- https://x-access-token:${TOKEN}@github.com/acme/checkout.git\nfatal: unable to access 'https://github.com/acme/checkout.git/': The requested URL returned error: 403\n`,
      ),
    );

    expect(error.gitSays).toBe(
      "fatal: unable to access 'https://github.com/acme/checkout.git/': The requested URL returned error: 403",
    );
    expect(error.message).not.toContain(TOKEN);
  });

  test("a secret registered for the run is redacted from what git said", () => {
    SecretRedactor.register(TOKEN, "repository-token");

    const error: GitCommandError = failure(
      `fatal: unable to access 'https://deploy:${TOKEN}@tfs.example.com/x/': The requested URL returned error: 401\n`,
    );

    expect(error.gitSays).not.toContain(TOKEN);
    expect(error.message).not.toContain(TOKEN);
    expect(error.gitSays).toContain("[redacted");
  });

  test("a long explanation is cut, so the reason fits where the run's message is kept", () => {
    const error: GitCommandError = failure(
      `remote: ${"x".repeat(5000)}\nfatal: Authentication failed\n`,
    );

    expect(error.gitSays.length).toBe(MAX_GIT_SAYS_LENGTH);
    expect(error.gitSays.endsWith("…")).toBe(true);
    // Why it failed is still read from all of it.
    expect(error.isSignInRefusal()).toBe(true);
  });

  test("a line of megabytes a server wrote is bounded before any pattern reads it", () => {
    // How much text the redactor's patterns are given to read, each time.
    const readByPatterns: Array<number> = [];
    const redact: (text: string | null | undefined) => string =
      SecretRedactor.redact.bind(SecretRedactor);
    jest
      .spyOn(SecretRedactor, "redact")
      .mockImplementation((text: string | null | undefined): string => {
        readByPatterns.push((text || "").length);
        return redact(text);
      });

    // Fastest of up to three attempts, each reading a new error from the whole output.
    const read: FastestRun<GitCommandError> = fastestRun({
      run: (): GitCommandError => {
        const error: GitCommandError = failure(
          `remote: ${"a:b@c ".repeat(800000)}\nfatal: Authentication failed for 'https://tfs.example.com/x/'\n`,
        );
        error.isSignInRefusal();
        return error;
      },
      limitInMs: 5000,
    });

    expect(read.result.isSignInRefusal()).toBe(true);
    expect(read.result.gitSays.length).toBe(MAX_GIT_SAYS_LENGTH);
    expect(read.inMs).toBeLessThan(5000);
    /*
     * The server wrote 4.8 MB; the patterns read at most 20 lines of 2,048
     * characters. A linear redactor reads the whole line fast enough to pass
     * the time limit alone, so the bound is held here, where it is made.
     */
    expect(readByPatterns.length).toBeGreaterThan(0);
    expect(Math.max(...readByPatterns)).toBeLessThan(64 * 1024);
  });

  test("a command that ran out of time says so", () => {
    const error: GitCommandError = GitCommandError.fromExecError(
      AZURE_DEVOPS_CLONE_ARGS,
      execError({
        args: AZURE_DEVOPS_CLONE_ARGS,
        stderr: "",
        killed: true,
        signal: "SIGKILL",
      }),
    );

    expect(error.isTimeout).toBe(true);
    expect(error.gitSays).toBe("");
    expect(error.message).toBe(
      "git clone did not finish in time and was stopped.",
    );
  });

  test("a command that said nothing still says which one failed", () => {
    expect(failure("").message).toBe("git clone failed.");
  });

  test("anything thrown is read, not only Errors", () => {
    expect(
      GitCommandError.fromExecError(["fetch"], "fatal: bad object").gitSays,
    ).toBe("fatal: bad object");
    expect(GitCommandError.fromExecError(["fetch"], undefined).message).toBe(
      "git fetch failed.",
    );
  });
});

describe("GitCommandError - why it failed", () => {
  test.each([
    [
      "Azure DevOps Server",
      "fatal: Authentication failed for 'https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter/'",
    ],
    [
      "no credentials to give",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    ],
    [
      "no password to give",
      "fatal: could not read Password for 'https://deploy@git.example.com': terminal prompts disabled",
    ],
    [
      "GitLab",
      "remote: HTTP Basic: Access denied. If a password was provided for Git authentication, the password was incorrect\nfatal: Authentication failed for 'https://gitlab.example.com/team/app.git/'",
    ],
    [
      "GitHub",
      "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/acme/checkout.git/'",
    ],
    [
      "a 401 libcurl reports",
      "fatal: unable to access 'https://git.example.com/team/app.git/': The requested URL returned error: 401",
    ],
  ])("%s: a refused sign-in", (_host: string, stderr: string) => {
    const error: GitCommandError = failure(stderr);

    expect(error.isSignInRefusal()).toBe(true);
    expect(error.isMissingRemoteBranch()).toBe(false);
    expect(error.isServerUnreachable()).toBe(false);
  });

  test("a branch that is not on the remote", () => {
    const error: GitCommandError = failure(
      "Cloning into 'x'...\nwarning: Could not find remote branch master to clone.\nfatal: Remote branch master not found in upstream origin\n",
    );

    expect(error.isMissingRemoteBranch()).toBe(true);
    expect(error.isSignInRefusal()).toBe(false);
  });

  test.each([
    "fatal: unable to access 'https://tfs.example.com/x/': Could not resolve host: tfs.example.com",
    "fatal: unable to access 'https://tfs.example.com/x/': Failed to connect to tfs.example.com port 443 after 3 ms: Couldn't connect to server",
    "fatal: unable to access 'https://tfs.example.com/x/': Connection timed out after 300001 milliseconds",
    "fatal: unable to access 'https://tfs.example.com/x/': Connection refused",
  ])("a server that could not be reached: %s", (stderr: string) => {
    const error: GitCommandError = failure(stderr);

    expect(error.isServerUnreachable()).toBe(true);
    expect(error.isSignInRefusal()).toBe(false);
  });

  test("a 403 is not a refused sign-in: the credentials were taken, the permission is missing", () => {
    const error: GitCommandError = failure(
      "remote: TF401027: You need the Git 'GenericContribute' permission to perform this action.\nfatal: unable to access 'https://tfs.example.com/x/': The requested URL returned error: 403",
    );

    expect(error.isSignInRefusal()).toBe(false);
  });
});

describe("RepositoryManager.describeRemoteFailure - what the run says", () => {
  function gitRepository(): RepositoryConfig {
    return {
      organizationName: "DefaultCollection/ScriptVault/_git",
      repositoryName: "InstantAccessReporter",
      token: TOKEN,
      repositoryUrl:
        "https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter",
      baseBranch: "main",
      codeHost: {
        type: CodeRepositoryType.Git,
        hostUrl: "https://tfs.example.com",
        apiUrl: null,
        webUrl: null,
        username: "deploy",
        projectId: null,
        hasPullRequests: false,
      },
    };
  }

  function gitHubRepository(): RepositoryConfig {
    return {
      organizationName: "acme",
      repositoryName: "checkout",
      token: "ghs_installationtoken0123456789",
    };
  }

  const AZURE_DEVOPS_REMOTE: string =
    "https://deploy@tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter";

  test("a refused sign-in on a Git server says where the credentials are kept, and what git said", () => {
    const error: Error = RepositoryManager.describeRemoteFailure({
      action: "clone",
      config: gitRepository(),
      remoteUrl: AZURE_DEVOPS_REMOTE,
      error: failure(AZURE_DEVOPS_REFUSAL),
    });

    expect(error.message).toBe(
      "tfs.example.com refused the credentials OneUptime signed in with, so DefaultCollection/ScriptVault/_git/InstantAccessReporter could not be cloned. Check the username and the password or token it is connected with in Code, and that they may read the repository. Git said: fatal: Authentication failed for 'https://tfs.example.com/DefaultCollection/ScriptVault/_git/InstantAccessReporter/'",
    );
    expect(error.message.length).toBeLessThan(500);
    expect(error.message).not.toContain(TOKEN);
  });

  test("a refused push asks for a token that may write", () => {
    const error: Error = RepositoryManager.describeRemoteFailure({
      action: "push",
      config: gitRepository(),
      remoteUrl: AZURE_DEVOPS_REMOTE,
      branchName: "oneuptime/fix-login",
      error: failure("fatal: Authentication failed for 'x'", ["push"]),
    });

    expect(error.message).toContain(
      "so the branch oneuptime/fix-login could not be pushed to DefaultCollection/ScriptVault/_git/InstantAccessReporter.",
    );
    expect(error.message).toContain("that they may write to the repository.");
  });

  test("a refused sign-in on GitHub points at the OneUptime GitHub App", () => {
    const error: Error = RepositoryManager.describeRemoteFailure({
      action: "clone",
      config: gitHubRepository(),
      remoteUrl: "https://x-access-token@github.com/acme/checkout.git",
      error: failure(
        "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/acme/checkout.git/'",
      ),
    });

    expect(error.message).toContain(
      "github.com refused the credentials OneUptime signed in with, so acme/checkout could not be cloned.",
    );
    expect(error.message).toContain(
      "Check that the OneUptime GitHub App is still installed with access to the repository.",
    );
    expect(error.message).not.toContain("password or token it is connected");
  });

  test("a server that could not be reached says so", () => {
    const error: Error = RepositoryManager.describeRemoteFailure({
      action: "clone",
      config: gitRepository(),
      remoteUrl: AZURE_DEVOPS_REMOTE,
      error: failure(
        "fatal: unable to access 'https://tfs.example.com/x/': Could not resolve host: tfs.example.com",
      ),
    });

    expect(
      error.message.startsWith(
        "tfs.example.com could not be reached, so DefaultCollection/ScriptVault/_git/InstantAccessReporter could not be cloned. Git said: ",
      ),
    ).toBe(true);
  });

  test("a clone that ran out of time says so", () => {
    const error: Error = RepositoryManager.describeRemoteFailure({
      action: "clone",
      config: gitHubRepository(),
      remoteUrl: "https://x-access-token@github.com/acme/checkout.git",
      error: GitCommandError.fromExecError(
        AZURE_DEVOPS_CLONE_ARGS,
        execError({
          args: AZURE_DEVOPS_CLONE_ARGS,
          stderr: "",
          killed: true,
          signal: "SIGKILL",
        }),
      ),
    });

    expect(error.message).toBe(
      "Git did not finish in time and was stopped, so acme/checkout could not be cloned.",
    );
  });

  test("any other failure names the repository and what git said", () => {
    expect(
      RepositoryManager.describeRemoteFailure({
        action: "clone",
        config: gitHubRepository(),
        remoteUrl: "https://x-access-token@github.com/acme/checkout.git",
        error: failure("fatal: early EOF\nfatal: index-pack failed"),
      }).message,
    ).toBe(
      "acme/checkout could not be cloned. Git said: fatal: early EOF fatal: index-pack failed",
    );

    expect(
      RepositoryManager.describeRemoteFailure({
        action: "push",
        config: gitHubRepository(),
        remoteUrl: "https://x-access-token@github.com/acme/checkout.git",
        branchName: "oneuptime/fix",
        error: failure(
          "error: failed to push some refs to 'https://github.com/acme/checkout.git'",
          ["push"],
        ),
      }).message,
    ).toBe(
      "The branch oneuptime/fix could not be pushed to acme/checkout. Git said: error: failed to push some refs to 'https://github.com/acme/checkout.git'",
    );
  });

  test("an error that did not come from git is said as it is", () => {
    const guardRefusal: Error = new Error(
      "A global Runner reaches Git servers over https only, and this repository's address is http.",
    );

    expect(
      RepositoryManager.describeRemoteFailure({
        action: "clone",
        config: gitRepository(),
        remoteUrl: AZURE_DEVOPS_REMOTE,
        error: guardRefusal,
      }),
    ).toBe(guardRefusal);

    expect(
      RepositoryManager.describeRemoteFailure({
        action: "clone",
        config: gitRepository(),
        remoteUrl: AZURE_DEVOPS_REMOTE,
        error: "something odd",
      }).message,
    ).toBe("something odd");
  });
});
