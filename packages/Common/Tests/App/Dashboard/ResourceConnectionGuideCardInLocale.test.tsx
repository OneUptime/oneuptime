import "@testing-library/jest-dom";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import ResourceConnectionGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuideCard";
import {
  ResourceConnectionGuide,
  getCephClusterConnectionGuide,
  getCloudResourceConnectionGuide,
  getDockerHostConnectionGuide,
  getDockerSwarmClusterConnectionGuide,
  getHostConnectionGuide,
  getIoTFleetConnectionGuide,
  getKubernetesClusterConnectionGuide,
  getOpenStackCloudConnectionGuide,
  getPodmanHostConnectionGuide,
  getProxmoxClusterConnectionGuide,
  getRumApplicationConnectionGuide,
  getServerlessFunctionConnectionGuide,
  getStorageArrayConnectionGuide,
  getVMwareVCenterConnectionGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import Route from "../../../Types/API/Route";
import {
  isTranslatableTerm,
  TranslatableTerm,
  translatableTerm,
} from "../../../Types/Translator";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE "HOW DO I CONNECT THIS?" CARD, DRAWN IN EVERY LANGUAGE (issue
 * #6308).
 *
 * The card is drawn for real, for every kind of resource and every state it
 * explains - nothing has ever arrived, data stopped (or a resource that is
 * idle when unused went quiet), a host OneUptime installed the collector on
 * while it starts and once its first data is late - in each of the sixteen
 * languages, with the shipped locale files. Every sentence it draws of its
 * own - its title, its sentence, the line that shows folded checks, its
 * link, each step's title and description - must differ from the English
 * card's: so a sentence filled in with a value (a cluster's name, an
 * attribute, when it was last heard from), or one a guide builds, is read
 * in the reader's language as a whole, never left English, never English
 * around a translated word. Commands are code, the same in every language,
 * and are left out.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

const ONEUPTIME_URL: string = "https://oneuptime.example.com";
const DOCS: Route = new Route("/dashboard/project-1/resource-1/documentation");
const MINUTE: number = 60 * 1000;

interface CardCase {
  name: string;
  // Built in the reader's language: a guide fills its sentences when built.
  build: () => ResourceConnectionGuide;
}

const CASES: ReadonlyArray<CardCase> = [
  {
    name: "Kubernetes cluster",
    build: (): ResourceConnectionGuide => {
      return getKubernetesClusterConnectionGuide("prod-east");
    },
  },
  {
    name: "Docker host",
    build: (): ResourceConnectionGuide => {
      return getDockerHostConnectionGuide("web-01");
    },
  },
  {
    name: "Podman host",
    build: (): ResourceConnectionGuide => {
      return getPodmanHostConnectionGuide("web-02");
    },
  },
  {
    name: "Docker Swarm cluster",
    build: (): ResourceConnectionGuide => {
      return getDockerSwarmClusterConnectionGuide("swarm-a", ONEUPTIME_URL);
    },
  },
  {
    name: "Proxmox cluster",
    build: (): ResourceConnectionGuide => {
      return getProxmoxClusterConnectionGuide("pve-a", ONEUPTIME_URL);
    },
  },
  {
    name: "OpenStack cloud",
    build: (): ResourceConnectionGuide => {
      return getOpenStackCloudConnectionGuide("cloud-a", ONEUPTIME_URL);
    },
  },
  {
    name: "Ceph cluster",
    build: (): ResourceConnectionGuide => {
      return getCephClusterConnectionGuide("ceph-a", ONEUPTIME_URL);
    },
  },
  {
    name: "storage array",
    build: (): ResourceConnectionGuide => {
      return getStorageArrayConnectionGuide("array-a", ONEUPTIME_URL);
    },
  },
  {
    name: "vCenter",
    build: (): ResourceConnectionGuide => {
      return getVMwareVCenterConnectionGuide("vc-a", ONEUPTIME_URL);
    },
  },
  {
    name: "host set up by hand",
    build: (): ResourceConnectionGuide => {
      return getHostConnectionGuide("db-01");
    },
  },
  {
    name: "host OneUptime installed the collector on, starting",
    build: (): ResourceConnectionGuide => {
      return getHostConnectionGuide("db-02", {
        isManaged: true,
        osType: "linux",
        registeredAt: new Date(Date.now() - MINUTE),
      });
    },
  },
  {
    name: "host OneUptime installed the collector on, its data late",
    build: (): ResourceConnectionGuide => {
      return getHostConnectionGuide("db-03", {
        isManaged: true,
        osType: "windows",
        registeredAt: new Date(Date.now() - 30 * MINUTE),
      });
    },
  },
  {
    name: "IoT fleet",
    build: (): ResourceConnectionGuide => {
      return getIoTFleetConnectionGuide("sensors-a");
    },
  },
  {
    name: "cloud environment",
    build: (): ResourceConnectionGuide => {
      return getCloudResourceConnectionGuide({
        cloudPlatform: "aws_ecs",
        cloudAccountId: "123456789012",
        cloudRegion: "us-east-1",
      });
    },
  },
  {
    name: "RUM application",
    build: (): ResourceConnectionGuide => {
      return getRumApplicationConnectionGuide("shop-web");
    },
  },
  {
    name: "serverless function",
    build: (): ResourceConnectionGuide => {
      return getServerlessFunctionConnectionGuide("resize-image", "aws_lambda");
    },
  },
  {
    name: "Azure Functions function",
    build: (): ResourceConnectionGuide => {
      return getServerlessFunctionConnectionGuide(
        "resize-image",
        "azure_functions",
      );
    },
  },
];

// Nothing has ever arrived, or data stopped three hours ago.
const STATES: ReadonlyArray<{
  name: string;
  lastSeenAt: () => Date | undefined;
}> = [
  {
    name: "before its first data",
    lastSeenAt: (): undefined => {
      return undefined;
    },
  },
  {
    name: "once data stopped",
    lastSeenAt: (): Date => {
      return new Date(Date.now() - 3 * 60 * MINUTE);
    },
  },
];

// A placeholder nothing filled, or a value that was missing (Italian "nulla" is a word).
const LEFT_UNFILLED: RegExp = /\{\{|\bundefined\b|\bnull\b/;

// A status left in English inside a translated sentence.
const ENGLISH_STATUS_WORD: RegExp =
  /\bConnected\b|\bDisconnected\b|\bReceiving data\b/;

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

async function useLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

/*
 * Every sentence the card draws of its own, in order: its title and
 * sentence, the line that shows folded checks, its link, and each step's
 * title and description (steps folded away included: they are drawn,
 * hidden until shown).
 */
function drawnSentences(
  build: () => ResourceConnectionGuide,
  lastSeenAt: Date | undefined,
): Array<string> {
  const { container } = render(
    <ResourceConnectionGuideCard
      status="disconnected"
      lastSeenAt={lastSeenAt}
      guide={build()}
      documentationRoute={DOCS}
    />,
  );

  const card: Element | null = container.querySelector(
    '[data-testid="resource-connection-guide"]',
  );

  const sentences: Array<string> = Array.from(
    card?.querySelectorAll(
      'h2, h3, p, a span, [data-testid="resource-connection-guide-steps-toggle"] span',
    ) || [],
  ).map((element: Element): string => {
    return (element.textContent || "").trim();
  });

  cleanup();

  return sentences;
}

const ENGLISH_CARDS: Map<string, Array<string>> = new Map<
  string,
  Array<string>
>();

function caseKey(cardCase: CardCase, stateName: string): string {
  return `${cardCase.name} / ${stateName}`;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...LANGUAGES]) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
  // As the Dashboard does: "3 hours ago" in the reader's language.
  followLanguageForDates(i18next);

  for (const cardCase of CASES) {
    for (const state of STATES) {
      ENGLISH_CARDS.set(
        caseKey(cardCase, state.name),
        drawnSentences(cardCase.build, state.lastSeenAt()),
      );
    }
  }
});

afterAll(async () => {
  cleanup();
  await useLanguage("en");
});

describe("the connection card in English", () => {
  test("draws a title, a sentence, a link and its steps for every resource and state", () => {
    for (const cardCase of CASES) {
      for (const state of STATES) {
        const sentences: Array<string> =
          ENGLISH_CARDS.get(caseKey(cardCase, state.name)) || [];

        expect({
          card: caseKey(cardCase, state.name),
          enough: sentences.length >= 3,
        }).toEqual({ card: caseKey(cardCase, state.name), enough: true });
        expect(sentences.join(" ")).not.toMatch(LEFT_UNFILLED);
      }
    }
  });
});

describe.each(LANGUAGES)("the connection card in %s", (language: string) => {
  beforeAll(async () => {
    await useLanguage(language);
  });

  test.each(
    CASES.flatMap((cardCase: CardCase) => {
      return STATES.map((state: { name: string }) => {
        return [caseKey(cardCase, state.name), cardCase, state];
      });
    }) as Array<
      [string, CardCase, { name: string; lastSeenAt: () => Date | undefined }]
    >,
  )(
    "%s: every sentence it draws reads in the language",
    (
      key: string,
      cardCase: CardCase,
      state: { lastSeenAt: () => Date | undefined },
    ) => {
      const english: Array<string> = ENGLISH_CARDS.get(key) || [];
      const sentences: Array<string> = drawnSentences(
        cardCase.build,
        state.lastSeenAt(),
      );

      // The same card, sentence for sentence.
      expect(sentences).toHaveLength(english.length);

      const leftInEnglish: Array<string> = sentences.filter(
        (sentence: string, index: number): boolean => {
          return sentence === english[index];
        },
      );

      expect({ language, key, leftInEnglish }).toEqual({
        language,
        key,
        leftInEnglish: [],
      });

      for (const sentence of sentences) {
        expect({
          language,
          sentence,
          english: ENGLISH_STATUS_WORD.test(sentence),
        }).toEqual({ language, sentence, english: false });
        expect(sentence).not.toMatch(LEFT_UNFILLED);
      }
    },
  );
});

/*
 * THE COLLECTOR A HOST'S CARD NAMES, WHERE EACH SENTENCE PUTS IT (#7692).
 *
 * French, Italian and Russian put the article or the case on the name of
 * the collector OneUptime installs on a host - "le collecteur OneUptime" -
 * so it is worded for the middle of a sentence. The card's sentence once
 * data stopped starts with it, and takes its capital there; the guide's
 * sentence for a host nothing has arrived from names it in its middle, and
 * read "Configurez Le collecteur OneUptime" while the name carried the
 * capital.
 */
// A host OneUptime installed the collector on, its first data late.
function managedHost(): ResourceConnectionGuide {
  return getHostConnectionGuide("db-04", {
    isManaged: true,
    osType: "linux",
    registeredAt: new Date(Date.now() - 30 * MINUTE),
  });
}

// The card's sentence, under its title.
function drawnSentence(
  guide: ResourceConnectionGuide,
  lastSeenAt: Date | undefined,
): string {
  const { container } = render(
    <ResourceConnectionGuideCard
      status="disconnected"
      lastSeenAt={lastSeenAt}
      guide={guide}
      documentationRoute={DOCS}
    />,
  );

  const sentence: string =
    container.querySelector('[data-testid="resource-connection-guide"] h2 + p')
      ?.textContent || "";

  cleanup();

  return sentence;
}

describe("the collector a host's card names, where each sentence puts it", () => {
  test.each([
    [
      "fr",
      ". Le collecteur OneUptime ne remonte plus de données — ",
      "Configurez le collecteur OneUptime — ",
    ],
    [
      "it",
      ". Il collector di OneUptime non invia più dati: ",
      "Configura il collector di OneUptime: ",
    ],
    [
      "ru",
      ". Коллектор OneUptime больше не передаёт данные — ",
      "Настройте коллектор OneUptime — ",
    ],
  ])(
    "%s starts the sentence with the collector's capital, and names it lower-case in the middle of one",
    async (language: string, stopped: string, setUp: string) => {
      await useLanguage(language);

      expect(
        drawnSentence(managedHost(), new Date(Date.now() - 3 * 60 * MINUTE)),
      ).toContain(stopped);

      /*
       * Before its first data the card says the host is starting instead
       * (the guide's startingCopy), so the guide's sentence for a host
       * nothing has arrived from is drawn without it.
       */
      expect(
        drawnSentence({ ...managedHost(), startingCopy: undefined }, undefined),
      ).toContain(setUp);
    },
  );
});

/*
 * THE AGENT'S NAME IN A CHINESE OR JAPANESE SENTENCE (#7864).
 *
 * The zh-CN, zh-TW and ja sentences put a space on each side of
 * {{agentName}}: right beside a name in Latin letters ("请设置 OneUptime
 * Kubernetes Agent"), a stray one beside a name the language words in its
 * own script ("请设置 设备或网关上的 OpenTelemetry 导出器"). Three stopped
 * sentences were written without it, which suited such names ("OneUptime
 * 收集器已不再上报数据") and read "OpenTelemetry Collector已不再上报数据" for
 * a host set up by hand. Every sentence has the space now, and the
 * Translator drops it where the name and the words meet in Chinese or
 * Japanese.
 */
describe("the agent's name in a Chinese or Japanese sentence", () => {
  const WITHOUT_WORD_SPACES: ReadonlyArray<string> = ["zh-CN", "zh-TW", "ja"];

  // One letter of Chinese or Japanese: a Han character or a kana.
  const LETTER: RegExp =
    /^(?=[\p{L}\p{Nl}])[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]$/u;

  function isLetter(character: string | undefined): boolean {
    return character !== undefined && LETTER.test(character);
  }

  // The agent's name as the card's sentences say it in `language`.
  function agentNameIn(
    guide: ResourceConnectionGuide,
    language: string,
  ): string {
    const name: TranslatableTerm = isTranslatableTerm(guide.agentName)
      ? guide.agentName
      : translatableTerm(guide.agentName);

    return dashboardTranslator(language).translateTerm(name.translatableTerm, {
      inSentence: name.inSentence,
    });
  }

  /*
   * Whether `sentence` spaces `name` from a Chinese or Japanese word beside
   * it the wrong way: with a space where the name is Chinese or Japanese on
   * that side too, or with none where it is not (Latin letters, a digit).
   */
  function isSpacedWrong(sentence: string, name: string): boolean {
    const letters: Array<string> = Array.from(name);

    for (
      let at: number = sentence.indexOf(name);
      at !== -1;
      at = sentence.indexOf(name, at + 1)
    ) {
      const before: Array<string> = Array.from(sentence.slice(0, at));
      const after: Array<string> = Array.from(sentence.slice(at + name.length));
      const isSpaceBefore: boolean = before[before.length - 1] === " ";
      const isSpaceAfter: boolean = after[0] === " ";
      // The word's letter next to the name, past the space if there is one.
      const wordBefore: string | undefined =
        before[before.length - (isSpaceBefore ? 2 : 1)];
      const wordAfter: string | undefined = after[isSpaceAfter ? 1 : 0];

      if (
        (isLetter(wordBefore) && isSpaceBefore === isLetter(letters[0])) ||
        (isLetter(wordAfter) &&
          isSpaceAfter === isLetter(letters[letters.length - 1]))
      ) {
        return true;
      }
    }

    return false;
  }

  // Every card and state, and a managed host's sentence for before its first data.
  const CARDS: ReadonlyArray<{
    name: string;
    build: () => ResourceConnectionGuide;
    lastSeenAt: () => Date | undefined;
  }> = [
    ...CASES.flatMap((cardCase: CardCase) => {
      return STATES.map(
        (state: { name: string; lastSeenAt: () => Date | undefined }) => {
          return {
            name: caseKey(cardCase, state.name),
            build: cardCase.build,
            lastSeenAt: state.lastSeenAt,
          };
        },
      );
    }),
    {
      name: "host OneUptime installed the collector on, its setup sentence",
      build: (): ResourceConnectionGuide => {
        return { ...managedHost(), startingCopy: undefined };
      },
      lastSeenAt: (): undefined => {
        return undefined;
      },
    },
  ];

  test.each(WITHOUT_WORD_SPACES)(
    "%s: a space between the agent's name and the words only where the name is not Chinese or Japanese on that side",
    async (language: string) => {
      await useLanguage(language);

      const spacedWrong: Array<string> = [];
      let named: number = 0;

      for (const card of CARDS) {
        const guide: ResourceConnectionGuide = card.build();
        const name: string = agentNameIn(guide, language);
        const sentences: Array<string> = drawnSentences(
          (): ResourceConnectionGuide => {
            return guide;
          },
          card.lastSeenAt(),
        );

        for (const sentence of sentences) {
          if (!sentence.includes(name)) {
            continue;
          }

          named++;

          if (isSpacedWrong(sentence, name)) {
            spacedWrong.push(`${card.name}: ${sentence}`);
          }
        }
      }

      // Every card names its agent: before its first data, or once it stopped.
      expect(named).toBeGreaterThanOrEqual(CASES.length);
      expect({ language, spacedWrong }).toEqual({ language, spacedWrong: [] });
    },
  );

  test("zh-CN: a name in its own words takes no space, a name in Latin letters keeps it", async () => {
    await useLanguage("zh-CN");

    const threeHoursAgo: Date = new Date(Date.now() - 3 * 60 * MINUTE);

    expect(
      drawnSentence(getIoTFleetConnectionGuide("sensors-a"), undefined),
    ).toBe(
      "尚未收到此设备群的数据，因此显示为“已断开”。请设置设备或网关上的 OpenTelemetry 导出器，只需几分钟。",
    );
    // A host set up by hand, and one OneUptime installed the collector on.
    expect(
      drawnSentence(getHostConnectionGuide("db-01"), threeHoursAgo),
    ).toContain("。OpenTelemetry Collector 已不再上报数据，");
    expect(drawnSentence(managedHost(), threeHoursAgo)).toContain(
      "。OneUptime 收集器已不再上报数据，",
    );
    expect(
      drawnSentence(
        getCloudResourceConnectionGuide({
          cloudPlatform: "aws_ecs",
          cloudAccountId: "123456789012",
          cloudRegion: "us-east-1",
        }),
        threeHoursAgo,
      ),
    ).toContain("。OpenTelemetry SDK 或收集器已不再上报数据，");
  });

  test("ja: the same, before the particle", async () => {
    await useLanguage("ja");

    const threeHoursAgo: Date = new Date(Date.now() - 3 * 60 * MINUTE);

    expect(
      drawnSentence(getHostConnectionGuide("db-01"), threeHoursAgo),
    ).toContain("。OpenTelemetry Collector は報告を停止しています");
    expect(drawnSentence(managedHost(), threeHoursAgo)).toContain(
      "。OneUptime コレクターは報告を停止しています",
    );
    expect(
      drawnSentence({ ...managedHost(), startingCopy: undefined }, undefined),
    ).toContain("。OneUptime コレクターをセットアップしてください");
  });

  test.each([
    ["zh-CN", "读取集群是在 "],
    ["zh-TW", "讀取叢集是在 "],
  ])(
    "%s: the Proxmox cluster's last read, a date, keeps its space",
    async (language: string, wordsBefore: string) => {
      await useLanguage(language);

      // Its agent heard two minutes ago, the cluster last read 25 minutes ago.
      const { container } = render(
        <ResourceConnectionGuideCard
          status="disconnected"
          lastSeenAt={new Date(Date.now() - 25 * MINUTE)}
          agentLastSeenAt={new Date(Date.now() - 2 * MINUTE)}
          guide={getProxmoxClusterConnectionGuide("pve-a", ONEUPTIME_URL)}
          documentationRoute={DOCS}
        />,
      );
      const sentence: string =
        container.querySelector(
          '[data-testid="resource-connection-guide"] h2 + p',
        )?.textContent || "";

      cleanup();

      // "是在 25分钟前", "是在 25 分鐘前": a space between the words and the date's digits.
      expect(sentence).toContain(`${wordsBefore}25`);
    },
  );
});
