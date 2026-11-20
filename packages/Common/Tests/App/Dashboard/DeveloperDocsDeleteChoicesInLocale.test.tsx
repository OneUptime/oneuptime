import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import DeveloperDocsPage from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPage";
import { DEVELOPER_DOCS_DELETE_CHOICE_WORDS } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { getDeveloperDocsResource } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { WorkflowRunAs } from "../../../Types/Workflow/WorkflowRunAs";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo } from "./SideMenuHarness";

/*
 * A CUSTOM ROLE'S DELETE IT STEP, IN EVERY LANGUAGE THE DASHBOARD SHIPS
 * (#10031). The step's description and its tabs are the page's own words:
 * the description is looked up as the guide is written, the tabs as they
 * are drawn. Read from the shipped locale files, each language draws them
 * in its own words - no English sentence in a German step - and the code
 * under them stays as the API and the CLI take it, in every language.
 */

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("pre", {}, props.text);
    },
  };
});

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ROLE_ID: string = "5a0e0000-0000-4000-8000-0000000000aa";
const USER_ID: string = "0aa1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b";

jest.mock("react-router-dom", () => {
  return {
    __esModule: true,
    useParams: () => {
      return {
        id: "5a0e0000-0000-4000-8000-0000000000aa",
        projectId: "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
      };
    },
  };
});

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const getListMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const ProtocolType: { HTTPS: unknown } = (
    jest.requireActual("../../../Types/API/Protocol") as {
      default: { HTTPS: unknown };
    }
  ).default;
  return {
    __esModule: true,
    ...actual,
    HOST: "oneuptime.acme.com",
    HTTP_PROTOCOL: ProtocolType.HTTPS,
    VERSION: "14.0.11",
  };
});

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(".json", "");
  })
  .sort();

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const WORDS: (typeof DEVELOPER_DOCS_DELETE_CHOICE_WORDS)[string] =
  DEVELOPER_DOCS_DELETE_CHOICE_WORDS["CustomRole"]!;

// The marks a page sets a value or a piece of code apart with.
const ISOLATE_AND_DIRECTION_MARKS: RegExp = /[⁦-⁩‎‏]/g;

function plain(text: string | null | undefined): string {
  return (text || "").replace(ISOLATE_AND_DIRECTION_MARKS, "");
}

function customRole(): CustomRole {
  const item: CustomRole = new CustomRole();
  item._id = ROLE_ID;
  item.name = "Incident Automation";
  return item;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/teams/roles/${ROLE_ID}/developer/api`);
  getItemMock.mockReset();
  getListMock.mockReset();
  getItemMock.mockResolvedValue(customRole());
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 10 });
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(USER_ID));
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function renderIn(
  language: string,
  page: DeveloperDocsPageType,
): Promise<HTMLElement> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  render(
    <DeveloperDocsPage
      pageRoute={new Route("/")}
      currentProject={null}
      hasPaymentMethod={false}
      resource={getDeveloperDocsResource(CustomRole)}
      scope={DeveloperDocsScope.View}
      page={page}
    />,
  );

  const locale: Record<string, string> = readLocale(language);
  const withoutChoices: string = locale[WORDS.withoutChoices]!;

  // The step is drawn once its tab - the plain delete's - is.
  const tab: HTMLElement = await screen.findByRole("tab", {
    name: withoutChoices,
  });

  // The numbered step that holds the tab (a tab's own test id is a step's too).
  const step: HTMLElement | undefined = screen
    .getAllByTestId(/^setup-guide-step-\d+$/)
    .find((candidate: HTMLElement): boolean => {
      return candidate.contains(tab);
    });

  expect(step).toBeDefined();

  return step!;
}

describe.each(LANGUAGES)("in %s", (language: string) => {
  const locale: Record<string, string> = readLocale(language);

  test("the API page's Delete it step says it in the reader's words, and each tab sends the API's body", async () => {
    const step: HTMLElement = await renderIn(
      language,
      DeveloperDocsPageType.Api,
    );

    expect(plain(step.textContent)).toContain(
      locale[WORDS.description]!.replace("{{placeholder}}", "<custom-role-id>"),
    );
    expect(
      within(step)
        .getAllByRole("tab")
        .map((tab: HTMLElement): string => {
          return tab.textContent || "";
        }),
    ).toEqual([
      locale[WORDS.withoutChoices],
      locale[WORDS.ways[WorkflowRunAs.Default]!],
      locale[WORDS.ways[WorkflowRunAs.CustomRole]!],
    ]);

    fireEvent.click(
      within(step).getByRole("tab", {
        name: locale[WORDS.ways[WorkflowRunAs.CustomRole]!]!,
      }),
    );

    // The code is the API's, whatever the language.
    expect(step.textContent).toContain('"workflowsRunAs": "CustomRole"');
    expect(step.textContent).toContain(
      '"workflowsRunAsCustomRoleId": "<custom-role-id>"',
    );
  });

  test("the CLI page's Delete it step says it in the reader's words, and each tab is the CLI's command", async () => {
    const step: HTMLElement = await renderIn(
      language,
      DeveloperDocsPageType.Cli,
    );

    expect(plain(step.textContent)).toContain(
      locale[WORDS.description]!.replace("{{placeholder}}", "<custom-role-id>"),
    );

    fireEvent.click(
      within(step).getByRole("tab", {
        name: locale[WORDS.ways[WorkflowRunAs.Default]!]!,
      }),
    );

    expect(step.textContent).toContain(
      `oneuptime custom-role delete ${ROLE_ID}`,
    );
    expect(step.textContent).toContain("--workflows-run-as Default");
  });
});
