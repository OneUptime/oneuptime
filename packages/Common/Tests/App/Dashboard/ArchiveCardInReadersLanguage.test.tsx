import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
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

/*
 * THE SETTINGS PAGE'S ARCHIVE CARD, IN THE READER'S LANGUAGE (#7195).
 *
 * The card at the foot of a resource's Settings page built its title out of
 * English ("Archive " + the resource's name) and handed the SLO's sentences
 * and the telemetry sentence to the page as English the page never looked
 * up: on a German or Persian Settings page it read "Archive SLO" over an
 * English paragraph, and its dialog asked in English too. The SLO list's
 * bulk Archive asked "Archive 3 SLOs?" in English over its sentence.
 *
 * Rendered here with the Dashboard's shipped locale files: the card for an
 * SLO (with the SLO's own sentences) and for a service (with the telemetry
 * ones), live and archived, and the SLO list's bulk dialogs - in German and
 * Persian, and in English word for word as before.
 */

interface ArchiveState {
  isArchived: boolean;
}

const getItemMock: Mock<(args: unknown) => Promise<ArchiveState | null>> =
  jest.fn<(args: unknown) => Promise<ArchiveState | null>>();
const updateByIdMock: Mock<(args: unknown) => Promise<void>> =
  jest.fn<(args: unknown) => Promise<void>>();

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
      updateById: (args: unknown): Promise<void> => {
        return updateByIdMock(args);
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      create: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (): void => {
        return undefined;
      },
      // The project the SLO list's label and owner actions read: none.
      getFirstParam: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
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

import ArchiveResourceCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard";
import {
  SLO_ARCHIVE_CARD_DESCRIPTION,
  SLO_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
  SLO_UNARCHIVE_CARD_DESCRIPTION,
  SLO_UNARCHIVE_CONFIRM_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloArchiveCopy";
import {
  ARCHIVE_CARD_TITLE,
  TELEMETRY_ARCHIVE_CARD_DESCRIPTION,
  TELEMETRY_ARCHIVE_CONFIRM_MESSAGE,
  TELEMETRY_UNARCHIVE_CARD_DESCRIPTION,
  UNARCHIVE_CARD_TITLE,
  UNARCHIVE_CONFIRM_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Archive/ArchiveCardWords";
import useSloBulkActions, {
  SloBulkActionsResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/useSloBulkActions";
import ConfirmModal from "../../../UI/Components/Modal/ConfirmModal";
import { BulkActionButtonSchema } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const DE: Record<string, string> = readDashboardLocale("de");
const FA: Record<string, string> = readDashboardLocale("fa");

const LOCALES: Record<string, Record<string, string>> = { de: DE, fa: FA };

interface CardCase {
  name: string;
  modelType: { new (): BaseModel };
  singularName: string;
  // The props the Settings page passes; none for a telemetry resource.
  copy: {
    archiveCardDescription?: string;
    unarchiveCardDescription?: string;
    archiveConfirmMessage?: string;
    unarchiveConfirmMessage?: string;
  };
  // The English keys the card says, live and archived.
  liveDescription: string;
  archivedDescription: string;
  archiveConfirm: string;
  unarchiveConfirm: string;
}

const SLO_CASE: CardCase = {
  name: "SLO",
  modelType: ServiceLevelObjective,
  singularName: "SLO",
  copy: {
    archiveCardDescription: SLO_ARCHIVE_CARD_DESCRIPTION,
    unarchiveCardDescription: SLO_UNARCHIVE_CARD_DESCRIPTION,
    archiveConfirmMessage: SLO_ARCHIVE_CONFIRM_MESSAGE,
    unarchiveConfirmMessage: SLO_UNARCHIVE_CONFIRM_MESSAGE,
  },
  liveDescription: SLO_ARCHIVE_CARD_DESCRIPTION,
  archivedDescription: SLO_UNARCHIVE_CARD_DESCRIPTION,
  archiveConfirm: SLO_ARCHIVE_CONFIRM_MESSAGE,
  unarchiveConfirm: SLO_UNARCHIVE_CONFIRM_MESSAGE,
};

const SERVICE_CASE: CardCase = {
  name: "service",
  modelType: Service,
  singularName: "service",
  copy: {},
  liveDescription: TELEMETRY_ARCHIVE_CARD_DESCRIPTION,
  archivedDescription: TELEMETRY_UNARCHIVE_CARD_DESCRIPTION,
  archiveConfirm: TELEMETRY_ARCHIVE_CONFIRM_MESSAGE,
  unarchiveConfirm: UNARCHIVE_CONFIRM_MESSAGE,
};

/*
 * A locale's wording of `key`, its {{placeholders}} filled. Fails, naming
 * the key, when the file has no wording of its own for it.
 */
function worded(
  language: string,
  key: string,
  values: Record<string, string> = {},
): string {
  const words: Record<string, string> = LOCALES[language]!;
  let text: string | undefined = words[key];

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

/*
 * A resource's name as a locale words it: "Dienst" for "service", "SLO" for
 * "SLO" (kept as written in every language).
 */
function nameIn(language: string, singularName: string): string {
  return LOCALES[language]![singularName] || singularName;
}

function readText(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

async function renderCard(
  cardCase: CardCase,
  isArchived: boolean,
): Promise<void> {
  getItemMock.mockResolvedValue({ isArchived: isArchived });

  render(
    <ArchiveResourceCard
      modelType={cardCase.modelType}
      modelId={new ObjectID("77777777-0000-4000-8000-000000007195")}
      singularName={cardCase.singularName}
      {...cardCase.copy}
    />,
  );

  await waitFor(() => {
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });
}

interface DrawnCard {
  title: string;
  description: string;
  button: string;
  dialogTitle: string;
  dialogBody: string;
  dialogSubmit: string;
}

// The card as drawn, then its dialog as the card's one button opens it.
function readCard(): DrawnCard {
  const button: HTMLElement = within(
    screen.getByTestId("card-header-actions"),
  ).getByRole("button");
  const card: Omit<DrawnCard, "dialogTitle" | "dialogBody" | "dialogSubmit"> = {
    title: readText(screen.getByTestId("card-details-heading")),
    description: readText(screen.getByTestId("card-description")),
    button: readText(button),
  };

  fireEvent.click(button);

  const dialog: HTMLElement = screen.getByRole("dialog");

  return {
    ...card,
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
      de: { translation: DE },
      fa: { translation: FA },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  permissionsForTest = [Permission.ProjectAdmin];
  getItemMock.mockReset();
  updateByIdMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("the Archive card in English, word for word as before", () => {
  beforeAll(async () => {
    await inLanguage("en");
  });

  test("an SLO's card says the SLO's sentences, live and archived", async () => {
    await renderCard(SLO_CASE, false);
    expect(readCard()).toEqual({
      title: "Archive SLO",
      description: SLO_ARCHIVE_CARD_DESCRIPTION,
      button: "Archive",
      dialogTitle: "Archive SLO",
      dialogBody: SLO_ARCHIVE_CONFIRM_MESSAGE,
      dialogSubmit: "Archive",
    });
    cleanup();

    await renderCard(SLO_CASE, true);
    expect(readCard()).toEqual({
      title: "Unarchive SLO",
      description: SLO_UNARCHIVE_CARD_DESCRIPTION,
      button: "Unarchive",
      dialogTitle: "Unarchive SLO",
      dialogBody: SLO_UNARCHIVE_CONFIRM_MESSAGE,
      dialogSubmit: "Unarchive",
    });
  });

  test("a service's card says the telemetry sentences, live and archived", async () => {
    await renderCard(SERVICE_CASE, false);
    expect(readCard()).toEqual({
      title: "Archive service",
      description:
        "Archive this service to hide it from lists while it keeps collecting telemetry. You can unarchive it anytime.",
      button: "Archive",
      dialogTitle: "Archive service",
      dialogBody:
        "Are you sure you want to archive this service? It will be hidden from the list but will keep collecting telemetry.",
      dialogSubmit: "Archive",
    });
    cleanup();

    await renderCard(SERVICE_CASE, true);
    expect(readCard()).toEqual({
      title: "Unarchive service",
      description:
        "This service is archived and hidden from lists. It is still collecting telemetry. Unarchive it to make it visible again.",
      button: "Unarchive",
      dialogTitle: "Unarchive service",
      dialogBody:
        "Are you sure you want to unarchive this service? It will reappear in the main list.",
      dialogSubmit: "Unarchive",
    });
  });
});

describe.each(["de", "fa"])(
  "the Archive card in %s, from the shipped locale",
  (language: string) => {
    beforeAll(async () => {
      await inLanguage(language);
    });

    test.each([SLO_CASE, SERVICE_CASE])(
      "a live $name's card and its dialog",
      async (cardCase: CardCase) => {
        const name: string = nameIn(language, cardCase.singularName);
        const title: string = worded(language, ARCHIVE_CARD_TITLE, {
          itemName: name,
        });

        await renderCard(cardCase, false);
        const drawn: DrawnCard = readCard();

        expect(drawn).toEqual({
          title: title,
          description: worded(language, cardCase.liveDescription, {
            itemName: name,
          }),
          button: worded(language, "Archive"),
          dialogTitle: title,
          dialogBody: worded(language, cardCase.archiveConfirm, {
            itemName: name,
          }),
          dialogSubmit: worded(language, "Archive"),
        });

        // Not a word of the English left in it.
        expect(drawn.title).not.toContain("Archive");
        expect(drawn.description).not.toContain("hidden from");
        expect(drawn.dialogBody).not.toContain("Are you sure");
      },
    );

    test.each([SLO_CASE, SERVICE_CASE])(
      "an archived $name's card and its dialog",
      async (cardCase: CardCase) => {
        const name: string = nameIn(language, cardCase.singularName);
        const title: string = worded(language, UNARCHIVE_CARD_TITLE, {
          itemName: name,
        });

        await renderCard(cardCase, true);
        const drawn: DrawnCard = readCard();

        expect(drawn).toEqual({
          title: title,
          description: worded(language, cardCase.archivedDescription, {
            itemName: name,
          }),
          button: worded(language, "Unarchive"),
          dialogTitle: title,
          dialogBody: worded(language, cardCase.unarchiveConfirm, {
            itemName: name,
          }),
          dialogSubmit: worded(language, "Unarchive"),
        });

        expect(drawn.title).not.toContain("Unarchive");
        expect(drawn.description).not.toContain("archived");
        expect(drawn.dialogBody).not.toContain("Are you sure");
      },
    );
  },
);

describe("the German card, as a German reader reads it", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  // Pinned as written, so the test above cannot pass on a wording it made up.
  test("a live service's card", async () => {
    await renderCard(SERVICE_CASE, false);
    const drawn: DrawnCard = readCard();

    expect(drawn.title).toBe("Dienst archivieren");
    expect(drawn.description).toBe(
      "Archivieren Sie diesen Eintrag (Dienst), um ihn aus Listen auszublenden, während er weiterhin Telemetriedaten sammelt. Sie können ihn jederzeit aus dem Archiv holen.",
    );
  });

  test("an archived SLO's card", async () => {
    await renderCard(SLO_CASE, true);
    const drawn: DrawnCard = readCard();

    expect(drawn.title).toBe("SLO aus dem Archiv holen");
    expect(drawn.description).toMatch(/^Dieses SLO ist archiviert: /);
  });
});

describe("the Persian card, as a Persian reader reads it", () => {
  beforeAll(async () => {
    await inLanguage("fa");
  });

  test("a live service's card names it after a word of the sentence's own", async () => {
    await renderCard(SERVICE_CASE, false);
    const drawn: DrawnCard = readCard();

    expect(drawn.title).toBe("بایگانی سرویس");
    expect(drawn.description).toMatch(/^این مورد \(سرویس\) را بایگانی کنید/);
    expect(drawn.dialogBody).toMatch(
      /^مطمئنید می‌خواهید این مورد \(سرویس\) را بایگانی کنید؟/,
    );
  });

  test("an archived SLO's card", async () => {
    await renderCard(SLO_CASE, true);
    const drawn: DrawnCard = readCard();

    expect(drawn.title).toBe("خروج SLO از بایگانی");
    expect(drawn.description).toMatch(/^این SLO بایگانی شده است: /);
  });
});

type SloAction = BulkActionButtonSchema<ServiceLevelObjective>;

function slos(count: number): Array<ServiceLevelObjective> {
  const items: Array<ServiceLevelObjective> = [];

  for (let index: number = 0; index < count; index++) {
    items.push(new ServiceLevelObjective(ObjectID.generate()));
  }

  return items;
}

function onlyAction(actions: Array<SloAction>): SloAction {
  expect(actions).toHaveLength(1);
  return actions[0]!;
}

/*
 * The dialog the SLO list's bulk action opens, as BulkUpdateForm draws it:
 * its title from confirmTitle, its body from confirmMessage, its button the
 * action's title.
 */
function readBulkDialog(
  action: SloAction,
  items: Array<ServiceLevelObjective>,
): { title: string; body: string; submit: string } {
  render(
    <ConfirmModal
      title={action.confirmTitle!(items)}
      description={action.confirmMessage!(items)}
      submitButtonText={action.title}
      onClose={() => {
        return undefined;
      }}
      onSubmit={() => {
        return undefined;
      }}
    />,
  );

  const dialog: HTMLElement = screen.getByRole("dialog");

  return {
    title: readText(within(dialog).getByTestId("modal-title")),
    body: readText(within(dialog).getByTestId("confirm-modal-description")),
    submit: readText(within(dialog).getByTestId("modal-footer-submit-button")),
  };
}

function renderSloActions(): SloBulkActionsResult {
  return renderHook(() => {
    return useSloBulkActions();
  }).result.current;
}

describe("the SLO list's bulk Archive and Unarchive, in German", () => {
  beforeAll(async () => {
    await inLanguage("de");
  });

  test("Archive asks in German, for several SLOs and for one", () => {
    const archive: SloAction = onlyAction(
      renderSloActions().archiveBulkActions,
    );

    expect(readBulkDialog(archive, slos(3))).toEqual({
      title: "3 SLOs archivieren?",
      body: worded("de", SLO_BULK_ARCHIVE_CONFIRM_MESSAGE),
      submit: "Archivieren",
    });
    cleanup();

    expect(readBulkDialog(archive, slos(1))).toEqual({
      title: "1 SLO archivieren?",
      body: worded("de", SLO_BULK_ARCHIVE_CONFIRM_MESSAGE),
      submit: "Archivieren",
    });
  });

  test("Unarchive asks in German", () => {
    const unarchive: SloAction = onlyAction(
      renderSloActions().unarchiveBulkActions,
    );
    const drawn: { title: string; body: string; submit: string } =
      readBulkDialog(unarchive, slos(2));

    expect(drawn).toEqual({
      title: "2 SLOs aus dem Archiv holen?",
      body: worded("de", SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE),
      submit: worded("de", "Unarchive"),
    });
    expect(drawn.body).toMatch(/^Aus dem Archiv geholte SLOs /);
  });
});

describe("the SLO list's bulk dialogs in English, as before", () => {
  beforeAll(async () => {
    await inLanguage("en");
  });

  test("Archive and Unarchive", () => {
    const result: SloBulkActionsResult = renderSloActions();

    expect(
      readBulkDialog(onlyAction(result.archiveBulkActions), slos(3)),
    ).toEqual({
      title: "Archive 3 SLOs?",
      body: SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
      submit: "Archive",
    });
    cleanup();

    expect(
      readBulkDialog(onlyAction(result.unarchiveBulkActions), slos(1)),
    ).toEqual({
      title: "Unarchive 1 SLO?",
      body: SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
      submit: "Unarchive",
    });
  });
});
