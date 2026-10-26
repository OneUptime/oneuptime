import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ModelPage from "../../../UI/Components/Page/ModelPage";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";

/*
 * A record's page is headed "<what it is> - <its name>": "Network Device -
 * sw-core-01". The two were glued into one English string before the page
 * drew it, and the translation layer could only look that string up whole,
 * so every record page's heading read English in every language - a
 * German reader met "Network Device - sw-core-01" over a German side menu.
 * The heading is put together when drawn now: the page's title in the
 * reader's language (the Dashboard's own locale files, here), the record's
 * name as it was typed.
 */

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

const DEVICE_ID: ObjectID = new ObjectID(
  "85000000-0000-4000-8000-000000000001",
);

function deviceNamed(name: string): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.name = name;
  return device;
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

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function renderDevicePage(data: {
  language: string;
  item: Promise<NetworkDevice | null>;
}): Promise<void> {
  jest.spyOn(ModelAPI, "getItem").mockReturnValue(data.item as never);

  await act(async () => {
    await i18next.changeLanguage(data.language);
  });

  await act(async () => {
    render(
      <ModelPage<NetworkDevice>
        title="Network Device"
        modelType={NetworkDevice}
        modelId={DEVICE_ID}
        modelNameField="name"
      >
        <div data-testid="page-body">Body</div>
      </ModelPage>,
    );
  });
}

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

describe("a record page's heading, in the reader's language", () => {
  test("ships for every Dashboard language", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test.each(LANGUAGES)(
    "%s: the page's title is looked up, the record's name is not",
    async (language: string) => {
      const title: string =
        readLocale(language)["Network Device"] || "Network Device";

      await renderDevicePage({
        language: language,
        item: Promise.resolve(deviceNamed("sw-core-01")),
      });

      expect(heading()).toHaveTextContent(`${title} - sw-core-01`);
    },
  );

  test("in German: Netzwerkgerät - and the device's name", async () => {
    await renderDevicePage({
      language: "de",
      item: Promise.resolve(deviceNamed("sw-core-01")),
    });

    expect(heading().textContent).toBe("Netzwerkgerät - sw-core-01");
  });

  test("in English: as it always read", async () => {
    await renderDevicePage({
      language: "en",
      item: Promise.resolve(deviceNamed("sw-core-01")),
    });

    expect(heading().textContent).toBe("Network Device - sw-core-01");
  });

  test("a record named like an interface word keeps its name", async () => {
    await renderDevicePage({
      language: "de",
      item: Promise.resolve(deviceNamed("Monitors")),
    });

    expect(heading().textContent).toBe("Netzwerkgerät - Monitors");
  });

  test("follows the reader to another language without reading the record again", async () => {
    await renderDevicePage({
      language: "en",
      item: Promise.resolve(deviceNamed("sw-core-01")),
    });

    expect(heading().textContent).toBe("Network Device - sw-core-01");

    await act(async () => {
      await i18next.changeLanguage("de");
    });

    expect(heading().textContent).toBe("Netzwerkgerät - sw-core-01");
    expect(ModelAPI.getItem).toHaveBeenCalledTimes(1);
  });

  test("while the record is read, the title alone, in the reader's language", async () => {
    await renderDevicePage({
      language: "de",
      item: new Promise<NetworkDevice | null>(() => {}),
    });

    expect(screen.queryByTestId("page-body")).toBeNull();
    expect(heading().textContent).toBe("Netzwerkgerät");
  });
});
