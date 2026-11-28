import { readPage } from "./DocsContentSupport";
import { anchorInLanguage } from "./NetworkDocsLabels";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { CALL_VOICE_CARD_COPY } from "../../../FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/CallVoiceCardCopy";
import TwilioConfigVoiceCopy from "../../../FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigVoiceCopy";
import {
  CALL_LANGUAGE_VOICES,
  CALL_VOICES,
  CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD,
  CALL_VOICE_VALUES,
  CallVoice,
  CallVoiceGender,
  SpokenCallVoice,
  getCallVoiceCentsOfAPage,
  getCallVoiceForLanguage,
} from "Common/Types/Call/CallVoice";
import { CALL_VOICE_KIND_WORDS } from "Common/UI/Components/CallVoice/CallVoiceOptions";
import {
  CALL_KEYPAD_FINISH_ON_KEY,
  CALL_PROMPT_REPEATS,
  CALL_WRONG_KEY_ASKS,
  CALL_WRONG_KEY_SENTENCE,
  getKeyAnswer,
} from "Common/Utils/Call/CallKeypad";
import { OnCallInputRequest } from "Common/Types/Call/CallRequest";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import { SERVER_TWILIO_CALL_VOICE_VARIABLE } from "Common/Types/CallAndSMS/ServerTwilioEnvironment";
import {
  DashboardLanguage,
  SUPPORTED_DASHBOARD_LANGUAGES,
} from "Common/Types/Dashboard/DashboardLanguage";
import { PROJECT_CALL_VOICES_COPY } from "../../../FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/ProjectCallVoicesCardCopy";
import { PROJECT_CALL_VOICE_TITLE } from "../../../FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectCallVoiceWords";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

// The English docs' name of each language OneUptime writes in.
const LANGUAGE_NAMES: Record<string, string> = {
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  da: "Danish",
  no: "Norwegian",
  sv: "Swedish",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  hi: "Hindi",
  fa: "Persian",
  ar: "Arabic",
};

/*
 * WHAT THE DOCS SAY OF A CALL'S WRONG KEY AND ITS VOICE, HELD TO THE PRODUCT
 * (#10949, #10948).
 *
 *   - How to Reach Me's "What a phone call says": a wrong key - 3, # or * -
 *     is answered "That key does nothing." and asked again, at most twice,
 *     as often as the call says its keys when none is pressed; then a wrong
 *     key ends the call. Keys 1 and 2 work as always. And calls speak with
 *     the account's default voice unless an admin chooses another, linking
 *     Twilio Integration's section on it.
 *   - Twilio Integration's "The voice calls speak with": where each voice is
 *     chosen, by the names the Admin Dashboard and the Dashboard draw, the
 *     voices OneUptime offers as its list holds them, what they cost, and
 *     the field the API and Terraform take.
 */

const ON_CALL_RULES: string = "notifications/on-call-rules";
const TWILIO: string = "self-hosted/twilio-integration";

const VOICE_ANCHOR: string = "the-voice-calls-speak-with";

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const ANSWERS: OnCallInputRequest = {
  "1": { sayMessage: "You have acknowledged this incident. Good bye" },
  default: {
    sayMessage:
      "That key does nothing, so this incident is not acknowledged. Good bye.",
  },
};

// The lines of a page's section, from its heading to the next of its level or higher.
function section(markdown: string, heading: string): Array<string> {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect(start).toBeGreaterThanOrEqual(0);

  const level: number = heading.indexOf(" ");
  const end: number = lines.findIndex((line: string, index: number) => {
    if (index <= start) {
      return false;
    }

    const match: RegExpMatchArray | null = line.match(/^(#+) /);

    return Boolean(match && match[1]!.length <= level);
  });

  return lines.slice(start, end < 0 ? undefined : end);
}

describe("How to Reach Me: what a phone call says", () => {
  const lines: Array<string> = section(
    readPage("en", ON_CALL_RULES),
    "### What a phone call says",
  );
  const text: string = lines.join("\n");

  it("says a wrong key is asked again, in the call's words, at most as often as the call says its keys", () => {
    expect(text).toContain(
      'If you press a key the call did not offer, such as 3, # or *, the call says "That key does nothing." and asks for the keys again. It asks again at most twice, as often as it says the keys when you press none; after that, a wrong key ends the call and the page stays unacknowledged. Keys 1 and 2 work as they always have.',
    );

    expect(CALL_WRONG_KEY_SENTENCE).toBe("That key does nothing.");
    // "At most twice", "as often as it says the keys when you press none".
    expect(CALL_WRONG_KEY_ASKS).toBe(2);
    expect(CALL_PROMPT_REPEATS + 1).toBe(CALL_WRONG_KEY_ASKS);
  });

  it("names keys the call does not offer, # and * among them, which a prompt takes now that no key ends it", () => {
    for (const key of ["3", "#", "*"]) {
      expect(getKeyAnswer(ANSWERS, key)).toBeNull();
    }

    expect(getKeyAnswer(ANSWERS, "1")).not.toBeNull();
    expect(CALL_KEYPAD_FINISH_ON_KEY).toBe("");
  });

  it("says a call is in the person's language, in a voice of it of the account's kind, and when it is English, linking where (#11066)", () => {
    expect(text).toContain(
      "A call is in the language you read OneUptime in when the Twilio account it goes out on speaks with one of OneUptime's voices: everything it says, the answers to your keys included, in a voice of your language, a woman's if the account's voice is a woman's and a man's if it is a man's. The keys stay the same: 1 to acknowledge, 2 to escalate. A call through an account that keeps its default voice is in English, and so is a call to someone who reads OneUptime in Persian, which no voice speaks: see [The voice calls speak with](/docs/self-hosted/twilio-integration#the-voice-calls-speak-with).",
    );
    expect(text).not.toContain("always in English");
    expect(readPage("en", TWILIO)).toContain("### The voice calls speak with");

    // Every language but Persian has a voice of each kind; Persian has none.
    for (const voice of CALL_VOICES) {
      for (const language of SUPPORTED_DASHBOARD_LANGUAGES) {
        if (language.code === "en") {
          continue;
        }

        const spoken: SpokenCallVoice | null = getCallVoiceForLanguage(
          voice,
          language.code,
        );

        if (language.code === "fa") {
          expect(spoken).toBeNull();
        } else {
          expect(spoken?.gender).toBe(voice.gender);
        }
      }
    }
  });

  it.each(LANGUAGES)(
    "%s links the voice section by its own anchor",
    (language: string) => {
      const anchor: string | null = anchorInLanguage(
        language,
        TWILIO,
        VOICE_ANCHOR,
      );

      expect(anchor).not.toBeNull();
      expect(readPage(language, ON_CALL_RULES)).toContain(
        `(/docs/self-hosted/twilio-integration#${anchor!})`,
      );
    },
  );
});

describe("Twilio Integration: the voice calls speak with", () => {
  const lines: Array<string> = section(
    readPage("en", TWILIO),
    "### The voice calls speak with",
  );
  const text: string = lines.join("\n");

  // The voices table's rows: [voice, made by, how it sounds].
  const rows: Array<Array<string>> = lines
    .filter((line: string): boolean => {
      return line.startsWith("| `");
    })
    .map((line: string): Array<string> => {
      return line
        .split("|")
        .slice(1, -1)
        .map((cell: string): string => {
          return cell.trim();
        });
    });

  it("lists exactly the voices OneUptime offers, in its order, by who makes them and how they sound", () => {
    expect(rows).toEqual(
      CALL_VOICES.map((voice: CallVoice): Array<string> => {
        return [
          `\`${voice.value}\``,
          voice.provider,
          CALL_VOICE_KIND_WORDS[voice.language][voice.gender],
        ];
      }),
    );
  });

  it("says where each is chosen, by the names the Admin Dashboard and the Dashboard draw", () => {
    expect(CALL_VOICE_CARD_COPY.title).toBe("Call Voice");
    expect(TwilioConfigVoiceCopy.fieldTitle).toBe("Call Voice");
    expect(text).toContain(
      "Choose the installation-wide account's in the **Call Voice** card of **Admin Dashboard > Settings > Call and SMS**, and a project configuration's in **Call Voice** under **More fields**.",
    );
  });

  it("says the default is the account's own, free Basic voice, which Twilio says is not for production", () => {
    expect(text).toContain(
      "Calls speak with the voice your Twilio account uses by default: Twilio's free Basic voice, unless you picked another in the Twilio Console. Twilio says its Basic voices are not meant for production",
    );
    expect(text).toContain(
      "Leave **Call Voice** empty to keep the account's default voice.",
    );
  });

  it("says what the voices cost as the product says it: the most a page's call costs, in any language", () => {
    expect(CALL_VOICE_PRICE_PER_100_CHARACTERS_IN_USD).toBe(0.0032);
    expect(text).toContain(
      "$0.0032 for every 100 characters in November 2026, under 3 US cents for a page's call in any language",
    );

    for (const voice of [...CALL_VOICES, ...CALL_LANGUAGE_VOICES]) {
      expect(getCallVoiceCentsOfAPage(voice)).toBe(3);
    }
  });

  /*
   * #11066: each language's voices, as getCallVoiceForLanguage picks them,
   * in the order the language picker lists the languages, and Persian's
   * none. The table's rows start with the language's name, so the voices
   * table above reads none of them as its own.
   */
  it("lists each language's woman's and man's voice exactly as a call picks them, and Persian's none", () => {
    const calls: Array<string> = section(
      readPage("en", TWILIO),
      "#### Calls in other languages",
    );
    const languageRows: Array<Array<string>> = calls
      .filter((line: string): boolean => {
        return line.startsWith("| ") && !line.startsWith("| ---");
      })
      .slice(1)
      .map((line: string): Array<string> => {
        return line
          .split("|")
          .slice(1, -1)
          .map((cell: string): string => {
            return cell.trim();
          });
      });

    const woman: CallVoice = CALL_VOICES.find((voice: CallVoice) => {
      return voice.gender === CallVoiceGender.Female;
    })!;
    const man: CallVoice = CALL_VOICES.find((voice: CallVoice) => {
      return voice.gender === CallVoiceGender.Male;
    })!;

    // The languages with voices in the language picker's order, then Persian.
    expect(languageRows).toEqual([
      ...SUPPORTED_DASHBOARD_LANGUAGES.filter((language: DashboardLanguage) => {
        return language.code !== "en" && language.code !== "fa";
      }).map((language: DashboardLanguage): Array<string> => {
        return [
          LANGUAGE_NAMES[language.code]!,
          `\`${getCallVoiceForLanguage(woman, language.code)!.value}\``,
          `\`${getCallVoiceForLanguage(man, language.code)!.value}\``,
        ];
      }),
      [
        LANGUAGE_NAMES["fa"]!,
        "None: calls are in English",
        "None: calls are in English",
      ],
    ]);
    // Every language OneUptime writes in has its row.
    expect(languageRows).toHaveLength(SUPPORTED_DASHBOARD_LANGUAGES.length - 1);
    expect(calls.join("\n")).toContain(
      "These are the voices, from Twilio's list of neural voices, checked on 27 November 2026; they cost what the voices above cost:",
    );
    expect(calls.join("\n")).toContain(
      "Neither Amazon Polly nor Google has a Persian voice, so a call to someone who reads OneUptime in Persian is in English",
    );
  });

  // #11065: the switch, the card and the field, by the names the screens draw.
  it("says how a self-hosted installation lets each project choose its voice, by the names the screens draw", () => {
    const projects: string = section(
      readPage("en", TWILIO),
      "#### Projects that choose their own voice",
    ).join("\n");

    expect(PROJECT_CALL_VOICES_COPY.switchTitle).toBe(
      "Let projects choose their call voice",
    );
    expect(PROJECT_CALL_VOICES_COPY.cardTitle).toBe("Project Call Voices");
    expect(PROJECT_CALL_VOICE_TITLE).toBe("Call Voice");
    expect(projects).toContain(
      "turn on **Let projects choose their call voice** in the **Project Call Voices** card of **Admin Dashboard > Settings > Call and SMS**",
    );
    expect(projects).toContain(
      "chooses it in the **Call Voice** card under **More settings** in **Project Settings > Notifications > Notification Channels**",
    );
    expect(projects).toContain("OneUptime Cloud does not offer it");
    expect(projects).toContain(
      "Through the API, the voice is the project's `callVoice` field, which is refused while the switch is off.",
    );
    expect(new Project().getTableColumnMetadata("callVoice")).toBeDefined();
    expect(
      new GlobalConfig().getTableColumnMetadata("letProjectsChooseCallVoice"),
    ).toBeDefined();
  });

  // #11064: the variable, its Helm value, and what it does.
  it("names the variable and the Helm value that set the voice from code, as the server and the chart read them", () => {
    const page: string = readPage("en", TWILIO);

    expect(SERVER_TWILIO_CALL_VOICE_VARIABLE).toBe("GLOBAL_TWILIO_CALL_VOICE");
    expect(page).toContain(
      "| `GLOBAL_TWILIO_CALL_VOICE` | `twilio.callVoice` | Optional: the voice calls speak with, one of the voices in [The voice calls speak with](#the-voice-calls-speak-with).",
    );
    expect(text).toContain(
      "To set the installation-wide account's from code, use `GLOBAL_TWILIO_CALL_VOICE` (`twilio.callVoice` with Helm)",
    );
    expect(page).toContain(
      "A `GLOBAL_TWILIO_CALL_VOICE` that names no voice OneUptime offers stops no call: calls speak with the account's default voice until it is fixed",
    );

    const schema: {
      properties: {
        twilio: { properties: { callVoice: { enum: Array<unknown> } } };
      };
    } = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../../HelmChart/Public/oneuptime/values.schema.json",
        ),
        "utf8",
      ),
    );

    expect(schema.properties.twilio.properties.callVoice.enum).toEqual([
      null,
      "",
      ...CALL_VOICE_VALUES,
    ]);
  });

  it("names the field the API and Terraform take, on both accounts' records", () => {
    expect(text).toContain(
      "Through the API and Terraform, the voice is the `twilioCallVoice` field, and a voice that is not in the table is refused.",
    );
    expect(
      new ProjectCallSMSConfig().getTableColumnMetadata("twilioCallVoice"),
    ).toBeDefined();
    expect(
      new GlobalConfig().getTableColumnMetadata("twilioCallVoice"),
    ).toBeDefined();
  });

  it('sits before the voicemail section, whose "see the next section" still means network access', () => {
    const page: string = readPage("en", TWILIO);

    expect(page.indexOf("### The voice calls speak with")).toBeLessThan(
      page.indexOf("### Voicemail on on-call calls"),
    );
    expect(
      section(page, "### Voicemail on on-call calls").join("\n"),
    ).toContain("see the next section");
    expect(page.indexOf("### Voicemail on on-call calls")).toBeLessThan(
      page.indexOf("## 3. Configure network access"),
    );
  });

  it.each(LANGUAGES)(
    "%s lists the same voices, by the same names",
    (language: string) => {
      const englishLine: number = readPage("en", TWILIO)
        .split("\n")
        .indexOf("### The voice calls speak with");
      const translated: Array<string> = readPage(language, TWILIO).split("\n");

      expect(translated[englishLine]).toMatch(/^### /);

      for (const voice of CALL_VOICES) {
        expect(translated.join("\n")).toContain(
          `| \`${voice.value}\` | ${voice.provider} |`,
        );
      }

      // Each language's voices, a row each, in the English rows' places.
      const english: Array<string> = readPage("en", TWILIO).split("\n");

      english.forEach((line: string, index: number) => {
        const voices: RegExpMatchArray | null = line.match(
          /^\| [^|`]+ \| (`[^`]+`) \| (`[^`]+`) \|$/,
        );

        if (voices) {
          const cells: Array<string> = (translated[index] || "")
            .split("|")
            .slice(1, -1)
            .map((cell: string): string => {
              return cell.trim();
            });

          expect([index, cells.slice(1)]).toEqual([
            index,
            [voices[1], voices[2]],
          ]);
          expect(cells[0]).toBeTruthy();
        }
      });
    },
  );
});
