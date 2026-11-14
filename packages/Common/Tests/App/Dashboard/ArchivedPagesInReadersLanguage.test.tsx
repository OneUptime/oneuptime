import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * AN ARCHIVED RESOURCE'S BANNER AND ITS LIST'S ARCHIVED PAGE, IN THE
 * READER'S LANGUAGE (#7386, #7387).
 *
 * The banner across the top of an archived workflow's, monitor's, status
 * page's, dashboard's or on-call policy's pages, and the Archived page each of
 * their lists has, said their title, their sentence and their empty list's
 * message in English on a German or Russian Dashboard. They are rendered
 * here, the pages with their real table, from the Dashboard's shipped locale
 * files - and the banner's button, the card's title and the dialog it opens
 * say one verb for unarchiving.
 */

interface ArchiveState {
  isArchived: boolean;
}

const getItemMock: Mock<(args: unknown) => Promise<ArchiveState | null>> =
  jest.fn<(args: unknown) => Promise<ArchiveState | null>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (args: unknown): Promise<ArchiveState | null> => {
        return getItemMock(args);
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/API/API",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...(actual["default"] as Record<string, unknown>),
      getFriendlyMessage: (): string => {
        return "Request failed";
      },
    },
  };
});

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
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

import ArchivedResourceBanner from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ArchivedResourceBanner";
import {
  DASHBOARD_ARCHIVE_COPY,
  MONITOR_ARCHIVE_COPY,
  ON_CALL_POLICY_ARCHIVE_COPY,
  ResourceArchiveCopy,
  STATUS_PAGE_ARCHIVE_COPY,
  WORKFLOW_ARCHIVE_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ResourceArchiveCopy";
import WorkflowsArchived from "../../../../App/FeatureSet/Dashboard/src/Pages/Workflow/Archived";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LANGUAGES: ReadonlyArray<string> = ["de", "ru"];

const LOCALES: Record<string, Record<string, string>> = {
  de: readDashboardLocale("de"),
  ru: readDashboardLocale("ru"),
};

/*
 * A locale's own wording of `key`, its {{placeholders}} filled. Fails,
 * naming the key, when the file has none.
 */
function worded(
  language: string,
  key: string,
  values: Record<string, string> = {},
): string {
  let text: string | undefined = LOCALES[language]![key];

  expect({ language, key, worded: Boolean(text) && text !== key }).toEqual({
    language,
    key,
    worded: true,
  });

  for (const name of Object.keys(values)) {
    text = text!.split(`{{${name}}}`).join(values[name]!);
  }

  return text!;
}

function readText(element: Element): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

interface BannerCase {
  name: string;
  modelType: { new (): BaseModel };
  copy: ResourceArchiveCopy;
}

const BANNER_CASES: ReadonlyArray<BannerCase> = [
  { name: "workflow", modelType: Workflow, copy: WORKFLOW_ARCHIVE_COPY },
  { name: "monitor", modelType: Monitor, copy: MONITOR_ARCHIVE_COPY },
  {
    name: "status page",
    modelType: StatusPage,
    copy: STATUS_PAGE_ARCHIVE_COPY,
  },
  { name: "dashboard", modelType: Dashboard, copy: DASHBOARD_ARCHIVE_COPY },
  {
    name: "on-call policy",
    modelType: OnCallDutyPolicy,
    copy: ON_CALL_POLICY_ARCHIVE_COPY,
  },
];

interface DrawnBanner {
  title: string;
  body: string;
  button: string;
  dialogTitle: string;
  dialogBody: string;
  dialogSubmit: string;
}

async function renderBanner(bannerCase: BannerCase): Promise<DrawnBanner> {
  getItemMock.mockResolvedValue({ isArchived: true });

  render(
    <ArchivedResourceBanner
      modelType={bannerCase.modelType}
      modelId={new ObjectID("77777777-0000-4000-8000-000000007386")}
      copy={bannerCase.copy}
    />,
  );

  const banner: HTMLElement = await screen.findByTestId(
    "archived-resource-banner",
  );
  const paragraphs: Array<HTMLParagraphElement> = Array.from(
    banner.querySelectorAll("p"),
  );
  const button: HTMLElement = screen.getByTestId(
    "archived-resource-banner-unarchive",
  );
  const drawn: Pick<DrawnBanner, "title" | "body" | "button"> = {
    title: readText(paragraphs[0]!),
    body: readText(paragraphs[1]!),
    button: readText(button),
  };

  fireEvent.click(button);

  const dialog: HTMLElement = screen.getByRole("dialog");

  return {
    ...drawn,
    dialogTitle: readText(within(dialog).getByTestId("modal-title")),
    dialogBody: readText(
      within(dialog).getByTestId("confirm-modal-description"),
    ),
    dialogSubmit: readText(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ),
  };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: LOCALES["de"]! },
      ru: { translation: LOCALES["ru"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("the banner in English, word for word as before", () => {
  beforeAll(async () => {
    await inLanguage("en");
  });

  test("an archived workflow's", async () => {
    expect(await renderBanner(BANNER_CASES[0]!)).toEqual({
      title: "This workflow is archived",
      body: "It does not run from any trigger and is hidden from the Workflows list. Unarchive it to bring it back.",
      button: "Unarchive",
      dialogTitle: "Unarchive workflow",
      dialogBody:
        "Unarchive this workflow? It will reappear in the Workflows list. It runs again only if it is enabled.",
      dialogSubmit: "Unarchive",
    });
  });
});

describe.each(LANGUAGES)(
  "the banner in %s, from the shipped locale",
  (language: string) => {
    beforeAll(async () => {
      await inLanguage(language);
    });

    test.each(BANNER_CASES)(
      "an archived $name's banner and its dialog",
      async (bannerCase: BannerCase) => {
        const name: string = worded(language, bannerCase.copy.singularName);
        const drawn: DrawnBanner = await renderBanner(bannerCase);

        expect(drawn).toEqual({
          title: worded(language, bannerCase.copy.bannerTitle),
          body: worded(language, bannerCase.copy.bannerBody),
          button: worded(language, "Unarchive"),
          dialogTitle: worded(language, "Unarchive {{itemName}}", {
            itemName: name,
          }),
          dialogBody: worded(language, bannerCase.copy.unarchiveConfirmMessage),
          dialogSubmit: worded(language, "Unarchive"),
        });

        // Not a word of the English left in it.
        expect(drawn.title).not.toMatch(/archived/);
        expect(drawn.body).not.toMatch(/Unarchive|hidden/);
      },
    );
  },
);

describe("the German banner, as a German reader reads it", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  // Pinned as written, so the test above cannot pass on a wording it made up.
  test("an archived workflow's: its button, its title and its dialog say one verb", async () => {
    const drawn: DrawnBanner = await renderBanner(BANNER_CASES[0]!);

    expect(drawn).toEqual({
      title: "Dieser Arbeitsablauf ist archiviert",
      body: "Er wird von keinem Auslöser gestartet und ist in der Liste „Arbeitsabläufe“ ausgeblendet. Holen Sie ihn aus dem Archiv, um ihn zurückzubekommen.",
      button: "Aus dem Archiv holen",
      dialogTitle: "Arbeitsablauf aus dem Archiv holen",
      dialogBody:
        "Diesen Arbeitsablauf aus dem Archiv holen? Er erscheint wieder in der Liste „Arbeitsabläufe“. Er wird nur wieder ausgeführt, wenn er aktiviert ist.",
      dialogSubmit: "Aus dem Archiv holen",
    });
  });
});

describe("the Russian banner, as a Russian reader reads it", () => {
  beforeAll(async () => {
    await inLanguage("ru");
  });

  test("an archived status page's", async () => {
    const drawn: DrawnBanner = await renderBanner(BANNER_CASES[2]!);

    expect(drawn.title).toBe("Эта статус-страница архивирована");
    expect(drawn.body).toBe(
      "Она недоступна (посетители видят «Страница не найдена») и ничего не отправляет подписчикам. Извлеките её из архива, чтобы она снова стала доступна.",
    );
    expect(drawn.button).toBe("Извлечь из архива");
    expect(drawn.dialogTitle).toBe("Извлечь из архива: статус-страница");
  });
});

/*
 * The Archived workflows page, with its real table: the card's title and
 * its sentence, the empty list's message, and the column that says what
 * unarchiving will do.
 */
async function renderArchivedWorkflows(): Promise<HTMLElement> {
  const path: string = `/dashboard/${PROJECT_ID}/workflows/archived`;

  goTo(path);

  const { container } = render(
    <MemoryRouter initialEntries={[path]}>
      <WorkflowsArchived
        pageRoute={new Route(path)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("table-empty-state-title");

  return container;
}

/*
 * The empty list's message as the table draws it: its first sentence as the
 * heading, without its stop, and the rest below it - read back as the one
 * sentence it was worded as.
 */
function readEmptyListMessage(): string {
  const title: string = readText(screen.getByTestId("table-empty-state-title"));
  const description: HTMLElement | null = screen.queryByTestId(
    "table-empty-state-description",
  );

  return description ? `${title}. ${readText(description)}` : title;
}

describe.each(LANGUAGES)(
  "the Archived workflows page in %s, from the shipped locale",
  (language: string) => {
    beforeAll(async () => {
      await inLanguage(language);
    });

    test("its card's title and sentence, and its empty list's message", async () => {
      const container: HTMLElement = await renderArchivedWorkflows();
      const text: string = readText(container);

      expect(text).toContain(
        worded(language, WORKFLOW_ARCHIVE_COPY.archivedPageTitle),
      );
      expect(text).toContain(
        worded(language, WORKFLOW_ARCHIVE_COPY.archivedPageDescription),
      );
      expect(readEmptyListMessage()).toBe(
        worded(language, WORKFLOW_ARCHIVE_COPY.noArchivedItemsMessage),
      );
      expect(text).not.toContain("Archived Workflows");
      expect(text).not.toContain("No archived workflows");
      expect(text).not.toContain("Select workflows to unarchive them");
    });
  },
);

describe("the Archived workflows page, as a German reader reads it", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  test("says the list's name in German quotes and the button's verb", async () => {
    const text: string = readText(await renderArchivedWorkflows());

    expect(text).toContain("Archivierte Arbeitsabläufe");
    expect(text).toContain(
      "Wählen Sie Arbeitsabläufe aus, um sie aus dem Archiv zu holen.",
    );
    expect(readEmptyListMessage()).toBe(
      "Keine archivierten Arbeitsabläufe. Um einen zu archivieren, wählen Sie ihn in der Liste „Arbeitsabläufe“ aus und wählen Sie „Archivieren“, oder öffnen Sie seine Seite „Einstellungen“.",
    );
    // The column that says what unarchiving does, in the button's verb.
    expect(text).toContain("Wenn aus dem Archiv geholt");
  });
});
