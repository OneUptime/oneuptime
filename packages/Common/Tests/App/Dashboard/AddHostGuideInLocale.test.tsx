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
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import AddHostGuide, {
  ADD_HOST_WAIT_STEP_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/AddHostGuide";
import { HOST_ADD_PLACEHOLDER_NOTE } from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostCollectorGuide";
import { HOST_CONNECTION_WAITING_TEXT } from "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/HostConnectionWatch";
import { SETUP_GUIDE_API_KEY_PLACEHOLDER } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { HostCollectorOsType } from "../../../Types/HostCollector/HostCollector";
import ObjectID from "../../../Types/ObjectID";

/*
 * Add Host, the way OneUptime adds a host by default, in every language the
 * Dashboard ships: everything the guide draws of its own is looked up - the
 * question, the systems, the Kubernetes line, each step, the key picker's
 * button, the note while no key is picked, the folded sections and their
 * counts - so a reader never meets an English sentence in a German guide.
 * The values come from the shipped locale files, so a sentence a language
 * has not translated yet is expected in English, and one it has, in its own
 * words.
 *
 * And what the guide leaves out: the URL and the token beside the key
 * picker (the command carries them), and the system choice for a host whose
 * system OneUptime knows.
 */

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
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

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

// What the guide draws of its own on its first screen, as en.json keys.
const DRAWN_KEYS: Array<string> = [
  "Add a host",
  "What does the host run?",
  "Ubuntu, Debian, RHEL, Rocky, Amazon Linux and other systemd hosts.",
  "Windows 10, Windows Server 2019 and later.",
  "Apple silicon and Intel Macs.",
  "Kubernetes nodes are monitored by the Kubernetes agent instead.",
  "Set up the Kubernetes agent",
  "Choose an ingestion key",
  "The host sends its data and asks for its config with this key. Pick an existing key or create a new one: the command below updates to use it.",
  "Run this command on the host",
  "As a user who can use sudo. It takes about a minute.",
  "Wait for the host",
  ADD_HOST_WAIT_STEP_DESCRIPTION,
  HOST_CONNECTION_WAITING_TEXT,
  "Advanced",
  "Troubleshooting",
  "Learn more:",
  "Hosts documentation",
];

// The project has no key yet: the note under the command, and Create.
let keys: Array<TelemetryIngestionKey> = [];

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
  });
});

beforeEach(() => {
  keys = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getList").mockImplementation(((data: {
    modelType: unknown;
  }): Promise<unknown> => {
    // The keys for step 1; no host has connected yet for the last step.
    const list: Array<unknown> =
      data.modelType === TelemetryIngestionKey ? keys : [];
    return Promise.resolve({
      data: list,
      count: list.length,
      skip: 0,
      limit: 50,
    });
  }) as never);
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
  props?: React.ComponentProps<typeof AddHostGuide>,
): Promise<HTMLElement> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  const { container } = render(
    <MemoryRouter>
      <AddHostGuide {...(props || {})} />
    </MemoryRouter>,
  );

  // Step 1 has read the project's keys, said in the reader's language too.
  const loading: string = readLocale(language)[
    "Loading ingestion keys..."
  ] as string;
  await waitFor(() => {
    expect(container.textContent).not.toContain(loading);
  });

  return container;
}

describe("Add Host in every language", () => {
  test("ships for every Dashboard language", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test.each(LANGUAGES)(
    "%s: everything the guide draws of its own is looked up",
    async (language: string) => {
      const locale: Record<string, string> = readLocale(language);
      const container: HTMLElement = await renderIn(language);
      const text: string = container.textContent || "";

      for (const key of DRAWN_KEYS) {
        expect({ key, shown: text.includes(locale[key] as string) }).toEqual({
          key,
          shown: true,
        });
      }

      // The command is code: the same in every language.
      expect(text).toContain("curl -fsSL");
      expect(text).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    },
  );

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s: no sentence of the first screen is left in English",
    async (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const locale: Record<string, string> = readLocale(language);

      for (const key of [
        ...DRAWN_KEYS,
        "New Key",
        HOST_ADD_PLACEHOLDER_NOTE,
        "{{count}} topics",
      ]) {
        expect({ key, translated: locale[key] !== english[key] }).toEqual({
          key,
          translated: true,
        });
      }
    },
  );

  test("in German, the folded sections count their topics in German", async () => {
    const container: HTMLElement = await renderIn("de");

    expect(container.textContent).toContain("6 Themen");
    expect(container.textContent).toContain("3 Themen");
  });

  test("while no key is picked, the note under the command says where the key goes, in the reader's language", async () => {
    const container: HTMLElement = await renderIn("de");
    const note: HTMLElement = screen.getByTestId("setup-guide-step-note");

    expect(note).toHaveTextContent(
      readLocale("de")[HOST_ADD_PLACEHOLDER_NOTE] as string,
    );
    expect(note.textContent).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(container.textContent).toContain(
      readLocale("de")["Create Ingestion Key"] as string,
    );
  });
});

describe("what Add Host leaves out", () => {
  test("the URL and the token beside the key: the command carries them", async () => {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key.id = new ObjectID("20000000-0000-4000-8000-000000000001");
    key.name = "Hosts key";
    key.secretKey = new ObjectID("a1b2c3d4-0000-4000-8000-00000000f00d");
    key.keyType = TelemetryIngestionKeyType.Server;
    keys = [key];

    const container: HTMLElement = await renderIn("en");

    await waitFor(() => {
      expect(container.textContent).toContain(
        "--key a1b2c3d4-0000-4000-8000-00000000f00d",
      );
    });
    const step: HTMLElement = screen.getByTestId("setup-guide-step-1");
    expect(step).not.toHaveTextContent("OneUptime URL");
    expect(step).not.toHaveTextContent("Ingestion Token");
    expect(step).not.toHaveTextContent("a1b2c3d4-0000-4000-8000-00000000f00d");
    // A key is picked: no note about the placeholder.
    expect(screen.queryByTestId("setup-guide-step-note")).toBeNull();
  });

  test("Kubernetes as a system: one line says the Kubernetes agent monitors a cluster's nodes, and where to set it up", async () => {
    await renderIn("en");

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByRole("radio", { name: /Kubernetes/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Set up the Kubernetes agent" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID.toString()}/kubernetes/documentation`,
    );
  });

  test.each([
    [HostCollectorOsType.Linux, "sh -s --"],
    [HostCollectorOsType.Windows, "-Key"],
    [HostCollectorOsType.MacOS, "sh -s --"],
  ])(
    "a host whose system is known (%s): its own command, no system to pick and no Kubernetes line",
    async (osType: HostCollectorOsType, inCommand: string) => {
      const container: HTMLElement = await renderIn("en", {
        osType: osType,
        hostId: new ObjectID("30000000-0000-4000-8000-000000000001"),
      });

      expect(screen.queryAllByRole("radio")).toHaveLength(0);
      expect(screen.queryByTestId("add-host-kubernetes-note")).toBeNull();
      expect(container.textContent).toContain(inCommand);
      // The last step waits for this host's new collector.
      expect(container.textContent).toContain(
        "Waiting for the new collector to connect. This step updates by itself.",
      );
      expect(container.textContent).not.toContain(
        ADD_HOST_WAIT_STEP_DESCRIPTION,
      );
    },
  );

  test("a host whose system is not known: the reader picks it", async () => {
    await renderIn("en", {
      osType: null,
      hostId: new ObjectID("30000000-0000-4000-8000-000000000001"),
    });

    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });
});
