import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { Translator } from "../../../Types/Translator";
import {
  RuleMoveChoice,
  RULE_MOVE_CHOICE_DESCRIPTIONS,
  RULE_MOVE_CHOICE_TITLES,
  SETTINGS_REPLACED,
  WHAT_STAYS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/MonitorTemplateChangeModel";
import useMonitorTemplateMoveConfirmation, {
  MonitorTemplateMoveConfirmation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TemplateChange/useMonitorTemplateMoveConfirmation";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * BEFORE A POLICY OR A RULE IS POINTED AT ANOTHER TEMPLATE, THE FORM SAYS
 * WHAT HAPPENS TO ITS MONITORS (issues #11452, #11451).
 *
 * A network alert policy pointed at another template used to delete its
 * monitors and make new ones - their history, labels, owners and incident
 * links gone, and nothing said before the save. Now the save asks once:
 * how many monitors move, what each takes from the new template and what it
 * keeps, with Move N Monitors and Save or Cancel. An auto import rule's
 * devices' monitors can move first (recommended), or stay while the rule
 * gives each device a second monitor; the button says which.
 */

let latest: MonitorTemplateMoveConfirmation | null = null;

function Harness(): ReactElement {
  const confirmation: MonitorTemplateMoveConfirmation =
    useMonitorTemplateMoveConfirmation();

  latest = confirmation;

  return <div data-testid="harness">{confirmation.confirmation}</div>;
}

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "ru", "ar"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        ...(language === "en"
          ? {}
          : { [language]: { translation: readDashboardLocale(language) } }),
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
  latest = null;
});

// What the page reads: the isolates a sentence sets its values apart with taken out.
function plain(text: string | null | undefined): string {
  return (text || "").replace(/[⁦-⁩‎‏]/g, "").trim();
}

async function mount(language: string = "en"): Promise<void> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <Harness />
      </I18nextProvider>,
    );
  });
}

/*
 * The question asked, and its answer still to come: held in an object, as
 * an async function that returned the answer itself would wait for it.
 */
interface Asked<T> {
  answer: Promise<T>;
}

async function ask<T>(question: () => Promise<T>): Promise<Asked<T>> {
  let answer: Promise<T> | undefined;

  await act(async () => {
    answer = question();
  });

  return { answer: answer! };
}

function titleText(): string {
  return plain(screen.getByTestId("modal-title").textContent);
}

function submitText(): string {
  return plain(screen.getByTestId("modal-footer-submit-button").textContent);
}

function policyLines(): Array<string> {
  return Array.from(
    screen
      .getByTestId("policy-template-move-confirmation")
      .querySelectorAll("li"),
  ).map((item: Element): string => {
    return plain(item.textContent);
  });
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

async function pick(choice: RuleMoveChoice): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen
        .getByTestId(`card-select-option-${choice}`)
        .querySelector("input")!,
    );
  });
}

const ENGLISH: Translator = dashboardTranslator("en");

/*
 * English's words in a sentence, once the template names it quotes are
 * taken out. Hoisted: eslint's wrap-regex wants a literal tested in place
 * wrapped in brackets, and prettier takes them back off.
 */
const ENGLISH_WORDS: RegExp = /\b(Move|monitors?|Save|Leave|rule's|policy's)\b/;
const TEMPLATE_NAMES: RegExp = /Switches \((new|old)\)/g;

describe("a policy pointed at another template: one question, which says what changes and what stays", () => {
  test("how many monitors move, to which template, what they take and what they keep", async () => {
    await mount();

    const { answer }: Asked<boolean> = await ask(() => {
      return latest!.confirmPolicyMove({
        templateName: "Switches (new)",
        count: 2000,
      });
    });

    expect(titleText()).toBe("Move this policy's monitors to Switches (new)?");
    expect(policyLines()).toEqual([
      "Its 2,000 monitors move to Switches (new) on the server, and stay this policy's.",
      plain(ENGLISH.translatePlural(SETTINGS_REPLACED, 2000)),
      plain(ENGLISH.translatePlural(WHAT_STAYS, 2000)),
    ]);
    expect(policyLines()[2]).toContain("history");
    expect(submitText()).toBe("Move 2,000 Monitors and Save");

    await click("modal-footer-submit-button");

    await expect(answer).resolves.toBe(true);
    expect(screen.queryByTestId("modal-title")).toBeNull();
  });

  test("one monitor is said as one", async () => {
    await mount();

    await ask(() => {
      return latest!.confirmPolicyMove({
        templateName: "Switches (new)",
        count: 1,
      });
    });

    expect(policyLines()[0]).toBe(
      "Its 1 monitor moves to Switches (new) on the server, and stays this policy's.",
    );
    expect(policyLines()[1]).toBe(
      plain(ENGLISH.translatePlural(SETTINGS_REPLACED, 1)),
    );
    expect(submitText()).toBe("Move 1 Monitor and Save");
  });

  test("when how many could not be read, it asks all the same, without the number", async () => {
    await mount();

    await ask(() => {
      return latest!.confirmPolicyMove({
        templateName: "Switches (new)",
        count: null,
      });
    });

    expect(policyLines()[0]).toBe(
      "Its monitors move to Switches (new) on the server, and stay this policy's.",
    );
    // Said of many.
    expect(policyLines()[1]).toBe(
      plain(ENGLISH.translatePlural(SETTINGS_REPLACED, 2)),
    );
    expect(submitText()).toBe("Move Monitors and Save");
  });

  test("there is no save that leaves them behind: Cancel calls the save back", async () => {
    await mount();

    const { answer }: Asked<boolean> = await ask(() => {
      return latest!.confirmPolicyMove({
        templateName: "Switches (new)",
        count: 300,
      });
    });

    // Two buttons: the move, and Cancel.
    expect(
      screen.getByTestId("modal-footer").querySelectorAll("button").length,
    ).toBe(2);

    await click("modal-footer-close-button");

    await expect(answer).resolves.toBe(false);
    expect(screen.queryByTestId("modal-title")).toBeNull();
  });
});

describe("a rule pointed at another template: move its devices' monitors first, or leave them", () => {
  const QUESTION: {
    templateName: string;
    oldTemplateName: string;
    count: number;
  } = {
    templateName: "Switches (new)",
    oldTemplateName: "Switches (old)",
    count: 120,
  };

  test("the question, and moving first picked: its button says what it does", async () => {
    await mount();

    await ask(() => {
      return latest!.askRuleMove(QUESTION);
    });

    expect(titleText()).toBe("Move this rule's monitors to Switches (new)?");
    expect(
      plain(screen.getByTestId("rule-template-move-question").textContent),
    ).toContain("This rule's devices have 120 monitors from Switches (old).");

    const moveFirst: HTMLInputElement = screen
      .getByTestId(`card-select-option-${RuleMoveChoice.MoveFirst}`)
      .querySelector("input")!;

    expect(moveFirst.checked).toBe(true);
    expect(
      plain(
        screen.getByTestId(`card-select-option-${RuleMoveChoice.MoveFirst}`)
          .textContent,
      ),
    ).toBe(
      plain(
        "Move them to Switches (new) first (recommended)" +
          " Each takes the criteria, interval and probe agreement of Switches (new), and keeps its name, history, labels, owners and incidents. The rule uses Switches (new) once they are moved, and gives a monitor only to devices that have none.",
      ),
    );
    expect(
      plain(
        screen.getByTestId(`card-select-option-${RuleMoveChoice.Leave}`)
          .textContent,
      ),
    ).toBe(
      plain(
        "Leave them on Switches (old)" +
          " They stay as they are, and the rule gives each of these devices a second monitor, from Switches (new).",
      ),
    );
    expect(submitText()).toBe("Move 120 Monitors First");
  });

  test("moving first answers so", async () => {
    await mount();

    const { answer }: Asked<RuleMoveChoice | null> = await ask(() => {
      return latest!.askRuleMove(QUESTION);
    });

    await click("modal-footer-submit-button");

    await expect(answer).resolves.toBe(RuleMoveChoice.MoveFirst);
    expect(screen.queryByTestId("modal-title")).toBeNull();
  });

  test("leaving them: the button says the save does not move them, and it answers so", async () => {
    await mount();

    const { answer }: Asked<RuleMoveChoice | null> = await ask(() => {
      return latest!.askRuleMove(QUESTION);
    });

    await pick(RuleMoveChoice.Leave);

    expect(submitText()).toBe("Save Without Moving");

    await click("modal-footer-submit-button");

    await expect(answer).resolves.toBe(RuleMoveChoice.Leave);
  });

  test("Cancel calls the save back", async () => {
    await mount();

    const { answer }: Asked<RuleMoveChoice | null> = await ask(() => {
      return latest!.askRuleMove(QUESTION);
    });

    await click("modal-footer-close-button");

    await expect(answer).resolves.toBeNull();
  });

  test("one monitor is said as one", async () => {
    await mount();

    await ask(() => {
      return latest!.askRuleMove({ ...QUESTION, count: 1 });
    });

    expect(
      plain(screen.getByTestId("rule-template-move-question").textContent),
    ).toContain("This rule's devices have 1 monitor from Switches (old).");
    expect(submitText()).toBe("Move 1 Monitor First");
  });

  test("asked again, moving first is picked again", async () => {
    await mount();

    const { answer: first }: Asked<RuleMoveChoice | null> = await ask(() => {
      return latest!.askRuleMove(QUESTION);
    });

    await pick(RuleMoveChoice.Leave);
    await click("modal-footer-close-button");
    await expect(first).resolves.toBeNull();

    await ask(() => {
      return latest!.askRuleMove(QUESTION);
    });

    expect(submitText()).toBe("Move 120 Monitors First");
  });
});

describe("one question at a time", () => {
  test("a question asked while another is open answers the open one Cancel", async () => {
    await mount();

    const { answer: policy }: Asked<boolean> = await ask(() => {
      return latest!.confirmPolicyMove({
        templateName: "Switches (new)",
        count: 3,
      });
    });

    const { answer: rule }: Asked<RuleMoveChoice | null> = await ask(() => {
      return latest!.askRuleMove({
        templateName: "Switches (new)",
        oldTemplateName: "Switches (old)",
        count: 3,
      });
    });

    await expect(policy).resolves.toBe(false);
    expect(titleText()).toBe("Move this rule's monitors to Switches (new)?");

    await ask(() => {
      return latest!.confirmPolicyMove({
        templateName: "Routers",
        count: 3,
      });
    });

    await expect(rule).resolves.toBeNull();
    expect(titleText()).toBe("Move this policy's monitors to Routers?");
  });

  test("with no question open, nothing is drawn", async () => {
    await mount();

    expect(screen.getByTestId("harness")).toBeEmptyDOMElement();
  });
});

describe("in the reader's language", () => {
  test.each(["de", "ru", "ar"])(
    "%s: the policy's question and button, and the rule's choices",
    async (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      await mount(language);

      await ask(() => {
        return latest!.confirmPolicyMove({
          templateName: "Switches (new)",
          count: 21,
        });
      });

      const words: Array<string> = [
        titleText(),
        ...policyLines(),
        submitText(),
      ];

      expect(words[0]).toBe(
        plain(
          translator.translateTemplate(
            "Move this policy's monitors to {{templateName}}?",
            { templateName: "Switches (new)" },
          ),
        ),
      );
      expect(words[4]).toBe(
        plain(
          translator.translatePlural(
            {
              one: "Move {{count}} Monitor and Save",
              other: "Move {{count}} Monitors and Save",
            },
            21,
            { count: translator.formatNumber(21) },
          ),
        ),
      );

      await click("modal-footer-close-button");

      await ask(() => {
        return latest!.askRuleMove({
          templateName: "Switches (new)",
          oldTemplateName: "Switches (old)",
          count: 3,
        });
      });

      words.push(
        titleText(),
        plain(screen.getByTestId("rule-template-move-question").textContent),
        plain(
          screen.getByTestId(`card-select-option-${RuleMoveChoice.MoveFirst}`)
            .textContent,
        ),
        plain(
          screen.getByTestId(`card-select-option-${RuleMoveChoice.Leave}`)
            .textContent,
        ),
        submitText(),
      );

      expect(words[7]).toContain(
        plain(
          translator.translateTemplate(
            RULE_MOVE_CHOICE_TITLES[RuleMoveChoice.MoveFirst],
            {
              templateName: "Switches (new)",
              oldTemplateName: "Switches (old)",
            },
          ),
        ),
      );
      expect(words[8]).toContain(
        plain(
          translator.translateTemplate(
            RULE_MOVE_CHOICE_DESCRIPTIONS[RuleMoveChoice.Leave],
            {
              templateName: "Switches (new)",
              oldTemplateName: "Switches (old)",
            },
          ),
        ),
      );

      await pick(RuleMoveChoice.Leave);

      words.push(submitText());

      // None of it is English.
      const english: Array<string> = words.filter((word: string): boolean => {
        return ENGLISH_WORDS.test(word.replace(TEMPLATE_NAMES, ""));
      });

      expect({ language, english }).toEqual({ language, english: [] });
      expect(
        words.every((word: string): boolean => {
          return word.length > 0 && !word.includes("{{");
        }),
      ).toBe(true);
    },
  );
});
