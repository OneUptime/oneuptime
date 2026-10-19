import "@testing-library/jest-dom";
import {
  afterEach,
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
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Health page's card for visitors who share an address.
 *
 * OneUptime counts a visitor by their address. When several people signed in
 * from one private network address in the last 30 days
 * (GET /admin/health/visitor-addresses), it counts them as one visitor, and
 * only the operator can change what hands it that address. The card:
 *
 *   - shows nothing at all while there is nothing to say: nothing checked,
 *     nothing shared, an error, an answer that is not one;
 *   - lists the shared addresses, how many people each, and how many more
 *     there are;
 *   - names the settings that change it - ENABLE_IPV6=true and
 *     TRUSTED_PROXY_HOPS=2 with Docker Compose,
 *     nginx.service.externalTrafficPolicy: Local with the Helm chart - and
 *     opens the guides that say how;
 *   - reads in every language the Admin Dashboard speaks, with the settings
 *     exactly as written.
 *
 * The admin API is a stand-in; the locale files are the real ones.
 */

const mockGet: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return mockGet(...args);
      },
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof Error ? err.message : String(err);
      },
    },
  };
});

import VisitorAddressesSummary, {
  summarizeVisitorAddresses,
  VISITOR_ADDRESSES_API_ROUTE,
  VISITOR_ADDRESSES_COMPOSE_GUIDE,
  VISITOR_ADDRESSES_COPY,
  VISITOR_ADDRESSES_KUBERNETES_GUIDE,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Health/VisitorAddressesSummary";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import { SHARED_VISITOR_ADDRESS_WINDOW_DAYS } from "../../../Server/Utils/InstanceHealth/SharedVisitorAddresses";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;

// The suffix a locale's "one" form of a plural is kept under.
const ONE_FORM_SUFFIX: RegExp = /_one$/;

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

const answer: (data: JSONObject) => HTTPResponse<JSONObject> = (
  data: JSONObject,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, data, {});
};

const SHARED: JSONObject = {
  checked: true,
  windowDays: 30,
  minimumPeople: 2,
  trustedProxyHops: 1,
  addressCount: 5,
  addresses: [
    {
      address: "172.18.0.1",
      people: 6,
      lastSeenAt: "2026-10-19T08:00:00.000Z",
    },
    {
      address: "10.244.1.1",
      people: 3,
      lastSeenAt: "2026-10-18T08:00:00.000Z",
    },
    {
      address: "fdf9:9ef6:88c2::1",
      people: 2,
      lastSeenAt: "2026-10-17T08:00:00.000Z",
    },
  ],
};

async function renderIn(locale: string): Promise<HTMLElement | null> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <VisitorAddressesSummary />
    </I18nextProvider>,
  );

  await flush();

  return screen.queryByTestId("visitor-addresses");
}

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("summarizeVisitorAddresses", () => {
  test("nothing to say without an answer, without a check, or with nothing shared", () => {
    expect(summarizeVisitorAddresses(null)).toBeNull();
    expect(summarizeVisitorAddresses(undefined)).toBeNull();
    expect(summarizeVisitorAddresses({})).toBeNull();
    expect(
      summarizeVisitorAddresses({ ...SHARED, checked: false }),
    ).toBeNull();
    expect(
      summarizeVisitorAddresses({ ...SHARED, checked: "true" }),
    ).toBeNull();
    expect(
      summarizeVisitorAddresses({ checked: true, addresses: [] }),
    ).toBeNull();
    expect(
      summarizeVisitorAddresses({ checked: true, addresses: "172.18.0.1" }),
    ).toBeNull();
  });

  test("keeps the rows that are an address with people", () => {
    expect(
      summarizeVisitorAddresses({
        checked: true,
        addressCount: 2,
        addresses: [
          { address: " 172.18.0.1 ", people: 4 },
          { address: "", people: 3 },
          { address: 10, people: 3 },
          { address: "10.0.0.1", people: 0 },
          { address: "10.0.0.2", people: "two" },
          null,
          { address: "10.0.0.3", people: "2" },
        ],
      }),
    ).toEqual({
      addresses: [
        { address: "172.18.0.1", people: 4 },
        { address: "10.0.0.3", people: 2 },
      ],
      addressCount: 2,
    });
  });

  test("counts at least the addresses it lists", () => {
    expect(
      summarizeVisitorAddresses({
        checked: true,
        addressCount: 1,
        addresses: [
          { address: "10.0.0.1", people: 2 },
          { address: "10.0.0.2", people: 2 },
        ],
      })?.addressCount,
    ).toBe(2);
    expect(summarizeVisitorAddresses(SHARED)?.addressCount).toBe(5);
  });
});

describe("the card", () => {
  test("asks the visitor addresses route", async () => {
    mockGet.mockResolvedValue(answer(SHARED));

    await renderIn("en");

    expect(mockGet).toHaveBeenCalledTimes(1);

    const url: URL = (mockGet.mock.calls[0]?.[0] as { url: URL }).url;
    const pathname: string = new globalThis.URL(url.toString()).pathname;

    expect(pathname.slice(pathname.indexOf("/admin/health/"))).toBe(
      VISITOR_ADDRESSES_API_ROUTE,
    );
  });

  test.each([
    ["nothing was checked", { ...SHARED, checked: false, addresses: [] }],
    ["nobody shares an address", { ...SHARED, addresses: [], addressCount: 0 }],
    ["the answer is not one", { message: "Unexpected" }],
  ])("shows nothing when %s", async (_label: string, data: JSONObject) => {
    mockGet.mockResolvedValue(answer(data));

    expect(await renderIn("en")).toBeNull();
    expect(screen.queryByText(VISITOR_ADDRESSES_COPY.title)).toBeNull();
  });

  test("shows nothing when the route answers with an error", async () => {
    mockGet.mockResolvedValue(
      new HTTPErrorResponse(422, { message: "Only master admins" }, {}),
    );

    expect(await renderIn("en")).toBeNull();
  });

  test("shows nothing when the request fails", async () => {
    mockGet.mockRejectedValue(new Error("Network Error"));

    expect(await renderIn("en")).toBeNull();
  });

  test("lists each shared address with how many people, and how many more there are", async () => {
    mockGet.mockResolvedValue(answer(SHARED));

    const card: HTMLElement | null = await renderIn("en");

    expect(card).not.toBeNull();
    expect(screen.getByText(VISITOR_ADDRESSES_COPY.title)).toBeInTheDocument();
    expect(
      screen.getByText(VISITOR_ADDRESSES_COPY.description),
    ).toBeInTheDocument();

    const list: HTMLElement = screen.getByTestId("visitor-addresses-list");
    const rows: Array<string> = within(list)
      .getAllByRole("listitem")
      .map((row: HTMLElement): string => {
        return row.textContent || "";
      });

    expect(rows).toEqual([
      "172.18.0.16 people",
      "10.244.1.13 people",
      "fdf9:9ef6:88c2::12 people",
      "2 more",
    ]);
  });

  test("names the settings that change it, exactly as written", async () => {
    mockGet.mockResolvedValue(answer(SHARED));

    const card: HTMLElement = (await renderIn("en")) as HTMLElement;
    const settings: Array<string> = Array.from(
      card.querySelectorAll("code"),
    ).map((element: Element): string => {
      return element.textContent || "";
    });

    expect(settings).toEqual([
      "ENABLE_IPV6=true",
      "TRUSTED_PROXY_HOPS=2",
      "nginx.service.externalTrafficPolicy: Local",
    ]);
    expect(card.textContent).toContain(
      "Docker Compose: set ENABLE_IPV6=true when people come over IPv6, and TRUSTED_PROXY_HOPS=2 behind a proxy of your own on the server.",
    );
    expect(card.textContent).toContain(
      "Kubernetes: set nginx.service.externalTrafficPolicy: Local in the Helm chart's values.",
    );
    expect(card.textContent).toContain(VISITOR_ADDRESSES_COPY.nothingToChange);
  });

  test("opens the Docker Compose and Kubernetes guides", async () => {
    mockGet.mockResolvedValue(answer(SHARED));

    const opened: Array<Array<unknown>> = [];
    jest
      .spyOn(window, "open")
      .mockImplementation((...args: Array<unknown>): null => {
        opened.push(args);
        return null;
      });

    await renderIn("en");

    fireEvent.click(
      screen.getByRole("button", { name: VISITOR_ADDRESSES_COPY.composeGuide }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: VISITOR_ADDRESSES_COPY.kubernetesGuide,
      }),
    );

    expect(opened).toEqual([
      [VISITOR_ADDRESSES_COMPOSE_GUIDE, "_blank"],
      [VISITOR_ADDRESSES_KUBERNETES_GUIDE, "_blank"],
    ]);
    expect(VISITOR_ADDRESSES_COMPOSE_GUIDE).toBe(
      "/docs/installation/docker-compose#visitor-addresses",
    );
    expect(VISITOR_ADDRESSES_KUBERNETES_GUIDE).toBe(
      "https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#visitor-addresses",
    );
  });

  test("its description names the window the server looks back", () => {
    expect(SHARED_VISITOR_ADDRESS_WINDOW_DAYS).toBe(30);
    expect(VISITOR_ADDRESSES_COPY.description).toContain(
      `in the last ${SHARED_VISITOR_ADDRESS_WINDOW_DAYS} days`,
    );
  });
});

// Every sentence the card looks up, by its English key.
const SENTENCES: Array<string> = [
  VISITOR_ADDRESSES_COPY.title,
  VISITOR_ADDRESSES_COPY.description,
  VISITOR_ADDRESSES_COPY.cause,
  VISITOR_ADDRESSES_COPY.compose,
  VISITOR_ADDRESSES_COPY.kubernetes,
  VISITOR_ADDRESSES_COPY.nothingToChange,
  VISITOR_ADDRESSES_COPY.composeGuide,
  VISITOR_ADDRESSES_COPY.kubernetesGuide,
];

const PLURAL_KEYS: Array<string> = [
  VISITOR_ADDRESSES_COPY.people.other,
  `${VISITOR_ADDRESSES_COPY.people.other}_one`,
  VISITOR_ADDRESSES_COPY.more.other,
  `${VISITOR_ADDRESSES_COPY.more.other}_one`,
];

describe("the card in every language", () => {
  test("English has every key, as written", () => {
    const english: Locale = readLocale("en");

    for (const sentence of SENTENCES) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }

    expect(english[`${VISITOR_ADDRESSES_COPY.people.other}_one`]).toBe(
      VISITOR_ADDRESSES_COPY.people.one,
    );
  });

  test.each(OTHER_LOCALES)(
    "%s words every sentence, keeping its placeholders",
    (locale: string) => {
      const entries: Locale = readLocale(locale);

      for (const key of [...SENTENCES, ...PLURAL_KEYS]) {
        const value: unknown = entries[key];

        expect([key, typeof value]).toEqual([key, "string"]);
        expect([key, ((value as string).match(PLACEHOLDER) || []).sort()]).toEqual(
          [
            key,
            (key.replace(ONE_FORM_SUFFIX, "").match(PLACEHOLDER) || []).sort(),
          ],
        );
      }

      for (const sentence of SENTENCES) {
        if (
          sentence === VISITOR_ADDRESSES_COPY.composeGuide ||
          sentence === VISITOR_ADDRESSES_COPY.kubernetesGuide
        ) {
          continue;
        }

        expect([sentence, entries[sentence]]).not.toEqual([
          sentence,
          sentence,
        ]);
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "renders in %s, the settings exactly as written",
    async (locale: string) => {
      mockGet.mockResolvedValue(answer(SHARED));

      const entries: Locale = readLocale(locale);
      const card: HTMLElement = (await renderIn(locale)) as HTMLElement;
      const text: string = card.textContent || "";

      expect(
        screen.getByText(String(entries[VISITOR_ADDRESSES_COPY.title])),
      ).toBeInTheDocument();
      expect(text).toContain(String(entries[VISITOR_ADDRESSES_COPY.cause]));
      expect(text).toContain(
        String(entries[VISITOR_ADDRESSES_COPY.nothingToChange]),
      );
      expect(text).toContain(
        String(entries[VISITOR_ADDRESSES_COPY.compose])
          .replace("{{ipv6}}", "ENABLE_IPV6=true")
          .replace("{{hops}}", "TRUSTED_PROXY_HOPS=2"),
      );
      expect(text).toContain(
        String(entries[VISITOR_ADDRESSES_COPY.kubernetes]).replace(
          "{{setting}}",
          "nginx.service.externalTrafficPolicy: Local",
        ),
      );
      // No English sentence left behind.
      expect(text).not.toContain(VISITOR_ADDRESSES_COPY.cause);
      expect(text).not.toContain(VISITOR_ADDRESSES_COPY.nothingToChange);
    },
  );
});
