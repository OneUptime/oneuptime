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
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
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
describe("the collector a host's card names, where each sentence puts it", () => {
  const managedHost: () => ResourceConnectionGuide =
    (): ResourceConnectionGuide => {
      return getHostConnectionGuide("db-04", {
        isManaged: true,
        osType: "linux",
        registeredAt: new Date(Date.now() - 30 * MINUTE),
      });
    };

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
      container.querySelector(
        '[data-testid="resource-connection-guide"] h2 + p',
      )?.textContent || "";

    cleanup();

    return sentence;
  }

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
