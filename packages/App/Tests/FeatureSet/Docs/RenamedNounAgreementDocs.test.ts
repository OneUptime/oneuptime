import { listPages, readPage } from "./DocsContentSupport";
import { dashboardLocale } from "./DocsDashboardLabels";
import { describe, expect, test } from "@jest/globals";

/*
 * THE WORDS AROUND A RENAMED NOUN AGREE WITH ITS GENDER (#8528).
 *
 * #8230 gave the Danish and Russian docs their Dashboard's word for a thing,
 * and the new word has another grammatical gender than the one it replaced:
 *
 *   - Danish: workflow (neuter: et workflow, det, dets) became arbejdsgang
 *     (common: en arbejdsgang, den, dens);
 *   - Russian: дашборд (masculine) became панель (feminine), and проба
 *     (feminine) became зонд (masculine).
 *
 * The words next to the noun were changed by rule. A pronoun in a later
 * sentence, or in the next block, that refers back to it was not: "Opret
 * arbejdsgang ... Giv det navnet", "Панель открывается ... Чтобы изменить
 * его", "любая [собственный зонд], которую". A read-through of every page
 * #8230 changed fixed 51 Danish and 34 Russian ones, and the Danish
 * Dashboard's Archived column ("Når det fjernes fra arkivet").
 *
 * No check can tell every pronoun that refers to the workflow from one that
 * refers to something else, so this holds what one can: the phrases and the
 * word pairs that can only be the renamed noun, in the old gender.
 */

const DANISH_PAGES: Array<string> = listPages("da");
const RUSSIAN_PAGES: Array<string> = listPages("ru");

// The renamed nouns, in any form.
const ARBEJDSGANG: RegExp = /arbejdsgang/i;

/*
 * Danish: the phrases that refer to a workflow wherever they stand. The
 * Builder is a workflow's, and the Archived column is the workflows' list.
 */
const DANISH_NEUTER_WORKFLOW_ANYWHERE: Array<RegExp> = [
  /(?<![\p{L}])[Dd]ets \*\*Bygger\*\*/u,
  /Når det fjernes fra arkivet/u,
];

/*
 * And the ones that, in a block naming a workflow, refer to it: "give it
 * the name", "call it", "so it runs only when" and "the other one closes
 * it" name the workflow just created or the second of two.
 */
const DANISH_NEUTER_WORKFLOW_BESIDE: Array<RegExp> = [
  /(?<![\p{L}])Giv det navnet(?![\p{L}])/u,
  /(?<![\p{L}])[Kk]ald det `/u,
  /(?<![\p{L}])så det kun kører(?![\p{L}])/u,
  /(?<![\p{L}])og et andet (lukker|løser)(?![\p{L}])/u,
];

const DANISH_NEUTER_WORKFLOW: Array<RegExp> = [
  ...DANISH_NEUTER_WORKFLOW_ANYWHERE,
  ...DANISH_NEUTER_WORKFLOW_BESIDE,
];

// Danish workflow pages: a trigger, a block, a step or a webhook are the workflow's.
const DANISH_WORKFLOW_PARTS: RegExp =
  /(?<![\p{L}])[Dd]ets (trigger|blokke|trin|webhook|\*\*Bygger\*\*)(?![\p{L}])/u;

/*
 * Russian: a word that agrees, right beside it, with the gender the noun
 * no longer has: "один панель", "на любой панель", "любая [собственный
 * зонд], которую", "зонд, созданная".
 */
const RUSSIAN_MASCULINE_PANEL: RegExp =
  /(?<![\p{L}])([Сс]ам|[Лл]юбой|[Кк]аждый|[Нн]овый|[Оо]дин|[Ээ]тот|[Пп]убличный|[Сс]вой) панель(?![\p{L}])/u;
const RUSSIAN_FEMININE_PROBE: RegExp =
  /(?<![\p{L}])([Лл]юбая|[Кк]аждая|[Нн]овая|[Сс]обственная|[Ээ]та|[Оо]дна|[Сс]воя) \[?[Зз]онд(?![\p{L}])|[Зз]онд(\]\([^)]*\))?, (созданная|запущенная|которая|которую|которой)(?![\p{L}])|запустила глобальный зонд/u;

// The blocks of a page: its paragraphs, list items and table rows, one per line.
function blocksOf(language: string, page: string): Array<string> {
  return readPage(language, page)
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().length > 0;
    });
}

function sightings(
  language: string,
  pages: Array<string>,
  wrong: RegExp,
  only?: RegExp,
): Array<string> {
  const found: Array<string> = [];

  for (const page of pages) {
    blocksOf(language, page).forEach((block: string, index: number): void => {
      if ((!only || only.test(block)) && wrong.test(block)) {
        found.push(`${page}:${index}: ${block.match(wrong)![0]}`);
      }
    });
  }

  return found;
}

describe("the checks", () => {
  test("find the Danish phrases that refer back to a workflow in the old gender", () => {
    for (const old of [
      "Gå til **Arbejdsgange**, og klik på **Opret arbejdsgang**. Giv det navnet `X`.",
      "En arbejdsgang, der er slået fra, svarer `400`. Slå **Aktiveret** til øverst i dets **Bygger**.",
      "Vælg **Current Incident State**, så det kun kører, når tilstanden ændres.",
      "Én arbejdsgang opretter en alarm, og et andet lukker den.",
      "Siden **Arkiveret** viser i sin kolonne **Når det fjernes fra arkivet**, hvilket der er hvilket.",
      "Opret en arbejdsgang. Kald det `Grafana alerts`.",
    ]) {
      expect({
        old,
        found: DANISH_NEUTER_WORKFLOW.some((pattern: RegExp): boolean => {
          return pattern.test(old);
        }),
      }).toEqual({ old, found: true });
    }

    expect(DANISH_WORKFLOW_PARTS.test("en kørsel, som dets trigger startede")).toBe(
      true,
    );
  });

  test("pass the words that agree with arbejdsgang, and det that names something else", () => {
    for (const agrees of [
      "Gå til **Arbejdsgange**, og klik på **Opret arbejdsgang**. Giv den navnet `X`.",
      "Slå **Aktiveret** til øverst i dens **Bygger**.",
      "Én arbejdsgang opretter en alarm, og en anden lukker den.",
      // An issue (et issue) and a token (et token) are neuter.
      "Trinnet viser det nye issue, med dets `number` og dets `html_url`.",
    ]) {
      expect({
        agrees,
        found: DANISH_NEUTER_WORKFLOW.some((pattern: RegExp): boolean => {
          return pattern.test(agrees);
        }),
      }).toEqual({ agrees, found: false });
    }

    expect(DANISH_WORKFLOW_PARTS.test("en kørsel, som dens trigger startede")).toBe(
      false,
    );
    // "Call it" names a token in a block that names no workflow, so it is not read.
    expect(
      ARBEJDSGANG.test("Kald det `OneUptime import`, og kopiér tokenet."),
    ).toBe(false);
  });

  test("find a Russian word that agrees with the gender the noun no longer has", () => {
    expect(RUSSIAN_MASCULINE_PANEL.test("Один панель для каждого сервиса.")).toBe(true);
    expect(RUSSIAN_MASCULINE_PANEL.test("можно добавить на любой панель.")).toBe(true);
    expect(RUSSIAN_MASCULINE_PANEL.test("| **Панель** | Сам панель. |")).toBe(true);
    expect(
      RUSSIAN_FEMININE_PROBE.test(
        "и любая [собственный зонд](/docs/probe/custom-probe), которую вы запускаете сами.",
      ),
    ).toBe(true);
    expect(RUSSIAN_FEMININE_PROBE.test("глобальный зонд, созданная в приложении")).toBe(true);
    expect(RUSSIAN_FEMININE_PROBE.test("— монитор запустила глобальный зонд с")).toBe(true);
  });

  test("pass the words that agree with панель and зонд", () => {
    expect(RUSSIAN_MASCULINE_PANEL.test("Одна панель для каждого сервиса.")).toBe(false);
    expect(RUSSIAN_MASCULINE_PANEL.test("можно добавить на любую панель.")).toBe(false);
    // A feminine genitive before панели is not the masculine nominative.
    expect(RUSSIAN_MASCULINE_PANEL.test("на публичной панели")).toBe(false);
    expect(
      RUSSIAN_FEMININE_PROBE.test(
        "и любой [собственный зонд](/docs/probe/custom-probe), который вы запускаете сами.",
      ),
    ).toBe(false);
    // "которую зонд ищет" is the record the probe looks up.
    expect(RUSSIAN_FEMININE_PROBE.test("запись PTR, которую зонд ищет")).toBe(false);
  });
});

describe("the Danish docs", () => {
  test("read the pages", () => {
    expect(DANISH_PAGES.length).toBeGreaterThan(100);
  });

  test("never refer back to a workflow with the neuter det or dets", () => {
    expect([
      ...DANISH_NEUTER_WORKFLOW_ANYWHERE.flatMap(
        (pattern: RegExp): Array<string> => {
          return sightings("da", DANISH_PAGES, pattern);
        },
      ),
      ...DANISH_NEUTER_WORKFLOW_BESIDE.flatMap(
        (pattern: RegExp): Array<string> => {
          return sightings("da", DANISH_PAGES, pattern, ARBEJDSGANG);
        },
      ),
    ]).toEqual([]);
  });

  test("call a workflow's trigger, blocks, steps and webhook dens on the workflow pages", () => {
    expect(
      sightings(
        "da",
        DANISH_PAGES.filter((page: string): boolean => {
          return page.startsWith("workflows/");
        }),
        DANISH_WORKFLOW_PARTS,
      ),
    ).toEqual([]);
  });

  test("the checked sentences read as fixed", () => {
    expect(readPage("da", "integrations/github")).toContain(
      "Resten af denne side bygger arbejdsgangen. Den kræver:",
    );
    expect(readPage("da", "workflows/authoring")).toContain(
      "byg den, test den med **Kør arbejdsgang**, mens den stadig er slået fra",
    );
    expect(readPage("da", "workflows/components")).toContain(
      "når den ikke kan: den findes ikke, er slået fra eller arkiveret, eller at starte den ville give en løkke",
    );
    expect(readPage("da", "telemetry/security-cases")).toContain(
      "Starter en OneUptime-arbejdsgang",
    );
  });
});

describe("the Russian docs", () => {
  test("read the pages", () => {
    expect(RUSSIAN_PAGES.length).toBeGreaterThan(100);
  });

  test("never put a masculine word right beside панель", () => {
    expect(sightings("ru", RUSSIAN_PAGES, RUSSIAN_MASCULINE_PANEL)).toEqual([]);
  });

  test("never put a feminine word right beside зонд", () => {
    expect(sightings("ru", RUSSIAN_PAGES, RUSSIAN_FEMININE_PROBE)).toEqual([]);
  });

  test("the checked sentences read as fixed", () => {
    expect(readPage("ru", "dashboards/index")).toContain(
      "Сама панель. Читайте её или редактируйте через её меню",
    );
    expect(readPage("ru", "dashboards/sharing")).toContain(
      "У неё нет публичной ссылки",
    );
    expect(readPage("ru", "dashboards/configuration")).toContain(
      "Её владельцы и метки в экспорт не входят",
    );
    expect(readPage("ru", "telemetry/openstack")).toContain(
      "Он спрашивает об одной форме типа за раз",
    );
    expect(readPage("ru", "introduction/glossary")).toContain(
      "Защитите её паролем",
    );
  });
});

describe("the Dashboard's sentences", () => {
  test("Danish: the Archived workflows column and the create dialog say den for the workflow", () => {
    const danish: Record<string, unknown> = dashboardLocale("da");

    expect(danish["When Unarchived"]).toBe("Når den fjernes fra arkivet");
    expect(danish["Describe what it should do, and Ask AI builds it."]).toBe(
      "Beskriv, hvad den skal gøre, og Ask AI bygger den.",
    );
  });

  test("Russian: an archived dashboard and a playlist's dashboards agree with панель", () => {
    const russian: Record<string, unknown> = dashboardLocale("ru");

    expect(
      russian[
        "It is hidden from the Dashboards list, and its public link does not work. Unarchive it to bring it back."
      ],
    ).toBe(
      "Она скрыта из списка «Панели», и её публичная ссылка не работает. Извлеките её из архива, чтобы вернуть.",
    );
    // The playlist (плейлист) is masculine; each of its dashboards feminine.
    expect(
      russian[
        "Its dashboards are shown one after another, each for the same time. Press Play on the screen that shows them."
      ],
    ).toEqual(
      expect.stringMatching(/^Его панели показываются по очереди, каждая /),
    );
  });
});
