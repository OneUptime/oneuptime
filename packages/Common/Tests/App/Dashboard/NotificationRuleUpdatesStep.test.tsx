import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { FunctionComponent, ReactElement, useState } from "react";
import NotificationRuleUpdatesForm from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleUpdatesForm";
import {
  CHOOSE_UPDATES_DESCRIPTION,
  CHOOSE_UPDATES_TITLE,
  EVERY_UPDATE_TITLE,
  isUpdatesEventType,
  KEY_UPDATES_TITLE,
  UPDATES_COPY,
  UPDATES_SECTION_TITLE,
  UpdateKindCopy,
  UpdatesCopy,
  UpdatesEventType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleUpdatesCopy";
import UpdatesRuleSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/UpdatesRuleSummary";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../../Types/Dashboard/DashboardLanguage";
import {
  DOT_ZERO_INLINE_SEPARATOR,
  INLINE_SEPARATOR,
} from "../../../Types/Translator";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import {
  getRuntimeLocale,
  RuntimeLocaleTree,
} from "../../../UI/esbuild-locales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * A RULE'S UPDATES STEP, AND THE UPDATES ROW OF ITS CARD (#7581).
 *
 *   Which updates to post
 *   The rule always posts when an incident is declared. Pick the updates
 *   it posts after that.
 *     (o) Every update          ( ) Key updates only     ( ) Choose updates
 *
 * The step on its own, as the rule form draws it, handing back the rule it
 * edits; its words in every language the Dashboard speaks; and the step
 * and the card's row drawn in German, Persian and Arabic. i18next is set up
 * as the Dashboard sets it up (DashboardRuntimeLocales), each language's
 * chunk being what it ships.
 */

const {
  ResolvedAndReopened,
  SeverityChanges,
  PublicNotes,
  PrivateNotes,
  Paging,
  Postmortem,
  OnCallNow,
  OnCallNext,
  NobodyOnCall,
} = NotificationRuleUpdateKind;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const PROGRESS_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/i18n/Progress",
);

const ENGLISH: string = DEFAULT_DASHBOARD_LANGUAGE;

const UPDATES_EVENT_TYPES: Array<UpdatesEventType> = Object.keys(
  UPDATES_COPY,
) as Array<UpdatesEventType>;

type Locale = Record<string, string>;

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

// The locale's own list of English that reads the same in it.
function sameAsEnglish(code: string): Set<string> {
  return new Set<string>(
    (
      JSON.parse(
        fs.readFileSync(path.join(PROGRESS_DIR, `${code}.json`), "utf8"),
      ) as { sameAsEnglish?: Array<string> }
    ).sameAsEnglish || [],
  );
}

const fullEnglish: Locale = readLocale(ENGLISH);

// Every sentence the step and the card's row draw, in English.
function everySentence(): Array<string> {
  const sentences: Array<string> = [
    // The step's title, and the card row's name.
    "Updates",
    UPDATES_SECTION_TITLE,
    EVERY_UPDATE_TITLE,
    KEY_UPDATES_TITLE,
    CHOOSE_UPDATES_TITLE,
    CHOOSE_UPDATES_DESCRIPTION,
  ];

  for (const eventType of UPDATES_EVENT_TYPES) {
    const copy: UpdatesCopy = UPDATES_COPY[eventType];

    sentences.push(
      copy.sectionDescription,
      copy.everyUpdateDescription,
      copy.keyUpdatesDescription,
      copy.nothingChosenNote,
      copy.nothingChosenTitle,
    );

    for (const kindCopy of Object.values(copy.kinds) as Array<UpdateKindCopy>) {
      sentences.push(kindCopy.title, kindCopy.description);
    }
  }

  return Array.from(new Set(sentences));
}

/*
 * The sentences a locale leaves in English (or leaves out), less those it
 * lists as reading the same in it.
 */
function untranslated(locale: Locale, excused: Set<string>): Array<string> {
  return everySentence().filter((sentence: string): boolean => {
    const words: string | undefined = locale[sentence];

    if (typeof words !== "string" || words.trim().length === 0) {
      return true;
    }

    return words === sentence && !excused.has(sentence);
  });
}

// The Dashboard's i18next options (Utils/i18n.ts), its resources given here.
async function dashboardIn(language: string): Promise<i18n> {
  const shipped: (code: string) => RuntimeLocaleTree = (
    code: string,
  ): RuntimeLocaleTree => {
    return getRuntimeLocale({
      language: code,
      fallbackLanguage: ENGLISH,
      locale: (code === ENGLISH
        ? fullEnglish
        : readLocale(code)) as unknown as RuntimeLocaleTree,
      fallback: fullEnglish as unknown as RuntimeLocaleTree,
    });
  };

  const instance: i18n = createInstance();
  const resources: Record<string, { translation: RuntimeLocaleTree }> = {
    [ENGLISH]: { translation: shipped(ENGLISH) },
  };

  if (language !== ENGLISH) {
    resources[language] = { translation: shipped(language) };
  }

  await instance.init({
    lng: language,
    resources: resources,
    partialBundledLanguages: true,
    fallbackLng: ENGLISH,
    supportedLngs: SUPPORTED_DASHBOARD_LANGUAGE_CODES,
    load: "currentOnly",
    interpolation: { escapeValue: false },
  });

  return instance;
}

function ruleOf(
  updatesToPost?: Array<NotificationRuleUpdateKind> | unknown,
): IncidentNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    shouldCreateNewChannel: false,
    shouldPostToExistingChannel: true,
    existingChannelNames: "#leadership",
    ...(updatesToPost !== undefined ? { updatesToPost: updatesToPost } : {}),
  } as IncidentNotificationRule;
}

/*
 * The step as the rule form holds it: the rule it edits kept in the form's
 * values, each change handed back recorded.
 */
function renderStep(data: {
  rule?: IncidentNotificationRule | undefined;
  eventType?: UpdatesEventType | undefined;
  error?: string | undefined;
  instance: i18n;
}): Array<IncidentNotificationRule> {
  const changes: Array<IncidentNotificationRule> = [];

  const Form: FunctionComponent = (): ReactElement => {
    const [rule, setRule] = useState<IncidentNotificationRule | undefined>(
      data.rule,
    );

    return (
      <NotificationRuleUpdatesForm
        value={rule}
        onChange={(value: IncidentNotificationRule) => {
          changes.push(value);
          setRule(value);
        }}
        eventType={data.eventType || NotificationRuleEventType.Incident}
        error={data.error}
      />
    );
  };

  render(
    <I18nextProvider i18n={data.instance}>
      <Form />
    </I18nextProvider>,
  );

  return changes;
}

function answers(): HTMLElement {
  return screen.getByRole("radiogroup");
}

function answer(name: string): HTMLElement {
  return within(answers()).getByRole("radio", { name: name });
}

function checkedAnswer(): string {
  const checked: HTMLElement | undefined = within(answers())
    .getAllByRole("radio")
    .find((radio: HTMLElement): boolean => {
      return (radio as HTMLInputElement).checked;
    });

  return checked
    ? document.querySelector(`label[for="${checked.id}"]`)?.textContent || ""
    : "";
}

function boxes(): Array<HTMLElement> {
  return screen.queryAllByRole("checkbox");
}

function tickedBoxes(): Array<string> {
  return boxes()
    .filter((box: HTMLElement): boolean => {
      return (box as HTMLInputElement).checked;
    })
    .map((box: HTMLElement): string => {
      return (
        document.querySelector(`label[for="${box.id}"]`)?.textContent || ""
      );
    });
}

function box(name: string): HTMLElement {
  return screen.getByRole("checkbox", { name: name });
}

afterEach(() => {
  cleanup();
});

describe("the step's words, one entry a kind of rule", () => {
  test("the kinds of rule that choose their updates are those with words for the step", () => {
    for (const eventType of Object.values(NotificationRuleEventType)) {
      expect({
        eventType: eventType,
        hasStep: isUpdatesEventType(eventType),
      }).toEqual({
        eventType: eventType,
        hasStep: NotificationRuleUpdates.canChooseUpdates(eventType),
      });
    }
  });

  test.each(UPDATES_EVENT_TYPES)(
    "%s rules have a box's words for each update they can choose, and no other",
    (eventType: UpdatesEventType) => {
      expect(Object.keys(UPDATES_COPY[eventType].kinds).sort()).toEqual(
        [...NotificationRuleUpdates.getChoosableKinds(eventType)].sort(),
      );
    },
  );

  test.each(UPDATES_EVENT_TYPES)(
    "no two boxes of %s rules share a name or a description",
    (eventType: UpdatesEventType) => {
      const kinds: Array<UpdateKindCopy> = Object.values(
        UPDATES_COPY[eventType].kinds,
      ) as Array<UpdateKindCopy>;

      for (const field of ["title", "description"] as const) {
        const words: Array<string> = kinds.map(
          (kindCopy: UpdateKindCopy): string => {
            return kindCopy[field];
          },
        );

        expect(new Set(words).size).toBe(words.length);
      }
    },
  );

  test("the key updates are what Key updates only says they are", () => {
    // Pinned per kind of rule: the step's sentence names them.
    expect(
      NotificationRuleUpdates.getKeyKinds(NotificationRuleEventType.Incident),
    ).toEqual([ResolvedAndReopened, SeverityChanges, PublicNotes, Postmortem]);
    expect(
      UPDATES_COPY[NotificationRuleEventType.Incident].keyUpdatesDescription,
    ).toBe(
      "Resolved and reopened, severity changes, public notes and the postmortem.",
    );
    expect(
      NotificationRuleUpdates.getKeyKinds(NotificationRuleEventType.Alert),
    ).toEqual([ResolvedAndReopened, SeverityChanges]);
    expect(
      UPDATES_COPY[NotificationRuleEventType.Alert].keyUpdatesDescription,
    ).toBe("Resolved and reopened, and severity changes.");
    expect(
      NotificationRuleUpdates.getKeyKinds(
        NotificationRuleEventType.OnCallDutyPolicy,
      ),
    ).toEqual([OnCallNow, NobodyOnCall]);
    expect(
      UPDATES_COPY[NotificationRuleEventType.OnCallDutyPolicy]
        .keyUpdatesDescription,
    ).toBe("Who is on call now, and when nobody is.");
  });
});

describe("the step's words in every language the Dashboard speaks", () => {
  test("en.json holds every sentence as the step writes it", () => {
    const missing: Array<string> = everySentence().filter(
      (sentence: string): boolean => {
        return fullEnglish[sentence] !== sentence;
      },
    );

    expect(missing).toEqual([]);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every sentence of the step and the card's row",
    (language: string) => {
      expect(
        untranslated(readLocale(language), sameAsEnglish(language)),
      ).toEqual([]);
    },
  );

  // The check above would see a sentence left in English, or left out.
  test("a sentence left in English, or left out, is caught", () => {
    const german: Locale = { ...readLocale("de") };

    german[KEY_UPDATES_TITLE] = KEY_UPDATES_TITLE;
    delete german[
      UPDATES_COPY[NotificationRuleEventType.AlertEpisode].nothingChosenNote
    ];

    expect(untranslated(german, sameAsEnglish("de"))).toEqual([
      KEY_UPDATES_TITLE,
      UPDATES_COPY[NotificationRuleEventType.AlertEpisode].nothingChosenNote,
    ]);
  });
});

describe("the step, as the rule form draws it", () => {
  test("a rule saved before the step, and a new rule, are on Every update", async () => {
    const instance: i18n = await dashboardIn(ENGLISH);

    for (const rule of [undefined, ruleOf(), ruleOf(null), ruleOf("Paging")]) {
      renderStep({ rule: rule, instance: instance });

      expect(checkedAnswer()).toBe("Every update");
      expect(boxes()).toHaveLength(0);

      cleanup();
    }
  });

  test("its three answers, each saying what the rule posts", async () => {
    renderStep({ instance: await dashboardIn(ENGLISH) });

    expect(answers()).toHaveAccessibleName("Which updates to post");
    expect(answer("Every update")).toHaveAccessibleDescription(
      "State changes, notes, owners, paging, edits and everything else.",
    );
    expect(answer("Key updates only")).toHaveAccessibleDescription(
      "Resolved and reopened, severity changes, public notes and the postmortem.",
    );
    expect(answer("Choose updates")).toHaveAccessibleDescription(
      "Pick the updates to post.",
    );
  });

  test("Key updates only hands back the rule with its key updates, the rest of it as it was", async () => {
    const changes: Array<IncidentNotificationRule> = renderStep({
      rule: ruleOf(),
      instance: await dashboardIn(ENGLISH),
    });

    await userEvent.click(answer("Key updates only"));

    expect(changes).toEqual([
      {
        ...ruleOf(),
        updatesToPost: [
          ResolvedAndReopened,
          SeverityChanges,
          PublicNotes,
          Postmortem,
        ],
      },
    ]);
    expect(checkedAnswer()).toBe("Key updates only");
  });

  test("Every update hands back the rule without its list", async () => {
    const changes: Array<IncidentNotificationRule> = renderStep({
      rule: ruleOf([Paging]),
      instance: await dashboardIn(ENGLISH),
    });

    expect(checkedAnswer()).toBe("Choose updates");

    await userEvent.click(answer("Every update"));

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(ruleOf());
    expect(Object.keys(changes[0]!)).not.toContain("updatesToPost");
  });

  test("Choose updates changes nothing until a box is changed, its boxes ticked as the rule posts", async () => {
    const changes: Array<IncidentNotificationRule> = renderStep({
      rule: ruleOf([
        ResolvedAndReopened,
        SeverityChanges,
        PublicNotes,
        Postmortem,
      ]),
      instance: await dashboardIn(ENGLISH),
    });

    expect(checkedAnswer()).toBe("Key updates only");

    await userEvent.click(answer("Choose updates"));

    expect(changes).toEqual([]);
    expect(checkedAnswer()).toBe("Choose updates");
    expect(screen.getByRole("group", { name: "Choose updates" })).toBeVisible();
    expect(tickedBoxes()).toEqual([
      "Resolved and reopened",
      "Severity changes",
      "Public notes",
      "Postmortem",
    ]);
  });

  test("each box says what it covers", async () => {
    renderStep({
      rule: ruleOf([Paging]),
      instance: await dashboardIn(ENGLISH),
    });

    expect(box("Private notes")).toHaveAccessibleDescription(
      "Notes kept off status pages.",
    );
    expect(box("Paging")).toHaveAccessibleDescription(
      "Who an on-call policy paged, and who acknowledged.",
    );
    expect(box("Owners and roles")).toHaveAccessibleDescription(
      "Owners added and removed, and people given a role, such as Incident Commander.",
    );
  });

  test("ticking a box adds its update, in the order of the boxes; clearing one takes it out", async () => {
    const changes: Array<IncidentNotificationRule> = renderStep({
      rule: ruleOf([Postmortem]),
      instance: await dashboardIn(ENGLISH),
    });

    await userEvent.click(box("Private notes"));
    await userEvent.click(box("Resolved and reopened"));
    await userEvent.click(box("Postmortem"));

    expect(
      changes.map((rule: IncidentNotificationRule) => {
        return (rule as { updatesToPost?: unknown }).updatesToPost;
      }),
    ).toEqual([
      [PrivateNotes, Postmortem],
      [ResolvedAndReopened, PrivateNotes, Postmortem],
      [ResolvedAndReopened, PrivateNotes],
    ]);
  });

  /*
   * REGRESSION: on a rule saved on Choose updates, the answer followed what
   * the boxes added up to - ticking the last box moved it to Every update
   * and closed the boxes under the pointer.
   */
  test("with every box ticked the rule posts every update, and the answer stays Choose updates", async () => {
    const changes: Array<IncidentNotificationRule> = renderStep({
      rule: ruleOf([]),
      instance: await dashboardIn(ENGLISH),
    });

    for (const kind of NotificationRuleUpdates.getChoosableKinds(
      NotificationRuleEventType.Incident,
    )) {
      await userEvent.click(
        screen.getByTestId(`notification-rule-update-${kind}`),
      );
    }

    expect(tickedBoxes()).toHaveLength(
      NotificationRuleUpdates.getChoosableKinds(
        NotificationRuleEventType.Incident,
      ).length,
    );
    // Every box ticked is every update: no list is kept.
    expect(Object.keys(changes[changes.length - 1]!)).not.toContain(
      "updatesToPost",
    );
    expect(checkedAnswer()).toBe("Choose updates");
  });

  test("a saved rule whose boxes come to the key updates stays on Choose updates, its boxes open", async () => {
    const changes: Array<IncidentNotificationRule> = renderStep({
      rule: ruleOf([ResolvedAndReopened, SeverityChanges, PublicNotes]),
      instance: await dashboardIn(ENGLISH),
    });

    expect(checkedAnswer()).toBe("Choose updates");

    await userEvent.click(box("Postmortem"));

    expect(
      (changes[changes.length - 1] as { updatesToPost?: unknown })
        .updatesToPost,
    ).toEqual([ResolvedAndReopened, SeverityChanges, PublicNotes, Postmortem]);
    expect(checkedAnswer()).toBe("Choose updates");
    expect(tickedBoxes()).toEqual([
      "Resolved and reopened",
      "Severity changes",
      "Public notes",
      "Postmortem",
    ]);
  });

  test("with no box ticked, it says what the rule still posts", async () => {
    const instance: i18n = await dashboardIn(ENGLISH);

    for (const eventType of UPDATES_EVENT_TYPES) {
      renderStep({
        rule: ruleOf([]),
        eventType: eventType,
        instance: instance,
      });

      expect(checkedAnswer()).toBe("Choose updates");
      expect(tickedBoxes()).toEqual([]);
      expect(
        screen.getByTestId("notification-rule-updates-nothing-chosen"),
      ).toHaveTextContent(UPDATES_COPY[eventType].nothingChosenNote);

      cleanup();
    }
  });

  /*
   * The note shows below the boxes, often off screen on a phone: a screen
   * reader hears it as the last box is cleared, from a polite live region
   * that was on the page before the note came into it.
   */
  test("clearing the last box reads out when the rule still posts", async () => {
    renderStep({
      rule: ruleOf([Paging]),
      instance: await dashboardIn(ENGLISH),
    });

    const region: Element | null = screen
      .getByTestId("notification-rule-updates-checklist")
      .querySelector('[aria-live="polite"]');

    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();

    await userEvent.click(box("Paging"));

    expect(region).toHaveTextContent(
      "With none ticked, the rule posts only when an incident is declared or a video call starts.",
    );
  });

  test("shows the form's own error for the step", async () => {
    renderStep({
      rule: ruleOf(),
      error: "Pick at least one update.",
      instance: await dashboardIn(ENGLISH),
    });

    expect(screen.getByText("Pick at least one update.")).toBeVisible();
  });

  test.each(UPDATES_EVENT_TYPES)(
    "a %s rule's boxes are the updates it can choose, in their order",
    async (eventType: UpdatesEventType) => {
      renderStep({
        rule: ruleOf([]),
        eventType: eventType,
        instance: await dashboardIn(ENGLISH),
      });

      expect(
        boxes().map((updateBox: HTMLElement): string => {
          return updateBox.getAttribute("data-testid") || "";
        }),
      ).toEqual(
        NotificationRuleUpdates.getChoosableKinds(eventType).map(
          (kind: NotificationRuleUpdateKind): string => {
            return `notification-rule-update-${kind}`;
          },
        ),
      );
    },
  );
});

/*
 * An on-call policy rule's step (#7549): its updates are who is on call,
 * and a new rule starts on Key updates only - who is on call now, and when
 * nobody is.
 */
describe("an on-call policy rule's step", () => {
  const ON_CALL: UpdatesEventType = NotificationRuleEventType.OnCallDutyPolicy;

  test("a new rule opens on Key updates only; one saved before, on Every update", async () => {
    const instance: i18n = await dashboardIn(ENGLISH);

    renderStep({
      rule: {
        ...ruleOf(),
        ...NotificationRuleUpdates.getNewRuleUpdates(ON_CALL),
      } as IncidentNotificationRule,
      eventType: ON_CALL,
      instance: instance,
    });

    expect(checkedAnswer()).toBe("Key updates only");
    expect(answer("Key updates only")).toHaveAccessibleDescription(
      "Who is on call now, and when nobody is.",
    );
    expect(answer("Every update")).toHaveAccessibleDescription(
      "Who is on call now and next, nobody on call, overrides, and changes to the policy and its owners.",
    );

    cleanup();

    renderStep({ rule: ruleOf(), eventType: ON_CALL, instance: instance });

    expect(checkedAnswer()).toBe("Every update");
  });

  test("its boxes say what each covers", async () => {
    renderStep({
      rule: ruleOf([OnCallNow]),
      eventType: ON_CALL,
      instance: await dashboardIn(ENGLISH),
    });

    expect(box("Who is on call now")).toHaveAccessibleDescription(
      "One line at each hand-off: who is on call, and until when.",
    );
    expect(box("Who is on call next")).toHaveAccessibleDescription(
      "Who takes over at the next hand-off, and when.",
    );
    expect(box("Nobody on call")).toHaveAccessibleDescription(
      "When a schedule is left with nobody on call, so alerts that reach it page no one.",
    );
    expect(box("User overrides")).toHaveAccessibleDescription(
      "Overrides added, changed and taken back: who is away, and who covers.",
    );
    expect(box("Changes to the policy")).toHaveAccessibleDescription(
      "Schedules, people and teams added to its escalation rules or taken out.",
    );
    expect(tickedBoxes()).toEqual(["Who is on call now"]);
  });

  test("ticking who is on call next adds it, in the order of the boxes", async () => {
    const changes: Array<IncidentNotificationRule> = renderStep({
      rule: ruleOf([OnCallNow, NobodyOnCall]),
      eventType: ON_CALL,
      instance: await dashboardIn(ENGLISH),
    });

    await userEvent.click(answer("Choose updates"));
    await userEvent.click(box("Who is on call next"));

    expect(
      (changes[changes.length - 1] as { updatesToPost?: unknown })
        .updatesToPost,
    ).toEqual([OnCallNow, OnCallNext, NobodyOnCall]);
  });

  test("the card's row: Key updates only, and who is on call now and nobody on call", async () => {
    render(
      <I18nextProvider i18n={await dashboardIn(ENGLISH)}>
        <UpdatesRuleSummary
          rule={ruleOf([NobodyOnCall, OnCallNow])}
          eventType={ON_CALL}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByTestId("notification-rule-updates-summary-title"),
    ).toHaveTextContent("Key updates only");
    expect(
      screen.getByTestId("notification-rule-updates-summary-list"),
    ).toHaveTextContent(
      ["Who is on call now", "Nobody on call"].join(INLINE_SEPARATOR),
    );
  });

  test("with every box cleared, the step and the card say it posts only when the policy is created", async () => {
    const instance: i18n = await dashboardIn(ENGLISH);

    renderStep({ rule: ruleOf([]), eventType: ON_CALL, instance: instance });

    expect(
      screen.getByTestId("notification-rule-updates-nothing-chosen"),
    ).toHaveTextContent(
      "With none ticked, the rule posts only when an on-call policy is created.",
    );

    cleanup();

    render(
      <I18nextProvider i18n={instance}>
        <UpdatesRuleSummary rule={ruleOf([])} eventType={ON_CALL} />
      </I18nextProvider>,
    );

    expect(
      screen.getByTestId("notification-rule-updates-summary-title"),
    ).toHaveTextContent("Only when an on-call policy is created");
    expect(
      screen.queryByTestId("notification-rule-updates-summary-list"),
    ).not.toBeInTheDocument();
  });

  test("German: a new rule's step, in German words", async () => {
    const german: Locale = readLocale("de");

    renderStep({
      rule: ruleOf([OnCallNow, NobodyOnCall]),
      eventType: ON_CALL,
      instance: await dashboardIn("de"),
    });

    expect(checkedAnswer()).toBe("Nur wichtige Aktualisierungen");

    await userEvent.click(answer("Aktualisierungen auswählen"));

    expect(tickedBoxes()).toEqual([
      german["Who is on call now"],
      german["Nobody on call"],
    ]);
    expect(german["Who is on call now"]).not.toBe("Who is on call now");
  });
});

describe("the step and the card's row in other languages", () => {
  test("German: the answers, a box and what Key updates only posts", async () => {
    const german: Locale = readLocale("de");

    renderStep({
      rule: ruleOf([
        ResolvedAndReopened,
        SeverityChanges,
        PublicNotes,
        Postmortem,
      ]),
      instance: await dashboardIn("de"),
    });

    expect(answers()).toHaveAccessibleName(
      "Welche Aktualisierungen gepostet werden",
    );
    expect(checkedAnswer()).toBe("Nur wichtige Aktualisierungen");
    expect(answer("Nur wichtige Aktualisierungen")).toHaveAccessibleDescription(
      german[
        UPDATES_COPY[NotificationRuleEventType.Incident].keyUpdatesDescription
      ] as string,
    );

    await userEvent.click(answer("Aktualisierungen auswählen"));

    expect(tickedBoxes()).toEqual([
      german["Resolved and reopened"],
      german["Severity changes"],
      german["Public notes"],
      german["Postmortem"],
    ]);
    expect(box(german["Private notes"] as string)).not.toBeChecked();
  });

  async function cardRow(
    language: string,
    updatesToPost: Array<NotificationRuleUpdateKind>,
    eventType: UpdatesEventType = NotificationRuleEventType.Incident,
  ): Promise<{ title: string | null; updates: string | null }> {
    render(
      <I18nextProvider i18n={await dashboardIn(language)}>
        <UpdatesRuleSummary
          rule={ruleOf(updatesToPost)}
          eventType={eventType}
        />
      </I18nextProvider>,
    );

    return {
      title:
        screen.queryByTestId("notification-rule-updates-summary-title")
          ?.textContent || null,
      updates:
        screen.queryByTestId("notification-rule-updates-summary-list")
          ?.textContent || null,
    };
  }

  test("German: the card names the answer and its updates", async () => {
    expect(
      await cardRow("de", [
        ResolvedAndReopened,
        SeverityChanges,
        PublicNotes,
        Postmortem,
      ]),
    ).toEqual({
      title: "Nur wichtige Aktualisierungen",
      updates: [
        "Behoben und wieder geöffnet",
        "Änderungen des Schweregrads",
        "Öffentliche Notizen",
        "Postmortem",
      ].join(INLINE_SEPARATOR),
    });
  });

  test("Persian: the updates set apart with the bullet Persian uses, its zero being a dot", async () => {
    const persian: Locale = readLocale("fa");

    expect(await cardRow("fa", [PrivateNotes, Paging])).toEqual({
      title: null,
      updates: [persian["Private notes"], persian["Paging"]].join(
        DOT_ZERO_INLINE_SEPARATOR,
      ),
    });
  });

  test("Arabic: a rule with every box cleared says when it still posts, for each kind of rule", async () => {
    const arabic: Locale = readLocale("ar");

    for (const eventType of UPDATES_EVENT_TYPES) {
      expect(await cardRow("ar", [], eventType)).toEqual({
        title: arabic[UPDATES_COPY[eventType].nothingChosenTitle],
        updates: null,
      });

      cleanup();
    }

    // "Only when an incident is declared or a video call starts".
    expect(
      arabic[
        UPDATES_COPY[NotificationRuleEventType.Incident].nothingChosenTitle
      ],
    ).toBe("عند إعلان حادثة أو بدء مكالمة فيديو فقط");
  });

  test("German: the step's note with every box cleared, in German", async () => {
    renderStep({ rule: ruleOf([]), instance: await dashboardIn("de") });

    expect(
      screen.getByTestId("notification-rule-updates-nothing-chosen"),
    ).toHaveTextContent(
      "Ist nichts ausgewählt, postet die Regel nur, wenn ein Vorfall gemeldet oder ein Videoanruf gestartet wird.",
    );
  });
});
