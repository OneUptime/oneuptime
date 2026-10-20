import {
  afterEach,
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
} from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The first page someone sees after signing up, when nobody has invited them
 * anywhere, said "No projects - Get started by creating a new project." It
 * never said what a project is, and the sentence was not translated: a German
 * reader got it in English. It now says, in the words the Create Project
 * dialog uses and in every language they are translated into, that a project
 * holds your monitors, incidents, status pages and team.
 *
 * The real page; the invitations list, the server's settings and the user
 * are stubbed, and react-i18next answers from the REAL locale files.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type LocaleData = Record<string, unknown>;

function readLocale(code: string): LocaleData {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as LocaleData;
}

const EN: LocaleData = readLocale("en");
const DE: LocaleData = readLocale("de");

let activeLocale: LocaleData = EN;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          const flat: unknown = activeLocale[key];
          if (typeof flat === "string") {
            return flat;
          }
          if (options && typeof options === "object") {
            return (options as { defaultValue?: string }).defaultValue ?? key;
          }
          return typeof options === "string" ? options : key;
        },
        i18n: {
          language: activeLocale === DE ? "de" : "en",
        },
      };
    },
  };
});

let invitationsWaiting: number = 0;
let projectCreationDisabled: boolean = false;

jest.mock(
  "../../../UI/Components/ProjectInvitations/PendingProjectInvitations",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onInvitationsLoaded: (count: number) => void;
      }): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        ReactActual.useEffect(() => {
          props.onInvitationsLoaded(invitationsWaiting);
        }, []);
        return ReactActual.createElement("div", {
          "data-testid": "pending-invitations",
        });
      },
    };
  },
);

jest.mock("../../../UI/Utils/GlobalConfig", () => {
  return {
    __esModule: true,
    default: {
      fetchVars: () => {
        return Promise.resolve({
          disableUserProjectCreation: projectCreationDisabled,
        });
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import Welcome from "../../../../App/FeatureSet/Dashboard/src/Pages/Onboarding/Welcome";
import Route from "../../../Types/API/Route";

const EXPLANATION: string =
  "A project holds your monitors, incidents, status pages and team.";
const OLD_SENTENCE: string = "Get started by creating a new project.";

const showProjectModalMock: MockFunction = getJestMockFunction();

async function renderWelcome(): Promise<void> {
  await act(async () => {
    render(
      <Welcome
        pageRoute={new Route("/dashboard/welcome")}
        currentProject={null}
        hasPaymentMethod={false}
        onClickShowProjectModal={() => {
          showProjectModalMock();
        }}
      />,
    );
  });
}

function emptyState(): HTMLElement {
  const element: HTMLElement | null = document.getElementById(
    "empty-state-no-projects",
  );
  expect(element).not.toBeNull();
  return element!;
}

beforeEach(() => {
  activeLocale = EN;
  invitationsWaiting = 0;
  projectCreationDisabled = false;
});

afterEach(() => {
  cleanup();
  showProjectModalMock.mockReset();
});

describe("with no project and no invitation", () => {
  test("it says what a project is, under No projects", async () => {
    await renderWelcome();

    expect(emptyState()).toHaveTextContent("No projects");
    expect(emptyState()).toHaveTextContent(EXPLANATION);
  });

  test("the old sentence, which said nothing about projects, is gone", async () => {
    await renderWelcome();

    expect(screen.queryByText(OLD_SENTENCE, { exact: false })).toBeNull();
  });

  test("it speaks as the Create Project dialog does", () => {
    const dialog: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/Header/ProjectPicker.tsx",
      ),
      "utf8",
    );

    expect(dialog).toContain(`description="${EXPLANATION}"`);
  });

  test("Create New Project still opens the dialog", async () => {
    await renderWelcome();

    fireEvent.click(screen.getByTestId("create-new-project-button"));

    expect(showProjectModalMock).toHaveBeenCalledTimes(1);
  });

  test("in German, the whole of it is German", async () => {
    activeLocale = DE;
    await renderWelcome();

    const german: string = String(DE[EXPLANATION]);
    expect(german).toBe(
      "Ein Projekt enthält Ihre Monitore, Vorfälle, Statusseiten und Ihr Team.",
    );
    expect(emptyState()).toHaveTextContent(german);
    expect(emptyState()).toHaveTextContent(String(DE["No projects"]));
    expect(emptyState()).not.toHaveTextContent(EXPLANATION);
  });

  test("every language has its own words for it", () => {
    const codes: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json") && file !== "en.json";
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      });

    expect(codes.length).toBeGreaterThanOrEqual(16);

    for (const code of codes) {
      const translated: unknown = readLocale(code)[EXPLANATION];
      expect({ code, isText: typeof translated === "string" }).toEqual({
        code,
        isText: true,
      });
      expect({ code, sameAsEnglish: translated === EXPLANATION }).toEqual({
        code,
        sameAsEnglish: false,
      });
    }
  });
});

describe("what did not change", () => {
  test("where only admins may create projects, it says to ask to join one", async () => {
    projectCreationDisabled = true;
    await renderWelcome();

    expect(
      document.getElementById("empty-state-project-creation-restricted"),
    ).not.toBeNull();
    expect(document.getElementById("empty-state-no-projects")).toBeNull();
    expect(screen.queryByText(EXPLANATION)).toBeNull();
  });

  test("with an invitation waiting, the invitations lead and no empty state competes", async () => {
    invitationsWaiting = 1;
    await renderWelcome();

    expect(screen.getByTestId("pending-invitations")).toBeInTheDocument();
    expect(document.getElementById("empty-state-no-projects")).toBeNull();
    expect(
      document.getElementById("create-project-alternative"),
    ).not.toBeNull();
  });
});
