import GitHostGuard, {
  GLOBAL_RUNNER_PRIVATE_GIT_SERVER_HINT,
} from "../../Utils/GitHostGuard";
import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import { CodeHostRunnerInfo } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";

/*
 * Where a Runner may take a repository that is not on GitHub: an address a
 * project member typed, reached as OneUptime's server reaches one - never
 * loopback or link-local on any Runner; a global Runner only the internet,
 * over https, unless the server says it may reach a private network (a
 * self-hosted OneUptime); git pinned to the addresses that were checked,
 * following no redirect.
 */

const CODE_HOST: CodeHostRunnerInfo = {
  type: CodeRepositoryType.Git,
  hostUrl: "https://git.example.com",
  apiUrl: null,
  webUrl: null,
  username: "deploy",
  projectId: null,
  hasPullRequests: false,
};

afterEach(() => {
  GlobalRunnerMode.setFromServer(false);
  jest.restoreAllMocks();
});

function resolvesTo(addresses: Array<ResolvedAddress>): jest.SpyInstance {
  return jest
    .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
    .mockResolvedValue(addresses);
}

describe("on any Runner", () => {
  test("pins git to the checked addresses and follows no redirect", async () => {
    const spy: jest.SpyInstance = resolvesTo([
      { address: "203.0.113.10", family: 4 },
      { address: "2001:db8::10", family: 6 },
    ]);

    await expect(
      GitHostGuard.getGitOptions("https://git.example.com/team/app.git"),
    ).resolves.toEqual([
      "-c",
      "http.followRedirects=false",
      "-c",
      "http.curloptResolve=git.example.com:443:203.0.113.10,[2001:db8::10]",
    ]);
    expect(spy).toHaveBeenCalledWith(
      "git.example.com",
      expect.objectContaining({ targetLabel: "Git server" }),
    );
  });

  test("pins the port the address names", async () => {
    resolvesTo([{ address: "203.0.113.10", family: 4 }]);

    await expect(
      GitHostGuard.getGitOptions("https://git.example.com:8443/team/app.git"),
    ).resolves.toContain(
      "http.curloptResolve=git.example.com:8443:203.0.113.10",
    );
  });

  test("never reaches loopback or the cloud metadata address", async () => {
    for (const address of [
      "https://127.0.0.1/team/app.git",
      "https://[::1]/team/app.git",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      await expect(GitHostGuard.getGitOptions(address)).rejects.toThrow();
    }
  });

  test("takes only web addresses", async () => {
    await expect(
      GitHostGuard.getGitOptions("ssh://git@git.example.com/team/app.git"),
    ).rejects.toThrow("over https");
    await expect(GitHostGuard.getGitOptions("not an address")).rejects.toThrow(
      "not a web address",
    );
  });

  test("a project's own Runner reaches its private network, over http too", async () => {
    expect(GitHostGuard.mayReachPrivateNetwork(CODE_HOST)).toBe(true);
    expect(GitHostGuard.isHttpAllowed(CODE_HOST)).toBe(true);
    expect(GitHostGuard.getEgressOptions(CODE_HOST)).toEqual(
      expect.objectContaining({ blockPrivateAddresses: false }),
    );

    await expect(
      GitHostGuard.getGitOptions("http://10.0.0.5/team/app.git", CODE_HOST),
    ).resolves.toEqual(["-c", "http.followRedirects=false"]);
  });
});

describe("on a global Runner", () => {
  beforeEach(() => {
    GlobalRunnerMode.setFromServer(true);
  });

  test("reaches the internet only, over https, saying what to do instead", async () => {
    expect(GitHostGuard.mayReachPrivateNetwork(CODE_HOST)).toBe(false);
    expect(GitHostGuard.getEgressOptions(CODE_HOST)).toEqual(
      expect.objectContaining({
        blockPrivateAddresses: true,
        privateNetworkHint: GLOBAL_RUNNER_PRIVATE_GIT_SERVER_HINT,
      }),
    );

    await expect(
      GitHostGuard.getGitOptions("https://10.0.0.5/team/app.git", CODE_HOST),
    ).rejects.toThrow();
    await expect(
      GitHostGuard.getGitOptions(
        "http://git.example.com/team/app.git",
        CODE_HOST,
      ),
    ).rejects.toThrow("over https only");
  });

  test("an older server's token, which says nothing, keeps it on the internet", async () => {
    const older: CodeHostRunnerInfo = { ...CODE_HOST };
    delete older.isPrivateNetworkAllowed;

    expect(GitHostGuard.mayReachPrivateNetwork(older)).toBe(false);
    expect(GitHostGuard.mayReachPrivateNetwork(undefined)).toBe(false);
  });

  test("a self-hosted server lets it reach its own network, as the server does", async () => {
    const selfHosted: CodeHostRunnerInfo = {
      ...CODE_HOST,
      isPrivateNetworkAllowed: true,
    };

    expect(GitHostGuard.mayReachPrivateNetwork(selfHosted)).toBe(true);
    expect(GitHostGuard.isHttpAllowed(selfHosted)).toBe(true);

    await expect(
      GitHostGuard.getGitOptions("http://10.0.0.5/team/app.git", selfHosted),
    ).resolves.toEqual(["-c", "http.followRedirects=false"]);

    // Never loopback, whatever the server says.
    await expect(
      GitHostGuard.getGitOptions("http://127.0.0.1/team/app.git", selfHosted),
    ).rejects.toThrow();
  });
});
