import CallVoiceSample, {
  CALL_VOICE_COST_SENTENCE,
  CALL_VOICE_DEFAULT_COST_SENTENCE,
  CALL_VOICE_HEAR_IT_SENTENCE,
  CALL_VOICE_SAMPLE_LABEL,
  CALL_VOICE_SAMPLE_PROJECT_NAME,
  CALL_VOICE_SAMPLE_RECORD_NUMBER,
  getCallVoiceSampleSentence,
} from "../../../../UI/Components/CallVoice/CallVoiceSample";
import {
  CALL_VOICE_DEFAULT_LABEL,
  CALL_VOICE_KIND_WORDS,
  getCallVoiceDescription,
  getCallVoiceOptions,
  getCallVoiceSummary,
  joinCallVoiceFacts,
} from "../../../../UI/Components/CallVoice/CallVoiceOptions";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../../Types/ReadingDirection";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import {
  CALL_VOICES,
  CallVoice,
  getCallVoice,
  getCallVoiceCentsOfAPage,
} from "../../../../Types/Call/CallVoice";
import { Translator, createTranslator } from "../../../../Types/Translator";
import {
  ON_CALL_PAGE_CALL_PROMPT,
  getOnCallPageCallHeadline,
  getOnCallPageCallOpening,
} from "../../../../Utils/Call/OnCallPageCall";
import "@testing-library/jest-dom";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";

/*
 * THE CALL VOICE PICKER: A SHORT LIST, AND A SAMPLE OF WHAT A PAGE'S CALL
 * SAYS (#10948).
 *
 * The same picker on Admin Dashboard > Settings > Call and SMS and on a
 * project's Twilio config. Each voice by its own name, drawn as written,
 * with who makes it and how it sounds under it in the reader's language;
 * the empty choice is the account's default voice. Under the picker: the
 * voice chosen, the first lines a page's call says - in English, as every
 * call is, never translated - what it costs, and how to hear it.
 */

const GERMAN_WORDS: Record<string, string> = {
  [CALL_VOICE_DEFAULT_LABEL]: "Standardstimme Ihres Twilio-Kontos",
  "US English, female voice": "US-Englisch, weibliche Stimme",
  "US English, male voice": "US-Englisch, männliche Stimme",
  "British English, female voice": "Britisches Englisch, weibliche Stimme",
  "British English, male voice": "Britisches Englisch, männliche Stimme",
  [CALL_VOICE_SAMPLE_LABEL]:
    "So beginnt der Anruf einer Benachrichtigung, immer auf Englisch:",
  [CALL_VOICE_COST_SENTENCE]:
    "Twilio berechnet für diese Stimme einen Aufpreis: unter 2 US-Cent je Anruf einer Benachrichtigung.",
  [CALL_VOICE_DEFAULT_COST_SENTENCE]:
    "Kostenlos. Laut Twilio sind seine Basic-Stimmen nicht für den Produktivbetrieb gedacht.",
  [CALL_VOICE_HEAR_IT_SENTENCE]:
    "Speichern Sie und senden Sie dann einen Testanruf, um sie zu hören.",
};

const createLanguage: (
  language: string,
  translation: Record<string, string>,
) => i18n = (language: string, translation: Record<string, string>): i18n => {
  const instance: i18n = createInstance();

  void instance.init({
    lng: language,
    fallbackLng: "en",
    resources: { [language]: { translation } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });

  return instance;
};

const PERSIAN_WORDS: Record<string, string> = {
  "US English, female voice": "انگلیسی آمریکایی، صدای زن",
};

// A fact as a line that reads the other way holds it.
const isolated: (fact: string) => string = (fact: string): string => {
  return `${FIRST_STRONG_ISOLATE}${fact}${POP_DIRECTIONAL_ISOLATE}`;
};

let german: i18n;
let english: i18n;
let persian: i18n;

beforeAll(() => {
  german = createLanguage("de", GERMAN_WORDS);
  english = createLanguage("en", {});
  persian = createLanguage("fa", PERSIAN_WORDS);
});

// A translator in English, as code that runs outside React builds one.
const englishTranslator: Translator = createTranslator(
  (text: string): string => {
    return text;
  },
  "en",
);

const germanTranslator: Translator = createTranslator(
  (text: string): string => {
    return GERMAN_WORDS[text] ?? text;
  },
  "de",
);

describe("the picker's options", () => {
  test("every voice of the list, in its order, by its own name, drawn as written", () => {
    const options: Array<DropdownOption> =
      getCallVoiceOptions(englishTranslator);

    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual(
      CALL_VOICES.map((voice: CallVoice): string => {
        return voice.value;
      }),
    );

    for (const option of options) {
      const voice: CallVoice = getCallVoice(option.value)!;

      expect(option.label).toBe(voice.name);
      // A product's own name: never looked up, so "Amy" is never translated.
      expect(option.isUserContent).toBe(true);
    }
  });

  test("under each, who makes it and how it sounds, already in the reader's words", () => {
    const options: Array<DropdownOption> =
      getCallVoiceOptions(germanTranslator);
    const joanna: DropdownOption = options.find((option: DropdownOption) => {
      return option.value === "Polly.Joanna-Neural";
    })!;
    const brian: DropdownOption = options.find((option: DropdownOption) => {
      return option.value === "Polly.Brian-Neural";
    })!;
    const google: DropdownOption = options.find((option: DropdownOption) => {
      return option.value === "Google.en-US-Neural2-J";
    })!;

    expect(joanna.description).toBe(
      "Amazon Polly · US-Englisch, weibliche Stimme",
    );
    expect(brian.description).toBe(
      "Amazon Polly · Britisches Englisch, männliche Stimme",
    );
    expect(google.description).toBe("Google · US-Englisch, männliche Stimme");
    // Words the picker put in the reader's language are never looked up again.
    expect(joanna.isDescriptionUserContent).toBe(true);
  });

  test("the account's default voice is no option: it is the picker's empty choice", () => {
    for (const option of getCallVoiceOptions(englishTranslator)) {
      expect(option.value).not.toBe("");
      expect(option.label).not.toBe(CALL_VOICE_DEFAULT_LABEL);
    }

    expect(CALL_VOICE_DEFAULT_LABEL).toBe(
      "Your Twilio account's default voice",
    );
  });

  test("every voice's kind has its words, in the language and the kind the voice is", () => {
    for (const voice of CALL_VOICES) {
      const words: string = CALL_VOICE_KIND_WORDS[voice.language][voice.gender];

      expect(words).toMatch(/^(US|British) English, (female|male) voice$/);
      expect(
        words.startsWith(voice.language === "en-GB" ? "British" : "US"),
      ).toBe(true);
      expect(words).toContain(voice.gender);
      expect(getCallVoiceDescription(voice, englishTranslator)).toBe(
        `${voice.provider} · ${words}`,
      );
    }
  });
});

describe("the voice chosen, in a line of its own", () => {
  test("its name, who makes it and how it sounds", () => {
    expect(getCallVoiceSummary("Polly.Amy-Neural", englishTranslator)).toBe(
      "Amy · Amazon Polly · British English, female voice",
    );
    expect(getCallVoiceSummary("Polly.Amy-Neural", germanTranslator)).toBe(
      "Amy · Amazon Polly · Britisches Englisch, weibliche Stimme",
    );
  });

  test("none - or a value the list does not hold - is the account's default voice, in the reader's words", () => {
    for (const value of [undefined, null, "", "man", "Polly.Joanna"]) {
      expect(getCallVoiceSummary(value, englishTranslator)).toBe(
        "Your Twilio account's default voice",
      );
      expect(getCallVoiceSummary(value, germanTranslator)).toBe(
        "Standardstimme Ihres Twilio-Kontos",
      );
    }
  });
});

describe("the sample sentence", () => {
  test("is the first lines a page's call says, from the call's own builder", () => {
    expect(getCallVoiceSampleSentence()).toBe(
      [
        getOnCallPageCallOpening(CALL_VOICE_SAMPLE_PROJECT_NAME),
        getOnCallPageCallHeadline({
          record: {
            noun: "incident",
            number: "INC-42",
            severityName: "Critical Incident",
          },
        }),
        ON_CALL_PAGE_CALL_PROMPT,
      ].join(" "),
    );
    expect(getCallVoiceSampleSentence()).toBe(
      "This is a call from Acme Production. A new Critical Incident has been created: INC-42. Press 1 to acknowledge, or 2 to escalate.",
    );
  });

  test("is called from the project the config is for, when the page knows it", () => {
    expect(getCallVoiceSampleSentence("Payments EU")).toMatch(
      /^This is a call from Payments EU\. /,
    );
  });
});

describe("under the picker", () => {
  test("a voice: its name and kind, the English sample, what it costs, and how to hear it", () => {
    render(
      <I18nextProvider i18n={english}>
        <CallVoiceSample value="Polly.Joanna-Neural" />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("call-voice-sample-voice")).toHaveTextContent(
      "Joanna · Amazon Polly · US English, female voice",
    );
    expect(screen.getByText(CALL_VOICE_SAMPLE_LABEL)).toBeInTheDocument();
    expect(screen.getByTestId("call-voice-sample-sentence")).toHaveTextContent(
      `“${getCallVoiceSampleSentence()}”`,
    );
    expect(screen.getByTestId("call-voice-sample-cost")).toHaveTextContent(
      CALL_VOICE_COST_SENTENCE,
    );
    expect(screen.getByText(CALL_VOICE_HEAR_IT_SENTENCE)).toBeInTheDocument();
  });

  test("what it costs is true of every voice: under 2 US cents for a page's call", () => {
    expect(CALL_VOICE_COST_SENTENCE).toContain("under 2 US cents");

    for (const voice of CALL_VOICES) {
      expect(getCallVoiceCentsOfAPage(voice)).toBe(2);
    }
  });

  test("no voice: the account's default, free, and what Twilio says of its Basic voices", () => {
    render(
      <I18nextProvider i18n={english}>
        <CallVoiceSample value={undefined} />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("call-voice-sample-voice")).toHaveTextContent(
      "Your Twilio account's default voice",
    );
    expect(screen.getByTestId("call-voice-sample-cost")).toHaveTextContent(
      "Free. Twilio says its Basic voices are not meant for production.",
    );
    expect(
      screen.getByTestId("call-voice-sample-sentence"),
    ).toBeInTheDocument();
  });

  test("follows the picker: a voice the list does not hold reads as none", () => {
    render(
      <I18nextProvider i18n={english}>
        <CallVoiceSample value="Polly.Joanna" />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("call-voice-sample-voice")).toHaveTextContent(
      CALL_VOICE_DEFAULT_LABEL,
    );
  });

  test("in German: every word of the box is the reader's, and the sample stays English, as the call says it", () => {
    render(
      <I18nextProvider i18n={german}>
        <CallVoiceSample value="Polly.Brian-Neural" projectName="Zahlungen" />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("call-voice-sample-voice")).toHaveTextContent(
      "Brian · Amazon Polly · Britisches Englisch, männliche Stimme",
    );
    expect(
      screen.getByText(GERMAN_WORDS[CALL_VOICE_SAMPLE_LABEL]!),
    ).toBeInTheDocument();
    expect(screen.getByTestId("call-voice-sample-cost")).toHaveTextContent(
      GERMAN_WORDS[CALL_VOICE_COST_SENTENCE]!,
    );
    expect(
      screen.getByText(GERMAN_WORDS[CALL_VOICE_HEAR_IT_SENTENCE]!),
    ).toBeInTheDocument();

    const sample: HTMLElement = screen.getByTestId(
      "call-voice-sample-sentence",
    );

    expect(sample).toHaveTextContent(
      "This is a call from Zahlungen. A new Critical Incident has been created: INC-42. Press 1 to acknowledge, or 2 to escalate.",
    );
    expect(sample).toHaveAttribute("lang", "en");
    expect(sample).toHaveAttribute("dir", "ltr");
  });

  test("on a page read from the right, the English sample still reads from the left, and the facts are set apart the language's way", () => {
    render(
      <I18nextProvider i18n={persian}>
        <CallVoiceSample value="Polly.Joanna-Neural" />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("call-voice-sample-sentence")).toHaveAttribute(
      "dir",
      "ltr",
    );
    /*
     * Persian writes its zero as a dot, so its facts are set apart by a
     * bullet; the Latin ones are each isolated, so the line reads them in
     * their order from the right.
     */
    expect(screen.getByTestId("call-voice-sample-voice").textContent).toBe(
      `${isolated("Joanna")} • ${isolated("Amazon Polly")} • انگلیسی آمریکایی، صدای زن`,
    );
  });

  test("the sample's record number is never split across two lines, and the sentence reads as before", () => {
    render(
      <I18nextProvider i18n={english}>
        <CallVoiceSample value="Polly.Joanna-Neural" />
      </I18nextProvider>,
    );

    const number: HTMLElement = screen.getByText(
      CALL_VOICE_SAMPLE_RECORD_NUMBER,
    );

    expect(number).toHaveClass("whitespace-nowrap");
    expect(number.textContent).toBe("INC-42");
    expect(screen.getByTestId("call-voice-sample-sentence").textContent).toBe(
      `“${getCallVoiceSampleSentence()}”`,
    );
  });

  test("a project named like the record keeps its name as it is: only the headline's number is held together", () => {
    render(
      <I18nextProvider i18n={english}>
        <CallVoiceSample value="Polly.Joanna-Neural" projectName="INC-42 Ops" />
      </I18nextProvider>,
    );

    const sentence: HTMLElement = screen.getByTestId(
      "call-voice-sample-sentence",
    );
    const heldTogether: NodeListOf<Element> =
      sentence.querySelectorAll(".whitespace-nowrap");

    expect(heldTogether).toHaveLength(1);
    expect(heldTogether[0]?.previousSibling?.textContent).toBe(
      "This is a call from INC-42 Ops. A new Critical Incident has been created: ",
    );
    expect(sentence.textContent).toBe(
      `“${getCallVoiceSampleSentence("INC-42 Ops")}”`,
    );
  });
});

describe("a voice's facts on a page read from the right", () => {
  const persianTranslator: Translator = createTranslator(
    (text: string): string => {
      return PERSIAN_WORDS[text] ?? text;
    },
    "fa",
  );

  test("each Latin fact is set apart, so the voice comes before its maker, as a Persian reader reads", () => {
    expect(
      getCallVoiceSummary("Google.en-US-Neural2-F", persianTranslator),
    ).toBe(
      `${isolated("Neural2-F")} • ${isolated("Google")} • انگلیسی آمریکایی، صدای زن`,
    );
    expect(
      getCallVoiceDescription(
        getCallVoice("Polly.Joanna-Neural") as CallVoice,
        persianTranslator,
      ),
    ).toBe(`${isolated("Amazon Polly")} • انگلیسی آمریکایی، صدای زن`);
  });

  test("a fact in the line's own script is left as it is", () => {
    expect(joinCallVoiceFacts(["انگلیسی آمریکایی", "صدای زن"], "fa")).toBe(
      "انگلیسی آمریکایی • صدای زن",
    );
  });

  test("on a page read from the left nothing is set apart: the line is the same as before", () => {
    expect(
      joinCallVoiceFacts(["Neural2-F", "Google", "US English"], "en"),
    ).toBe("Neural2-F · Google · US English");
    expect(
      getCallVoiceSummary("Google.en-US-Neural2-F", englishTranslator),
    ).not.toContain(FIRST_STRONG_ISOLATE);
  });

  test("the options, read from the right, carry the same set-apart facts", () => {
    const option: DropdownOption | undefined = getCallVoiceOptions(
      persianTranslator,
    ).find((candidate: DropdownOption): boolean => {
      return candidate.value === "Polly.Joanna-Neural";
    });

    expect(option?.label).toBe("Joanna");
    expect(option?.description).toBe(
      `${isolated("Amazon Polly")} • انگلیسی آمریکایی، صدای زن`,
    );
  });
});
