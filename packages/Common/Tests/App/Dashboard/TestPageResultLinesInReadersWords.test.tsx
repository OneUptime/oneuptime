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
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * ISSUES #7260 AND #7182: A TEST PAGE'S RESULT, LINE BY LINE, IN THE
 * READER'S WORDS - AND THE SERVER'S OWN WORDS SET APART.
 *
 * A test page's result showed each line as the server wrote it: why an SMS
 * was not sent, why somebody was not paged, how the test ended - in English
 * on a German page, and on an Arabic or Persian page laid out right to
 * left, so ".SMS not sent because phone 15550100+ is not verified" put its
 * full stop first and its "+" after the digits. The server now sends each
 * line it knows as a code with its values (statusMessageCode), and the
 * Dashboard words it from its own locale files. A line with no code - a
 * provider's own error, a result from a server that sends none - is shown
 * as written: in an isolate that reads left to right on a page read right
 * to left (#7182), as it always was on an English one.
 *
 * The view is the real TestPageResultView with the shipped Dashboard
 * locales.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi",
  () => {
    return {
      __esModule: true,
      default: {
        preview: () => {
          return new Promise(() => {});
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

import {
  TestPageResultView,
  getResultSentenceWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/TestPageResult";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import useTranslator from "../../../UI/Utils/UseTranslator";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
  getOnCallNoVerifiedMethodStatusMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallPageLine";
import {
  ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
  ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
  OnCallTestPageDelivery,
  OnCallTestPageDeliveryStatus,
  OnCallTestPageKind,
  OnCallTestPageLine,
  OnCallTestPageLineCode,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
  OnCallTestPageStep,
  OnCallTestPageStepStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  getOnCallTestPageNotVerifiedMessage,
  readOnCallTestPageDeliveryLine,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPageLine";

import {
  DrawnLine,
  drawLine,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "../../../Utils/Project/NotificationChannels";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import { withNumbersKeptWithUnits } from "../../../Types/NoBreakSpaces";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {
  en: readLocale("en"),
  de: readLocale("de"),
  fa: readLocale("fa"),
  ar: readLocale("ar"),
};

// A sentence of `language`'s locale, with its values in.
function worded(
  language: string,
  key: string,
  values: Record<string, string> = {},
): string {
  let sentence: string = LOCALES[language]![key]!;

  expect(sentence).toBeTruthy();

  for (const [name, value] of Object.entries(values)) {
    sentence = sentence.replace(`{{${name}}}`, value);
  }

  return sentence;
}

const SMS_NOT_VERIFIED_KEY: string =
  "This SMS method is not verified, so the test can't use it.";
const CALLS_OFF_KEY: string =
  "Phone calls are off in this project. A Project Owner, a Billing Admin or someone with Manage Billing can turn them on in Project Settings → Notifications → Notification Channels.";
const NOT_A_MEMBER_KEY: string = "{{name}} is not a member of this project.";
const NO_VERIFIED_METHOD_KEY: string =
  "{{name}} has no verified notification method.";
const ENDED_UNANSWERED_KEY: string =
  "Test ended: nobody acknowledged it within {{count}} minutes.";

const SMS_NOT_VERIFIED_ENGLISH: string = getOnCallTestPageNotVerifiedMessage({
  channel: OnCallPageChannel.SMS,
  address: "+15550100",
});
const CALLS_OFF_ENGLISH: string = getProjectNotificationChannelOffMessage(
  ProjectNotificationChannel.Call,
);
const PROVIDER_ERROR: string =
  "Twilio error 21610: Attempt to send to unsubscribed recipient.";
// Why a run failed, in the words of the error that stopped it.
const RUN_ERROR: string =
  "Twilio error 20003: authentication failed while calling +15550100.";

const STARTED_AT: string = "2026-11-12T09:00:00.000Z";

function delivery(
  data: Partial<OnCallTestPageDelivery> & {
    id: string;
    statusMessage: string;
  },
): OnCallTestPageDelivery {
  return {
    channel: OnCallPageChannel.SMS,
    status: OnCallTestPageDeliveryStatus.Failed,
    canAcknowledge: true,
    sentAt: STARTED_AT,
    ...data,
  };
}

// A test of a policy that ended with nobody acknowledging it.
function endedResult(withCodes: boolean): OnCallTestPageResult {
  const ana: OnCallTestPageStep = {
    id: "line-ana",
    userName: "Ana Lopez",
    status: OnCallTestPageStepStatus.Failed,
    statusMessage: "",
    deliveries: [
      delivery({
        id: "sms-not-verified",
        address: "+15550100",
        statusMessage: SMS_NOT_VERIFIED_ENGLISH,
        ...(withCodes
          ? {
              statusMessageCode: {
                code: OnCallTestPageLineCode.MethodNotVerified,
                channel: OnCallPageChannel.SMS,
              },
            }
          : {}),
      }),
      delivery({
        id: "call-off",
        channel: OnCallPageChannel.Call,
        statusMessage: CALLS_OFF_ENGLISH,
        ...(withCodes
          ? {
              statusMessageCode: {
                code: OnCallTestPageLineCode.ChannelOff,
                channel: OnCallPageChannel.Call,
              },
            }
          : {}),
      }),
      // A provider's own words: no code, from any server.
      delivery({ id: "provider-error", statusMessage: PROVIDER_ERROR }),
    ],
  };

  const bob: OnCallTestPageStep = {
    id: "line-bob",
    userName: "Bob Stone",
    status: OnCallTestPageStepStatus.Skipped,
    statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
    ...(withCodes
      ? {
          statusMessageCode: {
            code: OnCallTestPageLineCode.NotProjectMember,
            name: "Bob Stone",
          },
        }
      : {}),
    deliveries: [],
  };

  const cara: OnCallTestPageStep = {
    id: "line-cara",
    userName: "Cara Diaz",
    status: OnCallTestPageStepStatus.Failed,
    statusMessage: getOnCallNoVerifiedMethodStatusMessage("Cara Diaz"),
    ...(withCodes
      ? {
          statusMessageCode: {
            code: OnCallTestPageLineCode.NoVerifiedMethod,
            name: "Cara Diaz",
          },
        }
      : {}),
    deliveries: [],
  };

  return {
    executionLogId: "7e5ae000-0000-4000-8000-000000000003",
    kind: OnCallTestPageKind.Policy,
    policyId: "7e5ae000-0000-4000-8000-000000000002",
    policyName: "Primary",
    recordKind: OnCallTestPageRecordKind.Incident,
    severityName: "Critical",
    walksEscalation: false,
    status: OnCallTestPageStatus.Ended,
    statusMessage: ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
    ...(withCodes
      ? {
          statusMessageCode: {
            code: OnCallTestPageLineCode.EndedUnanswered,
            minutes: ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
          },
        }
      : {}),
    startedAt: STARTED_AT,
    endsAt: "2026-11-12T09:15:00.000Z",
    steps: [ana, bob, cara],
  };
}

// A test that failed: its own line is the error that stopped it, no code.
function failedResult(): OnCallTestPageResult {
  return {
    ...endedResult(false),
    status: OnCallTestPageStatus.Failed,
    statusMessage: RUN_ERROR,
  };
}

async function renderIn(
  language: string,
  result: OnCallTestPageResult,
): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  render(
    <MemoryRouter>
      <TestPageResultView result={result} />
    </MemoryRouter>,
  );
}

// The line under a message, a person, or the result's headline.
function lineOf(element: HTMLElement): HTMLElement {
  const line: HTMLElement | null = element.querySelector("p.break-words");

  expect(line).not.toBeNull();

  return line!;
}

function deliveryLine(index: number): HTMLElement {
  return lineOf(screen.getAllByTestId("test-page-delivery")[index]!);
}

function stepLine(index: number): HTMLElement {
  return lineOf(screen.getAllByTestId("test-page-step")[index]!);
}

function headlineLine(): HTMLElement {
  return lineOf(screen.getByTestId("test-page-result"));
}

// The plain text of a line, the marks a value is set apart with taken out.
function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

/*
 * What a plural's sentence says before and after its count.
 * The words around the count, as the page sets them: the count held to its word (#8770).
 */
function aroundCount(language: string, key: string): [string, string] {
  const [before, after] = withNumbersKeptWithUnits(worded(language, key), key, {
    durationWords: true,
  }).split("{{count}}");

  return [before!, after!];
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of Object.keys(LOCALES)) {
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

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe.each(["en", "de", "fa"])(
  "a %s reader reads each line the server sent a code for in their words (#7260)",
  (language: string) => {
    test("an SMS method that is not verified", async () => {
      await renderIn(language, endedResult(true));

      expect(textOf(deliveryLine(0))).toBe(
        worded(language, SMS_NOT_VERIFIED_KEY),
      );
    });

    test("phone calls switched off in the project, who can turn them on and where", async () => {
      await renderIn(language, endedResult(true));

      expect(textOf(deliveryLine(1))).toBe(worded(language, CALLS_OFF_KEY));
    });

    test("a provider's own error is shown as the provider wrote it", async () => {
      await renderIn(language, endedResult(true));

      expect(textOf(deliveryLine(2))).toBe(PROVIDER_ERROR);
    });

    test("somebody who is not a member, and somebody with no verified method, by name", async () => {
      await renderIn(language, endedResult(true));

      expect(textOf(stepLine(1))).toBe(
        worded(language, NOT_A_MEMBER_KEY, { name: "Bob Stone" }),
      );
      expect(textOf(stepLine(2))).toBe(
        worded(language, NO_VERIFIED_METHOD_KEY, { name: "Cara Diaz" }),
      );
    });

    test("how the test ended: nobody acknowledged it within its window", async () => {
      await renderIn(language, endedResult(true));

      const [before, after] = aroundCount(language, ENDED_UNANSWERED_KEY);
      const line: string = textOf(headlineLine());

      expect(line.startsWith(before)).toBe(true);
      expect(line.endsWith(after)).toBe(true);
    });

    if (language !== "en") {
      test("none of the coded lines reads the server's English", async () => {
        await renderIn(language, endedResult(true));

        const page: string = textOf(screen.getByTestId("test-page-result"));

        for (const english of [
          SMS_NOT_VERIFIED_ENGLISH,
          CALLS_OFF_ENGLISH,
          NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
          getOnCallNoVerifiedMethodStatusMessage("Cara Diaz"),
          ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
          "This SMS method is not verified",
          "is not a member of this project",
        ]) {
          expect([english, page.includes(english)]).toEqual([english, false]);
        }
      });
    }
  },
);

describe("a result from a server that sends no codes reads as the server wrote it", () => {
  test("in English, every line word for word, drawn as it always was", async () => {
    await renderIn("en", endedResult(false));

    expect(deliveryLine(0).textContent).toBe(SMS_NOT_VERIFIED_ENGLISH);
    expect(deliveryLine(1).textContent).toBe(CALLS_OFF_ENGLISH);
    expect(deliveryLine(2).textContent).toBe(PROVIDER_ERROR);
    expect(stepLine(1).textContent).toBe(NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE);
    expect(headlineLine().textContent).toBe(
      ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
    );

    // No isolate, no direction of its own, no width of its own.
    for (const line of [
      deliveryLine(0),
      deliveryLine(2),
      stepLine(1),
      headlineLine(),
    ]) {
      expect(line).not.toHaveAttribute("dir");
      expect(line.className).not.toContain(
        CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      );
    }
    expect(
      screen.getByTestId("test-page-result").querySelector("bdi"),
    ).toBeNull();
  });

  test("in German, the server's English is still there to read", async () => {
    await renderIn("de", endedResult(false));

    expect(textOf(deliveryLine(0))).toBe(SMS_NOT_VERIFIED_ENGLISH);
    expect(textOf(headlineLine())).toBe(
      ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
    );
  });

  test("in English, a run that failed says why exactly as the server wrote it", async () => {
    await renderIn("en", failedResult());

    expect(screen.getByTestId("test-page-result")).toHaveAttribute(
      "data-status",
      OnCallTestPageStatus.Failed,
    );
    expect(headlineLine().textContent).toBe(RUN_ERROR);
    expect(headlineLine()).not.toHaveAttribute("dir");
    expect(headlineLine().querySelector("bdi")).toBeNull();
  });
});

/*
 * #7182: the server's own words - a line with no code - on a page read
 * right to left are a line of their own that reads left to right, its
 * words unchanged: the "+" stays before the digits and the full stop at
 * the end. Run onto more lines, an English line starts each of them at its
 * own start, as wide as its words at the page's side (IsolatedLine) -
 * set apart inside a line of the page's instead, each of its lines was
 * lined up by its end, ragged where an English reader starts reading. On
 * an English page they are drawn exactly as they always were.
 */
describe.each(["ar", "fa"])(
  "on a %s page, the server's own words are a line of their own, reading left to right (#7182)",
  (language: string) => {
    // The line reads left to right, from its own start, and holds the words alone.
    function expectLineOfItsOwn(line: HTMLElement, english: string): void {
      expect([english, line.getAttribute("dir")]).toEqual([english, "ltr"]);
      expect(line.className).toContain(
        CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      );
      // It keeps its own classes: it still wraps a word too long for it.
      expect(line.className).toContain("break-words");
      expect(line.querySelector("bdi")).toBeNull();
      expect(line.textContent).toBe(english);
    }

    test("each line with no code reads left to right from its own start, its words unchanged", async () => {
      await renderIn(language, endedResult(false));

      for (const [line, english] of [
        [deliveryLine(0), SMS_NOT_VERIFIED_ENGLISH],
        [deliveryLine(1), CALLS_OFF_ENGLISH],
        [deliveryLine(2), PROVIDER_ERROR],
        [stepLine(1), NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE],
        [headlineLine(), ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE],
      ] as Array<[HTMLElement, string]>) {
        expectLineOfItsOwn(line, english);
      }
    });

    test("a provider's error beside coded lines is the only line of its own", async () => {
      await renderIn(language, endedResult(true));

      for (const line of [deliveryLine(0), deliveryLine(1), headlineLine()]) {
        expect(line).not.toHaveAttribute("dir");
        expect(line.className).not.toContain(
          CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
        );
      }
      expectLineOfItsOwn(deliveryLine(2), PROVIDER_ERROR);
    });

    test("a run that failed says why in the error's own words, left to right: its number keeps its + in front", async () => {
      await renderIn(language, failedResult());

      expectLineOfItsOwn(headlineLine(), RUN_ERROR);
    });
  },
);

/*
 * Ask AI's test page card draws the run's sentence inline, after the
 * result's headline (getResultSentenceWords). A failed run's own error -
 * the server's words, with no code - is set apart on a page read the other
 * way, as the result's own line is: its number keeps its "+" in front and
 * its full stop at its end. A sentence in the reader's words is drawn as
 * it is.
 */
function InlineSentence(props: { result: OnCallTestPageResult }): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <p data-testid="inline-result-sentence">
      {getResultSentenceWords(translator, props.result)}
    </p>
  );
}

async function renderInline(
  language: string,
  result: OnCallTestPageResult,
): Promise<HTMLElement> {
  await renderIn(language, result);

  render(<InlineSentence result={result} />);

  return screen.getByTestId("inline-result-sentence");
}

describe("the run's sentence drawn inline (Ask AI's test page card)", () => {
  test.each(["ar", "fa"])(
    "%s: a failed run's error is one isolate that reads left to right, its words unchanged",
    async (language: string) => {
      const line: HTMLElement = await renderInline(language, failedResult());
      const isolates: Array<Element> = Array.from(line.querySelectorAll("bdi"));

      expect(isolates).toHaveLength(1);
      expect(isolates[0]).toHaveAttribute("dir", "ltr");
      expect(isolates[0]!.textContent).toBe(RUN_ERROR);
      expect(line.textContent).toBe(RUN_ERROR);
    },
  );

  test("en: a failed run's error as it always was, with no isolate", async () => {
    const line: HTMLElement = await renderInline("en", failedResult());

    expect(line.querySelector("bdi")).toBeNull();
    expect(line.textContent).toBe(RUN_ERROR);
  });

  test.each(["ar", "fa", "de"])(
    "%s: a coded line is the reader's own words, as the result's headline says them, with no isolate",
    async (language: string) => {
      const line: HTMLElement = await renderInline(language, endedResult(true));

      expect(line.querySelector("bdi")).toBeNull();
      expect(textOf(line)).toBe(textOf(headlineLine()));
      expect(textOf(line)).not.toBe(ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE);
    },
  );
});

describe("the result keeps its parts where tests and pages find them", () => {
  test("the result, each person's step and each message keep their test ids", async () => {
    await renderIn("fa", endedResult(true));

    const result: HTMLElement = screen.getByTestId("test-page-result");

    expect(result).toHaveAttribute("data-status", OnCallTestPageStatus.Ended);
    expect(within(result).getAllByTestId("test-page-step")).toHaveLength(3);
    expect(within(result).getAllByTestId("test-page-delivery")).toHaveLength(3);
    expect(
      within(result)
        .getAllByTestId("test-page-delivery")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("data-status");
        }),
    ).toEqual([
      OnCallTestPageDeliveryStatus.Failed,
      OnCallTestPageDeliveryStatus.Failed,
      OnCallTestPageDeliveryStatus.Failed,
    ]);
    expect(
      within(result).getByTestId("test-page-delivery-address"),
    ).toHaveTextContent("+15550100");
  });
});

/*
 * ISSUE #7550: ONEUPTIME'S OWN FAILURE LINES, IN THE READER'S WORDS.
 *
 * The Notification service refusing a request or answering with an error,
 * a request that never reached it, a send that failed with no words of its
 * own, a balance too low and a chat workspace that is not connected are
 * OneUptime's sentences, not a provider's - and they reached a German, a
 * Persian or an Arabic reader in English, because no code stood for them.
 * The server now reads each back into a code with its values (the real
 * reader is used here, on the English a row holds today), and the
 * Dashboard words it. The service's own words after a refusal are not
 * OneUptime's: they go into the sentence as written, set apart, so on an
 * Arabic or Persian page they read left to right, their full stop at
 * their end.
 */
const SERVICE_WORDS: string = "Email ana@ is not in valid format.";

interface OwnLine {
  // What the row of the person's on-call timeline holds, as written today.
  english: string;
  channel: OnCallPageChannel;
  // The Dashboard's sentence(s) for it, and the values each names.
  keys: Array<string>;
  values?: Record<string, string> | undefined;
  // Values the sentence holds as written: set apart on a page read from the right.
  writtenValues?: Array<string> | undefined;
}

const WHO_CAN_ADD_BALANCE_KEY: string =
  "A Project Owner or someone with Manage Billing can add balance in Project Settings → Notifications → Notification Channels.";

const OWN_LINES: Record<string, OwnLine> = {
  refusedWithWords: {
    english: `The Notification service refused to send this (HTTP 400): ${SERVICE_WORDS}`,
    channel: OnCallPageChannel.Email,
    keys: [
      "The Notification service refused to send this (HTTP {{statusCode}}): {{words}}",
    ],
    values: { statusCode: "400", words: SERVICE_WORDS },
    writtenValues: [SERVICE_WORDS],
  },
  refused: {
    english: "The Notification service refused to send this (HTTP 422).",
    channel: OnCallPageChannel.Webhook,
    keys: [
      "The Notification service refused to send this (HTTP {{statusCode}}).",
    ],
    values: { statusCode: "422" },
  },
  answerFailed: {
    english:
      "The Notification service answered with an error (HTTP 500), so this may not have been sent: Server Error.",
    channel: OnCallPageChannel.SMS,
    keys: [
      "The Notification service answered with an error (HTTP {{statusCode}}), so this may not have been sent: {{words}}",
    ],
    values: { statusCode: "500", words: "Server Error." },
    writtenValues: ["Server Error."],
  },
  answerFailedNoStatus: {
    english:
      "The Notification service answered with an error, so this may not have been sent.",
    channel: OnCallPageChannel.Call,
    keys: [
      "The Notification service answered with an error, so this may not have been sent.",
    ],
  },
  notReached: {
    english:
      "Could not reach the Notification service to send this (ECONNREFUSED).",
    channel: OnCallPageChannel.WhatsApp,
    keys: [
      "Could not reach the Notification service to send this ({{reason}}).",
    ],
    values: { reason: "ECONNREFUSED" },
  },
  sendFailedSms: {
    english: "Error sending SMS.",
    channel: OnCallPageChannel.SMS,
    keys: ["Error sending SMS."],
  },
  sendFailedPush: {
    english: "Error sending push notification.",
    channel: OnCallPageChannel.Push,
    keys: ["Error sending push notification."],
  },
  sendFailedTeams: {
    english: "Error sending Microsoft Teams message.",
    channel: OnCallPageChannel.MicrosoftTeams,
    keys: ["Error sending Microsoft Teams message."],
  },
  sendFailedCustomChannel: {
    english: "Error sending to Ops bridge.",
    channel: OnCallPageChannel.CustomChannel,
    keys: ["Error sending to {{name}}."],
    values: { name: "Ops bridge" },
    writtenValues: ["Ops bridge"],
  },
  balanceUsedUp: {
    english:
      "This project's balance is used up. A Project Owner or someone with Manage Billing can add balance in Project Settings > Notifications > Notification Channels.",
    channel: OnCallPageChannel.SMS,
    keys: ["This project's balance is used up.", WHO_CAN_ADD_BALANCE_KEY],
  },
  balanceLessThanCost: {
    english:
      "This project's balance (0.05 USD) is less than this call costs (0.35 USD). A Project Owner or someone with Manage Billing can add balance in Project Settings > Notifications > Notification Channels.",
    channel: OnCallPageChannel.Call,
    keys: [
      "This project's balance ({{balance}}) is less than this call costs ({{cost}}).",
      WHO_CAN_ADD_BALANCE_KEY,
    ],
    values: { balance: "0.05 USD", cost: "0.35 USD" },
  },
  workspaceProjectNotConnected: {
    english:
      "This project is not connected to Slack. Please go to Project Settings and connect the account.",
    channel: OnCallPageChannel.Slack,
    keys: [
      "This project is not connected to {{workspace}}, so nothing was sent there. A Project Admin can connect it in Project Settings → Workspace → {{workspace}}.",
    ],
    values: { workspace: "Slack" },
  },
  workspaceAccountNotConnected: {
    english:
      "This account is not connected to Microsoft Teams. Please go to User Settings and connect the account.",
    channel: OnCallPageChannel.MicrosoftTeams,
    keys: [
      "This {{workspace}} account is not connected to OneUptime in this project, so nothing was sent to it. Its owner can connect it in User Settings → Workspace → {{workspace}}.",
    ],
    values: { workspace: "Microsoft Teams" },
  },
};

const OWN_LINE_NAMES: Array<string> = Object.keys(OWN_LINES);

// A test whose one person got one message of each of OneUptime's own lines.
function ownLinesResult(withCodes: boolean): OnCallTestPageResult {
  const deliveries: Array<OnCallTestPageDelivery> = OWN_LINE_NAMES.map(
    (name: string): OnCallTestPageDelivery => {
      const line: OwnLine = OWN_LINES[name]!;
      const code: OnCallTestPageLine | null = readOnCallTestPageDeliveryLine({
        statusMessage: line.english,
        channel: line.channel,
      });

      // The server's reader knows every one of them.
      expect([name, code !== null]).toEqual([name, true]);

      return delivery({
        id: name,
        channel: line.channel,
        statusMessage: line.english,
        ...(withCodes && code ? { statusMessageCode: code } : {}),
      });
    },
  );

  return {
    ...endedResult(withCodes),
    steps: [
      {
        id: "line-dee",
        userName: "Dee Park",
        status: OnCallTestPageStepStatus.Failed,
        statusMessage: "",
        deliveries: deliveries,
      },
    ],
  };
}

// The line of OneUptime's own `name`, as the result draws it.
function ownLine(name: string): HTMLElement {
  return lineOf(
    screen.getAllByTestId("test-page-delivery")[OWN_LINE_NAMES.indexOf(name)]!,
  );
}

// The reader's words for `name`: each sentence filled, joined as drawn.
function ownLineWords(language: string, name: string): string {
  const line: OwnLine = OWN_LINES[name]!;

  return line.keys
    .map((key: string): string => {
      let sentence: string = worded(language, key);

      // Every place a value goes: a workspace is named twice.
      for (const [value, text] of Object.entries(line.values || {})) {
        sentence = sentence.split(`{{${value}}}`).join(text);
      }

      return sentence;
    })
    .join(" ");
}

describe.each(["en", "de", "fa", "ar"])(
  "a %s reader reads OneUptime's own failure lines in their words (#7550)",
  (language: string) => {
    test.each(OWN_LINE_NAMES)("%s", async (name: string) => {
      await renderIn(language, ownLinesResult(true));

      expect(textOf(ownLine(name))).toBe(ownLineWords(language, name));
    });

    if (language !== "en") {
      test("none of them reads OneUptime's English", async () => {
        await renderIn(language, ownLinesResult(true));

        for (const name of OWN_LINE_NAMES) {
          const text: string = textOf(ownLine(name));

          for (const english of [
            OWN_LINES[name]!.english,
            "Notification service",
            "refused to send",
            "may not have been sent",
            "Could not reach",
            "Error sending",
            "Error making",
            "This project's balance",
            "is not connected to",
            "Please go to",
          ]) {
            expect([name, english, text.includes(english)]).toEqual([
              name,
              english,
              false,
            ]);
          }
        }
      });

      test("the service's own words, and a channel's name, stay as written", async () => {
        await renderIn(language, ownLinesResult(true));

        for (const name of OWN_LINE_NAMES) {
          for (const value of OWN_LINES[name]!.writtenValues || []) {
            expect([name, textOf(ownLine(name)).includes(value)]).toEqual([
              name,
              true,
            ]);
          }
        }
      });
    }
  },
);

describe.each(["fa", "ar"])(
  "on a %s page, OneUptime's own failure lines read right to left, the service's words set apart (#7550)",
  (language: string) => {
    test("each is a line of the page's own: no direction of its own", async () => {
      await renderIn(language, ownLinesResult(true));

      for (const name of OWN_LINE_NAMES) {
        expect([name, ownLine(name).getAttribute("dir")]).toEqual([name, null]);
        expect(ownLine(name).className).not.toContain(
          CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
        );
      }
    });

    test("the service's words and a channel's name are each set apart, and drawn left to right as written: the full stop at their end", async () => {
      await renderIn(language, ownLinesResult(true));

      for (const name of OWN_LINE_NAMES) {
        const text: string = ownLine(name).textContent || "";

        for (const value of OWN_LINES[name]!.writtenValues || []) {
          const set: string = isolated(value);
          const at: number = text.indexOf(set);

          expect([name, value, at >= 0]).toEqual([name, value, true]);

          const drawn: DrawnLine = drawLine(text, "rtl");

          expect([
            name,
            value,
            isDrawnAsWritten(drawn, at + 1, at + 1 + value.length),
          ]).toEqual([name, value, true]);
        }
      }
    });
  },
);

describe("a result from a server that sends no codes for them reads as the server wrote it", () => {
  test("in English, each line word for word, drawn as it always was", async () => {
    await renderIn("en", ownLinesResult(false));

    for (const name of OWN_LINE_NAMES) {
      expect(ownLine(name).textContent).toBe(OWN_LINES[name]!.english);
      expect(ownLine(name)).not.toHaveAttribute("dir");
    }
  });

  test.each(["fa", "ar"])(
    "in %s, each English line is a line of its own that reads left to right",
    async (language: string) => {
      await renderIn(language, ownLinesResult(false));

      for (const name of OWN_LINE_NAMES) {
        expect([name, ownLine(name).getAttribute("dir")]).toEqual([
          name,
          "ltr",
        ]);
        expect(ownLine(name).textContent).toBe(OWN_LINES[name]!.english);
      }
    },
  );
});
