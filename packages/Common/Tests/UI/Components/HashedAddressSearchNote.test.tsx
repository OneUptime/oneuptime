import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * ---------------------------------------------------------------------------
 * A SEARCH FOR AN IP ADDRESS SAYS ONCE, ABOVE ITS RESULTS, THAT IT INCLUDES
 * THE RECORDS WHERE THE ADDRESS WAS HASHED (#10418).
 *
 * In a project that hashes IP addresses out of its telemetry, a search for
 * an address also finds the records holding the project's token for it.
 * Those records show the token, not the address, so the results say why
 * they are there - and that records hashed before tokens were keyed (8
 * characters) are not among them, rather than leave a reader to think every
 * record of the address is listed. The note is drawn only when the server
 * said the search matched an address by its token, never while the search
 * could not run, and reads in every language the Dashboard ships.
 * ---------------------------------------------------------------------------
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

getListMock.mockImplementation(() => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
});

postMock.mockImplementation(() => {
  return Promise.resolve({ data: {} });
});

import HashedAddressSearchNote, {
  HASHED_ADDRESS_SEARCH_NOTE,
  HASHED_ADDRESS_SEARCH_NOTE_TEST_ID,
  LEGACY_HASH_TOKEN_EXAMPLE,
  LEGACY_HASH_TOKEN_NOTE,
} from "../../../UI/Components/TelemetryViewer/components/HashedAddressSearchNote";
import LogsViewer, {
  LOGS_VIEWER_MAIN_AREA_TEST_ID,
} from "../../../UI/Components/LogsViewer/LogsViewer";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import TelemetryViewer, {
  TELEMETRY_VIEWER_MAIN_AREA_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/TelemetryViewer";
import TimeRange from "../../../Types/Time/TimeRange";
import { TelemetryLoadErrorKind } from "../../../UI/Utils/Telemetry/TelemetryLoadError";

const LOCALE_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const ONE: string = "Includes records where this address was hashed.";
const LEGACY_IN_ENGLISH: string = `Older records whose token has 8 characters, such as ${LEGACY_HASH_TOKEN_EXAMPLE}, can't be matched to an address.`;

afterEach(() => {
  cleanup();
});

describe("the note", () => {
  test("its words", () => {
    expect(HASHED_ADDRESS_SEARCH_NOTE).toEqual({
      one: ONE,
      other: "Includes records where these {{count}} addresses were hashed.",
    });
    expect(LEGACY_HASH_TOKEN_NOTE).toBe(
      "Older records whose token has 8 characters, such as {{example}}, can't be matched to an address.",
    );
    expect(LEGACY_HASH_TOKEN_EXAMPLE).toMatch(/^\[HASHED:[0-9a-f]{8}\]$/);
  });

  test.each([
    ["no addresses", undefined],
    ["an empty list", []],
  ])("says nothing with %s", (_case: string, addresses: unknown) => {
    render(
      <HashedAddressSearchNote
        addresses={addresses as Array<string> | undefined}
      />,
    );

    expect(
      screen.queryByTestId(HASHED_ADDRESS_SEARCH_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("for one address: that the results include its hashed records, and that old tokens can't be matched", () => {
    render(<HashedAddressSearchNote addresses={["203.0.113.7"]} />);

    const note: HTMLElement = screen.getByRole("note");

    expect(note).toHaveAttribute(
      "data-testid",
      HASHED_ADDRESS_SEARCH_NOTE_TEST_ID,
    );
    expect(note).toHaveTextContent(ONE);
    expect(note).toHaveTextContent(LEGACY_IN_ENGLISH);
    // It names no address: the reader typed it, and a token is never turned back into one.
    expect(note).not.toHaveTextContent("203.0.113.7");
  });

  test("for several: how many", () => {
    render(
      <HashedAddressSearchNote
        addresses={["203.0.113.7", "2001:db8::1", "198.51.100.4"]}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      "Includes records where these 3 addresses were hashed.",
    );
  });
});

const PLACEHOLDER: RegExp = /{{\s*(\w+)\s*}}/g;

const placeholdersOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return (text.match(PLACEHOLDER) || []).sort();
};

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALE_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

// Each key with the English it stands for.
const KEYS: Array<[string, string]> = [
  [HASHED_ADDRESS_SEARCH_NOTE.other, HASHED_ADDRESS_SEARCH_NOTE.other],
  [`${HASHED_ADDRESS_SEARCH_NOTE.other}_one`, HASHED_ADDRESS_SEARCH_NOTE.one],
  [LEGACY_HASH_TOKEN_NOTE, LEGACY_HASH_TOKEN_NOTE],
];

describe("its words in every language the Dashboard ships", () => {
  test("the Dashboard has each in English", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const [key, text] of KEYS) {
      expect([key, english[key]]).toEqual([key, text]);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s has each translated, with its placeholders",
    (language: string) => {
      const locale: Record<string, unknown> = readLocale(language);

      for (const [key, text] of KEYS) {
        const value: unknown = locale[key];

        expect([language, key, typeof value]).toEqual([
          language,
          key,
          "string",
        ]);
        expect([language, key, value === text]).toEqual([language, key, false]);
        expect([language, key, placeholdersOf(value as string)]).toEqual([
          language,
          key,
          placeholdersOf(text),
        ]);
      }
    },
  );
});

describe("drawn in the reader's language", () => {
  const instances: Map<string, i18n> = new Map<string, i18n>();

  beforeAll(async () => {
    for (const language of ["de", "fa"]) {
      const locale: Record<string, unknown> = readLocale(language);
      const translations: Record<string, string> = {};

      for (const [key] of KEYS) {
        translations[key] = locale[key] as string;
      }

      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        resources: { [language]: { translation: translations } },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances.set(language, instance);
    }
  });

  const drawNote: (language: string, addresses: Array<string>) => string = (
    language: string,
    addresses: Array<string>,
  ): string => {
    render(
      <I18nextProvider i18n={instances.get(language)!}>
        <HashedAddressSearchNote addresses={addresses} />
      </I18nextProvider>,
    );

    return screen.getByRole("note").textContent || "";
  };

  test("in German", () => {
    const text: string = drawNote("de", ["203.0.113.7"]);

    expect(text).toContain(
      "Enthält Datensätze, in denen diese Adresse gehasht wurde.",
    );
    expect(text).toContain(LEGACY_HASH_TOKEN_EXAMPLE);
    expect(text).toContain("lassen sich keiner Adresse zuordnen.");
  });

  test("in Persian, with the token as written", () => {
    const text: string = drawNote("fa", ["203.0.113.7", "2001:db8::1"]);

    expect(text).toContain("درهم‌سازی");
    expect(text).toContain(LEGACY_HASH_TOKEN_EXAMPLE);
  });
});

describe("in the logs explorer: once, above the results", () => {
  const renderLogs: (props: {
    hashedAddresses?: Array<string> | undefined;
    listError?: boolean | undefined;
  }) => Promise<void> = async (props: {
    hashedAddresses?: Array<string> | undefined;
    listError?: boolean | undefined;
  }): Promise<void> => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        page={1}
        pageSize={100}
        totalCount={0}
        hasMore={false}
        onPageChange={jest.fn()}
        onPageSizeChange={jest.fn()}
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        hashedAddresses={props.hashedAddresses}
        listError={
          props.listError
            ? {
                kind: TelemetryLoadErrorKind.Failed,
                message: "The search could not run.",
              }
            : undefined
        }
      />,
    );

    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
  };

  test("drawn once, before the list", async () => {
    await renderLogs({ hashedAddresses: ["203.0.113.7"] });

    const notes: Array<HTMLElement> = screen.getAllByTestId(
      HASHED_ADDRESS_SEARCH_NOTE_TEST_ID,
    );

    expect(notes).toHaveLength(1);
    expect(
      notes[0]!.compareDocumentPosition(
        screen.getByTestId(LOGS_VIEWER_MAIN_AREA_TEST_ID),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("not drawn for a search that matched no address by its token", async () => {
    await renderLogs({});

    expect(
      screen.queryByTestId(HASHED_ADDRESS_SEARCH_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("not drawn when the search could not run", async () => {
    await renderLogs({ hashedAddresses: ["203.0.113.7"], listError: true });

    expect(
      screen.queryByTestId(HASHED_ADDRESS_SEARCH_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("in the traces and exceptions explorers: once, above the results", () => {
  interface Item {
    id: string;
  }

  const renderViewer: (props: {
    hashedAddresses?: Array<string> | undefined;
    error?: string | undefined;
  }) => void = (props: {
    hashedAddresses?: Array<string> | undefined;
    error?: string | undefined;
  }): void => {
    render(
      <TelemetryViewer<Item>
        items={[]}
        isLoading={false}
        error={props.error}
        hashedAddresses={props.hashedAddresses}
        renderRow={(item: Item): React.ReactElement => {
          return <span>{item.id}</span>;
        }}
        getRowKey={(item: Item): string => {
          return item.id;
        }}
        searchValue="203.0.113.7"
        onSearchChange={(): void => {}}
        onSearchSubmit={(): void => {}}
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={(): void => {}}
        page={1}
        pageSize={50}
        totalCount={0}
        onPageChange={(): void => {}}
        onPageSizeChange={(): void => {}}
        itemLabel="spans"
      />,
    );
  };

  test("drawn once, before the list", () => {
    renderViewer({ hashedAddresses: ["203.0.113.7", "2001:db8::1"] });

    const notes: Array<HTMLElement> = screen.getAllByTestId(
      HASHED_ADDRESS_SEARCH_NOTE_TEST_ID,
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(
      "Includes records where these 2 addresses were hashed.",
    );
    expect(
      notes[0]!.compareDocumentPosition(
        screen.getByTestId(TELEMETRY_VIEWER_MAIN_AREA_TEST_ID),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("not drawn when the search could not run", () => {
    renderViewer({
      hashedAddresses: ["203.0.113.7"],
      error: "The search could not run.",
    });

    expect(
      screen.queryByTestId(HASHED_ADDRESS_SEARCH_NOTE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
