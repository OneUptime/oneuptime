import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * SERVER SETUP: WHERE THE ADMIN DASHBOARD LANDS, AND THE TEST SENDS (#6824).
 *
 *   - /admin lands on Server setup while a required check is open on a
 *     self-hosted server; otherwise, on OneUptime Cloud, or when the
 *     checklist cannot be read, on Users, as before;
 *   - the Server setup page reads the checklist, says so while it reads,
 *     and says what to do when it cannot;
 *   - "Send test email", "Send test SMS" and "Make test call" open one
 *     field (the admin's own address to start with), send through the
 *     server's own settings, and answer in words: accepted closes the
 *     dialog and is told to the page; refused or not set up stays in it, in
 *     the provider's words;
 *   - Settings > Emails and Settings > Call and SMS start with a card that
 *     says where the channel stands, in the checklist's words, and holds
 *     the test sends.
 */

jest.setTimeout(60000);

let mockBillingEnabled: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

const mockSendServerTest: Mock<(...args: Array<unknown>) => Promise<unknown>> =
  jest.fn();

jest.mock("../../../UI/Utils/ServerSetupChecklist", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/ServerSetupChecklist",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    sendServerTest: (...args: Array<unknown>): unknown => {
      return mockSendServerTest(...args);
    },
  };
});

interface MockPageProps {
  title?: string | undefined;
  children?: ReactNode | undefined;
}

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return (
        <main data-testid="admin-page" data-title={props.title}>
          {props.children}
        </main>
      );
    },
  };
});

import ServerTestCard, {
  SERVER_TEST_CARD_COPY,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerTestCard";
import ServerTestSendButton, {
  describeServerTestSend,
  getServerTestSendFieldName,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerTestSendButton";
import Init, {
  getInitialPage,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Init/Init";
import SetupPage, {
  SERVER_SETUP_PAGE_LOAD_ERROR,
  SERVER_SETUP_PAGE_TITLE,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Setup/Index";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import Email from "../../../Types/Email";
import { ServerSendingChannel } from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import {
  ServerTestSendAnswer,
  ServerTestSendResult,
} from "../../../Types/ServerSetup/ServerTestSend";
import { createTranslator } from "../../../Types/Translator";
import Navigation from "../../../UI/Utils/Navigation";
import ServerSetupChecklistLoader, {
  UseServerSetupChecklistResult,
} from "../../../UI/Utils/ServerSetupChecklist";
import UserUtil from "../../../UI/Utils/User";

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src/Locales",
);

async function instanceFor(locale: string): Promise<i18n> {
  const read: (name: string) => Record<string, unknown> = (
    name: string,
  ): Record<string, unknown> => {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${name}.json`), "utf8"),
    ) as Record<string, unknown>;
  };
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: read("en") },
      [locale]: { translation: read(locale) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function answerWithOpen(
  openRequired: Array<ServerSetupCheckId>,
): ServerSetupChecklistAnswer {
  return { checks: [], openRequired: openRequired, isHiddenForReader: false };
}

// A checklist whose email is set up and not tested yet.
const UNTESTED: ServerSetupChecklistAnswer =
  ServerSetupChecklistUtil.parseAnswer({
    checks: [
      {
        id: "email",
        status: "untested",
        tests: ["email"],
        sentThrough: "smtp.example.com",
      },
      { id: "https", status: "done" },
      { id: "signups", status: "done" },
      {
        id: "sms-and-calls",
        status: "failing",
        time: "2026-11-10T09:30:00.000Z",
        sentThrough: "Twilio",
        reason: "The number is not SMS-capable.",
        tests: ["sms", "call"],
      },
    ],
  })!;

const ACCEPTED: ServerTestSendAnswer = {
  channel: ServerSendingChannel.Email,
  result: ServerTestSendResult.Accepted,
  to: "ada@example.com",
  sentThrough: "smtp.example.com",
  message: null,
};

beforeEach(() => {
  mockBillingEnabled = false;
  mockSendServerTest.mockReset();
  ServerSetupChecklistLoader.clear();
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  jest
    .spyOn(UserUtil, "getEmail")
    .mockReturnValue(new Email("ada@example.com"));
});

afterEach(() => {
  cleanup();
  ServerSetupChecklistLoader.clear();
  jest.restoreAllMocks();
});

describe("where /admin lands", () => {
  test("Server setup while a required check is open", () => {
    expect(getInitialPage(answerWithOpen([ServerSetupCheckId.Email]))).toBe(
      PageMap.SERVER_SETUP,
    );
  });

  test("Users once nothing required is open, or when the checklist cannot be read", () => {
    expect(getInitialPage(answerWithOpen([]))).toBe(PageMap.USERS);
    expect(getInitialPage(null)).toBe(PageMap.USERS);
  });

  test("Users on OneUptime Cloud, whatever is open", () => {
    mockBillingEnabled = true;

    expect(getInitialPage(answerWithOpen([ServerSetupCheckId.Email]))).toBe(
      PageMap.USERS,
    );
  });

  test("Init reads the checklist and goes there", async () => {
    jest
      .spyOn(ServerSetupChecklistLoader, "load")
      .mockResolvedValue(answerWithOpen([ServerSetupCheckId.Https]));
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    render(<Init />);
    await flush();

    expect(String(navigate.mock.calls[0]![0])).toBe("/admin/setup");
  });

  test("Init on OneUptime Cloud reads nothing and opens Users", async () => {
    mockBillingEnabled = true;
    const load: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ServerSetupChecklistLoader,
      "load",
    );
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    render(<Init />);
    await flush();

    expect(load).not.toHaveBeenCalled();
    expect(String(navigate.mock.calls[0]![0])).toBe("/admin/users");
  });

  test("Init opens Users when the checklist cannot be read", async () => {
    jest.spyOn(ServerSetupChecklistLoader, "load").mockResolvedValue(null);
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    render(<Init />);
    await flush();

    expect(String(navigate.mock.calls[0]![0])).toBe("/admin/users");
  });
});

describe("the Server setup page", () => {
  test("titled Server setup; draws the checklist once it is read", async () => {
    jest.spyOn(ServerSetupChecklistLoader, "load").mockResolvedValue(UNTESTED);

    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>,
    );
    await flush();

    expect(screen.getByTestId("admin-page")).toHaveAttribute(
      "data-title",
      SERVER_SETUP_PAGE_TITLE,
    );
    expect(screen.getByTestId("server-setup-checklist")).toBeVisible();
    expect(screen.getByTestId("server-setup-email")).toBeVisible();
  });

  test("says what to do when it cannot be read", async () => {
    jest.spyOn(ServerSetupChecklistLoader, "load").mockResolvedValue(null);

    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>,
    );
    await flush();

    expect(screen.queryByTestId("server-setup-checklist")).toBeNull();
    expect(screen.getByText(SERVER_SETUP_PAGE_LOAD_ERROR)).toBeVisible();
  });
});

async function openTest(testId: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
  await flush();

  return screen.getByRole("dialog");
}

async function submit(dialog: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
  });
  await flush();
}

describe("a test send", () => {
  test("the email dialog starts with the admin's own address, and the field each channel asks for", async () => {
    expect(getServerTestSendFieldName(ServerSendingChannel.Email)).toBe(
      "toEmail",
    );
    expect(getServerTestSendFieldName(ServerSendingChannel.SMS)).toBe(
      "toPhone",
    );
    expect(getServerTestSendFieldName(ServerSendingChannel.Call)).toBe(
      "toPhone",
    );

    render(<ServerTestSendButton channel={ServerSendingChannel.Email} />);

    expect(screen.getByTestId("server-test-email")).toHaveTextContent(
      "Send test email",
    );

    const dialog: HTMLElement = await openTest("server-test-email");

    expect(within(dialog).getByPlaceholderText("you@company.com")).toHaveValue(
      "ada@example.com",
    );
  });

  test("accepted: sent to that address, the dialog closes, and the page is told", async () => {
    mockSendServerTest.mockResolvedValue(ACCEPTED);
    const onAnswer: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

    render(
      <ServerTestSendButton
        channel={ServerSendingChannel.Email}
        onAnswer={onAnswer as never}
      />,
    );

    await submit(await openTest("server-test-email"));

    expect(mockSendServerTest).toHaveBeenCalledWith({
      channel: ServerSendingChannel.Email,
      to: "ada@example.com",
    });
    expect(onAnswer).toHaveBeenCalledWith(ACCEPTED);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("refused: the dialog stays, in the provider's words, and the page is told too", async () => {
    const refused: ServerTestSendAnswer = {
      ...ACCEPTED,
      result: ServerTestSendResult.Refused,
      message: "535 5.7.8 Username and Password not accepted",
    };
    mockSendServerTest.mockResolvedValue(refused);
    const onAnswer: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

    render(
      <ServerTestSendButton
        channel={ServerSendingChannel.Email}
        onAnswer={onAnswer as never}
      />,
    );

    const dialog: HTMLElement = await openTest("server-test-email");
    await submit(dialog);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "smtp.example.com refused it: 535 5.7.8 Username and Password not accepted",
    );
    expect(onAnswer).toHaveBeenCalledWith(refused);
  });

  test("not set up: nothing was sent, and what is missing", async () => {
    mockSendServerTest.mockResolvedValue({
      ...ACCEPTED,
      channel: ServerSendingChannel.SMS,
      to: "+14155550100",
      result: ServerTestSendResult.NotSetUp,
      message: "No Twilio account or SMS gateway is set up.",
    });

    render(<ServerTestSendButton channel={ServerSendingChannel.SMS} />);

    const dialog: HTMLElement = await openTest("server-test-sms");

    fireEvent.change(within(dialog).getByPlaceholderText("+14155550100"), {
      target: { value: "+14155550100" },
    });
    await flush();
    await submit(dialog);

    expect(mockSendServerTest).toHaveBeenCalledWith({
      channel: ServerSendingChannel.SMS,
      to: "+14155550100",
    });
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Nothing was sent: No Twilio account or SMS gateway is set up.",
    );
  });

  test("a request that fails says why, in the dialog", async () => {
    mockSendServerTest.mockRejectedValue(new Error("Network unreachable"));

    render(<ServerTestSendButton channel={ServerSendingChannel.Email} />);

    const dialog: HTMLElement = await openTest("server-test-email");
    await submit(dialog);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("dialog").textContent).not.toBe("");
  });

  test("the answer reads in the reader's language", () => {
    const de: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
    ) as Record<string, string>;
    const german: ReturnType<typeof createTranslator> = createTranslator(
      (text: string): string | undefined => {
        return de[text];
      },
      "de",
    );

    expect(describeServerTestSend(german, ACCEPTED)).toContain(
      "smtp.example.com",
    );
    expect(describeServerTestSend(german, ACCEPTED)).toContain("Test-E-Mail");
  });

  /*
   * Issue #6605: in an Arabic or Persian sentence the number a test SMS or
   * call went to read 14155550100+ - a number has no letter to say which
   * way it reads, so it took the sentence's. It is set apart in an isolate
   * that reads left to right (LRI ... PDI: phoneNumberInLine); an email
   * address, and every English answer, read as they always did.
   */
  describe("the number a test went to, on a page read right to left", () => {
    const LRI: string = String.fromCharCode(0x2066);
    const PDI: string = String.fromCharCode(0x2069);
    const NUMBER: string = "+14155550100";

    function translatorFor(
      language: string,
    ): ReturnType<typeof createTranslator> {
      const words: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
      ) as Record<string, string>;

      return createTranslator((text: string): string | undefined => {
        return words[text];
      }, language);
    }

    test.each([
      ["ar", ServerSendingChannel.SMS],
      ["ar", ServerSendingChannel.Call],
      ["fa", ServerSendingChannel.SMS],
      ["fa", ServerSendingChannel.Call],
    ])(
      "in %s, a test %s names its number set apart, reading left to right",
      (language: string, channel: ServerSendingChannel) => {
        const sentence: string = describeServerTestSend(
          translatorFor(language),
          {
            channel: channel,
            result: ServerTestSendResult.Accepted,
            to: NUMBER,
            sentThrough: "Twilio",
            message: null,
          },
        );

        expect(sentence).toContain(`${LRI}${NUMBER}${PDI}`);
        expect(sentence.split(LRI)).toHaveLength(2);
        expect(sentence).toContain("Twilio");
      },
    );

    test("an email address is named as it is", () => {
      const sentence: string = describeServerTestSend(
        translatorFor("ar"),
        ACCEPTED,
      );

      expect(sentence).toContain("ada@example.com");
      expect(sentence).not.toContain(LRI);
    });

    test("in English a test SMS names its number as it always did", () => {
      const sentence: string = describeServerTestSend(translatorFor("en"), {
        channel: ServerSendingChannel.SMS,
        result: ServerTestSendResult.Accepted,
        to: NUMBER,
        sentThrough: "Twilio",
        message: null,
      });

      expect(sentence).toBe(`Twilio accepted the test SMS to ${NUMBER}.`);
    });

    test("an answer with no number sets nothing apart", () => {
      const sentence: string = describeServerTestSend(translatorFor("ar"), {
        channel: ServerSendingChannel.SMS,
        result: ServerTestSendResult.NotSetUp,
        to: "",
        sentThrough: null,
        message: "No Twilio account or SMS gateway is set up.",
      });

      expect(sentence).not.toContain(LRI);
      expect(sentence).toContain("No Twilio account or SMS gateway is set up.");
    });
  });
});

describe("the settings pages' test card", () => {
  function checklistOf(
    answer: ServerSetupChecklistAnswer | null,
  ): UseServerSetupChecklistResult & { reload: jest.Mock } {
    return {
      answer: answer,
      isLoading: false,
      reload: jest.fn(async () => {}) as never,
      setAnswer: jest.fn() as never,
    };
  }

  test("says where email stands, in the checklist's words, and holds its test", async () => {
    render(
      <MemoryRouter>
        <ServerTestCard
          check={ServerSetupCheckId.Email}
          title={SERVER_TEST_CARD_COPY.emailTitle}
          description={SERVER_TEST_CARD_COPY.emailDescription}
          channels={[ServerSendingChannel.Email]}
          checklist={checklistOf(UNTESTED)}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Test email")).toBeVisible();
    expect(
      screen.getByTestId("server-test-card-email-status"),
    ).toHaveTextContent(
      "Set up, but not tested yet: send a test email to make sure it arrives.",
    );
    expect(screen.getByTestId("server-test-email")).toBeVisible();
  });

  test("SMS and calls: failing since when, what Twilio said, and both tests", async () => {
    render(
      <MemoryRouter>
        <ServerTestCard
          check={ServerSetupCheckId.SmsAndCalls}
          title={SERVER_TEST_CARD_COPY.callAndSmsTitle}
          description={SERVER_TEST_CARD_COPY.callAndSmsDescription}
          channels={[ServerSendingChannel.SMS, ServerSendingChannel.Call]}
          checklist={checklistOf(UNTESTED)}
        />
      </MemoryRouter>,
    );

    const status: HTMLElement = screen.getByTestId(
      "server-test-card-sms-and-calls-status",
    );

    expect(status).toHaveTextContent(
      "Failing: SMS or calls have not gone out since",
    );
    expect(status).toHaveTextContent(
      "Twilio said: The number is not SMS-capable.",
    );
    expect(screen.getByTestId("server-test-sms")).toHaveTextContent(
      "Send test SMS",
    );
    expect(screen.getByTestId("server-test-call")).toHaveTextContent(
      "Make test call",
    );
  });

  test("an accepted test is said on the card, and the checklist read again", async () => {
    mockSendServerTest.mockResolvedValue(ACCEPTED);
    const checklist: UseServerSetupChecklistResult & { reload: jest.Mock } =
      checklistOf(UNTESTED);

    render(
      <MemoryRouter>
        <ServerTestCard
          check={ServerSetupCheckId.Email}
          title={SERVER_TEST_CARD_COPY.emailTitle}
          description={SERVER_TEST_CARD_COPY.emailDescription}
          channels={[ServerSendingChannel.Email]}
          checklist={checklist}
        />
      </MemoryRouter>,
    );

    await submit(await openTest("server-test-email"));

    expect(
      screen.getByTestId("server-test-card-email-accepted"),
    ).toHaveTextContent(
      "smtp.example.com accepted the test email to ada@example.com.",
    );
    expect(checklist.reload).toHaveBeenCalled();
  });

  test("in German", async () => {
    const instance: i18n = await instanceFor("de");

    render(
      <I18nextProvider i18n={instance}>
        <MemoryRouter>
          <ServerTestCard
            check={ServerSetupCheckId.Email}
            title={instance.t(SERVER_TEST_CARD_COPY.emailTitle)}
            description={instance.t(SERVER_TEST_CARD_COPY.emailDescription)}
            channels={[ServerSendingChannel.Email]}
            checklist={checklistOf(UNTESTED)}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    await flush();

    expect(screen.getByText("Test-E-Mail")).toBeVisible();
    expect(screen.getByTestId("server-test-email")).toHaveTextContent(
      "Test-E-Mail senden",
    );
  });
});

describe("where the cards are drawn", () => {
  test("first on Settings > Emails and Settings > Call and SMS, and read again after a save", () => {
    const read: (page: string) => string = (page: string): string => {
      return fs.readFileSync(
        path.join(
          __dirname,
          `../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/${page}`,
        ),
        "utf8",
      );
    };

    const email: string = read("Email/Index.tsx");
    const callAndSms: string = read("CallSMS/Index.tsx");

    expect(email.indexOf("<ServerTestCard")).toBeGreaterThan(-1);
    expect(email.indexOf("<ServerTestCard")).toBeLessThan(
      email.indexOf("<CardModelDetail"),
    );
    expect(email.match(/onSaveSuccess=\{onSettingsSaved\}/g)?.length).toBe(3);

    expect(callAndSms.indexOf("<ServerTestCard")).toBeGreaterThan(-1);
    expect(callAndSms.indexOf("<ServerTestCard")).toBeLessThan(
      callAndSms.indexOf("<CallAndSmsGatewayCard"),
    );
    expect(callAndSms).toContain(
      "<CallAndSmsGatewayCard onSaveSuccess={onSettingsSaved} />",
    );
  });
});
