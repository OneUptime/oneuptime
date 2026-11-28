import URL from "../../../Types/API/URL";
import {
  CallRequestMessage,
  GatherInput,
  Say,
} from "../../../Types/Call/CallRequest";
import {
  CALL_LANGUAGE_VOICES,
  CALL_VOICES,
  CALL_VOICE_CHARACTERS_IN_A_PAGE,
  CALL_VOICE_MOST_CHARACTERS_IN_A_PAGE,
  CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD,
  CALL_VOICE_READER_LANGUAGES,
  getCallVoiceCentsOfAPage,
  getCallVoiceCostOfAPageInUsd,
} from "../../../Types/Call/CallVoice";
import { OnCallObserverPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { getCallTranslator } from "../../../Server/Utils/ServerTranslation";
import { CALL_TITLE_MAX_LENGTH } from "../../../Utils/Call/CallSpeech";
import {
  OnCallPageCallInput,
  buildOnCallPageCallData,
} from "../../../Utils/Call/OnCallPageCall";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A PAGE'S CALL COSTS IN A VOICE, IN EVERY LANGUAGE (#11066, #10948).
 *
 * Twilio prices a voice's speech by the characters it says. A page's call
 * in another language says more or fewer than the English one - German
 * more, Chinese far fewer - so these measure every language's call, as the
 * call's own builder writes it, against what the picker says it costs.
 */

// What a call says when nobody presses a key: everything once, the repeated part again, then its goodbye.
function charactersSaid(data: CallRequestMessage["data"]): number {
  const sentences: Array<Say> = data.filter((item: unknown): boolean => {
    return typeof (item as Say).sayMessage === "string";
  }) as Array<Say>;
  const prompt: GatherInput = data.find((item: unknown): boolean => {
    return typeof (item as GatherInput).introMessage === "string";
  }) as GatherInput;

  let characters: number = 0;

  for (const sentence of sentences) {
    characters += sentence.sayMessage.length;

    if (sentence.repeated) {
      characters += sentence.sayMessage.length;
    }
  }

  return (
    characters + prompt.introMessage.length * 2 + prompt.noInputMessage.length
  );
}

/*
 * The longest first page's call about each kind of record - the call the
 * figures are for, as CALL_VOICE_CHARACTERS_IN_A_PAGE always was: a title
 * as long as a call says one, nobody pressing a key.
 */
function longestPages(): Array<OnCallPageCallInput> {
  const pages: Array<OnCallPageCallInput> = [];
  const kinds: ReadonlyArray<OnCallObserverPageRecordKind> = [
    "incident",
    "alert",
    "incident episode",
    "alert episode",
  ];

  for (const noun of kinds) {
    for (const severityName of ["Critical Incident", "High"]) {
      const base: OnCallPageCallInput = {
        record: {
          noun: noun,
          number: "INC-42",
          severityName: severityName,
          title: "x".repeat(CALL_TITLE_MAX_LENGTH),
        },
        projectName: "Acme Production",
        responseUrl: URL.fromString("https://oneuptime.example.com/a"),
      };

      pages.push(base);
    }
  }

  return pages;
}

describe("a page's call, in every language a call is spoken in", () => {
  test.each(
    ["en", ...CALL_VOICE_READER_LANGUAGES].map((code: string): [string] => {
      return [code];
    }),
  )("%s says no more than the most a call is priced for", (code: string) => {
    const most: number = Math.max(
      ...longestPages().map((page: OnCallPageCallInput): number => {
        return charactersSaid(
          buildOnCallPageCallData(page, getCallTranslator(code)),
        );
      }),
    );

    expect([code, most, most <= CALL_VOICE_MOST_CHARACTERS_IN_A_PAGE]).toEqual([
      code,
      most,
      true,
    ]);
  });

  test("in English, about as much as the English figure says", () => {
    const characters: number = charactersSaid(
      buildOnCallPageCallData(longestPages()[0]!),
    );

    expect(characters).toBeLessThanOrEqual(CALL_VOICE_CHARACTERS_IN_A_PAGE);
    expect(characters).toBeGreaterThan(CALL_VOICE_CHARACTERS_IN_A_PAGE - 100);
  });
});

describe("what a page's call costs", () => {
  test("in any language a voice speaks: under 3 US cents, as the picker says", () => {
    for (const voice of [...CALL_VOICES, ...CALL_LANGUAGE_VOICES]) {
      const most: number = getCallVoiceCostOfAPageInUsd(
        voice,
        CALL_VOICE_MOST_CHARACTERS_IN_A_PAGE,
      );

      expect(most).toBeGreaterThan(0.02);
      expect(most).toBeLessThan(0.03);
      expect(getCallVoiceCentsOfAPage(voice)).toBe(3);
    }
  });

  test("in English, under 2 US cents, as it always was", () => {
    for (const voice of CALL_VOICES) {
      expect(getCallVoiceCostOfAPageInUsd(voice)).toBeLessThan(0.02);
    }
  });

  test("is priced in blocks of 100 characters, 100 at least", () => {
    const voice: (typeof CALL_VOICES)[number] = CALL_VOICES[0]!;

    expect(getCallVoiceCostOfAPageInUsd(voice, 1)).toBe(
      CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD,
    );
    expect(getCallVoiceCostOfAPageInUsd(voice, 0)).toBe(
      CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD,
    );
    expect(getCallVoiceCostOfAPageInUsd(voice, 101)).toBeCloseTo(
      2 * CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD,
      10,
    );
    expect(getCallVoiceCostOfAPageInUsd(voice)).toBeCloseTo(
      5 * CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD,
      10,
    );
  });

  test("the account's default voice is free, in every language", () => {
    expect(getCallVoiceCostOfAPageInUsd(null)).toBe(0);
    expect(
      getCallVoiceCostOfAPageInUsd(null, CALL_VOICE_MOST_CHARACTERS_IN_A_PAGE),
    ).toBe(0);
    expect(getCallVoiceCentsOfAPage(null)).toBe(0);
  });
});
