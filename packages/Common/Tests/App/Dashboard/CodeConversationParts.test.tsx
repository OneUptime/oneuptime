import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlockerType,
  CodeTaskContextType,
  CodeTaskFileStatus,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskStepJSON,
  CodeTaskStepKind,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * The pieces a task's conversation and a repository's page are drawn from,
 * rendered for real: a turn (what was asked, what started it, the AI's side
 * of it), its steps, its changes, the state badge, a task row, a
 * repository's card and the notice that says what stops AI working.
 *
 * What they promise a reader: the state is always said in words; while AI
 * works its latest steps show live, and once done they fold behind one line
 * that counts them; a diff opens a file at a time and only for people who
 * may see it; a pull request is "opened" by the turn that opened it and
 * "pushed to" by the turns after; a failed or stopped turn says why and
 * offers Try again only where it applies; a record the request named links
 * to its page.
 */

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

import CodeTaskTurn from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskTurn";
import CodeTaskSteps, {
  LIVE_STEPS_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskSteps";
import CodeTaskChangesView, {
  getDiffLineClassName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskChanges";
import CodeTaskStateBadge from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskStateBadge";
import { CodeTaskRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskList";
import RepositoryCard from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RepositoryCard";
import CodeBlockerNotice from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeBlockerNotice";

const TASK_ID: string = "1d2e3f4a-5b6c-4d7e-8f90-a1b2c3d4e5f6";
const REPOSITORY_ID: string = "2e3f4a5b-6c7d-4e8f-9a0b-c1d2e3f4a5b6";
const INCIDENT_ID: string = "3f4a5b6c-7d8e-4f9a-8b1c-d2e3f4a5b6c7";
const EXCEPTION_ID: string = "4a5b6c7d-8e9f-4a0b-9c2d-e3f4a5b6c7d8";

const translation: i18n = createInstance();
const germanTranslation: i18n = createInstance();

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
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

afterEach(() => {
  cleanup();
});

function draw(element: ReactElement): void {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
}

function drawInGerman(element: ReactElement): void {
  render(<I18nextProvider i18n={germanTranslation}>{element}</I18nextProvider>);
}

/*
 * The signed-in person's permissions, as the permission snapshot hands them
 * to every gate - or (null) a snapshot that has not arrived yet.
 */
function grant(permissions: Array<Permission> | null): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(permissions || []);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(
    permissions
      ? {
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
        }
      : null,
  );
}

function steps(count: number, kind: CodeTaskStepKind): Array<CodeTaskStepJSON> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return {
      sequence: index + 1,
      kind,
      subject: `src/file-${index + 1}.ts`,
      isError: false,
    };
  });
}

function turn(data: Partial<CodeTaskTurnJSON>): CodeTaskTurnJSON {
  return {
    runId: TASK_ID,
    recipe: CodeFixTaskType.CodeRequest,
    status: AIRunStatus.Completed,
    state: CodeTaskState.Done,
    createdAt: new Date(Date.now() - 60 * 60000).toISOString(),
    startedAt: new Date(Date.now() - 59 * 60000).toISOString(),
    completedAt: new Date(Date.now() - 50 * 60000).toISOString(),
    requestedBy: { id: "ada", name: "Ada Lovelace" },
    request: { message: "Add retries", context: [] },
    steps: [],
    pullRequests: [],
    needsInput: false,
    ...data,
  };
}

function hrefOf(element: Element): string {
  return element.getAttribute("href") || "";
}

describe("a turn: what was asked", () => {
  test("the person, their words as written, and the context they added - records link to their pages", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            request: {
              message: "Retry charges.\nNever retry a declined card.",
              context: [
                {
                  type: CodeTaskContextType.Incident,
                  label: "Incident #87: Checkout fails",
                  recordId: INCIDENT_ID,
                },
                {
                  type: CodeTaskContextType.File,
                  label: "src/payments/client.ts",
                  path: "src/payments/client.ts",
                },
                {
                  type: CodeTaskContextType.Link,
                  label: "Express 5",
                  url: "https://expressjs.com/en/guide/migrating-5.html",
                },
                {
                  type: CodeTaskContextType.Logs,
                  label: 'Logs matching "timeout"',
                  search: "timeout",
                  hours: 24,
                },
              ],
            },
          })}
        />
      </ol>,
    );

    const request: HTMLElement = screen.getByTestId("code-turn-request");
    expect(request).toHaveTextContent("Ada Lovelace");
    expect(request).toHaveTextContent(
      "Retry charges. Never retry a declined card.",
    );

    const chips: Array<HTMLElement> = within(request).getAllByTestId(
      "code-turn-context-chip",
    );
    expect(
      chips.map((chip: HTMLElement) => {
        return chip.getAttribute("data-context-type");
      }),
    ).toEqual(["Incident", "File", "Link", "Logs"]);

    // A record opens its page in the project; a link opens in a new tab.
    expect(hrefOf(within(chips[0]!).getByRole("link"))).toBe(
      `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`,
    );
    expect(within(chips[1]!).queryByRole("link")).toBeNull();
    expect(within(chips[2]!).getByRole("link")).toHaveAttribute(
      "target",
      "_blank",
    );
    // A path reads as code.
    expect(chips[1]!.querySelector(".font-mono")).not.toBeNull();
  });

  test("a task OneUptime started says what started it and links the record - its kind is the header's to say", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          origin={{
            type: CodeTaskOriginType.Exception,
            label: "TypeError: x is undefined",
            recordId: EXCEPTION_ID,
          }}
          turn={turn({
            recipe: CodeFixTaskType.FixException,
            request: undefined,
            requestedBy: undefined,
          })}
        />
      </ol>,
    );

    const origin: HTMLElement = screen.getByTestId("code-turn-origin");
    expect(origin).toHaveTextContent("OneUptime");
    // Said once on the page: the header's pill names the kind.
    expect(origin).not.toHaveTextContent("Fix Exception");
    expect(origin).toHaveTextContent(
      "OneUptime started this task from an exception: TypeError: x is undefined",
    );
    expect(
      hrefOf(
        within(origin).getByRole("link", { name: "TypeError: x is undefined" }),
      ),
    ).toBe(`/dashboard/${PROJECT_ID}/exceptions/${EXCEPTION_ID}`);
  });

  test("a GitHub issue links to GitHub", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          origin={{
            type: CodeTaskOriginType.GitHubIssue,
            label: "#12",
            url: "https://github.com/acme/api/issues/12",
          }}
          turn={turn({
            recipe: CodeFixTaskType.GitHubIssueFix,
            request: undefined,
          })}
        />
      </ol>,
    );

    expect(screen.getByTestId("code-turn-origin")).toHaveTextContent(
      "Started from GitHub issue #12",
    );
    expect(screen.getByRole("link", { name: "#12" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/issues/12",
    );
  });
});

describe("a turn: the AI's side", () => {
  test("queued: waiting for a Runner, with no Log yet", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          logRoute={new Route("/log")}
          turn={turn({
            status: AIRunStatus.Queued,
            state: CodeTaskState.Working,
            startedAt: undefined,
            completedAt: undefined,
            createdAt: new Date().toISOString(),
          })}
        />
      </ol>,
    );

    const reply: HTMLElement = screen.getByTestId("code-turn-reply");
    expect(reply).toHaveAttribute("data-turn-state", "Working");
    expect(within(reply).getByTestId("code-task-state")).toHaveTextContent(
      "Queued",
    );
    expect(screen.getByTestId("code-turn-working")).toHaveTextContent(
      "Waiting for a Runner to pick this up…",
    );
    expect(screen.queryByTestId("code-turn-slow-queue")).toBeNull();
    expect(within(reply).queryByRole("link", { name: "Log" })).toBeNull();
  });

  test("queued for long: what to check, and where", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            status: AIRunStatus.Queued,
            state: CodeTaskState.Working,
            startedAt: undefined,
            completedAt: undefined,
            createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
          })}
        />
      </ol>,
    );

    const slow: HTMLElement = screen.getByTestId("code-turn-slow-queue");
    expect(slow).toHaveTextContent(
      "Taking longer than usual? Check that a Runner is online and up to date in Runners.",
    );
    expect(hrefOf(within(slow).getByRole("link", { name: "Runners" }))).toBe(
      `/dashboard/${PROJECT_ID}/runbooks/runners`,
    );
    // Never the switch Runners no longer have.
    expect(slow).not.toHaveTextContent("Code Fixes");
  });

  test("queued for long in a repository: its Runner is checked in the repository's settings", () => {
    const settings: string = `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}/settings`;

    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          repositorySettingsRoute={new Route(settings)}
          turn={turn({
            status: AIRunStatus.Queued,
            state: CodeTaskState.Working,
            startedAt: undefined,
            completedAt: undefined,
            createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
          })}
        />
      </ol>,
    );

    const slow: HTMLElement = screen.getByTestId("code-turn-slow-queue");
    expect(slow).toHaveTextContent(
      "Taking longer than usual? Check that this repository's Runner is online in its Settings.",
    );
    expect(hrefOf(within(slow).getByRole("link", { name: "Settings" }))).toBe(
      settings,
    );
    expect(within(slow).queryByRole("link", { name: "Runners" })).toBeNull();
  });

  test("working: Working…, how long so far, its Log and its latest steps - ending where the next one will appear", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          logRoute={new Route("/dashboard/x/code/tasks/y/log")}
          turn={turn({
            status: AIRunStatus.Running,
            state: CodeTaskState.Working,
            completedAt: undefined,
            steps: steps(3, CodeTaskStepKind.Read),
          })}
        />
      </ol>,
    );

    const reply: HTMLElement = screen.getByTestId("code-turn-reply");
    expect(within(reply).getByTestId("code-task-state")).toHaveTextContent(
      "Working…",
    );
    expect(reply).toHaveTextContent("so far");
    expect(within(reply).getByRole("link", { name: "Log" })).toHaveAttribute(
      "href",
      "/dashboard/x/code/tasks/y/log",
    );
    expect(screen.getAllByTestId("code-task-step")).toHaveLength(3);

    // "Working on it…" is said once, as the last line of the live steps.
    const working: HTMLElement = screen.getByTestId("code-task-steps-working");
    expect(working).toHaveTextContent("Working on it…");
    expect(working).toHaveAttribute("role", "status");
    const list: HTMLElement = working.parentElement as HTMLElement;
    expect(list.lastElementChild).toBe(working);
    expect(screen.queryByTestId("code-turn-working")).toBeNull();
    expect(screen.getAllByText("Working on it…")).toHaveLength(1);
  });

  test("working before its first step: Working on it…, on its own line", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            status: AIRunStatus.Running,
            state: CodeTaskState.Working,
            completedAt: undefined,
            steps: [],
          })}
        />
      </ol>,
    );

    expect(screen.getByTestId("code-turn-working")).toHaveTextContent(
      "Working on it…",
    );
    expect(screen.queryByTestId("code-task-steps-working")).toBeNull();
  });

  test.each([
    [9 * 60000, "worked 9 minutes"],
    [65 * 60000, "worked 1 hour, 5 minutes"],
    [20 * 1000, "worked less than a minute"],
  ])(
    "how long a turn took is said in words (%s ms: %s)",
    (took: number, words: string) => {
      const completedAt: number = Date.now() - 50 * 60000;
      draw(
        <ol>
          <CodeTaskTurn
            isLatest={true}
            turn={turn({
              startedAt: new Date(completedAt - took).toISOString(),
              completedAt: new Date(completedAt).toISOString(),
            })}
          />
        </ol>,
      );

      expect(screen.getByTestId("code-turn-duration").textContent).toBe(words);
    },
  );

  test("in German, how long a turn took is German too - unit, plural and all", () => {
    const completedAt: number = Date.now() - 50 * 60000;
    drawInGerman(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            startedAt: new Date(completedAt - 9 * 60000).toISOString(),
            completedAt: new Date(completedAt).toISOString(),
          })}
        />
      </ol>,
    );

    const duration: HTMLElement = screen.getByTestId("code-turn-duration");
    expect(duration).toHaveTextContent("9 Minuten gearbeitet");
    expect(duration).not.toHaveTextContent("min");
  });

  test("a turn's byline facts read on the page's gray: never gray-400", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          logRoute={new Route("/log")}
          turn={turn({})}
        />
      </ol>,
    );

    const reply: HTMLElement = screen.getByTestId("code-turn-reply");
    expect(screen.getByTestId("code-turn-duration").className).toContain(
      "text-gray-500",
    );
    expect(
      within(reply).getByRole("link", { name: "Log" }).className,
    ).toContain("text-gray-500");
    for (const time of Array.from(document.querySelectorAll("time"))) {
      expect(time.className).not.toContain("text-gray-400");
    }
  });

  test("done: the reply, the files it changed, and the pull request it opened", async () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            steps: steps(2, CodeTaskStepKind.Edited),
            outcome: {
              summary: "Charges now retry up to **3 times**.",
              filesChanged: [
                {
                  path: "src/payments/client.ts",
                  status: CodeTaskFileStatus.Modified,
                  additions: 9,
                  deletions: 1,
                },
              ],
              pullRequestNumber: 418,
              pullRequestUrl: "https://github.com/acme/api/pull/418",
              openedPullRequest: true,
            },
            changes: {
              files: [
                {
                  path: "src/payments/client.ts",
                  status: CodeTaskFileStatus.Modified,
                  additions: 9,
                  deletions: 1,
                  patch: "@@ -1 +1 @@\n-old\n+new",
                },
              ],
              isTruncated: false,
            },
            pullRequests: [
              {
                number: 418,
                url: "https://github.com/acme/api/pull/418",
                state: "open",
              },
            ],
          })}
        />
      </ol>,
    );

    const reply: HTMLElement = screen.getByTestId("code-turn-reply");
    expect(within(reply).getByTestId("code-task-state")).toHaveTextContent(
      "Done",
    );
    expect(reply).toHaveTextContent("worked");
    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "Charges now retry up to **3 times**.",
    );
    expect(screen.getByTestId("code-task-changes")).toHaveTextContent(
      "1 file changed",
    );

    const pullRequest: HTMLElement = screen.getByTestId(
      "code-turn-pull-request",
    );
    expect(pullRequest).toHaveTextContent("Opened pull request #418");
    // An open pull request needs no pill.
    expect(
      within(pullRequest).queryByTestId("code-turn-pull-request-state"),
    ).toBeNull();
    expect(
      within(pullRequest).getByRole("link", { name: "View on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/acme/api/pull/418");

    // Done: the steps fold into one counted line.
    expect(screen.queryAllByTestId("code-task-step")).toHaveLength(0);
    await userEvent.click(screen.getByTestId("code-task-steps-toggle"));
    expect(screen.getAllByTestId("code-task-step")).toHaveLength(2);
  });

  test("a later turn pushed to the pull request the task already had", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            outcome: {
              summary: "Done.",
              filesChanged: [
                {
                  path: "a.ts",
                  status: CodeTaskFileStatus.Modified,
                  additions: 1,
                  deletions: 0,
                },
              ],
              pullRequestNumber: 418,
              pullRequestUrl: "https://github.com/acme/api/pull/418",
              openedPullRequest: false,
            },
          })}
        />
      </ol>,
    );

    expect(screen.getByTestId("code-turn-pull-request")).toHaveTextContent(
      "Pushed to pull request #418",
    );
  });

  test("a merged or closed pull request says so", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            pullRequests: [
              {
                number: 402,
                url: "https://github.com/a/b/pull/402",
                state: "merged",
              },
              {
                number: 403,
                url: "https://github.com/a/b/pull/403",
                state: "closed",
              },
            ],
          })}
        />
      </ol>,
    );

    const pills: Array<HTMLElement> = screen.getAllByTestId(
      "code-turn-pull-request-state",
    );
    expect(
      pills.map((pill: HTMLElement) => {
        return pill.textContent;
      }),
    ).toEqual(["Merged", "Closed"]);
  });

  test("waiting for you: the question stands out, marked as AI's", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            needsInput: true,
            state: CodeTaskState.WaitingForYou,
            outcome: { summary: "Which do you prefer?", filesChanged: [] },
          })}
        />
      </ol>,
    );

    const summary: HTMLElement = screen.getByTestId("code-turn-summary");
    expect(summary).toHaveTextContent("AI asks");
    expect(summary).toHaveTextContent("Which do you prefer?");
    expect(
      within(screen.getByTestId("code-turn-reply")).getByTestId(
        "code-task-state",
      ),
    ).toHaveTextContent("Waiting for you");
  });

  test("done with nothing to show says it finished without changing code - or the server's reason", () => {
    draw(
      <ol>
        <CodeTaskTurn isLatest={true} turn={turn({ outcome: undefined })} />
      </ol>,
    );
    expect(screen.getByTestId("code-turn-reply")).toHaveTextContent(
      "Finished without changing any code.",
    );
    cleanup();

    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          turn={turn({
            status: AIRunStatus.NoFixFound,
            outcome: undefined,
            errorMessage: "No connected repository holds these files.",
          })}
        />
      </ol>,
    );
    expect(screen.getByTestId("code-turn-reply")).toHaveTextContent(
      "No connected repository holds these files.",
    );
  });

  test("failed: why, and Try again on the latest turn only", async () => {
    const retry: MockFunction = getJestMockFunction();
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          onRetry={retry as unknown as () => void}
          turn={turn({
            status: AIRunStatus.Error,
            state: CodeTaskState.Failed,
            errorMessage: "npm run build failed.",
          })}
        />
      </ol>,
    );

    const failed: HTMLElement = screen.getByTestId("code-turn-failed");
    // Plain words, not the conversation's inner workings ("turn").
    expect(failed).toHaveTextContent("AI could not finish.");
    expect(failed).not.toHaveTextContent("turn");
    expect(failed).toHaveTextContent("npm run build failed.");
    await userEvent.click(
      within(failed).getByRole("button", { name: "Try again" }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
    cleanup();

    draw(
      <ol>
        <CodeTaskTurn
          isLatest={false}
          onRetry={retry as unknown as () => void}
          turn={turn({
            status: AIRunStatus.Error,
            state: CodeTaskState.Failed,
          })}
        />
      </ol>,
    );
    expect(screen.queryByTestId("code-turn-retry")).toBeNull();
  });

  test("stopped: who stopped it, and Try again", () => {
    draw(
      <ol>
        <CodeTaskTurn
          isLatest={true}
          onRetry={(): void => {}}
          turn={turn({
            status: AIRunStatus.Cancelled,
            state: CodeTaskState.Stopped,
            errorMessage: "Stopped by Grace Hopper.",
          })}
        />
      </ol>,
    );

    const stopped: HTMLElement = screen.getByTestId("code-turn-stopped");
    expect(stopped).toHaveTextContent("Stopped by Grace Hopper.");
    expect(
      within(stopped).getByRole("button", { name: "Try again" }),
    ).toBeTruthy();
  });
});

describe("steps", () => {
  test(`while AI works: the latest ${LIVE_STEPS_SHOWN} show, open, and the earlier ones on demand`, async () => {
    draw(
      <CodeTaskSteps isLive={true} steps={steps(9, CodeTaskStepKind.Read)} />,
    );

    expect(screen.queryByTestId("code-task-steps-toggle")).toBeNull();
    const shown: Array<HTMLElement> = screen.getAllByTestId("code-task-step");
    expect(shown).toHaveLength(LIVE_STEPS_SHOWN);
    expect(shown[shown.length - 1]).toHaveTextContent("Read src/file-9.ts");

    await userEvent.click(
      screen.getByRole("button", { name: "Show 3 earlier steps" }),
    );
    expect(screen.getAllByTestId("code-task-step")).toHaveLength(9);
  });

  test("once done: one line that counts them by kind, opened by a click", async () => {
    draw(
      <CodeTaskSteps
        isLive={false}
        steps={[
          ...steps(2, CodeTaskStepKind.Read),
          {
            sequence: 3,
            kind: CodeTaskStepKind.Edited,
            subject: "a.ts",
            isError: false,
          },
          {
            sequence: 4,
            kind: CodeTaskStepKind.Ran,
            subject: "npm test",
            isError: true,
          },
          {
            sequence: 5,
            kind: CodeTaskStepKind.Note,
            subject: "Thinking about retries",
            isError: false,
          },
        ]}
      />,
    );

    const toggle: HTMLElement = screen.getByTestId("code-task-steps-toggle");
    expect(toggle).toHaveTextContent(
      "5 steps · read 2 files · edited 1 file · ran 1 command",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    const shown: Array<HTMLElement> = screen.getAllByTestId("code-task-step");
    expect(
      shown.map((step: HTMLElement) => {
        return step.textContent;
      }),
    ).toEqual([
      "Read src/file-1.ts",
      "Read src/file-2.ts",
      "Edited a.ts",
      "Ran npm test",
      "Thinking about retries",
    ]);
    // A failed step is marked.
    expect(shown[3]!.querySelector(".text-red-700")).not.toBeNull();
  });

  test("no steps, nothing drawn", () => {
    draw(<CodeTaskSteps isLive={false} steps={[]} />);
    expect(screen.queryByTestId("code-task-steps")).toBeNull();
  });
});

describe("changes", () => {
  const FILES: Array<{
    path: string;
    previousPath?: string;
    status: CodeTaskFileStatus;
    additions: number;
    deletions: number;
  }> = [
    {
      path: "src/a.ts",
      status: CodeTaskFileStatus.Modified,
      additions: 3,
      deletions: 1,
    },
    {
      path: "src/new.ts",
      status: CodeTaskFileStatus.Added,
      additions: 10,
      deletions: 0,
    },
    {
      path: "src/renamed.ts",
      previousPath: "src/old.ts",
      status: CodeTaskFileStatus.Renamed,
      additions: 0,
      deletions: 0,
    },
  ];

  test("each file with how it changed and by how much; its diff a click away", async () => {
    draw(
      <CodeTaskChangesView
        files={FILES}
        changes={{
          files: [
            { ...FILES[0]!, patch: "@@ -1,2 +1,2 @@\n-a\n+b\n c" },
            {
              ...FILES[1]!,
              patch: "@@ -0,0 +1 @@\n+x",
              isPatchTruncated: true,
            },
          ],
          isTruncated: true,
        }}
      />,
    );

    const view: HTMLElement = screen.getByTestId("code-task-changes");
    expect(view).toHaveTextContent("3 files changed");
    expect(view).toHaveTextContent("+13");
    expect(view).toHaveTextContent("−1");
    expect(view).toHaveTextContent(
      "Part of the diff is left out; the pull request has all of it.",
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "code-task-changed-file",
    );
    expect(rows[2]).toHaveTextContent("src/old.ts → src/renamed.ts");
    // A file with no diff kept cannot be opened.
    expect(within(rows[2]!).getByRole("button")).toBeDisabled();

    await userEvent.click(within(rows[0]!).getByRole("button"));
    expect(within(rows[0]!).getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(rows[0]!).getByTestId("code-task-diff")).toHaveTextContent(
      "+b",
    );

    await userEvent.click(within(rows[1]!).getByRole("button"));
    expect(within(rows[1]!).getByTestId("code-task-diff")).toHaveTextContent(
      "This file's diff is cut short here.",
    );
  });

  test("for a reader who may not see the code: which files changed, no diff", () => {
    draw(<CodeTaskChangesView files={FILES} />);

    for (const row of screen.getAllByTestId("code-task-changed-file")) {
      expect(within(row).getByRole("button")).toBeDisabled();
    }
    expect(screen.queryByTestId("code-task-diff")).toBeNull();
  });

  test("a diff line is coloured by what it is", () => {
    expect(getDiffLineClassName("@@ -1 +1 @@")).toContain("sky");
    expect(getDiffLineClassName("+added")).toContain("emerald");
    expect(getDiffLineClassName("-removed")).toContain("red");
    expect(getDiffLineClassName("\\ No newline at end of file")).toContain(
      "gray-400",
    );
    expect(getDiffLineClassName(" context")).toBe("text-gray-700");
  });
});

describe("the state badge", () => {
  test.each([
    [CodeTaskState.Working, false, "Working…"],
    [CodeTaskState.Working, true, "Queued"],
    [CodeTaskState.WaitingForYou, false, "Waiting for you"],
    [CodeTaskState.Done, false, "Done"],
    [CodeTaskState.Failed, false, "Failed"],
    [CodeTaskState.Stopped, false, "Stopped"],
  ])(
    "%s (queued: %s) reads %s",
    (state: CodeTaskState, isQueued: boolean, words: string) => {
      draw(<CodeTaskStateBadge state={state} isQueued={isQueued} />);
      const badge: HTMLElement = screen.getByTestId("code-task-state");
      expect(badge).toHaveTextContent(words);
      expect(badge).toHaveAttribute("data-state", state);
      // Only AI at work pulses.
      expect(badge.querySelector(".motion-safe\\:animate-ping") !== null).toBe(
        state === CodeTaskState.Working && !isQueued,
      );
    },
  );
});

describe("a task row", () => {
  function summary(data: Partial<CodeTaskSummaryJSON>): CodeTaskSummaryJSON {
    return {
      id: TASK_ID,
      taskNumber: 12,
      title: "Retry charges",
      recipe: CodeFixTaskType.CodeRequest,
      state: CodeTaskState.Done,
      isQueued: false,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date(Date.now() - 2 * 3600000).toISOString(),
      origin: { type: CodeTaskOriginType.Request, label: "Ada Lovelace" },
      turnCount: 1,
      pullRequest: { number: 418, state: "open" },
      ...data,
    };
  }

  test("a request: its title, number, who asked, when, its pull request - and opens its conversation", () => {
    draw(
      <ul>
        <CodeTaskRow task={summary({})} />
      </ul>,
    );

    const row: HTMLElement = screen.getByTestId("code-task-row");
    expect(row).toHaveAttribute("data-task-state", "Done");
    expect(row).toHaveTextContent("Retry charges");
    const meta: HTMLElement = within(row).getByTestId("code-task-row-meta");
    expect(meta).toHaveTextContent("#12");
    expect(meta).toHaveTextContent("Asked by Ada Lovelace");
    expect(meta).toHaveTextContent("PR #418");
    expect(hrefOf(within(row).getByRole("link"))).toBe(
      `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`,
    );
    // One badge for a laptop, one leading the meta line on a phone.
    const badges: Array<HTMLElement> =
      within(row).getAllByTestId("code-task-state");
    expect(
      badges.map((badge: HTMLElement) => {
        const classes: Array<string> = badge.className.split(" ");
        return classes.includes("max-sm:hidden")
          ? "laptop"
          : classes.includes("sm:hidden")
            ? "phone"
            : "both";
      }),
    ).toEqual(["phone", "laptop"]);
    // The badge is the state's one mark: no icon column beside the title.
    expect(within(row).getByRole("link").querySelectorAll("svg")).toHaveLength(
      1,
    );

    // The facts read apart: a dot between each, hidden from screen readers.
    const dots: Array<HTMLElement> =
      within(meta).getAllByTestId("code-meta-dot");
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot).toHaveAttribute("aria-hidden", "true");
    }
    expect(meta.textContent).toMatch(
      /^Done#12·Asked by Ada Lovelace·.+·PR #418$/,
    );
  });

  test("a task OneUptime started is named by its record and its kind, said once", () => {
    draw(
      <ul>
        <CodeTaskRow
          task={summary({
            title: "TypeError: x is undefined",
            recipe: CodeFixTaskType.FixException,
            origin: {
              type: CodeTaskOriginType.Exception,
              label: "TypeError: x is undefined",
            },
          })}
        />
      </ul>,
    );

    const meta: HTMLElement = screen.getByTestId("code-task-row-meta");
    expect(meta).toHaveTextContent("Fix Exception");
    expect(meta).not.toHaveTextContent("From an exception");
    expect(meta).not.toHaveTextContent("Asked by");
  });

  test("a task with no title is named by its kind", () => {
    draw(
      <ul>
        <CodeTaskRow
          task={summary({ title: "", recipe: CodeFixTaskType.ImproveLogging })}
        />
      </ul>,
    );
    expect(screen.getByTestId("code-task-row")).toHaveTextContent(
      "Improve Logging",
    );
  });
});

describe("a repository's card", () => {
  test("what needs someone, then tasks, open pull requests and the last activity - and it opens the repository", () => {
    draw(
      <RepositoryCard
        repository={{
          id: REPOSITORY_ID,
          name: "checkout-api",
          organizationName: "acme",
          repositoryName: "checkout-api-service",
          description: "The checkout API.",
          isConnected: true,
          stats: {
            working: 2,
            waitingForYou: 1,
            openPullRequests: 3,
            taskCount: 7,
            lastActivityAt: new Date(Date.now() - 5 * 60000).toISOString(),
          },
        }}
      />,
    );

    const card: HTMLElement = screen.getByTestId("code-repository-card");
    expect(hrefOf(card)).toBe(
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`,
    );
    expect(within(card).getByRole("heading", { level: 3 })).toHaveTextContent(
      "checkout-api",
    );
    expect(card).toHaveTextContent("acme/checkout-api-service");
    expect(
      within(card).getByTestId("code-repository-working"),
    ).toHaveTextContent("2 working");
    expect(
      within(card).getByTestId("code-repository-waiting"),
    ).toHaveTextContent("1 waiting for you");
    const stats: HTMLElement = within(card).getByTestId(
      "code-repository-stats",
    );
    expect(stats).toHaveTextContent("7 tasks");
    expect(stats).toHaveTextContent("3 open pull requests");
    expect(stats).toHaveTextContent("5 minutes ago");
    // The counts read apart, a dot between them; the time stands on its own.
    expect(within(stats).getAllByTestId("code-meta-dot")).toHaveLength(1);
    expect(stats.textContent).toBe("7 tasks·3 open pull requests5 minutes ago");
    expect(stats.lastElementChild?.tagName).toBe("TIME");
    expect(
      within(card).queryByTestId("code-repository-not-connected"),
    ).toBeNull();
  });

  test("a quiet repository says it has no tasks yet and nothing more; one AI cannot reach says so", () => {
    draw(
      <RepositoryCard
        repository={{
          id: REPOSITORY_ID,
          name: "payments-worker",
          isConnected: false,
          stats: {
            working: 0,
            waitingForYou: 0,
            openPullRequests: 0,
            taskCount: 0,
          },
        }}
      />,
    );

    const card: HTMLElement = screen.getByTestId("code-repository-card");
    expect(within(card).getByTestId("code-repository-stats")).toHaveTextContent(
      /^No tasks yet$/,
    );
    expect(
      within(card).getByTestId("code-repository-not-connected"),
    ).toHaveTextContent("Not connected");
    // The pill sits under the name, never beside it.
    expect(
      within(card).getByRole("heading", { level: 3 }).parentElement,
    ).not.toContainElement(
      within(card).getByTestId("code-repository-not-connected"),
    );
  });
});

describe("what stops AI working", () => {
  test.each([
    [
      CodeTaskBlockerType.AiDisabled,
      "AI is turned off for this project.",
      "Turn AI on",
      "settings/ai-features",
    ],
    [
      CodeTaskBlockerType.NoLlmProvider,
      "AI needs an LLM provider for this project.",
      "Add an LLM provider",
      "settings/llm-providers",
    ],
    [
      CodeTaskBlockerType.NoAgent,
      "No global Runner is online to work in this repository.",
      "Pick a Runner",
      `code/repositories/${REPOSITORY_ID}/settings`,
    ],
    [
      CodeTaskBlockerType.RunnerNotOnline,
      "The Runner this repository picks is not online.",
      "Pick a Runner",
      `code/repositories/${REPOSITORY_ID}/settings`,
    ],
    [
      CodeTaskBlockerType.GlobalRunnersOff,
      "This project does not use global Runners, so this repository needs one of your Runners.",
      "Pick a Runner",
      `code/repositories/${REPOSITORY_ID}/settings`,
    ],
    [
      CodeTaskBlockerType.RepositoryNotConnected,
      "connected through the GitHub App",
      "Connect GitHub",
      "code",
    ],
  ])(
    "%s: its sentence and the link that fixes it",
    (
      type: CodeTaskBlockerType,
      sentence: string,
      fix: string,
      pathEnd: string,
    ) => {
      // A project owner may make every one of these fixes.
      grant([Permission.ProjectUser, Permission.ProjectOwner]);
      draw(
        <CodeBlockerNotice
          blocker={{ type, message: "The server's words." }}
          repositoryId={REPOSITORY_ID}
        />,
      );

      const notice: HTMLElement = screen.getByTestId("code-blocker");
      expect(notice).toHaveAttribute("data-blocker", type);
      expect(notice).toHaveTextContent(sentence);
      const link: HTMLElement = within(notice).getByTestId("code-blocker-fix");
      expect(link).toHaveTextContent(fix);
      expect(hrefOf(link).endsWith(`/${pathEnd}`)).toBe(true);
    },
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The AI switch, LLM providers and Runners are linked only for someone
   * the page they open would let make the fix; everyone else is told who
   * can, and nobody is told anything before their permissions arrive.
   */
  describe("a fix only some may make", () => {
    test.each([
      [
        CodeTaskBlockerType.AiDisabled,
        Permission.ManageProjectBilling,
        "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI → AI Features.",
      ],
      [
        CodeTaskBlockerType.NoLlmProvider,
        Permission.CreateProjectLlm,
        "A project admin can add an LLM provider in Project Settings → AI → LLM Providers.",
      ],
    ])(
      "%s: linked for someone with %s, who can for everyone else",
      (type: CodeTaskBlockerType, allowed: Permission, whoCan: string) => {
        grant([Permission.ProjectUser, allowed]);
        draw(<CodeBlockerNotice blocker={{ type, message: "x" }} />);
        expect(screen.getByTestId("code-blocker-fix")).toBeInTheDocument();
        expect(screen.queryByTestId("code-blocker-who-can")).toBeNull();
        cleanup();
        jest.restoreAllMocks();

        // A role that may edit repositories but not this: told who can.
        grant([Permission.ProjectUser, Permission.EditCodeRepository]);
        draw(<CodeBlockerNotice blocker={{ type, message: "x" }} />);
        expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
        expect(screen.getByTestId("code-blocker-who-can")).toHaveTextContent(
          whoCan,
        );
        cleanup();
        jest.restoreAllMocks();

        // Before the permissions arrive: the sentence alone.
        grant(null);
        draw(<CodeBlockerNotice blocker={{ type, message: "x" }} />);
        expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
        expect(screen.queryByTestId("code-blocker-who-can")).toBeNull();
      },
    );

    /*
     * A missing Runner is fixed in the repository's own settings, by whoever
     * may change the repository - which is whoever may ask AI in it, so the
     * people who see this blocker are offered the link.
     */
    test.each([
      CodeTaskBlockerType.NoAgent,
      CodeTaskBlockerType.RunnerNotOnline,
      CodeTaskBlockerType.GlobalRunnersOff,
    ])(
      "%s: linked for whoever may change the repository, who can for anyone else",
      (type: CodeTaskBlockerType) => {
        grant([Permission.ProjectUser, Permission.EditCodeRepository]);
        draw(
          <CodeBlockerNotice
            blocker={{ type, message: "x" }}
            repositoryId={REPOSITORY_ID}
          />,
        );
        expect(screen.getByTestId("code-blocker-fix")).toBeInTheDocument();
        expect(screen.queryByTestId("code-blocker-who-can")).toBeNull();
        cleanup();
        jest.restoreAllMocks();

        grant([Permission.ProjectUser, Permission.ReadCodeRepository]);
        draw(
          <CodeBlockerNotice
            blocker={{ type, message: "x" }}
            repositoryId={REPOSITORY_ID}
          />,
        );
        expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
        expect(screen.getByTestId("code-blocker-who-can")).toHaveTextContent(
          "A project admin can pick this repository's Runner in its settings.",
        );
        cleanup();
        jest.restoreAllMocks();

        grant(null);
        draw(
          <CodeBlockerNotice
            blocker={{ type, message: "x" }}
            repositoryId={REPOSITORY_ID}
          />,
        );
        expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
        expect(screen.queryByTestId("code-blocker-who-can")).toBeNull();
      },
    );

    test("a project member who may ask AI but not turn it on is told who can", () => {
      grant([Permission.ProjectUser, Permission.ProjectMember]);
      draw(
        <CodeBlockerNotice
          blocker={{ type: CodeTaskBlockerType.AiDisabled, message: "x" }}
        />,
      );
      expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
      expect(screen.getByTestId("code-blocker-who-can")).toHaveTextContent(
        "Manage Billing",
      );
    });

    test("the plan, the bill and a disconnected repository are linked for everyone", () => {
      for (const type of [
        CodeTaskBlockerType.PlanRequired,
        CodeTaskBlockerType.SubscriptionUnpaid,
        CodeTaskBlockerType.RepositoryNotConnected,
      ]) {
        grant(null);
        draw(<CodeBlockerNotice blocker={{ type, message: "x" }} />);
        expect(screen.getByTestId("code-blocker-fix")).toBeInTheDocument();
        cleanup();
        jest.restoreAllMocks();
      }
    });
  });

  /*
   * AI credits are added by a project owner or someone with Manage Billing:
   * only they are sent to AI Credits, everyone else is told who can, and
   * nobody is told anything before their permissions have arrived.
   */
  describe("out of AI credits", () => {
    test.each([
      [Permission.ProjectOwner, true],
      [Permission.ManageProjectBilling, true],
      [Permission.ProjectAdmin, false],
      [Permission.ProjectMember, false],
    ])(
      "%s is linked to AI Credits only when they may add them (%s)",
      (permission: Permission, offered: boolean) => {
        grant([Permission.ProjectUser, permission]);
        draw(
          <CodeBlockerNotice
            blocker={{
              type: CodeTaskBlockerType.NoAiCredits,
              message: "The server's words.",
            }}
          />,
        );

        const notice: HTMLElement = screen.getByTestId("code-blocker");
        expect(notice).toHaveTextContent(
          "This project's AI credits are used up.",
        );

        if (offered) {
          const link: HTMLElement =
            within(notice).getByTestId("code-blocker-fix");
          expect(link).toHaveTextContent("Add AI credits");
          expect(hrefOf(link).endsWith("/settings/ai-credits")).toBe(true);
          expect(
            within(notice).queryByTestId("code-blocker-who-can"),
          ).toBeNull();
        } else {
          expect(within(notice).queryByTestId("code-blocker-fix")).toBeNull();
          expect(
            within(notice).getByTestId("code-blocker-who-can"),
          ).toHaveTextContent(
            "A project owner or someone with Manage Billing can add AI credits.",
          );
        }
      },
    );

    test("before the permissions arrive, neither the link nor who can", () => {
      grant(null);
      draw(
        <CodeBlockerNotice
          blocker={{ type: CodeTaskBlockerType.NoAiCredits, message: "x" }}
        />,
      );

      expect(screen.getByTestId("code-blocker")).toHaveTextContent(
        "This project's AI credits are used up.",
      );
      expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
      expect(screen.queryByTestId("code-blocker-who-can")).toBeNull();
    });
  });

  test("a limit that resets is said in the server's own words, with no link", () => {
    draw(
      <CodeBlockerNotice
        blocker={{
          type: CodeTaskBlockerType.DailyLimitReached,
          message:
            "This project used its daily AI token limit of 2,000,000 tokens.",
        }}
      />,
    );
    expect(screen.getByTestId("code-blocker")).toHaveTextContent(
      "This project used its daily AI token limit of 2,000,000 tokens.",
    );
    expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
  });

  test("a reader who may only read is told so quietly, not sent to fix anything", () => {
    draw(
      <CodeBlockerNotice
        blocker={{ type: CodeTaskBlockerType.NoPermission, message: "x" }}
      />,
    );
    const notice: HTMLElement = screen.getByTestId("code-blocker");
    expect(notice).toHaveTextContent("ask a project admin for it");
    expect(notice.className).toContain("bg-gray-50");
    expect(screen.queryByTestId("code-blocker-fix")).toBeNull();
  });
});
