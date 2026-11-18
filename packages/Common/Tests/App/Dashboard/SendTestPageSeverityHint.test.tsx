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
  configure,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHAT THE SEVERITY CHANGES, UNDER ITS PICKER (#7756).
 *
 * "Send me a test page" asked for a Severity, picked for you as "Incident:
 * Critical Incident", and nothing near it said what it changed: a newcomer
 * testing their first page from the website setup left it as it was
 * without knowing whether it mattered. How to Reach Me can reach a person
 * a different way for a severity, so the severity decides how the test
 * reaches them, and one line under the picker says so. Their own test
 * links their How to Reach Me, in a new tab so the dialog stays open;
 * someone else's - a member's, a policy's people - is named only, as a
 * page the reader may not open.
 *
 * The dialog is the real SendTestPageModal with the shipped Dashboard
 * locales; only the server's answers are stood in for.
 */

configure({ asyncUtilTimeout: 15000 });

const previewMock: MockFunction = getJestMockFunction();
let severities: Array<Record<string, string>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi",
  () => {
    return {
      __esModule: true,
      default: {
        preview: (...args: Array<unknown>) => {
          return previewMock(...args);
        },
        send: () => {
          return new Promise(() => {});
        },
        getResult: () => {
          return new Promise(() => {});
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageSeverities",
  () => {
    return {
      __esModule: true,
      loadSeverityOptions: async () => {
        return severities;
      },
      fromSeverityOptionValue: () => {
        return null;
      },
    };
  },
);

import SendTestPageModal, {
  SEVERITY_HINTS,
  SEVERITY_HINT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/SendTestPageModal";
import { OnCallTestPageTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  OnCallTestPageKind,
  OnCallTestPagePreview,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { DASHBOARD_LANGUAGES } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const READ_IN: ReadonlyArray<string> = ["en", "de", "fa", "ar"];

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of READ_IN) {
  LOCALES[language] = readLocale(language);
}

const SEVERITIES: Array<Record<string, string>> = [
  {
    value: "Incident:sev-1",
    recordKind: "Incident",
    severityId: "sev-1",
    severityName: "Critical Incident",
  },
];

const SELF: OnCallTestPageTarget = { kind: "self" };
const MEMBER: OnCallTestPageTarget = {
  kind: "member",
  userId: "7e5b3000-0000-4000-8000-0000000000a1",
  userName: "Ana Lopez",
};
const POLICY: OnCallTestPageTarget = {
  kind: "policy",
  policyId: "7e5b3000-0000-4000-8000-0000000000c1",
  policyName: "Payments primary",
};

const PREVIEW: OnCallTestPagePreview = {
  kind: OnCallTestPageKind.Self,
  people: [
    {
      userId: "7e5b3000-0000-4000-8000-0000000000a2",
      userName: "You",
      methods: [
        {
          channel: OnCallPageChannel.Email,
          address: "you@example.com",
          notifyAfterMinutes: 0,
          isVerified: true,
          canAcknowledge: true,
        },
      ],
      hasNoRule: false,
      isOptedOut: false,
      warnings: [],
      warningCodes: [],
    },
  ],
  notPaged: [],
  notPagedCodes: [],
  cost: {
    isPaid: false,
    smsCount: 0,
    callCount: 0,
    whatsAppCount: 0,
    telegramCount: 0,
  },
};

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

async function openDialog(target: OnCallTestPageTarget): Promise<void> {
  render(
    <MemoryRouter>
      <SendTestPageModal target={target} onClose={() => {}} />
    </MemoryRouter>,
  );

  await screen.findByTestId("test-page-preview");
}

function hint(): string {
  return withoutIsolateMarks(
    screen.getByTestId(SEVERITY_HINT_TEST_ID).textContent || "",
  );
}

const HOW_TO_REACH_ME_ROUTE: string = RouteUtil.populateRouteParams(
  RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES] as Route,
).toString();

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of READ_IN) {
    resources[language] = { translation: LOCALES[language]! };
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
  severities = SEVERITIES;
  previewMock.mockReset();
  previewMock.mockResolvedValue(PREVIEW);
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("what the severity changes, said under its picker (#7756)", () => {
  test("your own test: it reaches you as your How to Reach Me says for this severity", async () => {
    await openDialog(SELF);

    // The regression (#7756): nothing near the picker said what it changes.
    expect(
      withoutIsolateMarks(
        screen.getByTestId("send-test-page-dialog").textContent || "",
      ),
    ).toContain(
      "The test reaches you as your How to Reach Me says for this severity.",
    );
    expect(hint()).toBe(
      "The test reaches you as your How to Reach Me says for this severity.",
    );
  });

  test("your own test links your How to Reach Me, in a new tab, so the dialog stays open", async () => {
    await openDialog(SELF);

    const link: HTMLElement = screen.getByTestId("test-page-how-to-reach-me");

    expect(link.tagName).toBe("A");
    expect(link).toHaveTextContent("How to Reach Me");
    expect(link).toHaveAttribute("href", HOW_TO_REACH_ME_ROUTE);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByTestId("send-test-page-dialog")).toBeInTheDocument();
  });

  test("a member's test: it reaches them as their How to Reach Me says, with no link to a page that is theirs", async () => {
    await openDialog(MEMBER);

    expect(hint()).toBe(
      "The test reaches them as their How to Reach Me says for this severity.",
    );
    expect(screen.queryByTestId("test-page-how-to-reach-me")).toBeNull();
  });

  test("a policy's test: it reaches each person as their How to Reach Me says", async () => {
    await openDialog(POLICY);

    expect(hint()).toBe(
      "The test reaches each person as their How to Reach Me says for this severity.",
    );
    expect(screen.queryByTestId("test-page-how-to-reach-me")).toBeNull();
  });

  test("said right under the picker it is about, before what the test sends", async () => {
    await openDialog(SELF);

    const picker: HTMLElement = screen.getByRole("combobox", {
      name: "Severity",
    });
    const line: HTMLElement = screen.getByTestId(SEVERITY_HINT_TEST_ID);
    const preview: HTMLElement = screen.getByTestId("test-page-preview");

    expect(
      picker.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      line.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // In the picker's own group, with its label.
    expect(line.parentElement).toBe(screen.getByText("Severity").parentElement);
  });

  test("a project with no severity to test says that instead", async () => {
    severities = [];
    render(
      <MemoryRouter>
        <SendTestPageModal target={SELF} onClose={() => {}} />
      </MemoryRouter>,
    );

    await screen.findByText("This project has no severities to test yet.");

    expect(screen.queryByTestId(SEVERITY_HINT_TEST_ID)).toBeNull();
  });

  test.each(["de", "fa", "ar"])(
    "in %s: the line and its link are the reader's",
    async (language: string) => {
      await readIn(language);
      await openDialog(SELF);

      const name: string = LOCALES[language]!["How to Reach Me"]!;

      expect(hint()).toBe(
        LOCALES[language]![SEVERITY_HINTS.self]!.replace(
          "{{howToReachMe}}",
          name,
        ),
      );
      expect(screen.getByTestId("test-page-how-to-reach-me")).toHaveTextContent(
        name,
      );
    },
  );
});

describe("its words, in every Dashboard language", () => {
  test.each([...DASHBOARD_LANGUAGES])("%s words all three", (code: string) => {
    const table: Record<string, string> = readLocale(code);

    for (const english of Object.values(SEVERITY_HINTS)) {
      const worded: string | undefined = table[english];

      expect({
        code,
        english,
        worded: Boolean(worded) && worded !== english,
      }).toEqual({ code, english, worded: true });
    }

    // Your own keeps the slot its link fills.
    expect(table[SEVERITY_HINTS.self]).toContain("{{howToReachMe}}");
  });

  test("English has them, as themselves", () => {
    const english: Record<string, string> = readLocale("en");

    for (const sentence of Object.values(SEVERITY_HINTS)) {
      expect(english[sentence]).toBe(sentence);
    }
  });
});
