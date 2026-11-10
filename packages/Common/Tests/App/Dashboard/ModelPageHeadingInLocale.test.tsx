import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ModelPage from "../../../UI/Components/Page/ModelPage";
import {
  PAGE_RECORD_TITLE_HEADING_CLASS_NAME,
  PAGE_RECORD_TITLE_NAME_CLASS_NAME,
  PAGE_RECORD_TITLE_TEST_IDS,
  PAGE_RECORD_TITLE_WORDS_CLASS_NAME,
} from "../../../UI/Components/Page/Page";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

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
    expect(LANGUAGES).toHaveLength(18);
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
    // No name yet: the plain heading, nothing set apart.
    expect(screen.queryByTestId(PAGE_RECORD_TITLE_TEST_IDS.name)).toBeNull();
  });
});

/*
 * #6149's review: in a Persian heading, "Cloud Environment - " in Persian
 * and the environment's name were one run of text, and the name's digits
 * and dashes joined the Persian words around them and moved. The name is
 * set apart now (IsolatedText): it reads the way its own letters do, where
 * the heading puts it - on every record page, App Platforms' environment
 * page among them.
 */
describe("a record's name in its heading, set apart", () => {
  function nameInHeading(): HTMLElement {
    return within(heading()).getByTestId(PAGE_RECORD_TITLE_TEST_IDS.name);
  }

  test.each(LANGUAGES)(
    "%s: the name is an isolate of its own, the heading's words unchanged",
    async (language: string) => {
      const title: string =
        readLocale(language)["Network Device"] || "Network Device";

      await renderDevicePage({
        language: language,
        item: Promise.resolve(deviceNamed("sw-core-01")),
      });

      expect(nameInHeading().tagName).toBe("BDI");
      expect(nameInHeading().textContent).toBe("sw-core-01");
      expect(withoutIsolateMarks(heading().textContent || "")).toBe(
        `${title} - sw-core-01`,
      );
      // The whole heading on hover, for a name cut short on one line.
      expect(heading()).toHaveAttribute("title", `${title} - sw-core-01`);
      expect(heading()).toHaveAttribute(
        "data-testid",
        PAGE_RECORD_TITLE_TEST_IDS.heading,
      );
    },
  );

  test("in Persian, a Latin name reads left to right inside the heading read right to left", async () => {
    await renderDevicePage({
      language: "fa",
      item: Promise.resolve(deviceNamed("prod-eu-1 (2)")),
    });

    expect(nameInHeading()).toHaveAttribute("dir", "ltr");
    expect(nameInHeading().textContent).toBe("prod-eu-1 (2)");
    expect(
      heading().textContent?.startsWith(readLocale("fa")["Network Device"]!),
    ).toBe(true);
  });

  test("in Persian, a name of digits alone is set apart too, reading the isolate's own way", async () => {
    await renderDevicePage({
      language: "fa",
      item: Promise.resolve(deviceNamed("8841-2277-4109")),
    });

    // No letter to go by: the bdi's own reading (auto), its digits kept together.
    expect(nameInHeading()).not.toHaveAttribute("dir");
    expect(nameInHeading().textContent).toBe("8841-2277-4109");
  });

  test("a Persian name on an English page reads right to left, its full stop where it was written", async () => {
    await renderDevicePage({
      language: "en",
      item: Promise.resolve(deviceNamed("سوئیچ اصلی.")),
    });

    expect(nameInHeading()).toHaveAttribute("dir", "rtl");
    expect(heading().textContent).toBe("Network Device - سوئیچ اصلی.");
  });

  test("on one line from 640px up, only the name is cut, at its own end", async () => {
    await renderDevicePage({
      language: "de",
      item: Promise.resolve(deviceNamed("sw-core-01")),
    });

    expect(heading().className).toBe(PAGE_RECORD_TITLE_HEADING_CLASS_NAME);
    expect(PAGE_RECORD_TITLE_HEADING_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["sm:flex", "sm:min-w-0", "sm:items-baseline"]),
    );
    // A phone's heading wraps, a long name breaking where it must.
    expect(PAGE_RECORD_TITLE_HEADING_CLASS_NAME).toContain(
      "[overflow-wrap:anywhere]",
    );
    expect(nameInHeading().className).toBe(PAGE_RECORD_TITLE_NAME_CLASS_NAME);
    expect(PAGE_RECORD_TITLE_NAME_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["sm:min-w-0", "sm:truncate"]),
    );

    // The title and its dash keep their width, and the space before the name.
    const words: HTMLElement = heading().firstElementChild as HTMLElement;

    expect(words.textContent).toBe("Netzwerkgerät - ");
    expect(words.className).toBe(PAGE_RECORD_TITLE_WORDS_CLASS_NAME);
    expect(PAGE_RECORD_TITLE_WORDS_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining(["sm:shrink-0", "sm:whitespace-pre"]),
    );
  });
});

describe("App Platforms' environment page", () => {
  const ENVIRONMENT_ID: ObjectID = new ObjectID(
    "86000000-0000-4000-8000-000000000001",
  );

  function environmentNamed(name: string): CloudResource {
    const environment: CloudResource = new CloudResource();
    environment.id = ENVIRONMENT_ID;
    environment.name = name;
    return environment;
  }

  test("is headed by the record heading this sets apart: its title and its name", () => {
    const layout: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Layout.tsx",
      ),
      "utf8",
    );

    expect(layout).toContain("<ModelPage");
    expect(layout).toContain('title="Cloud Environment"');
    expect(layout).toContain('modelNameField="name"');
  });

  test("in Persian, an environment's name keeps its digits in place", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockReturnValue(
        Promise.resolve(
          environmentNamed("AWS ECS · us-east-1 · 123456789012"),
        ) as never,
      );

    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    await act(async () => {
      render(
        <ModelPage<CloudResource>
          title="Cloud Environment"
          modelType={CloudResource}
          modelId={ENVIRONMENT_ID}
          modelNameField="name"
        >
          <div data-testid="page-body">Body</div>
        </ModelPage>,
      );
    });

    const name: HTMLElement = within(heading()).getByTestId(
      PAGE_RECORD_TITLE_TEST_IDS.name,
    );

    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "ltr");
    expect(name.textContent).toBe("AWS ECS · us-east-1 · 123456789012");
    expect(withoutIsolateMarks(heading().textContent || "")).toBe(
      `${readLocale("fa")["Cloud Environment"]} - AWS ECS · us-east-1 · 123456789012`,
    );
  });
});
