import { describe, expect, test } from "@jest/globals";
import {
  createTranslator,
  TextLookup,
  toSentenceTerm,
  translatableTerm,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A TERM IN THE MIDDLE OF A SENTENCE, IN A LANGUAGE WITHOUT LETTER CASE
 * (#7951).
 *
 * toSentenceTerm writes a label as the middle of a sentence takes it. In
 * English, the Latin-script languages and Russian a label's capitals are
 * title case, and a sentence lowers them: "Kubernetes Pod" reads "This
 * Kubernetes pod". Japanese, Chinese, Korean, Hindi, Persian and Arabic have
 * no letter case of their own, but their translations carry Latin words and
 * write each one with the capital the translator meant: Japanese writes
 * "Pod" 408 times to once. Lowered like an English label, the inventory's
 * empty state read "このKubernetes podには". A term in those languages reads
 * as its translation writes it, as a German one does; proper nouns and
 * abbreviations keep their capitals everywhere.
 */

// The product's languages whose script has no letter case.
const PRODUCT_CASELESS_LANGUAGES: ReadonlyArray<string> = [
  "ja",
  "zh-CN",
  "zh-TW",
  "ko",
  "hi",
  "fa",
  "ar",
];

// Languages without letter case OneUptime is not translated into yet.
const OTHER_CASELESS_LANGUAGES: ReadonlyArray<string> = ["he", "ur", "th"];

const CASELESS_LANGUAGES: ReadonlyArray<string> = [
  ...PRODUCT_CASELESS_LANGUAGES,
  ...OTHER_CASELESS_LANGUAGES,
];

// Languages whose label capitals are title case, which a sentence lowers.
const LOWERING_LANGUAGES: ReadonlyArray<string> = [
  "en",
  "da",
  "es",
  "fr",
  "it",
  "nl",
  "no",
  "pt",
  "sv",
  "ru",
];

// Languages that capitalize every noun.
const NOUN_CAPITALIZING_LANGUAGES: ReadonlyArray<string> = ["de", "lb"];

const ALL_LANGUAGES: ReadonlyArray<string> = [
  ...CASELESS_LANGUAGES,
  ...LOWERING_LANGUAGES,
  ...NOUN_CAPITALIZING_LANGUAGES,
];

/*
 * Labels as the product writes them in English, and as a translation in a
 * caseless language keeps them, each holding a Latin word a sentence in
 * English would lower.
 */
const LATIN_LABELS: ReadonlyArray<string> = [
  "Kubernetes Pod",
  "Kubernetes Namespace",
  "Kubernetes Deployment",
  "Docker Host",
  "AWS Account",
  "VM Hosts",
  "CPU Usage",
  "Pod",
  "Namespace",
  "Deployment",
  "On-Call Duty Policies",
  "Browser Application",
];

const casesOf: (
  languages: ReadonlyArray<string>,
  labels: ReadonlyArray<string>,
) => Array<[string, string]> = (
  languages: ReadonlyArray<string>,
  labels: ReadonlyArray<string>,
): Array<[string, string]> => {
  return languages.flatMap((language: string): Array<[string, string]> => {
    return labels.map((label: string): [string, string] => {
      return [language, label];
    });
  });
};

describe("toSentenceTerm in a language without letter case", () => {
  test.each(casesOf(CASELESS_LANGUAGES, LATIN_LABELS))(
    "%s keeps %s as written",
    (language: string, label: string) => {
      expect(toSentenceTerm(label, language)).toBe(label);
    },
  );

  // Each language's own words for a type, from its Dashboard file.
  test.each([
    ["ja", "Kubernetes Pod"],
    ["ja", "Kubernetes Namespace"],
    ["ja", "Docker ホスト"],
    ["ja", "AWS アカウント"],
    ["zh-CN", "Kubernetes Pod"],
    ["zh-CN", "Docker 主机"],
    ["zh-TW", "OpenStack Instance"],
    ["zh-TW", "Docker 主機"],
    ["ko", "Kubernetes Pod"],
    ["ko", "Kubernetes 파드"],
    ["hi", "Serverless फ़ंक्शन"],
    ["hi", "Docker होस्ट"],
    ["fa", "Deployment در Kubernetes"],
    ["fa", "Namespace در Kubernetes"],
    ["fa", "Datastore VMware"],
    ["fa", "پاد Kubernetes"],
    ["ar", "Pod في Kubernetes"],
    ["ar", "Deployment في Kubernetes"],
    ["ar", "مضيف Docker"],
    ["he", "Pod של Kubernetes"],
    ["ur", "Kubernetes Pod"],
    ["th", "Pod ของ Kubernetes"],
  ])(
    "%s writes %s mid-sentence as its file does",
    (language: string, text: string) => {
      expect(toSentenceTerm(text, language)).toBe(text);
    },
  );

  /*
   * The translator's lower case is kept just as their capitals are: Arabic
   * writes "pod" in its sentences.
   */
  test.each([
    ["ar", "الـ pod في Kubernetes"],
    ["ar", "deployment"],
    ["fa", "pod"],
    ["ja", "kubectl コマンド"],
  ])("%s keeps the lower case of %s too", (language: string, text: string) => {
    expect(toSentenceTerm(text, language)).toBe(text);
  });

  test.each([
    "ja-JP",
    "zh_CN",
    "ZH-tw",
    "zh-Hant",
    "ko-KR",
    "hi-IN",
    "fa-IR",
    "fa_AF",
    "ar-EG",
    "AR",
    "he-IL",
  ])(
    "a region or a script in the code (%s) reads the same",
    (language: string) => {
      expect(toSentenceTerm("Kubernetes Pod", language)).toBe("Kubernetes Pod");
    },
  );

  test("its spaces still collapse and its ends are trimmed", () => {
    expect(toSentenceTerm("  Kubernetes   Pod  ", "ja")).toBe("Kubernetes Pod");
    expect(toSentenceTerm("\tپاد  Kubernetes\n", "fa")).toBe("پاد Kubernetes");
    expect(toSentenceTerm("   ", "ar")).toBe("");
    expect(toSentenceTerm("", "zh-CN")).toBe("");
  });

  test("a word of its own script is unchanged, as it always was", () => {
    expect(toSentenceTerm("インシデント", "ja")).toBe("インシデント");
    expect(toSentenceTerm("주기적 점검", "ko")).toBe("주기적 점검");
    expect(toSentenceTerm("خادم قاعدة البيانات", "ar")).toBe(
      "خادم قاعدة البيانات",
    );
  });
});

describe("toSentenceTerm in a language with letter case", () => {
  test.each([
    ["en", "Kubernetes Pod", "Kubernetes pod"],
    ["en", "Kubernetes Namespace", "Kubernetes namespace"],
    ["en", "Docker Host", "Docker host"],
    ["en", "AWS Account", "AWS account"],
    ["en", "VM Hosts", "VM hosts"],
    ["en", "CPU Usage", "CPU usage"],
    ["en", "Deployment", "deployment"],
    ["en", "On-Call Duty Policies", "on-call duty policies"],
    ["fr", "Pod Kubernetes", "pod Kubernetes"],
    ["fr", "Hôte Docker", "hôte Docker"],
    ["fr", "Compte AWS", "compte AWS"],
    ["es", "Clúster De Kubernetes", "clúster de Kubernetes"],
    ["it", "Host Docker", "host Docker"],
    ["pt", "Conta AWS", "conta AWS"],
    ["nl", "Kubernetes-Pod", "Kubernetes-pod"],
    ["sv", "Kubernetes-Poddar", "Kubernetes-poddar"],
    ["da", "Docker-Vært", "Docker-vært"],
    ["no", "Kubernetes-Pod", "Kubernetes-pod"],
    // Cyrillic has case: Russian's capitals are a label's, and its Latin words too.
    ["ru", "Под Kubernetes", "под Kubernetes"],
    ["ru", "Хост Docker", "хост Docker"],
    ["ru", "Deployment Kubernetes", "deployment Kubernetes"],
  ])(
    "%s writes %s as %s mid-sentence",
    (language: string, label: string, expected: string) => {
      expect(toSentenceTerm(label, language)).toBe(expected);
    },
  );

  test.each([
    ["de", "Kubernetes-Pod"],
    ["de", "Docker-Host"],
    ["de", "AWS-Konto"],
    ["de", "Bereitschaftsrichtlinien"],
    ["lb", "Kubernetes-Pod"],
  ])(
    "%s, which capitalizes its nouns, keeps %s",
    (language: string, label: string) => {
      expect(toSentenceTerm(label, language)).toBe(label);
    },
  );

  test("a language that is not a code still lowers, as English does", () => {
    expect(toSentenceTerm("Kubernetes Pod", "not-a-language!!")).toBe(
      "Kubernetes pod",
    );
    expect(toSentenceTerm("Kubernetes Pod")).toBe("Kubernetes pod");
  });

  // "ja" or "ar" inside another code is not that language.
  test.each(["jam", "ark", "fake", "hil", "kok", "tha"])(
    "%s is not a language without letter case",
    (language: string) => {
      expect(toSentenceTerm("Kubernetes Pod", language)).toBe("Kubernetes pod");
    },
  );
});

describe("names and abbreviations, in every language", () => {
  test.each(
    casesOf(ALL_LANGUAGES, [
      "Kubernetes",
      "Docker",
      "AWS",
      "CPU",
      "VM",
      "IoT",
      "vCenter",
      "OneUptime",
      "Google Cloud",
      "Microsoft Teams",
    ]),
  )("%s keeps %s", (language: string, name: string) => {
    expect(toSentenceTerm(name, language)).toBe(name);
  });
});

/*
 * The term in a whole sentence, filled by the translator from a stub
 * translation, as the inventory's empty state fills its type.
 */

type Dictionary = Record<string, string>;

const lookupFrom: (dictionary: Dictionary) => TextLookup = (
  dictionary: Dictionary,
): TextLookup => {
  return (text: string): string | undefined => {
    return dictionary[text];
  };
};

const SENTENCE: string = "This {{type}} does not carry its own.";

const SENTENCE_START: string = "{{type}} does not carry its own.";

// The sentence, and where it starts with the type, in each language.
const SENTENCES: Record<string, { middle: string; start: string }> = {
  ja: {
    middle: "この{{type}}には独自のものはありません。",
    start: "{{type}}には独自のものはありません。",
  },
  "zh-CN": {
    middle: "此{{type}}没有自己的。",
    start: "{{type}}没有自己的。",
  },
  "zh-TW": {
    middle: "此{{type}}沒有自己的。",
    start: "{{type}}沒有自己的。",
  },
  ko: {
    middle: "이 {{type}}에는 자체 항목이 없습니다.",
    start: "{{type}}에는 자체 항목이 없습니다.",
  },
  hi: {
    middle: "इस {{type}} का अपना कुछ नहीं है।",
    start: "{{type}} का अपना कुछ नहीं है।",
  },
  fa: {
    middle: "این {{type}} موارد خودش را ندارد.",
    start: "{{type}} موارد خودش را ندارد.",
  },
  ar: {
    middle: "لا يحمل هذا العنصر ({{type}}) ما يخصه.",
    start: "{{type}} لا يحمل ما يخصه.",
  },
  he: {
    middle: "ל-{{type}} הזה אין משלו.",
    start: "{{type}} אין משלו.",
  },
  fr: {
    middle: "Ce {{type}} n'a pas les siens.",
    start: "{{type}} n'a pas les siens.",
  },
  de: {
    middle: "Dieser {{type}} hat keine eigenen.",
    start: "{{type}} hat keine eigenen.",
  },
  ru: {
    middle: "У этого {{type}} нет своих.",
    start: "{{type}} не имеет своих.",
  },
};

const translatorIn: (language: string, words?: Dictionary) => Translator = (
  language: string,
  words: Dictionary = {},
): Translator => {
  const sentences: { middle: string; start: string } | undefined =
    SENTENCES[language];

  return createTranslator(
    lookupFrom({
      ...(sentences
        ? { [SENTENCE]: sentences.middle, [SENTENCE_START]: sentences.start }
        : {}),
      ...words,
    }),
    language,
  );
};

const typeIn: (
  translator: Translator,
  template: string,
  type: string,
) => string = (
  translator: Translator,
  template: string,
  type: string,
): string => {
  return withoutIsolateMarks(
    translator.translateTemplate(template, {
      type: translatableTerm(type, { inSentence: true }),
    }),
  );
};

describe("a type in the middle of a translated sentence", () => {
  /*
   * The sentence's own key for the type is lower-case, as Japanese's
   * "Kubernetes pod" is, and each language words it "Kubernetes Pod".
   */
  test.each([
    ["ja", "このKubernetes Podには独自のものはありません。"],
    ["zh-CN", "此Kubernetes Pod没有自己的。"],
    ["zh-TW", "此Kubernetes Pod沒有自己的。"],
    ["ko", "이 Kubernetes Pod에는 자체 항목이 없습니다."],
    ["hi", "इस Kubernetes Pod का अपना कुछ नहीं है।"],
    ["fa", "این Kubernetes Pod موارد خودش را ندارد."],
    ["ar", "لا يحمل هذا العنصر (Kubernetes Pod) ما يخصه."],
    ["he", "ל-Kubernetes Pod הזה אין משלו."],
  ])(
    "%s keeps its translation's Kubernetes Pod: %s",
    (language: string, expected: string) => {
      const sentence: string = typeIn(
        translatorIn(language, { "Kubernetes pod": "Kubernetes Pod" }),
        SENTENCE,
        "Kubernetes pod",
      );

      expect(sentence).toBe(expected);
      expect(sentence).not.toContain("Kubernetes pod");
    },
  );

  /*
   * A file that words the type as English does ("Kubernetes Pod":
   * "Kubernetes Pod", as Japanese's does) reads to the lookup as no
   * translation at all, so the English text is kept as written too.
   */
  test.each(PRODUCT_CASELESS_LANGUAGES)(
    "%s keeps a type it words as English does",
    (language: string) => {
      const sentence: string = typeIn(
        translatorIn(language, { "Kubernetes Pod": "Kubernetes Pod" }),
        SENTENCE,
        "Kubernetes Pod",
      );

      expect(sentence).toContain("Kubernetes Pod");
      expect(sentence).not.toContain("Kubernetes pod");
    },
  );

  test("each language's own words for a type stay as its file writes them", () => {
    expect(
      typeIn(
        translatorIn("fa", {
          "Kubernetes Deployment": "Deployment در Kubernetes",
        }),
        SENTENCE,
        "Kubernetes Deployment",
      ),
    ).toBe("این Deployment در Kubernetes موارد خودش را ندارد.");
    expect(
      typeIn(
        translatorIn("ar", { "Kubernetes Pod": "Pod في Kubernetes" }),
        SENTENCE,
        "Kubernetes Pod",
      ),
    ).toBe("لا يحمل هذا العنصر (Pod في Kubernetes) ما يخصه.");
    expect(
      typeIn(
        translatorIn("ja", { "Docker Host": "Docker ホスト" }),
        SENTENCE,
        "Docker Host",
      ),
    ).toBe("このDocker ホストには独自のものはありません。");
  });

  test("English and French lower the label's capitals; German keeps them", () => {
    expect(typeIn(translatorIn("en"), SENTENCE, "Kubernetes Pod")).toBe(
      "This Kubernetes pod does not carry its own.",
    );
    expect(
      typeIn(
        translatorIn("fr", { "Kubernetes Pod": "Pod Kubernetes" }),
        SENTENCE,
        "Kubernetes Pod",
      ),
    ).toBe("Ce pod Kubernetes n'a pas les siens.");
    expect(
      typeIn(
        translatorIn("de", { "Kubernetes Pod": "Kubernetes-Pod" }),
        SENTENCE,
        "Kubernetes Pod",
      ),
    ).toBe("Dieser Kubernetes-Pod hat keine eigenen.");
    expect(
      typeIn(
        translatorIn("ru", { "Kubernetes Pod": "Пода Kubernetes" }),
        SENTENCE,
        "Kubernetes Pod",
      ),
    ).toBe("У этого пода Kubernetes нет своих.");
  });

  test.each(Object.keys(SENTENCES))(
    "%s keeps an abbreviation's capitals in the sentence",
    (language: string) => {
      const keepsLabels: boolean =
        CASELESS_LANGUAGES.includes(language) ||
        NOUN_CAPITALIZING_LANGUAGES.includes(language);

      expect(typeIn(translatorIn(language), SENTENCE, "CPU")).toContain("CPU");
      expect(typeIn(translatorIn(language), SENTENCE, "VM")).toContain("VM");
      expect(typeIn(translatorIn(language), SENTENCE, "AWS Account")).toContain(
        keepsLabels ? "AWS Account" : "AWS account",
      );
    },
  );
});

describe("a type that starts a translated sentence", () => {
  test.each([
    ["ja", "Kubernetes Podには独自のものはありません。"],
    ["zh-CN", "Kubernetes Pod没有自己的。"],
    ["ko", "Kubernetes Pod에는 자체 항목이 없습니다."],
    ["hi", "Kubernetes Pod का अपना कुछ नहीं है।"],
    ["fa", "Kubernetes Pod موارد خودش را ندارد."],
    ["ar", "Kubernetes Pod لا يحمل ما يخصه."],
  ])(
    "%s starts with the type as written: %s",
    (language: string, expected: string) => {
      expect(
        typeIn(translatorIn(language), SENTENCE_START, "Kubernetes Pod"),
      ).toBe(expected);
    },
  );

  test.each([
    ["ja", "CPU", "CPUには独自のものはありません。"],
    ["ja", "インシデント", "インシデントには独自のものはありません。"],
    ["fa", "VM", "VM موارد خودش را ندارد."],
    ["ar", "AWS", "AWS لا يحمل ما يخصه."],
  ])(
    "%s starts with %s unchanged",
    (language: string, type: string, expected: string) => {
      expect(typeIn(translatorIn(language), SENTENCE_START, type)).toBe(
        expected,
      );
    },
  );

  test("English starts with a capital, and lowers the rest of the label", () => {
    expect(typeIn(translatorIn("en"), SENTENCE_START, "Kubernetes Pod")).toBe(
      "Kubernetes pod does not carry its own.",
    );
    expect(typeIn(translatorIn("en"), SENTENCE_START, "Monitors")).toBe(
      "Monitors does not carry its own.",
    );
    expect(typeIn(translatorIn("en"), SENTENCE_START, "VM Hosts")).toBe(
      "VM hosts does not carry its own.",
    );
  });

  test("French and Russian start with a capital the sentence gives the term", () => {
    expect(
      typeIn(
        translatorIn("fr", { "Kubernetes Pod": "Pod Kubernetes" }),
        SENTENCE_START,
        "Kubernetes Pod",
      ),
    ).toBe("Pod Kubernetes n'a pas les siens.");
    expect(
      typeIn(
        translatorIn("ru", { "Kubernetes Pod": "Под Kubernetes" }),
        SENTENCE_START,
        "Kubernetes Pod",
      ),
    ).toBe("Под Kubernetes не имеет своих.");
  });
});

/*
 * A TERM THAT STARTS A SENTENCE IN A LANGUAGE WITHOUT LETTER CASE KEEPS ITS
 * TRANSLATOR'S LOWER CASE (#8252).
 *
 * An inSentence term takes a capital where it starts a sentence (toLabelTerm
 * through toSentenceValue): French "Pod Kubernetes n'a pas les siens.". In a
 * language whose script has no letter case that capital is one the
 * translator did not write: Persian words a plural "persistent volume
 * claimها", Arabic "cron مخصص" and "deployment", and none of their sentences
 * starts with a capital. There the term starts the sentence as its
 * translation writes it, as it reads in the middle of one.
 */
describe("a lower-case term that starts a sentence in a language without letter case", () => {
  test.each([
    [
      "fa",
      "persistent volume claimها",
      "persistent volume claimها موارد خودش را ندارد.",
    ],
    ["fa", "pod", "pod موارد خودش را ندارد."],
    ["ar", "cron مخصص", "cron مخصص لا يحمل ما يخصه."],
    ["ar", "deployment", "deployment لا يحمل ما يخصه."],
    ["hi", "namespace", "namespace का अपना कुछ नहीं है।"],
    ["ko", "pod", "pod에는 자체 항목이 없습니다."],
    ["ja", "pod", "podには独自のものはありません。"],
    ["zh-CN", "namespace", "namespace没有自己的。"],
    ["zh-TW", "namespace", "namespace沒有自己的。"],
    ["he", "deployment", "deployment אין משלו."],
  ])(
    "%s starts with %s as written",
    (language: string, type: string, expected: string) => {
      expect(typeIn(translatorIn(language), SENTENCE_START, type)).toBe(
        expected,
      );
    },
  );

  test.each(PRODUCT_CASELESS_LANGUAGES)(
    "%s writes the term the same at the start of a sentence as in its middle",
    (language: string) => {
      const start: string = typeIn(
        translatorIn(language),
        SENTENCE_START,
        "deployment",
      );
      const middle: string = typeIn(
        translatorIn(language),
        SENTENCE,
        "deployment",
      );

      expect(start).toContain("deployment");
      expect(middle).toContain("deployment");
      expect(start).not.toContain("Deployment");
    },
  );

  test.each(["ja-JP", "zh_TW", "fa-IR", "AR"])(
    "a region or a script in the code (%s) keeps it too",
    (language: string) => {
      expect(
        withoutIsolateMarks(
          createTranslator(
            lookupFrom({ [SENTENCE_START]: "{{type}} ..." }),
            language,
          ).translateTemplate(SENTENCE_START, {
            type: translatableTerm("deployment", { inSentence: true }),
          }),
        ),
      ).toBe("deployment ...");
    },
  );

  test("a capital the translator wrote stays", () => {
    expect(typeIn(translatorIn("ar"), SENTENCE_START, "Deployment")).toBe(
      "Deployment لا يحمل ما يخصه.",
    );
  });

  test("a language with letter case still starts the sentence with a capital", () => {
    expect(
      typeIn(
        translatorIn("fr", { "Kubernetes Pod": "pod Kubernetes" }),
        SENTENCE_START,
        "Kubernetes Pod",
      ),
    ).toBe("Pod Kubernetes n'a pas les siens.");
    expect(
      typeIn(
        translatorIn("ru", { "Kubernetes Pod": "под Kubernetes" }),
        SENTENCE_START,
        "Kubernetes Pod",
      ),
    ).toBe("Под Kubernetes не имеет своих.");
  });

  test("a name written in lower case starts a sentence in lower case, in English too", () => {
    expect(typeIn(translatorIn("en"), SENTENCE_START, "kubectl command")).toBe(
      "kubectl command does not carry its own.",
    );
    expect(
      typeIn(
        translatorIn("fr", { "kubectl command": "commande kubectl" }),
        SENTENCE_START,
        "kubectl command",
      ),
    ).toBe("Commande kubectl n'a pas les siens.");
    expect(
      typeIn(
        translatorIn("de", { "systemd unit": "systemd-Unit" }),
        SENTENCE_START,
        "systemd unit",
      ),
    ).toBe("systemd-Unit hat keine eigenen.");
  });
});
