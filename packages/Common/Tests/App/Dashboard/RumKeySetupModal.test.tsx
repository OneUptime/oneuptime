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
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import RumKeySetupModal from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumKeySetupModal";
import {
  getIngestionKeyUnusableReason,
  getIngestionKeysUsableFirst,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import type { Mock } from "jest-mock";

/*
 * "Pick another key" (issue #6378): what a RUM application sends is refused
 * because its key is turned off or has expired, so the setup check and the
 * empty charts open a dialog of the steps a new key takes - pick it, put it
 * where the refused one is, deploy - not the application's whole setup
 * guide: it is set up already. The picker lists the keys that can send
 * first, says beside a key's name when it cannot, never picks one of those
 * on its own while another key is there, and says under the token what is
 * wrong with it when the reader picks it anyway.
 */

// Rendered as plain text, as in SetupGuideCard.test.tsx.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const DAY_MS: number = 24 * 60 * 60 * 1000;

function makeKey(data: {
  id: string;
  name: string;
  keyType?: TelemetryIngestionKeyType;
  isEnabled?: boolean;
  expiresAt?: Date;
}): TelemetryIngestionKey {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID(data.id);
  key.name = data.name;
  key.secretKey = new ObjectID(`secret-${data.id}`);
  key.keyType = data.keyType || TelemetryIngestionKeyType.Browser;
  key.allowedOrigins = ["https://shop.example.com"];
  if (data.isEnabled !== undefined) {
    key.isEnabled = data.isEnabled;
  }
  if (data.expiresAt) {
    key.expiresAt = data.expiresAt;
  }
  return key;
}

const OFF_KEY: TelemetryIngestionKey = makeKey({
  id: "key-off",
  name: "Storefront Browser Key",
  isEnabled: false,
});

const EXPIRED_KEY: TelemetryIngestionKey = makeKey({
  id: "key-expired",
  name: "Last Year's Key",
  isEnabled: true,
  expiresAt: new Date(Date.now() - DAY_MS),
});

const GOOD_KEY: TelemetryIngestionKey = makeKey({
  id: "key-good",
  name: "New Storefront Key",
  isEnabled: true,
  expiresAt: new Date(Date.now() + 30 * DAY_MS),
});

const MOBILE_KEY: TelemetryIngestionKey = makeKey({
  id: "key-mobile",
  name: "Mobile Key",
  keyType: TelemetryIngestionKeyType.Server,
  isEnabled: true,
});

type GetList = typeof ModelAPI.getList;

interface ListArguments {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

// Answers with the keys of the requested type, in the order given, as the API does.
function mockKeys(keys: Array<TelemetryIngestionKey>): Mock<GetList> {
  return jest.spyOn(ModelAPI, "getList").mockImplementation(((
    args: ListArguments,
  ): Promise<unknown> => {
    const matching: Array<TelemetryIngestionKey> = keys.filter(
      (key: TelemetryIngestionKey): boolean => {
        return !args.query["keyType"] || key.keyType === args.query["keyType"];
      },
    );
    return Promise.resolve({
      data: matching,
      count: matching.length,
      skip: 0,
      limit: 50,
    });
  }) as never) as unknown as Mock<GetList>;
}

const onClose: Mock<() => void> = jest.fn<() => void>();

function open(
  clientType: string = "browser",
  wrap?: (element: React.ReactElement) => React.ReactElement,
): HTMLElement {
  const modal: React.ReactElement = (
    <RumKeySetupModal clientType={clientType} onClose={onClose} />
  );
  render(wrap ? wrap(modal) : modal);
  return screen.getByTestId("rum-pick-key-setup");
}

// The guide's step titles, without the "Step 1:" a screen reader hears.
function stepTitles(): Array<string> {
  return within(screen.getByTestId("setup-guide-steps"))
    .getAllByRole("heading", { level: 3 })
    .map((heading: HTMLElement): string => {
      return (heading.textContent || "").replace(/^\S+ \d+:\s*/, "");
    });
}

function picker(): HTMLElement {
  return screen.getByRole("combobox", { name: "Select ingestion key" });
}

// The picker's options, as react-select lists them once opened.
async function optionLabels(): Promise<Array<string>> {
  await act(async () => {
    fireEvent.focus(picker());
    fireEvent.keyDown(picker(), { key: "ArrowDown", keyCode: 40 });
  });

  return (await screen.findAllByRole("option")).map(
    (option: HTMLElement): string => {
      return option.textContent || "";
    },
  );
}

async function pick(label: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(picker());
    fireEvent.keyDown(picker(), { key: "ArrowDown", keyCode: 40 });
  });
  const option: HTMLElement = await screen.findByRole("option", {
    name: label,
  });
  await act(async () => {
    fireEvent.click(option);
  });
}

beforeEach(() => {
  onClose.mockReset();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("why a key cannot send", () => {
  const now: Date = new Date("2026-11-09T12:00:00.000Z");

  test("turned off, past its expiry - at the very instant too - or fine", () => {
    expect(
      getIngestionKeyUnusableReason(
        makeKey({ id: "a", name: "a", isEnabled: false }),
        now,
      ),
    ).toBe("turned-off");
    expect(
      getIngestionKeyUnusableReason(
        makeKey({ id: "b", name: "b", expiresAt: new Date(now.getTime() - 1) }),
        now,
      ),
    ).toBe("expired");
    expect(
      getIngestionKeyUnusableReason(
        makeKey({ id: "c", name: "c", expiresAt: now }),
        now,
      ),
    ).toBe("expired");
    expect(
      getIngestionKeyUnusableReason(
        makeKey({ id: "d", name: "d", expiresAt: new Date(now.getTime() + 1) }),
        now,
      ),
    ).toBeNull();
  });

  test("the picker lists the keys that can send first, then the refused ones, each in the order they came", () => {
    const keys: Array<TelemetryIngestionKey> = [
      makeKey({ id: "off", name: "off", isEnabled: false }),
      makeKey({ id: "one", name: "one", isEnabled: true }),
      makeKey({
        id: "old",
        name: "old",
        isEnabled: true,
        expiresAt: new Date(now.getTime() - DAY_MS),
      }),
      makeKey({ id: "two", name: "two" }),
    ];

    expect(
      getIngestionKeysUsableFirst(keys, now).map(
        (key: TelemetryIngestionKey): string | undefined => {
          return key.name;
        },
      ),
    ).toEqual(["one", "two", "off", "old"]);
    // The list it was given stays as it was.
    expect(
      keys.map((key: TelemetryIngestionKey): string | undefined => {
        return key.name;
      }),
    ).toEqual(["off", "one", "old", "two"]);
  });

  test("turned off says so first; a key whose switch or expiry was not read is fine", () => {
    expect(
      getIngestionKeyUnusableReason(
        makeKey({
          id: "e",
          name: "e",
          isEnabled: false,
          expiresAt: new Date(now.getTime() - DAY_MS),
        }),
        now,
      ),
    ).toBe("turned-off");
    expect(
      getIngestionKeyUnusableReason(makeKey({ id: "f", name: "f" }), now),
    ).toBeNull();

    const unreadable: TelemetryIngestionKey = makeKey({ id: "g", name: "g" });
    (unreadable as unknown as { expiresAt: string }).expiresAt = "not a date";
    expect(getIngestionKeyUnusableReason(unreadable, now)).toBeNull();
  });
});

describe("the Pick another key dialog", () => {
  test("the steps a new key takes, not the whole setup guide: pick it, put it in, deploy", async () => {
    mockKeys([GOOD_KEY]);
    const dialog: HTMLElement = open();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Pick another key",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "The key this app sends with is turned off or has expired, so everything sent with it is refused. Put another key in its place.",
    );
    // The line the refused key is on, with the picked key in its place.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("setup-guide-step-2")).getByText(
          /headers: \{ "x-oneuptime-token": "secret-key-good" \},/,
        ),
      ).toBeInTheDocument();
    });

    expect(stepTitles()).toEqual([
      "Choose an ingestion key",
      "Put it in place of the refused key",
      "Deploy and check",
    ]);
    expect(dialog.textContent).toContain(
      "Pick a Browser key that is turned on and allows your site's origin, or create one.",
    );
    expect(dialog.textContent).toContain(
      "Your trace exporter in src/telemetry.ts sends with the refused key.",
    );

    // Nothing of a first setup: no choice of client, no prerequisites, no packages.
    expect(screen.queryByTestId("setup-guide-options")).toBeNull();
    expect(screen.queryByTestId("setup-guide-prerequisites")).toBeNull();
    expect(screen.queryByTestId("setup-guide-advanced")).toBeNull();
    expect(dialog.textContent).not.toContain("npm install");

    expect(
      within(screen.getByTestId("setup-guide-links")).getByRole("link", {
        name: "RUM troubleshooting",
      }),
    ).toHaveAttribute("href", "/docs/rum/troubleshooting#check-the-key");
  });

  test("a browser app: Browser keys only, those that can send listed first, and a good one picked", async () => {
    const getList: Mock<GetList> = mockKeys([
      OFF_KEY,
      EXPIRED_KEY,
      GOOD_KEY,
      MOBILE_KEY,
    ]);
    const dialog: HTMLElement = open();

    await waitFor(() => {
      expect(dialog.textContent).toContain(
        '"x-oneuptime-token": "secret-key-good"',
      );
    });
    expect(
      getList.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as ListArguments).query["keyType"];
      }),
    ).toEqual([TelemetryIngestionKeyType.Browser]);
    // The picker reads what decides it.
    expect((getList.mock.calls[0]![0] as ListArguments).select).toEqual(
      expect.objectContaining({ isEnabled: true, expiresAt: true }),
    );
    expect(dialog.textContent).not.toContain("secret-key-off");
    expect(dialog.textContent).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(screen.queryByTestId("ingestion-key-unusable")).toBeNull();

    expect(await optionLabels()).toEqual([
      "New Storefront Key",
      "Storefront Browser Key (turned off)",
      "Last Year's Key (expired)",
    ]);
  });

  test("a mobile app asks for Server keys, and its line is the exporter's headers setting", async () => {
    const getList: Mock<GetList> = mockKeys([OFF_KEY, MOBILE_KEY]);
    const dialog: HTMLElement = open("mobile");

    // The exporter's headers setting, with the picked key in it.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("setup-guide-step-2")).getByText(
          /OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=secret-key-mobile"/,
        ),
      ).toBeInTheDocument();
    });
    expect(
      getList.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as ListArguments).query["keyType"];
      }),
    ).toEqual([TelemetryIngestionKeyType.Server]);
    expect(dialog).toHaveAttribute("data-client", "mobile");
    expect(stepTitles()).toEqual([
      "Choose an ingestion key",
      "Put it in place of the refused key",
      "Release and check",
    ]);
    expect(dialog.textContent).toContain(
      "Copies already installed keep sending with the refused key until they update.",
    );
  });

  test("an unknown client is a browser app", async () => {
    mockKeys([GOOD_KEY, MOBILE_KEY]);
    const dialog: HTMLElement = open("");

    await waitFor(() => {
      expect(dialog.textContent).toContain("secret-key-good");
    });
    expect(dialog).toHaveAttribute("data-client", "browser");
  });

  test("the refused key picked anyway: the code carries it, and the caution under the token says why it will be refused", async () => {
    mockKeys([OFF_KEY, GOOD_KEY]);
    const dialog: HTMLElement = open();

    await waitFor(() => {
      expect(dialog.textContent).toContain("secret-key-good");
    });
    await pick("Storefront Browser Key (turned off)");

    await waitFor(() => {
      expect(dialog.textContent).toContain(
        '"x-oneuptime-token": "secret-key-off"',
      );
    });
    expect(screen.getByTestId("ingestion-key-unusable")).toHaveTextContent(
      "This key is turned off, so everything sent with it is refused. Pick another key, or turn it back on in Project Settings > Telemetry & APM > Ingestion Keys.",
    );
  });

  test("when the refused key is all there is, it is picked - and the caution says so", async () => {
    mockKeys([EXPIRED_KEY]);
    const dialog: HTMLElement = open();

    await waitFor(() => {
      expect(dialog.textContent).toContain("secret-key-expired");
    });
    expect(screen.getByTestId("ingestion-key-unusable")).toHaveTextContent(
      "This key has expired, so everything sent with it is refused. Pick another key, or change its expiry date in Project Settings > Telemetry & APM > Ingestion Keys.",
    );
  });

  test("Done closes it", async () => {
    mockKeys([GOOD_KEY]);
    open();

    await waitFor(() => {
      expect(screen.getByTestId("rum-pick-key-setup").textContent).toContain(
        "secret-key-good",
      );
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("in the reader's language", () => {
  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const [language, locale] of [
      ["de", germanLocale],
      ["fa", persianLocale],
    ] as Array<[string, Record<string, unknown>]>) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: englishLocale },
          [language]: { translation: locale },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances[language] = instance;
    }
  });

  function openIn(language: string): HTMLElement {
    return open("browser", (element: React.ReactElement) => {
      return (
        <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>
      );
    });
  }

  test("German: the title, the steps, a refused key's label and its caution", async () => {
    mockKeys([OFF_KEY]);
    const dialog: HTMLElement = openIn("de");

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Anderen Schlüssel wählen",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Der Schlüssel, mit dem diese App sendet, ist ausgeschaltet oder abgelaufen",
    );
    await waitFor(() => {
      expect(dialog.textContent).toContain("secret-key-off");
    });
    expect(stepTitles()).toEqual([
      "Aufnahmeschlüssel auswählen",
      "Anstelle des abgelehnten Schlüssels einsetzen",
      "Bereitstellen und prüfen",
    ]);
    expect(screen.getByTestId("ingestion-key-unusable")).toHaveTextContent(
      "Dieser Schlüssel ist ausgeschaltet, daher wird alles abgelehnt, was damit gesendet wird.",
    );
    expect(dialog.textContent).toContain(
      "Storefront Browser Key (ausgeschaltet)",
    );
  });

  test("Persian: the key's Latin name is set apart from its label, and nothing is left in English", async () => {
    mockKeys([EXPIRED_KEY]);
    const dialog: HTMLElement = openIn("fa");

    await waitFor(() => {
      expect(dialog.textContent).toContain("secret-key-expired");
    });
    expect(dialog.textContent).toContain(
      `${FIRST_STRONG_ISOLATE}Last Year's Key${POP_DIRECTIONAL_ISOLATE} (منقضی‌شده)`,
    );
    expect(
      screen.getByTestId("ingestion-key-unusable").textContent,
    ).not.toMatch(/expired/);
    expect(screen.getByTestId("modal-title")).not.toHaveTextContent(
      "Pick another key",
    );

    // The steps' words are Persian; only the code and its names stay as written.
    for (const title of stepTitles()) {
      expect(title).not.toMatch(/[A-Za-z]/);
    }
    for (const id of ["setup-guide-step-1", "setup-guide-step-3"]) {
      expect(
        within(screen.getByTestId(id)).getByRole("heading", { level: 3 })
          .nextElementSibling?.textContent,
      ).not.toMatch(/[A-Za-z]{3,}/);
    }
  });
});
