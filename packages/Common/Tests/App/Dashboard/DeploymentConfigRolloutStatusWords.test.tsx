import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import StatusBadge from "../../../UI/Components/StatusBadge/StatusBadge";
import {
  OpenShiftDeploymentConfigObject,
  OpenShiftDeploymentConfigState,
  getDeploymentConfigState,
} from "../../../Types/Kubernetes/OpenShiftObjectParser";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * #6622: AN OPENSHIFT DEPLOYMENTCONFIG'S ROLLOUT STATUS (i) NAMES THE
 * STATES ITS BADGE DRAWS, AS THE BADGE DRAWS THEM, IN EVERY LANGUAGE.
 *
 * The (i) beside Rollout Status explained "Complete" and "In Progress" and
 * a bar - written for the Deployment page's old field - while the badge
 * beside it drew Available, Progressing, Unavailable, Scaled to zero or
 * Paused (getDeploymentConfigState), and no bar. A reader looking up the
 * word on the badge found a different one in the (i).
 *
 * Here each language's (i) text, from its locale file, is read against the
 * badge each state really draws in that language (StatusBadge rendered
 * through a real i18next instance): every state's word is named, whole -
 * Chinese's 可用 (Available) is not counted where only 不可用 (Unavailable)
 * stands - in the order the English names them, and the English rule for
 * each is the one getDeploymentConfigState applies.
 */

const ROLLOUT_STATUS: string =
  KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentRolloutStatus;

// The states, in the order the (i) names them.
const STATES_IN_ORDER: Array<OpenShiftDeploymentConfigState> = [
  OpenShiftDeploymentConfigState.Available,
  OpenShiftDeploymentConfigState.Progressing,
  OpenShiftDeploymentConfigState.Unavailable,
  OpenShiftDeploymentConfigState.ScaledToZero,
  OpenShiftDeploymentConfigState.Paused,
];

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

const instances: Map<string, i18n> = new Map();

function instanceFor(language: string): i18n {
  const existing: i18n | undefined = instances.get(language);

  if (existing) {
    return existing;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });
  instances.set(language, instance);

  return instance;
}

// The word the Rollout Status badge draws for `state` in `language`.
function badgeWord(
  language: string,
  state: OpenShiftDeploymentConfigState,
): string {
  const { container } = render(
    <I18nextProvider i18n={instanceFor(language)}>
      <StatusBadge text={state} />
    </I18nextProvider>,
  );

  const drawn: string = withoutIsolateMarks(container.textContent || "").trim();

  cleanup();

  return drawn;
}

// The (i)'s text as `language` reads it.
function rolloutText(language: string): string {
  return withoutIsolateMarks(
    readDashboardLocale(language)[ROLLOUT_STATUS] || "",
  );
}

/*
 * The states a text names, in the order it names them: each word is
 * replaced whole, the longest first, by a mark of its own, so a word that
 * holds another (不可用 holds 可用, Unavailable holds available) is never
 * also read as the shorter one.
 */
function statesNamed(
  text: string,
  words: Map<OpenShiftDeploymentConfigState, string>,
): Array<OpenShiftDeploymentConfigState> {
  const longestFirst: Array<[OpenShiftDeploymentConfigState, string]> =
    Array.from(words.entries()).sort(
      (
        a: [OpenShiftDeploymentConfigState, string],
        b: [OpenShiftDeploymentConfigState, string],
      ): number => {
        return b[1].length - a[1].length;
      },
    );
  let marked: string = text;

  for (const [state, stateWord] of longestFirst) {
    const mark: string = `⟦${STATES_IN_ORDER.indexOf(state)}⟧`;
    marked = marked.split(stateWord).join(mark);
  }

  const named: Array<OpenShiftDeploymentConfigState> = [];
  const markPattern: RegExp = /⟦(\d)⟧/g;
  let match: RegExpExecArray | null = markPattern.exec(marked);

  while (match) {
    named.push(STATES_IN_ORDER[Number(match[1])]!);
    match = markPattern.exec(marked);
  }

  return named;
}

/*
 * Each state once, where the text first names it. A rule may use a state's
 * word again ("Available when every pod ... is available"; Chinese's
 * 全部可用时为“可用”): what the reader looks up is where it is first named.
 */
function firstNamed(
  text: string,
  words: Map<OpenShiftDeploymentConfigState, string>,
): Array<OpenShiftDeploymentConfigState> {
  const named: Array<OpenShiftDeploymentConfigState> = statesNamed(text, words);

  return named.filter(
    (state: OpenShiftDeploymentConfigState, index: number): boolean => {
      return named.indexOf(state) === index;
    },
  );
}

function badgeWords(
  language: string,
): Map<OpenShiftDeploymentConfigState, string> {
  return new Map(
    STATES_IN_ORDER.map(
      (
        state: OpenShiftDeploymentConfigState,
      ): [OpenShiftDeploymentConfigState, string] => {
        return [state, badgeWord(language, state)];
      },
    ),
  );
}

afterEach(() => {
  cleanup();
});

test("the states are the five getDeploymentConfigState returns", () => {
  expect([...STATES_IN_ORDER].sort()).toEqual(
    Object.values(OpenShiftDeploymentConfigState).sort(),
  );
});

test("every Dashboard language is read, Arabic and Persian among them", () => {
  expect(LANGUAGES).toEqual(expect.arrayContaining(["en", "de", "ar", "fa"]));
  expect(LANGUAGES.length).toBeGreaterThanOrEqual(18);
});

describe.each(LANGUAGES)("the Rollout Status (i) in %s", (language: string) => {
  test("is worded in this language", () => {
    expect(rolloutText(language)).not.toBe("");
  });

  test("names each state as its badge draws it, in order", () => {
    const words: Map<OpenShiftDeploymentConfigState, string> =
      badgeWords(language);

    // Each badge draws a word of its own: no two states read alike.
    expect(new Set(words.values()).size).toBe(STATES_IN_ORDER.length);

    expect(firstNamed(rolloutText(language), words)).toEqual(STATES_IN_ORDER);
  });

  test("the badge's words are the language's own, not English", () => {
    if (language === "en") {
      return;
    }

    for (const state of STATES_IN_ORDER) {
      expect({ state, word: badgeWord(language, state) }).not.toEqual({
        state,
        word: state,
      });
    }
  });

  test("the count beside the badge reads in this language", () => {
    const worded: string | undefined =
      readDashboardLocale(language)["{{ready}}/{{total}} ready"];

    expect(worded).toEqual(expect.stringContaining("{{ready}}/{{total}}"));

    if (language !== "en") {
      expect(worded).not.toBe("{{ready}}/{{total}} ready");
    }
  });
});

/*
 * The negative control: the old text, and a text that names a word the
 * badge never draws in place of one it does, are caught.
 */
describe("what the check catches", () => {
  test("the old (i), naming Complete and In Progress, names none of the badge's states in order", () => {
    const old: string =
      "Complete when the number of ready pods matches the desired count and none are unavailable; In Progress otherwise. The bar shows ready pods out of desired.";

    expect(firstNamed(old, badgeWords("en"))).toEqual([]);
  });

  test("Chinese's Available is not found inside its Unavailable", () => {
    const words: Map<OpenShiftDeploymentConfigState, string> =
      badgeWords("zh-CN");

    expect(words.get(OpenShiftDeploymentConfigState.Unavailable)).toContain(
      words.get(OpenShiftDeploymentConfigState.Available),
    );

    // "When none is available, Unavailable" - and no Available in it.
    expect(statesNamed("一个都不可用时为“不可用”", words)).toEqual([
      OpenShiftDeploymentConfigState.Unavailable,
      OpenShiftDeploymentConfigState.Unavailable,
    ]);
  });

  test("a German text naming Progressing by another word misses it", () => {
    const words: Map<OpenShiftDeploymentConfigState, string> = badgeWords("de");
    const swapped: string = rolloutText("de").replace(
      words.get(OpenShiftDeploymentConfigState.Progressing)!,
      "Im Gange",
    );

    expect(firstNamed(swapped, words)).toEqual(
      STATES_IN_ORDER.filter((state: OpenShiftDeploymentConfigState) => {
        return state !== OpenShiftDeploymentConfigState.Progressing;
      }),
    );
  });
});

/*
 * The English rule for each state is the one the badge follows: a
 * DeploymentConfig set up each way reads as the (i) says it does.
 */
describe("the English rules are getDeploymentConfigState's", () => {
  type Setup = Pick<OpenShiftDeploymentConfigObject, "spec" | "status">;

  function deploymentConfig(
    replicas: number,
    availableReplicas: number,
    paused: boolean = false,
  ): Setup {
    return {
      spec: {
        replicas,
        strategy: "Rolling",
        selector: {},
        triggers: [],
        paused,
      },
      status: {
        latestVersion: 3,
        replicas,
        readyReplicas: availableReplicas,
        availableReplicas,
        unavailableReplicas: Math.max(0, replicas - availableReplicas),
        updatedReplicas: availableReplicas,
        conditions: [],
      },
    };
  }

  test.each([
    [
      "Available when every pod it is set to run is available",
      deploymentConfig(3, 3),
      OpenShiftDeploymentConfigState.Available,
    ],
    [
      "Progressing while only some are, as during a rollout or scale-up",
      deploymentConfig(3, 1),
      OpenShiftDeploymentConfigState.Progressing,
    ],
    [
      "Unavailable when none are",
      deploymentConfig(3, 0),
      OpenShiftDeploymentConfigState.Unavailable,
    ],
    [
      "Scaled to zero when it is set to run none",
      deploymentConfig(0, 0),
      OpenShiftDeploymentConfigState.ScaledToZero,
    ],
    [
      "Paused while its rollouts are paused",
      deploymentConfig(3, 3, true),
      OpenShiftDeploymentConfigState.Paused,
    ],
  ])(
    "%s",
    (rule: string, setup: Setup, state: OpenShiftDeploymentConfigState) => {
      expect(ROLLOUT_STATUS).toContain(rule);
      expect(getDeploymentConfigState(setup)).toBe(state);
    },
  );
});
