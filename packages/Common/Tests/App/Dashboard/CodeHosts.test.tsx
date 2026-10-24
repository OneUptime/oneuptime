import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import {
  CodeTaskBlockerType,
  CodeTaskRepositoryJSON,
  CodeTaskState,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeHostConnectResultJSON,
  CodeHostConnectionJSON,
  CodeHostRepositoryListJSON,
} from "../../../Types/CodeRepository/CodeHostConnect";
import {
  CodeHostUrl,
  CodeHostUrlError,
} from "../../../Types/CodeRepository/CodeHost";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import { goTo, PROJECT_ID } from "./SideMenuHarness";
import getJestMockFunction, { MockFunction } from "../../MockType";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import CodeConnectApi from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeConnectApi";
import CodeConnectDialog from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeConnectDialog";
import {
  CODE_CONNECT_FORM_ERRORS,
  CODE_HOST_URL_REFUSALS,
  getConnectableIds,
  readTokenForm,
  toggleSelection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeConnectFlow";
import {
  CODE_HOST_GITHUB_ONLY_NOTE,
  getCodeHostName,
  getDefaultHostUrl,
  getHostLabel,
  getPullRequestCopy,
  getRepositoryHostNote,
  opensPullRequests,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeHostCopy";
import { getRepositoryTaskWords } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoriesTable";
import CodeHostMark from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeHostMark";
import CodeRepositoryConnection, {
  getConnectionFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryConnection";
import RepositoryConnectionStatus from "../../../../App/FeatureSet/Dashboard/src/Components/CodeRepository/RepositoryConnectionStatus";
import CodeBlockerNotice, {
  getBlockerCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeBlockerNotice";
import CodeTaskTurn from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskTurn";
import CodeBranchPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeBranchPicker";
import CodeApi, {
  CodeRepositoryListItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import { CodeTaskRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskList";
import * as GitHubConnectLock from "../../../../App/FeatureSet/Dashboard/src/Components/CodeRepository/GitHubConnectLock";
import { UseGitHubConnect } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/GitHubConnect";
import CodeRepositorySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/SideMenu";
import CodeRepositoryModel from "../../../Models/DatabaseModels/CodeRepository";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * Code with repositories beyond GitHub, as a person sees it:
 *
 *   - the connect dialog asks where the code is, then what that host needs:
 *     GitLab, Forgejo or Gitea a server and a token (or a connection the
 *     project has), then the repositories the token can push to; any Git
 *     server an address and credentials, asking first about one OneUptime
 *     cannot reach - and a token is never shown again;
 *   - each host's mark and words: GitLab's merge requests ("!12"), "View on
 *     GitLab", a self-hosted server named beside the repository;
 *   - a repository's connection in its settings: its server, account and
 *     token's last characters, a refused token, a connection gone, a server
 *     only a Runner reaches, what works on GitHub only - and Replace access
 *     token;
 *   - what stops AI, said for the host: a refused token, a server that
 *     needs a project Runner, a lost connection that is not GitHub's;
 *   - the branch picker never asks for branches OneUptime does not read.
 */

const REPOSITORY_ID: string = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const CONNECTION_ID: string = "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e";
const TOKEN: string = "glpat-dialog-token-00000001";

const translation: i18n = createInstance();
const germanTranslation: i18n = createInstance();

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  goTo(`/dashboard/${PROJECT_ID}/code`);
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
  await germanTranslation.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest
    .spyOn(GitHubConnectLock, "getCodeConnectLock")
    .mockReturnValue({ isLocked: false });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function draw(element: ReactElement): void {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
}

function drawInGerman(element: ReactElement): void {
  render(<I18nextProvider i18n={germanTranslation}>{element}</I18nextProvider>);
}

// The reader's permissions in the project, as the Dashboard holds them.
function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as never);
}

function gitHub(overrides: Partial<UseGitHubConnect> = {}): UseGitHubConnect {
  return {
    isGitHubAppConfigured: true,
    connectLock: { isLocked: false },
    connect: jest.fn(),
    connectExisting: jest.fn(),
    notices: <></>,
    ...overrides,
  } as UseGitHubConnect;
}

function listing(
  overrides: Partial<CodeHostRepositoryListJSON> = {},
): CodeHostRepositoryListJSON {
  return {
    account: { login: "alice", name: "Alice" },
    hostUrl: "https://gitlab.com",
    repositories: [
      {
        id: "11",
        name: "checkout",
        ownerPath: "acme",
        fullName: "acme/checkout",
        defaultBranch: "main",
        webUrl: "https://gitlab.com/acme/checkout",
        isPrivate: true,
        canPush: true,
        isConnected: false,
      },
      {
        id: "12",
        name: "docs",
        ownerPath: "acme",
        fullName: "acme/docs",
        defaultBranch: "main",
        webUrl: "https://gitlab.com/acme/docs",
        isPrivate: false,
        canPush: false,
        isConnected: false,
      },
      {
        id: "13",
        name: "billing",
        ownerPath: "acme",
        fullName: "acme/billing",
        defaultBranch: "main",
        webUrl: "https://gitlab.com/acme/billing",
        isPrivate: true,
        canPush: true,
        isConnected: true,
      },
    ],
    hasMore: false,
    ...overrides,
  };
}

function repository(
  overrides: Partial<CodeTaskRepositoryJSON> = {},
): CodeTaskRepositoryJSON {
  return {
    id: REPOSITORY_ID,
    name: "checkout",
    organizationName: "acme",
    repositoryName: "checkout",
    isConnected: true,
    provider: CodeRepositoryType.GitLab,
    connection: {
      id: CONNECTION_ID,
      hostUrl: "https://gitlab.example.com",
      accountLogin: "alice",
      credentialHint: "ab12",
      isTokenRefused: false,
      isReachableFromServer: true,
      repositoryCount: 2,
    },
    ...overrides,
  };
}

describe("the connect dialog's rules", () => {
  test("the token form sends a connection, or a server as OneUptime keeps it and a token - or says what is missing", () => {
    expect(
      readTokenForm({
        provider: CodeRepositoryType.GitLab,
        connectionId: CONNECTION_ID,
        hostUrl: "",
        token: "",
      }),
    ).toEqual({ source: { connectionId: CONNECTION_ID } });
    expect(
      readTokenForm({
        provider: CodeRepositoryType.Forgejo,
        connectionId: null,
        hostUrl: "Git.Example.com/api/v1/",
        token: `  ${TOKEN} `,
      }),
    ).toEqual({
      source: {
        provider: CodeRepositoryType.Forgejo,
        hostUrl: "https://git.example.com",
        token: TOKEN,
      },
    });
    expect(
      readTokenForm({
        provider: CodeRepositoryType.GitLab,
        connectionId: null,
        hostUrl: " ",
        token: TOKEN,
      }),
    ).toEqual({ error: CODE_CONNECT_FORM_ERRORS.noServer });
    expect(
      readTokenForm({
        provider: CodeRepositoryType.GitLab,
        connectionId: null,
        hostUrl: "https://gitlab.com",
        token: "",
      }),
    ).toEqual({ error: CODE_CONNECT_FORM_ERRORS.noToken });
    expect(
      readTokenForm({
        provider: CodeRepositoryType.GitLab,
        connectionId: null,
        hostUrl: "https://gitlab.com",
        token: "two words",
      }),
    ).toEqual({ error: CODE_CONNECT_FORM_ERRORS.tokenHasSpaces });
  });

  test("an address the rules refuse is said in one of the dialog's own translated sentences", () => {
    const refusals: Array<string> = [];

    for (const address of [
      `https://a.com/${"x".repeat(3000)}`,
      "https://exa mple.com",
      "https://alice:secret@gitlab.com",
      "ftp://gitlab.com",
    ]) {
      try {
        CodeHostUrl.normalizeHostUrl(address, { allowHttp: true });
      } catch (error) {
        refusals.push((error as CodeHostUrlError).message);
      }
    }

    expect(refusals.sort()).toEqual([...CODE_HOST_URL_REFUSALS].sort());

    for (const refusal of CODE_HOST_URL_REFUSALS) {
      expect(
        (englishLocale as unknown as Record<string, string>)[refusal],
      ).toBe(refusal);
    }
  });

  test("only a repository the token can push to, and the project does not have, may be picked - at most 50", () => {
    expect(getConnectableIds(listing().repositories)).toEqual(["11"]);

    let picked: Array<string> = [];

    for (let index: number = 0; index < 60; index++) {
      picked = toggleSelection(picked, `${index}`);
    }

    expect(picked).toHaveLength(50);
    expect(toggleSelection(picked, "0")).toHaveLength(49);
  });
});

describe("each host's words and marks", () => {
  test("names the host as the server says it is", () => {
    expect(getCodeHostName({ provider: "GitLab" })).toBe("GitLab");
    expect(getCodeHostName({ provider: "Forgejo", hostProduct: "Gitea" })).toBe(
      "Gitea",
    );
    expect(
      getCodeHostName({ provider: "Forgejo", hostProduct: "Forgejo" }),
    ).toBe("Forgejo");
    expect(getCodeHostName({ provider: "Git" })).toBe("Git");
    expect(getCodeHostName({})).toBe("GitHub");
  });

  test("a self-hosted server is named beside the repository; a public one, or GitHub, is not", () => {
    expect(
      getRepositoryHostNote({
        provider: "GitLab",
        connection: { hostUrl: "https://gitlab.com" },
      }),
    ).toBe("");
    expect(
      getRepositoryHostNote({
        provider: "GitLab",
        connection: { hostUrl: "https://git.acme.io/gitlab" },
      }),
    ).toBe("git.acme.io/gitlab");
    expect(
      getRepositoryHostNote({
        provider: "Git",
        connection: { hostUrl: "https://bitbucket.org" },
      }),
    ).toBe("bitbucket.org");
    expect(getRepositoryHostNote({ provider: "GitHub" })).toBe("");
    expect(getHostLabel("https://codeberg.org/")).toBe("codeberg.org");
    expect(getDefaultHostUrl(CodeRepositoryType.GitLab)).toBe(
      "https://gitlab.com",
    );
    expect(getDefaultHostUrl(CodeRepositoryType.Git)).toBe("");
  });

  test("a GitLab merge request is written as GitLab writes it; a Git server opens none", () => {
    expect(getPullRequestCopy("GitLab").opened).toBe(
      "Opened merge request !{{number}}",
    );
    expect(getPullRequestCopy("GitLab").short).toBe("MR !{{number}}");
    expect(getPullRequestCopy("Forgejo").opened).toBe(
      "Opened pull request #{{number}}",
    );
    expect(getPullRequestCopy(undefined).title).toBe(
      "Pull request #{{number}}",
    );
    expect(opensPullRequests("GitLab")).toBe(true);
    expect(opensPullRequests("Git")).toBe(false);
    expect(opensPullRequests(undefined)).toBe(true);
  });

  test("draws each host's own mark, Gitea's for a Gitea server", () => {
    draw(
      <div>
        <CodeHostMark provider="GitHub" />
        <CodeHostMark provider="GitLab" />
        <CodeHostMark provider="Forgejo" hostProduct="Gitea" />
        <CodeHostMark provider="Git" />
        <CodeHostMark provider="Mercurial" />
      </div>,
    );

    expect(
      screen.getAllByTestId("code-host-mark").map((mark: HTMLElement) => {
        return mark.getAttribute("data-provider");
      }),
    ).toEqual(["GitHub", "GitLab", "Forgejo", "Git", "GitHub"]);
    // Every mark is decoration: the host is said in words beside it.
    for (const svg of Array.from(document.querySelectorAll("svg"))) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("a GitLab repository's open merge requests are named as GitLab names them, in the reader's language", () => {
    const row: (
      provider: string,
      openPullRequests: number,
    ) => CodeRepositoryListItem = (
      provider: string,
      openPullRequests: number,
    ): CodeRepositoryListItem => {
      return {
        id: REPOSITORY_ID,
        name: "checkout",
        isConnected: true,
        provider,
        stats: {
          working: 0,
          waitingForYou: 0,
          openPullRequests,
          taskCount: 3,
        },
      } as CodeRepositoryListItem;
    };

    expect(
      getRepositoryTaskWords(
        row("GitLab", 1),
        createTranslator(undefined, "en"),
      ).pullRequests,
    ).toBe("1 open merge request");
    expect(
      getRepositoryTaskWords(
        row("GitLab", 2),
        createTranslator(undefined, "en"),
      ).pullRequests,
    ).toBe("2 open merge requests");
    expect(
      getRepositoryTaskWords(
        row("Forgejo", 2),
        createTranslator(undefined, "en"),
      ).pullRequests,
    ).toBe("2 open pull requests");
    expect(
      getRepositoryTaskWords(
        row("GitHub", 0),
        createTranslator(undefined, "en"),
      ).pullRequests,
    ).toBeNull();
    expect(
      (germanLocale as unknown as Record<string, string>)[
        "{{count}} open merge requests_one"
      ],
    ).toBe("{{count}} offener Merge Request");
  });

  test("every host but GitHub says what works on GitHub only", () => {
    for (const note of Object.values(CODE_HOST_GITHUB_ONLY_NOTE)) {
      expect(note).toContain("GitHub repositories only");
      expect((englishLocale as unknown as Record<string, string>)[note]).toBe(
        note,
      );
    }
  });
});

describe("the connect dialog", () => {
  test("asks where the code is first: GitHub hands over to its App", async () => {
    const connect: MockFunction = getJestMockFunction();
    const onClose: MockFunction = getJestMockFunction();

    draw(
      <CodeConnectDialog
        gitHub={gitHub({ connect })}
        onClose={onClose}
        onConnected={jest.fn()}
      />,
    );

    const tiles: Array<HTMLElement> = screen.getAllByTestId("code-host-choice");

    expect(
      tiles.map((tile: HTMLElement) => {
        return tile.getAttribute("data-provider");
      }),
    ).toEqual(["GitHub", "GitLab", "Forgejo", "Git"]);
    expect(screen.getByText("Where is your code?")).toBeInTheDocument();

    fireEvent.click(tiles[0]!);

    expect(onClose).toHaveBeenCalled();
    expect(connect).toHaveBeenCalled();
  });

  test("on a server with no GitHub App, GitHub's tile says so and the others still connect", () => {
    draw(
      <CodeConnectDialog
        gitHub={gitHub({ isGitHubAppConfigured: false })}
        onClose={jest.fn()}
        onConnected={jest.fn()}
      />,
    );

    const tiles: Array<HTMLElement> = screen.getAllByTestId("code-host-choice");

    expect(tiles[0]).toBeDisabled();
    expect(tiles[0]).toHaveTextContent("Not set up on this server");
    expect(tiles[1]).toBeEnabled();
  });

  test("GitLab: the server and a token, then the repositories the token can push to, and Connect", async () => {
    jest.spyOn(CodeConnectApi, "listConnections").mockResolvedValue([]);
    const list: SpyInstance<typeof CodeConnectApi.listRepositories> = jest
      .spyOn(CodeConnectApi, "listRepositories")
      .mockResolvedValue(listing());
    const connect: SpyInstance<typeof CodeConnectApi.connect> = jest
      .spyOn(CodeConnectApi, "connect")
      .mockResolvedValue({
        connectionId: CONNECTION_ID,
        imported: 1,
        reconnected: 0,
        skipped: 0,
        repositoryIds: [REPOSITORY_ID],
      } as CodeHostConnectResultJSON);
    const onConnected: MockFunction = getJestMockFunction();

    draw(
      <CodeConnectDialog
        initialProvider={CodeRepositoryType.GitLab}
        gitHub={gitHub()}
        onClose={jest.fn()}
        onConnected={onConnected}
      />,
    );

    expect(await screen.findByText("Connect GitLab")).toBeInTheDocument();

    const host: HTMLInputElement = screen.getByTestId(
      "code-connect-host-url",
    ) as HTMLInputElement;
    const token: HTMLInputElement = screen.getByTestId(
      "code-connect-token-input",
    ) as HTMLInputElement;

    // The public server most people use, filled in; the token typed unseen.
    expect(host.value).toBe("https://gitlab.com");
    expect(token).toHaveAttribute("type", "password");

    fireEvent.change(token, { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByTestId("code-connect-pick")).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({
      source: {
        provider: CodeRepositoryType.GitLab,
        hostUrl: "https://gitlab.com",
        token: TOKEN,
      },
      search: "",
      page: 1,
    });
    expect(screen.getByTestId("code-connect-signed-in")).toHaveTextContent(
      "Signed in to gitlab.com as @alice.",
    );
    // The token is not on the page any more.
    expect(document.body.innerHTML).not.toContain(TOKEN);

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "code-connect-repository",
    );
    const boxes: Array<HTMLInputElement> = rows.map((row: HTMLElement) => {
      return within(row).getByRole("checkbox") as HTMLInputElement;
    });

    expect(boxes[0]).toBeEnabled();
    // One it cannot push to, and one the project has, cannot be picked.
    expect(boxes[1]).toBeDisabled();
    expect(
      within(rows[1]!).getByTestId("code-connect-repository-cannot-push"),
    ).toBeInTheDocument();
    expect(boxes[2]).toBeDisabled();
    expect(boxes[2]).toBeChecked();
    // Nothing picked yet: the button says what it does, not "Connect 0".
    expect(
      screen.getByRole("button", { name: "Connect repositories" }),
    ).toBeDisabled();

    fireEvent.click(boxes[0]!);
    fireEvent.click(
      screen.getByRole("button", { name: "Connect 1 repository" }),
    );

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith({
        count: 1,
        provider: CodeRepositoryType.GitLab,
      });
    });
    expect(connect).toHaveBeenCalledWith({
      source: {
        provider: CodeRepositoryType.GitLab,
        hostUrl: "https://gitlab.com",
        token: TOKEN,
      },
      repositoryIds: ["11"],
    });
  });

  test("a token the server refuses is said in the dialog, which keeps what was typed", async () => {
    jest.spyOn(CodeConnectApi, "listConnections").mockResolvedValue([]);
    jest
      .spyOn(CodeConnectApi, "listRepositories")
      .mockRejectedValue(new Error("GitLab refused the access token."));

    draw(
      <CodeConnectDialog
        initialProvider={CodeRepositoryType.GitLab}
        gitHub={gitHub()}
        onClose={jest.fn()}
        onConnected={jest.fn()}
      />,
    );

    fireEvent.change(await screen.findByTestId("code-connect-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("GitLab refused the access token."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("code-connect-dialog")).toHaveAttribute(
      "data-step",
      "token",
    );
    expect(
      (screen.getByTestId("code-connect-token-input") as HTMLInputElement)
        .value,
    ).toBe(TOKEN);
  });

  test("Forgejo or Gitea offers the project's connections to that host again, by server and account", async () => {
    const connections: Array<CodeHostConnectionJSON> = [
      {
        id: CONNECTION_ID,
        provider: CodeRepositoryType.Forgejo,
        hostUrl: "https://codeberg.org",
        accountLogin: "alice",
        credentialHint: "ab12",
        isTokenRefused: true,
        isReachableFromServer: true,
        repositoryCount: 3,
      },
      {
        id: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
        provider: CodeRepositoryType.GitLab,
        hostUrl: "https://gitlab.com",
        isTokenRefused: false,
        isReachableFromServer: true,
        repositoryCount: 1,
      },
    ];

    jest
      .spyOn(CodeConnectApi, "listConnections")
      .mockResolvedValue(connections);
    const list: SpyInstance<typeof CodeConnectApi.listRepositories> = jest
      .spyOn(CodeConnectApi, "listRepositories")
      .mockResolvedValue(listing({ hostUrl: "https://codeberg.org" }));

    draw(
      <CodeConnectDialog
        initialProvider={CodeRepositoryType.Forgejo}
        gitHub={gitHub()}
        onClose={jest.fn()}
        onConnected={jest.fn()}
      />,
    );

    const offered: Array<HTMLElement> = await screen.findAllByTestId(
      "code-connect-connection",
    );

    // Only Forgejo's: GitLab's connection is GitLab's.
    expect(offered).toHaveLength(1);
    expect(offered[0]).toHaveTextContent("codeberg.org");
    expect(offered[0]).toHaveTextContent("@alice · 3 repositories");
    expect(offered[0]).toHaveTextContent("Token refused");

    fireEvent.click(within(offered[0]!).getByRole("radio"));
    // A connection needs no server or token typed.
    expect(screen.queryByTestId("code-connect-token-input")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith({
        source: { connectionId: CONNECTION_ID },
        search: "",
        page: 1,
      });
    });
  });

  test("any Git server: asked about first when OneUptime cannot reach it, then connected for a project Runner", async () => {
    const connectGit: SpyInstance<typeof CodeConnectApi.connectGitRepository> =
      jest
        .spyOn(CodeConnectApi, "connectGitRepository")
        .mockResolvedValueOnce({
          needsConfirmation: true,
          message:
            "OneUptime cannot reach 10.0.0.5 to check it. Connect it anyway, and pick one of your own Runners on its network to work in it.",
        })
        .mockResolvedValueOnce({ repositoryId: REPOSITORY_ID });
    const onConnected: MockFunction = getJestMockFunction();

    draw(
      <CodeConnectDialog
        initialProvider={CodeRepositoryType.Git}
        gitHub={gitHub()}
        onClose={jest.fn()}
        onConnected={onConnected}
      />,
    );

    expect(screen.getByText("Connect a Git repository")).toBeInTheDocument();
    expect(screen.getByTestId("code-connect-git-password")).toHaveAttribute(
      "type",
      "password",
    );

    fireEvent.change(screen.getByTestId("code-connect-git-url"), {
      target: { value: "https://10.0.0.5/team/app.git" },
    });
    fireEvent.change(screen.getByTestId("code-connect-git-username"), {
      target: { value: "deploy" },
    });
    fireEvent.change(screen.getByTestId("code-connect-git-password"), {
      target: { value: "secret-password-000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByTestId("code-connect-git-confirm"),
    ).toHaveTextContent("Connect it anyway");
    expect(connectGit).toHaveBeenLastCalledWith({
      url: "https://10.0.0.5/team/app.git",
      username: "deploy",
      password: "secret-password-000001",
      connectWithoutCheck: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Connect anyway" }));

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith({
        count: 1,
        provider: CodeRepositoryType.Git,
        repositoryId: REPOSITORY_ID,
      });
    });
    expect(connectGit).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectWithoutCheck: true }),
    );
  });

  test("someone who may not connect repositories sees every tile locked, and why", () => {
    jest.spyOn(GitHubConnectLock, "getCodeConnectLock").mockReturnValue({
      isLocked: true,
      reason:
        "Connecting repositories needs permission to create code repositories.",
    });

    draw(
      <CodeConnectDialog
        gitHub={gitHub()}
        onClose={jest.fn()}
        onConnected={jest.fn()}
      />,
    );

    for (const tile of screen.getAllByTestId("code-host-choice")) {
      expect(tile).toBeDisabled();
    }

    expect(
      screen.getByText(
        "Connecting repositories needs permission to create code repositories.",
      ),
    ).toBeInTheDocument();
  });

  test("is drawn in the reader's language", async () => {
    jest.spyOn(CodeConnectApi, "listConnections").mockResolvedValue([]);

    drawInGerman(
      <CodeConnectDialog
        gitHub={gitHub()}
        onClose={jest.fn()}
        onConnected={jest.fn()}
      />,
    );

    expect(screen.getByText("Wo liegt Ihr Code?")).toBeInTheDocument();
    expect(screen.getByText("Beliebiger Git-Server")).toBeInTheDocument();
  });

  test("an address with a password in it is refused before anything is sent, in the reader's language", async () => {
    jest.spyOn(CodeConnectApi, "listConnections").mockResolvedValue([]);
    const list: SpyInstance<typeof CodeConnectApi.listRepositories> =
      jest.spyOn(CodeConnectApi, "listRepositories");

    drawInGerman(
      <CodeConnectDialog
        initialProvider={CodeRepositoryType.GitLab}
        gitHub={gitHub()}
        onClose={jest.fn()}
        onConnected={jest.fn()}
      />,
    );

    expect(await screen.findByText("GitLab verbinden")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("code-connect-host-url"), {
      target: { value: "https://alice:secret@gitlab.example.com" },
    });
    fireEvent.change(screen.getByTestId("code-connect-token-input"), {
      target: { value: TOKEN },
    });
    fireEvent.click(screen.getByRole("button", { name: "Weiter" }));

    expect(
      await screen.findByText(
        "Lassen Sie Benutzername und Passwort aus der Adresse weg. Das Zugriffstoken gehört in sein eigenes Feld.",
      ),
    ).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("a repository's connection, in its settings", () => {
  test("says the server, the account and the token's last characters, and what works on GitHub only", () => {
    draw(
      <CodeRepositoryConnection
        repository={repository()}
        onReplaced={jest.fn()}
      />,
    );

    const block: HTMLElement = screen.getByTestId("code-repository-connection");

    expect(block).toHaveAttribute("data-provider", "GitLab");
    expect(
      within(block).getByTestId("repository-connection-status"),
    ).toHaveAttribute("data-connection", "access-token");
    expect(
      within(block).getByTestId("code-repository-connection-facts"),
    ).toHaveTextContent(
      "gitlab.example.com · Signed in as alice · Access token ending in …ab12",
    );
    expect(
      within(block).getByTestId("code-repository-github-only"),
    ).toHaveTextContent(CODE_HOST_GITHUB_ONLY_NOTE[CodeRepositoryType.GitLab]);
    expect(
      within(block).queryByTestId("code-repository-connection-refused"),
    ).toBeNull();
  });

  test("a refused token says what happened and how to connect again", () => {
    draw(
      <CodeRepositoryConnection
        repository={repository({
          isConnected: false,
          provider: CodeRepositoryType.Forgejo,
          connection: {
            id: CONNECTION_ID,
            hostUrl: "https://git.example.com",
            hostProduct: "Gitea",
            isTokenRefused: true,
            isReachableFromServer: true,
          },
        })}
        onReplaced={jest.fn()}
      />,
    );

    expect(screen.getByTestId("repository-connection-status")).toHaveAttribute(
      "data-connection",
      "token-refused",
    );
    expect(
      screen.getByTestId("code-repository-connection-refused"),
    ).toHaveTextContent(
      "Gitea refused the access token: it may have expired or been revoked. Replace it to connect the repository again.",
    );
  });

  test("a connection that is gone says to connect again, with no token to replace", () => {
    draw(
      <CodeRepositoryConnection
        repository={repository({
          isConnected: false,
          connection: { isTokenRefused: false, isReachableFromServer: true },
        })}
        onReplaced={jest.fn()}
      />,
    );

    expect(
      screen.getByTestId("code-repository-connection-gone"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("code-repository-replace-token")).toBeNull();
  });

  test("a Git server only a Runner reaches says so, and the password is named as one", () => {
    const facts: Array<string> = getConnectionFacts({
      provider: CodeRepositoryType.Git,
      connection: {
        id: CONNECTION_ID,
        hostUrl: "https://10.0.0.5",
        accountLogin: "deploy",
        credentialHint: "9z9z",
        isTokenRefused: false,
        isReachableFromServer: false,
      },
      translator: createTranslator(undefined, "en"),
    });

    expect(facts).toEqual([
      "10.0.0.5",
      "Signed in as deploy",
      "Password or access token ending in …9z9z",
    ]);

    draw(
      <CodeRepositoryConnection
        repository={repository({
          provider: CodeRepositoryType.Git,
          connection: {
            id: CONNECTION_ID,
            hostUrl: "https://10.0.0.5",
            isTokenRefused: false,
            isReachableFromServer: false,
          },
        })}
        onReplaced={jest.fn()}
      />,
    );

    expect(
      screen.getByTestId("code-repository-connection-runner-only"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("code-repository-github-only")).toHaveTextContent(
      CODE_HOST_GITHUB_ONLY_NOTE[CodeRepositoryType.Git],
    );
  });

  test("Replace access token asks for the new one, sends it once, and the page reads the repository again", async () => {
    const replace: SpyInstance<typeof CodeConnectApi.replaceToken> = jest
      .spyOn(CodeConnectApi, "replaceToken")
      .mockResolvedValue({ accountLogin: "alice", credentialHint: "cd34" });
    const onReplaced: MockFunction = getJestMockFunction();

    draw(
      <CodeRepositoryConnection
        repository={repository()}
        onReplaced={onReplaced}
      />,
    );

    fireEvent.click(screen.getByTestId("code-repository-replace-token"));

    const dialog: HTMLElement = await screen.findByTestId(
      "code-replace-token-dialog",
    );
    const input: HTMLInputElement = within(dialog).getByTestId(
      "code-replace-token-input",
    ) as HTMLInputElement;

    expect(input).toHaveAttribute("type", "password");
    // GitLab signs in as the token's account: no username to ask.
    expect(
      within(dialog).queryByTestId("code-replace-token-username"),
    ).toBeNull();

    fireEvent.change(input, { target: { value: "glpat-new-token-0000002" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace token" }));

    await waitFor(() => {
      expect(onReplaced).toHaveBeenCalled();
    });
    expect(replace).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      token: "glpat-new-token-0000002",
    });
    expect(
      screen.getByTestId("code-repository-connection-replaced"),
    ).toHaveTextContent("Access token replaced.");
    expect(document.body.innerHTML).not.toContain("glpat-new-token-0000002");
  });

  test("a Git repository's replacement asks for its username too, keeping the one it has when left empty", async () => {
    const replace: SpyInstance<typeof CodeConnectApi.replaceToken> = jest
      .spyOn(CodeConnectApi, "replaceToken")
      .mockResolvedValue({ accountLogin: "deploy", credentialHint: "" });

    draw(
      <CodeRepositoryConnection
        repository={repository({ provider: CodeRepositoryType.Git })}
        onReplaced={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("code-repository-replace-token"));

    const dialog: HTMLElement = await screen.findByTestId(
      "code-replace-token-dialog",
    );

    expect(
      within(dialog).getByTestId("code-replace-token-username"),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByTestId("code-replace-token-input"), {
      target: { value: "new-password-000001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace token" }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith({
        connectionId: CONNECTION_ID,
        token: "new-password-000001",
      });
    });
  });

  test("someone who may not connect repositories is told why instead of offered the button", () => {
    jest.spyOn(GitHubConnectLock, "getCodeConnectLock").mockReturnValue({
      isLocked: true,
      reason:
        "Connecting repositories needs permission to create code repositories.",
    });

    draw(
      <CodeRepositoryConnection
        repository={repository()}
        onReplaced={jest.fn()}
      />,
    );

    expect(screen.queryByTestId("code-repository-replace-token")).toBeNull();
    expect(
      screen.getByTestId("code-repository-connection-locked"),
    ).toHaveTextContent("Connecting repositories needs permission");
  });

  test("the status keeps GitHub's words for a GitHub repository", () => {
    draw(
      <div>
        <RepositoryConnectionStatus gitHubAppInstallationId="1" />
        <RepositoryConnectionStatus provider="GitLab" isReachable={false} />
      </div>,
    );

    const statuses: Array<HTMLElement> = screen.getAllByTestId(
      "repository-connection-status",
    );

    expect(statuses[0]).toHaveAttribute("data-connection", "github-app");
    expect(statuses[0]).toHaveTextContent("GitHub App");
    expect(statuses[1]).toHaveAttribute("data-connection", "not-connected");
    expect(statuses[1]).toHaveAttribute("data-provider", "GitLab");
  });
});

describe("what stops AI, said for the repository's host", () => {
  test("a refused token links the repository's settings, with Replace access token", () => {
    grant([Permission.ProjectUser, Permission.ProjectOwner]);

    draw(
      <CodeBlockerNotice
        blocker={{
          type: CodeTaskBlockerType.RepositoryTokenRefused,
          message: "GitLab refused this repository's access token.",
        }}
        repositoryId={REPOSITORY_ID}
        provider="GitLab"
      />,
    );

    const fix: HTMLElement = screen.getByTestId("code-blocker-fix");

    expect(fix).toHaveTextContent("Replace access token");
    expect(fix.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings`,
    );
  });

  test("someone who may not connect repositories is told who can replace the token, not shown the link", () => {
    grant([Permission.ProjectUser, Permission.ReadCodeRepository]);

    draw(
      <CodeBlockerNotice
        blocker={{
          type: CodeTaskBlockerType.RepositoryTokenRefused,
          message: "",
        }}
        repositoryId={REPOSITORY_ID}
        provider="Forgejo"
      />,
    );

    expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
    expect(screen.getByTestId("code-blocker-who-can")).toHaveTextContent(
      "A project admin can replace the access token in this repository's settings.",
    );
  });

  test("a server only a project Runner reaches links its Runner setting", () => {
    grant([Permission.ProjectUser, Permission.ProjectOwner]);

    draw(
      <CodeBlockerNotice
        blocker={{
          type: CodeTaskBlockerType.RepositoryNeedsOwnRunner,
          message: "",
        }}
        repositoryId={REPOSITORY_ID}
        provider="Git"
      />,
    );

    expect(screen.getByTestId("code-blocker")).toHaveTextContent(
      "This repository's Git server is on a network OneUptime does not reach",
    );
    expect(screen.getByTestId("code-blocker-fix").getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings#runner`,
    );
  });

  test("a lost connection off GitHub links Repositories to connect again - never Connect GitHub", () => {
    const connectGitHub: { onConnect: MockFunction } = {
      onConnect: getJestMockFunction(),
    };

    draw(
      <CodeBlockerNotice
        blocker={{
          type: CodeTaskBlockerType.RepositoryNotConnected,
          message: "",
        }}
        repositoryId={REPOSITORY_ID}
        provider="Forgejo"
        connectGitHub={connectGitHub}
      />,
    );

    expect(screen.getByTestId("code-blocker")).toHaveTextContent(
      "This repository is no longer connected to its Git server",
    );
    expect(screen.getByTestId("code-blocker-fix")).toHaveTextContent(
      "Connect repositories",
    );
    expect(screen.queryByRole("button", { name: /Connect GitHub/ })).toBeNull();

    expect(
      getBlockerCopy({
        type: CodeTaskBlockerType.RepositoryNotConnected,
        provider: "GitHub",
      }).fix?.title,
    ).toBe("Connect GitHub");
  });
});

describe("a task's turn and row, on GitLab", () => {
  function turn(): CodeTaskTurnJSON {
    return {
      runId: "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a",
      recipe: CodeFixTaskType.CodeRequest,
      status: AIRunStatus.Completed,
      state: CodeTaskState.Done,
      createdAt: new Date(Date.now() - 60 * 60000).toISOString(),
      startedAt: new Date(Date.now() - 59 * 60000).toISOString(),
      completedAt: new Date(Date.now() - 50 * 60000).toISOString(),
      requestedBy: { id: "ada", name: "Ada" },
      request: { message: "Fix it", context: [] },
      steps: [],
      outcome: {
        summary: "Fixed it.",
        filesChanged: [
          {
            path: "src/a.ts",
            status: "Modified" as never,
            additions: 1,
            deletions: 1,
          },
        ],
        pullRequestNumber: 12,
        pullRequestUrl: "https://gitlab.com/acme/app/-/merge_requests/12",
        openedPullRequest: true,
      },
      pullRequests: [],
      needsInput: false,
    } as CodeTaskTurnJSON;
  }

  test("says it opened merge request !12, with GitLab's mark and View on GitLab", () => {
    draw(
      <ol>
        <CodeTaskTurn
          turn={turn()}
          isLatest={true}
          repositoryHost={{ provider: "GitLab" }}
        />
      </ol>,
    );

    const line: HTMLElement = screen.getByTestId("code-turn-pull-request");

    expect(line).toHaveTextContent("Opened merge request !12");
    expect(within(line).getByTestId("code-host-mark")).toHaveAttribute(
      "data-provider",
      "GitLab",
    );
    expect(
      within(line).getByRole("link", { name: /View on GitLab/ }),
    ).toHaveAttribute(
      "href",
      "https://gitlab.com/acme/app/-/merge_requests/12",
    );
  });

  test("a Gitea server's pull request is viewed on Gitea, in German too", () => {
    drawInGerman(
      <ol>
        <CodeTaskTurn
          turn={turn()}
          isLatest={true}
          repositoryHost={{ provider: "Forgejo", hostProduct: "Gitea" }}
        />
      </ol>,
    );

    const line: HTMLElement = screen.getByTestId("code-turn-pull-request");

    expect(line).toHaveTextContent("Pull Request #12 geöffnet");
    expect(
      within(line).getByRole("link", { name: /Auf Gitea ansehen/ }),
    ).toBeInTheDocument();
  });

  test("a task row names a GitLab merge request as MR !12", () => {
    draw(
      <ul>
        <CodeTaskRow
          task={{
            id: "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
            title: "Fix it",
            recipe: CodeFixTaskType.CodeRequest,
            state: CodeTaskState.Done,
            isQueued: false,
            createdAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            origin: { type: "Request" as never, label: "Ada" },
            pullRequest: { number: 12, state: "open" },
            turnCount: 1,
          }}
          repositoryName="checkout"
          repositoryHost={{ provider: "GitLab" }}
        />
      </ul>,
    );

    expect(screen.getByTestId("code-task-row-pull-request")).toHaveTextContent(
      "MR !12",
    );
    expect(
      within(screen.getByTestId("code-task-row-repository")).getByTestId(
        "code-host-mark",
      ),
    ).toHaveAttribute("data-provider", "GitLab");
  });
});

describe("the branch picker, for a Git server only a Runner reaches", () => {
  test("offers the main branch and says why, never asking for the rest", async () => {
    const getBranches: SpyInstance<typeof CodeApi.getBranches> = jest.spyOn(
      CodeApi,
      "getBranches",
    );

    draw(
      <CodeBranchPicker
        repositoryId={REPOSITORY_ID}
        defaultBranch="main"
        value={null}
        onChange={jest.fn()}
        provider="Git"
        isNotReadByServer={true}
      />,
    );

    await userEvent.click(screen.getByTestId("code-branch-picker-button"));

    const options: Array<HTMLElement> = screen.getAllByTestId(
      "code-branch-picker-option",
    );

    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("main");
    expect(options[0]).toHaveTextContent("Default");
    expect(screen.getByTestId("code-branch-picker-note")).toHaveTextContent(
      "OneUptime does not read this repository's branches: only your Runner reaches its Git server. A task starts from its main branch.",
    );
    expect(getBranches).not.toHaveBeenCalled();
  });

  test("a read that fails names the repository's own Git server, not GitHub", async () => {
    jest.spyOn(CodeApi, "getBranches").mockRejectedValue(new Error("down"));

    draw(
      <CodeBranchPicker
        repositoryId={REPOSITORY_ID}
        defaultBranch="main"
        value={null}
        onChange={jest.fn()}
        provider="GitLab"
      />,
    );

    await userEvent.click(screen.getByTestId("code-branch-picker-button"));

    expect(
      await screen.findByText(
        "OneUptime could not read this repository's branches from its Git server.",
      ),
    ).toBeInTheDocument();
  });
});

describe("a repository's menu, on its host", () => {
  function hostedAt(provider: CodeRepositoryType | Error): void {
    jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
      if (provider instanceof Error) {
        throw provider;
      }

      const item: CodeRepositoryModel = new CodeRepositoryModel();
      item.repositoryHostedAt = provider;
      return item;
    }) as never);
  }

  function menuTitles(): Array<string> {
    return screen.getAllByRole("link").map((link: HTMLElement): string => {
      return link.textContent?.trim() || "";
    });
  }

  test("off GitHub, Production Reviews leaves the menu once the host is read", async () => {
    hostedAt(CodeRepositoryType.GitLab);

    draw(<CodeRepositorySideMenu modelId={new ObjectID(REPOSITORY_ID)} />);

    await waitFor(() => {
      expect(menuTitles()).not.toContain("Production Reviews");
    });
    expect(menuTitles()).toEqual(expect.arrayContaining(["Tasks", "Settings"]));
    // Only where it is hosted is read.
    expect(
      (ModelAPI.getItem as unknown as jest.Mock).mock.calls[0]![0],
    ).toEqual(
      expect.objectContaining({ select: { repositoryHostedAt: true } }),
    );
  });

  test("on GitHub - or when the read fails - it stays, as it always was", async () => {
    hostedAt(CodeRepositoryType.GitHub);

    draw(<CodeRepositorySideMenu modelId={new ObjectID(REPOSITORY_ID)} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(menuTitles()).toContain("Production Reviews");

    cleanup();
    hostedAt(new Error("down"));

    draw(<CodeRepositorySideMenu modelId={new ObjectID(REPOSITORY_ID)} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(menuTitles()).toContain("Production Reviews");
  });
});
