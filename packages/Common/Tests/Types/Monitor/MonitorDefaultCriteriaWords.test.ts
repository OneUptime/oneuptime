import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  createTranslator,
  getTemplatePlaceholders,
  TemplateValues,
  Translator,
} from "../../../Types/Translator";

/*
 * The words a new monitor's out-of-the-box criteria are written with: each
 * criteria's name and description, and the title and description of every
 * incident and alert it opens. Once saved they are the project's own text,
 * which its people edit like anything they typed.
 *
 * Fixtures/MonitorDefaultCriteriaWords.en.json holds them for every monitor
 * type, for a monitor named "Acme Checkout", exactly as the builders wrote
 * them before they could be written in a reader's language (#6542). A caller
 * with no reader - the server, the API, a monitor made from a template - must
 * still get exactly those, byte for byte.
 */

const MONITOR_NAME: string = "Acme Checkout";

interface OpenedWords {
  title: string;
  description: string;
}

interface CriteriaWords {
  name: string;
  description: string;
  incidents: Array<OpenedWords>;
  alerts: Array<OpenedWords>;
}

type WordsByMonitorType = Record<string, Array<CriteriaWords>>;

const ENGLISH: WordsByMonitorType = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "Fixtures",
      "MonitorDefaultCriteriaWords.en.json",
    ),
    "utf8",
  ),
) as WordsByMonitorType;

const MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

const SEED_IDS: {
  defaultMonitorStatusId: ObjectID;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  warningAlertSeverityId: ObjectID;
} = {
  defaultMonitorStatusId: new ObjectID("10000000-0000-4000-8000-000000000001"),
  onlineMonitorStatusId: new ObjectID("10000000-0000-4000-8000-000000000001"),
  offlineMonitorStatusId: new ObjectID("10000000-0000-4000-8000-000000000002"),
  defaultIncidentSeverityId: new ObjectID(
    "10000000-0000-4000-8000-000000000003",
  ),
  defaultAlertSeverityId: new ObjectID("10000000-0000-4000-8000-000000000004"),
  warningAlertSeverityId: new ObjectID("10000000-0000-4000-8000-000000000005"),
};

const openedWords: (opened: CriteriaIncident | CriteriaAlert) => OpenedWords = (
  opened: CriteriaIncident | CriteriaAlert,
): OpenedWords => {
  return { title: opened.title, description: opened.description };
};

const wordsOfCriteria: (
  monitorCriteria: MonitorCriteria,
) => Array<CriteriaWords> = (
  monitorCriteria: MonitorCriteria,
): Array<CriteriaWords> => {
  return (monitorCriteria.data?.monitorCriteriaInstanceArray || []).map(
    (instance: MonitorCriteriaInstance): CriteriaWords => {
      return {
        name: instance.data!.name,
        description: instance.data!.description,
        incidents: (instance.data!.incidents || []).map(openedWords),
        alerts: (instance.data!.alerts || []).map(openedWords),
      };
    },
  );
};

const wordsOfSteps: (monitorSteps: MonitorSteps) => Array<CriteriaWords> = (
  monitorSteps: MonitorSteps,
): Array<CriteriaWords> => {
  return wordsOfCriteria(
    monitorSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria,
  );
};

const defaultSteps: (data: {
  monitorType: MonitorType;
  monitorName?: string | undefined;
  translator?: Translator | undefined;
}) => MonitorSteps = (data: {
  monitorType: MonitorType;
  monitorName?: string | undefined;
  translator?: Translator | undefined;
}): MonitorSteps => {
  return MonitorSteps.getDefaultMonitorSteps({
    ...SEED_IDS,
    monitorType: data.monitorType,
    monitorName: data.monitorName ?? MONITOR_NAME,
    ...(data.translator ? { translator: data.translator } : {}),
  });
};

// The fixture's words with the monitor's name swapped for another, as written.
const englishFor: (
  monitorType: MonitorType,
  monitorName: string,
) => Array<CriteriaWords> = (
  monitorType: MonitorType,
  monitorName: string,
): Array<CriteriaWords> => {
  const named: (text: string) => string = (text: string): string => {
    return text.split(MONITOR_NAME).join(monitorName);
  };
  const namedOpened: (opened: OpenedWords) => OpenedWords = (
    opened: OpenedWords,
  ): OpenedWords => {
    return {
      title: named(opened.title),
      description: named(opened.description),
    };
  };

  return (ENGLISH[monitorType] || []).map(
    (criteria: CriteriaWords): CriteriaWords => {
      return {
        name: named(criteria.name),
        description: named(criteria.description),
        incidents: criteria.incidents.map(namedOpened),
        alerts: criteria.alerts.map(namedOpened),
      };
    },
  );
};

describe("a new monitor's default criteria, written with no reader", () => {
  test("the fixture holds every monitor type, and nothing else", () => {
    expect(Object.keys(ENGLISH).sort()).toEqual([...MONITOR_TYPES].sort());
  });

  test.each(MONITOR_TYPES)(
    "%s: every name, description, title and description reads in English, exactly as before",
    (monitorType: MonitorType) => {
      expect(wordsOfSteps(defaultSteps({ monitorType }))).toEqual(
        ENGLISH[monitorType],
      );
    },
  );

  test.each(MONITOR_TYPES)(
    "%s: a step and the criteria on their own read the same as the steps",
    (monitorType: MonitorType) => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        ...SEED_IDS,
        monitorType,
        monitorName: MONITOR_NAME,
      });
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          ...SEED_IDS,
          monitorType,
          monitorName: MONITOR_NAME,
        });

      expect(wordsOfCriteria(step.data!.monitorCriteria)).toEqual(
        ENGLISH[monitorType],
      );
      expect(wordsOfCriteria(criteria)).toEqual(ENGLISH[monitorType]);
    },
  );

  /*
   * The name goes in as it is written: never read as a placeholder, a
   * replacement pattern ("$&") or a translation call ("$t("), and an empty
   * name - a new monitor not named yet - leaves the sentence around it.
   */
  test.each([
    "Shop $& {{monitorName}} $t(key) 100%",
    "{{days}} {{percent}} {{keyword}} {{disconnectedProbeNames}}",
    "  padded  ",
    "",
  ])("the monitor's name %j goes in as written", (monitorName: string) => {
    for (const monitorType of MONITOR_TYPES) {
      expect({
        monitorType,
        words: wordsOfSteps(defaultSteps({ monitorType, monitorName })),
      }).toEqual({ monitorType, words: englishFor(monitorType, monitorName) });
    }
  });

  test("no default writes remediation notes", () => {
    for (const monitorType of MONITOR_TYPES) {
      const instances: Array<MonitorCriteriaInstance> = defaultSteps({
        monitorType,
      }).data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!
        .monitorCriteriaInstanceArray;

      for (const instance of instances) {
        for (const opened of [
          ...(instance.data!.incidents || []),
          ...(instance.data!.alerts || []),
        ]) {
          expect(opened.remediationNotes).toBeUndefined();
        }
      }
    }
  });
});

/*
 * With the reader's translator - the Dashboard's, for the person creating
 * the monitor - every one of those words is written in the reader's
 * language: each sentence looked up whole, its values filled in after
 * (#6542). Nothing else about the criteria changes.
 */

/*
 * A reader whose language words every sentence: each comes back marked, so
 * a word written without asking - English left in a reader's criteria -
 * would be the one thing unmarked.
 */
const MARKING: Translator = createTranslator((text: string): string => {
  return `«${text}»`;
}, "de");

const marked: (words: Array<CriteriaWords>) => Array<CriteriaWords> = (
  words: Array<CriteriaWords>,
): Array<CriteriaWords> => {
  // A criteria with no words (Manual's blank one) asks for none.
  const mark: (text: string) => string = (text: string): string => {
    return text ? `«${text}»` : text;
  };
  const markOpened: (opened: OpenedWords) => OpenedWords = (
    opened: OpenedWords,
  ): OpenedWords => {
    return { title: mark(opened.title), description: mark(opened.description) };
  };

  return words.map((criteria: CriteriaWords): CriteriaWords => {
    return {
      name: mark(criteria.name),
      description: mark(criteria.description),
      incidents: criteria.incidents.map(markOpened),
      alerts: criteria.alerts.map(markOpened),
    };
  });
};

interface LookedUp {
  template: string;
  values: TemplateValues;
}

// An English reader's translator that remembers every sentence it was asked.
const recordingTranslator: () => {
  translator: Translator;
  lookedUp: Array<LookedUp>;
} = (): { translator: Translator; lookedUp: Array<LookedUp> } => {
  const lookedUp: Array<LookedUp> = [];
  const english: Translator = createTranslator(undefined, "en");

  return {
    lookedUp,
    translator: {
      ...english,
      translateTemplate: (
        template: string,
        values?: TemplateValues,
      ): string => {
        lookedUp.push({ template, values: values || {} });
        return english.translateTemplate(template, values);
      },
    },
  };
};

// The template variables an incident is created with (MonitorTemplateUtil).
const SERVER_PLACEHOLDERS: Array<string> = [
  "disconnectedProbeNames",
  "probeStatusSummary",
];

// The words of criteria, and their generated ids: everything else stays.
const WORD_KEYS: ReadonlySet<string> = new Set<string>([
  "name",
  "description",
  "title",
]);

const withoutWordsOrIds: (value: JSONValue) => JSONValue = (
  value: JSONValue,
): JSONValue => {
  if (Array.isArray(value)) {
    return value.map((item: JSONValue) => {
      return withoutWordsOrIds(item);
    });
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    const result: JSONObject = {};

    for (const key of Object.keys(value as JSONObject)) {
      if (key === "id") {
        continue;
      }

      result[key] = WORD_KEYS.has(key)
        ? ""
        : withoutWordsOrIds((value as JSONObject)[key] as JSONValue);
    }

    return result;
  }

  return value;
};

/*
 * The customer's report: a Website monitor created with the Dashboard in
 * Chinese. Only what this test's locale words is translated; the one
 * sentence it leaves out reads wholly in English, never half and half.
 */
const ZH_CN: Record<string, string> = {
  "Check if {{monitorName}} is offline": "检查 {{monitorName}} 是否离线",
  "This criteria checks if the {{monitorName}} is offline or responds with an error status code":
    "此条件检查 {{monitorName}} 是否离线，或是否返回错误状态码",
  "{{monitorName}} is offline": "{{monitorName}} 已离线",
  "{{monitorName}} is not responding, or is responding with an error status code.":
    "{{monitorName}} 没有响应，或返回了错误状态码。",
  "Check if {{monitorName}} is online": "检查 {{monitorName}} 是否在线",
  "This criteria checks if the {{monitorName}} SSL certificate is valid but expires in {{days}} days or less":
    "此条件检查 {{monitorName}} 的 SSL 证书是否有效但在 {{days}} 天内到期",
  "Probe disconnected: {{disconnectedProbeNames}}":
    "探针已断开：{{disconnectedProbeNames}}",
};

const CHINESE: Translator = createTranslator(
  (text: string): string | undefined => {
    return ZH_CN[text];
  },
  "zh-CN",
);

describe("a new monitor's default criteria, written for a reader", () => {
  test("a Website monitor created in Chinese names its criteria, and the incident and alert it opens, in Chinese", () => {
    expect(
      wordsOfSteps(
        defaultSteps({ monitorType: MonitorType.Website, translator: CHINESE }),
      ),
    ).toEqual([
      {
        name: "检查 Acme Checkout 是否离线",
        description: "此条件检查 Acme Checkout 是否离线，或是否返回错误状态码",
        incidents: [
          {
            title: "Acme Checkout 已离线",
            description: "Acme Checkout 没有响应，或返回了错误状态码。",
          },
        ],
        alerts: [
          {
            title: "Acme Checkout 已离线",
            description: "Acme Checkout 没有响应，或返回了错误状态码。",
          },
        ],
      },
      {
        name: "检查 Acme Checkout 是否在线",
        description:
          "This criteria checks if the Acme Checkout is online and responds with a 2xx or 3xx status code",
        incidents: [],
        alerts: [],
      },
    ]);
  });

  test.each(MONITOR_TYPES)(
    "%s: every name, description, title and description is the reader's, each sentence looked up whole",
    (monitorType: MonitorType) => {
      expect(
        wordsOfSteps(defaultSteps({ monitorType, translator: MARKING })),
      ).toEqual(marked(ENGLISH[monitorType] || []));
    },
  );

  test.each(MONITOR_TYPES)(
    "%s: a step and the criteria on their own are written for the reader too",
    (monitorType: MonitorType) => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        ...SEED_IDS,
        monitorType,
        monitorName: MONITOR_NAME,
        translator: MARKING,
      });
      const criteria: MonitorCriteria =
        MonitorCriteria.getDefaultMonitorCriteria({
          ...SEED_IDS,
          monitorType,
          monitorName: MONITOR_NAME,
          translator: MARKING,
        });

      expect(wordsOfCriteria(step.data!.monitorCriteria)).toEqual(
        marked(ENGLISH[monitorType] || []),
      );
      expect(wordsOfCriteria(criteria)).toEqual(
        marked(ENGLISH[monitorType] || []),
      );
    },
  );

  test.each(MONITOR_TYPES)(
    "%s: only the words change - filters, statuses, severities and what is opened are the same",
    (monitorType: MonitorType) => {
      expect(
        withoutWordsOrIds(
          defaultSteps({ monitorType, translator: MARKING }).toJSON(),
        ),
      ).toEqual(withoutWordsOrIds(defaultSteps({ monitorType }).toJSON()));
    },
  );

  test.each(MONITOR_TYPES)(
    "%s: an English reader's words are the English ones, exactly",
    (monitorType: MonitorType) => {
      // en.json gives every sentence as its own text; a bare translator has none.
      for (const translator of [
        createTranslator((text: string): string => {
          return text;
        }, "en"),
        createTranslator(undefined, "en"),
      ]) {
        expect(wordsOfSteps(defaultSteps({ monitorType, translator }))).toEqual(
          ENGLISH[monitorType],
        );
      }
    },
  );

  test.each([
    "Shop $& {{monitorName}} $t(key) 100%",
    "{{days}} {{percent}} {{keyword}} {{disconnectedProbeNames}}",
    "  padded  ",
    "",
  ])(
    "the monitor's name %j goes into the reader's sentences as written",
    (monitorName: string) => {
      for (const monitorType of MONITOR_TYPES) {
        expect({
          monitorType,
          words: wordsOfSteps(
            defaultSteps({ monitorType, monitorName, translator: MARKING }),
          ),
        }).toEqual({
          monitorType,
          words: marked(englishFor(monitorType, monitorName)),
        });
      }
    },
  );

  test("a value goes wherever the reader's sentence puts it, and the server's template variables are left for the server", () => {
    const ssl: Array<CriteriaWords> = wordsOfSteps(
      defaultSteps({
        monitorType: MonitorType.SSLCertificate,
        translator: CHINESE,
      }),
    );

    expect(ssl[1]!.description).toBe(
      `此条件检查 Acme Checkout 的 SSL 证书是否有效但在 ${MonitorCriteriaInstance.DEFAULT_SSL_CERTIFICATE_EXPIRY_WARNING_DAYS} 天内到期`,
    );

    const probeStatus: Array<CriteriaWords> = wordsOfSteps(
      defaultSteps({
        monitorType: MonitorType.ProbeStatus,
        translator: CHINESE,
      }),
    );

    expect(probeStatus[0]!.incidents[0]!.title).toBe(
      "探针已断开：{{disconnectedProbeNames}}",
    );
    expect(probeStatus[0]!.alerts[0]!.title).toBe(
      "探针已断开：{{disconnectedProbeNames}}",
    );
  });

  /*
   * A translator words a sentence from its template alone. So every
   * placeholder a template names is a value it is given, or one the server
   * fills when the incident is created - and every value given is named,
   * or a translation could never place it.
   */
  test.each(MONITOR_TYPES)(
    "%s: each sentence looked up names exactly the values it is given, and the server's own",
    (monitorType: MonitorType) => {
      const { translator, lookedUp } = recordingTranslator();

      defaultSteps({ monitorType, translator });

      for (const { template, values } of lookedUp) {
        const placeholders: Array<string> = getTemplatePlaceholders(template);

        expect({
          template,
          placeholders: [...placeholders].sort(),
        }).toEqual({
          template,
          placeholders: [
            ...Object.keys(values),
            ...SERVER_PLACEHOLDERS.filter((name: string) => {
              return placeholders.includes(name);
            }),
          ].sort(),
        });
      }
    },
  );
});
