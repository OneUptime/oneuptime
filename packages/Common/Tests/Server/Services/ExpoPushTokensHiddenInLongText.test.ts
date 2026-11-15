import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

import PushNotificationService, {
  ExpoPushRefusedError,
} from "../../../Server/Services/PushNotificationService";
import { JSONObject } from "../../../Types/JSON";
import {
  FastestRun,
  fastestRun,
  fastestRunAsync,
} from "../../Helpers/FastestRun";
import { Expo, ExpoPushReceipt, ExpoPushTicket } from "expo-server-sdk";

/*
 * EVERY EXPO PUSH TOKEN TAKEN OUT OF A MESSAGE, IN TIME THAT GROWS WITH
 * THE MESSAGE (issue #7291).
 *
 * Before a message is logged or answered, PushNotificationService
 * .withoutAnyPushToken takes every Expo push token out of it: a token is
 * the address that pages somebody's phone. It reads text from outside this
 * server - what Expo answers the push relay about a send it refused, and
 * about the receipts a server asks the relay for - so it must take time in
 * line with the text: 400,000 characters of its worst case within two
 * seconds.
 *
 * The bracketed part of the pattern used to run on over an opening
 * bracket: on a text of many "ExpoPushToken[" and no "]", each was read to
 * the end of the text - 14,000 characters took 26 ms, 56,000 took 265 ms
 * and 224,000 took 6.1 seconds. It now stops at the next opening bracket
 * too, so a run stops where the next token starts.
 *
 * Pinned here: every form of a token is still hidden - ExponentPushToken[...],
 * ExpoPushToken[...] and the bare UUID - and what is not a token stays;
 * the worst cases take milliseconds, alone and on the two ways outside
 * text reaches it (the relay's receipts answer and its own send). Timed
 * with FastestRun: work whose time grows with the square of the text takes
 * seconds here on every attempt.
 */

const HIDDEN: string = "[push token]";

// A text of `unit` over and over, cut to `length` characters.
function repeated(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

// How many times `part` is in `text`, read with indexOf.
function countOf(text: string, part: string): number {
  let count: number = 0;
  let from: number = text.indexOf(part);

  while (from !== -1) {
    count++;
    from = text.indexOf(part, from + part.length);
  }

  return count;
}

function hidden(message: string): string {
  return PushNotificationService.withoutAnyPushToken(message);
}

const WORST_CASE_LENGTH: number = 400000;
const LIMIT_IN_MS: number = 2000;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every form of a token is hidden", () => {
  test.each([
    [
      "ExponentPushToken[...], as Expo issues them",
      "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    ],
    ["ExpoPushToken[...]", "ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]"],
    ["a bare UUID", "2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e5f"],
    ["a bare UUID in capitals", "2D9B7C1E-6F3A-4B8D-8E2F-0A1B2C3D4E5F"],
    ["either spelling, in any case", "exponentpushtoken[abc-123]"],
    ["empty brackets", "ExpoPushToken[]"],
    ["a space inside the brackets", "ExpoPushToken[ab cd]"],
    ["a line break inside the brackets", "ExponentPushToken[ab\ncd]"],
  ])("%s", (_form: string, token: string) => {
    expect(hidden(`Sent to ${token}, refused`)).toBe(
      `Sent to ${HIDDEN}, refused`,
    );
    // Alone, at the start and at the end of the text.
    expect(hidden(token)).toBe(HIDDEN);
  });

  test("every token of a message, in each form, quoted, side by side", () => {
    expect(
      hidden(
        '"ExponentPushToken[aaa]" and ExpoPushToken[bbb]ExponentPushToken[ccc] and 2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e5f.',
      ),
    ).toBe(`"${HIDDEN}" and ${HIDDEN}${HIDDEN} and ${HIDDEN}.`);
  });

  test("a token ends at its first closing bracket", () => {
    expect(hidden("ExpoPushToken[abc]def]")).toBe(`${HIDDEN}def]`);
  });

  test("an opening bracket left unclosed is no token, and the token after it is hidden on its own", () => {
    expect(hidden("ExpoPushToken[abc ExpoPushToken[def] refused")).toBe(
      `ExpoPushToken[abc ${HIDDEN} refused`,
    );
    expect(hidden("ExpoPushToken[[def]")).toBe(`ExpoPushToken[[def]`);
  });

  test("thousands of tokens in a long message, every one", () => {
    const message: string = repeated(
      "Too many messages to ExpoPushToken[abcdefghij0123456789ab], ",
      WORST_CASE_LENGTH,
    );
    const tokens: number = countOf(message, "ExpoPushToken[");
    const result: string = hidden(message);

    expect(tokens).toBeGreaterThan(6000);
    expect(countOf(result, HIDDEN)).toBeGreaterThanOrEqual(tokens - 1);
    expect(countOf(result, "abcdefghij0123456789ab]")).toBe(0);
  });
});

describe("what is not a token stays as it was", () => {
  test.each([
    ["another bracketed word", "Token[x]"],
    ["the word with no brackets", "ExpoPushToken is not valid"],
    ["an opening bracket left unclosed", "ExpoPushToken[abcdef"],
    ["a UUID inside a longer word", "x2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e5f"],
    ["a UUID short of a group", "2d9b7c1e-6f3a-4b8d-8e2f"],
    [
      "a UUID with a letter too many in a group",
      "2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e5f0",
    ],
  ])("%s", (_what: string, text: string) => {
    expect(hidden(text)).toBe(text);
  });
});

describe("in time that grows with the text, not with its square", () => {
  /*
   * Each with no closing bracket - the shape that read every opening
   * bracket to the end of the text - or with one at its very end, and the
   * UUID form's near misses. 400,000 characters each.
   */
  test.each([
    ['"ExpoPushToken[" over and over', "ExpoPushToken[", ""],
    ['"ExponentPushToken[" over and over', "ExponentPushToken[", ""],
    ['"ExpoPushToken[x" over and over', "ExpoPushToken[x", ""],
    [
      '"ExpoPushToken[ " over and over, in either spelling',
      "ExpoPushToken[ exponentpushtoken[ ",
      "",
    ],
    [
      '"ExpoPushToken[" over and over, closed once at the end',
      "ExpoPushToken[",
      "]",
    ],
    ["near misses of the UUID form", "aaaaaaaa-aaaa-aaaa-aaaa-", ""],
  ])(
    "%s: within two seconds",
    (_shape: string, unit: string, end: string) => {
      const text: string = repeated(unit, WORST_CASE_LENGTH - end.length) + end;
      let attempt: number = 0;

      const run: FastestRun<string> = fastestRun({
        run: (): string => {
          attempt++;
          // A new text each attempt: nothing an earlier one did is reused.
          return hidden(`${attempt} ${text}`);
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(text.length).toBe(WORST_CASE_LENGTH);
      expect(run.inMs).toBeLessThan(LIMIT_IN_MS);
      // What was hidden: at most the one token the end closes.
      expect(run.result.length).toBeGreaterThan(WORST_CASE_LENGTH - 100);
    },
    120 * 1000,
  );

  test(
    "the relay's answer to a server asking for receipts, whose message Expo wrote: within two seconds",
    async () => {
      const message: string = repeated("ExpoPushToken[", WORST_CASE_LENGTH);
      let attempt: number = 0;

      jest
        .spyOn(PushNotificationService, "hasExpoAccessToken")
        .mockReturnValue(true);
      jest
        .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
        .mockImplementation((async () => {
          attempt++;

          return {
            "2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e5f": {
              status: "error",
              // The phone's token first: no closing bracket follows the run.
              message: `ExpoPushToken[the-phone] ${attempt} ${message}`,
              details: { error: "MessageRateExceeded" },
            } as ExpoPushReceipt,
          };
        }) as never);

      const run: FastestRun<JSONObject> = await fastestRunAsync({
        run: (): Promise<JSONObject> => {
          return PushNotificationService.getRelayPushReceipts([
            "2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e5f",
          ]);
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(run.inMs).toBeLessThan(LIMIT_IN_MS);

      const answered: string = (
        run.result["2d9b7c1e-6f3a-4b8d-8e2f-0a1b2c3d4e5f"] as JSONObject
      )["message"] as string;

      expect(answered.startsWith(`${HIDDEN} `)).toBe(true);
      expect(answered).not.toContain("the-phone");
    },
    120 * 1000,
  );

  describe("the relay's own send, refused by Expo with a message of its own", () => {
    let ticket: ExpoPushTicket;

    beforeEach(() => {
      jest
        .spyOn(PushNotificationService, "hasExpoAccessToken")
        .mockReturnValue(true);
      jest
        .spyOn(Expo.prototype, "sendPushNotificationsAsync")
        .mockImplementation((async () => {
          return [ticket];
        }) as never);
    });

    test(
      "is read within two seconds, every token taken out",
      async () => {
        const message: string = repeated(
          "ExponentPushToken[",
          WORST_CASE_LENGTH,
        );
        let attempt: number = 0;

        const run: FastestRun<unknown> = await fastestRunAsync({
          run: async (): Promise<unknown> => {
            attempt++;
            ticket = {
              status: "error",
              // The phone's token first: no closing bracket follows the run.
              message: `ExpoPushToken[the-phone] ${attempt} ${message}`,
              details: { error: "MessageRateExceeded" },
            };

            try {
              return await PushNotificationService.sendRelayPushNotification({
                to: "ExpoPushToken[the-relayed-phone]",
                title: "Incident #7",
                body: "Payments are down",
              });
            } catch (error) {
              return error;
            }
          },
          limitInMs: LIMIT_IN_MS,
        });

        expect(run.inMs).toBeLessThan(LIMIT_IN_MS);
        expect(run.result).toBeInstanceOf(ExpoPushRefusedError);

        const expoMessage: string = (run.result as ExpoPushRefusedError)
          .expoMessage;

        expect(expoMessage.startsWith(`${HIDDEN} `)).toBe(true);
        expect(expoMessage).not.toContain("the-phone");
      },
      120 * 1000,
    );
  });
});
