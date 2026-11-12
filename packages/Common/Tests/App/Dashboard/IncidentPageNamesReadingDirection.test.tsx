import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * NAMES PEOPLE TYPED, ON AN INCIDENT'S, AN ALERT'S AND AN EPISODE'S PAGE,
 * READ THE WAY THEY ARE WRITTEN (#6471).
 *
 * A line of an Arabic or Persian page reads from the right. An English
 * name drawn as a line of the page's was cut at its start where its box
 * ended ("...e-commerce.example"), its wrapped lines lined up on the right,
 * and its brackets stood at the wrong end ("(checkout-api (eu"). Each name
 * here is a line of its own that reads the way it is written now
 * (IsolatedLine, or IsolatedText for a name in a sentence of the page's):
 *
 *   - the header's people (owners, the commander) and the things a fact
 *     names (monitors, an episode, status pages): they wrap, as wide as
 *     their words at the page's start, each line from its own start;
 *   - an episode's grouping rule, in its header's facts;
 *   - the on-call policies an incident or an alert paged, listed the
 *     reader's way ("، " between them in Arabic and Persian);
 *   - a note template's name and first line, and a runbook's name and
 *     description, cut short at their own end.
 *
 * A name that reads the page's way is drawn exactly as it was. The channel
 * card's people and a call's title are in RecordChannelMembersCard.test
 * and EventVideoCallsCard.test; the roles card in
 * MemberRoleAssignmentReadingDirection.test.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
        dir?: string;
        title?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          {
            href: props.to?.toString(),
            className: props.className,
            dir: props.dir,
            title: props.title,
          },
          typeof props.children === "string"
            ? React.createElement("span", null, props.children)
            : props.children,
        );
      },
    };
  },
);

import {
  EVENT_PERSON_NAME_CLASS_NAME,
  PersonFactValue,
  getCommanderFact,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventPeopleFacts";
import EventFactLinks, {
  EVENT_FACT_LINK_CLASS_NAME,
  EVENT_FACT_NAME_CLASS_NAME,
  EventFactLinkItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventFactLinks";
import { EventStatusFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import {
  EPISODE_GROUPING_RULE_NAME_TEST_ID,
  getEpisodeHeaderFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeHeader";
import OnCallDutyPoliciesView from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicies";
import NoteTemplateMenu, {
  NoteTemplateOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteTemplateMenu";
import RunbookPicker from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { createTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

const ENGLISH_PERSON: string = "Maya Chen-Rodriguez (Platform SRE, EU West)";
const ARABIC_PERSON: string = "مايا تشين رودريغيز";

const UNTITLED_TEMPLATE: Record<string, string> = {
  ar: "قالب بلا عنوان",
  fa: "الگوی بی‌نام",
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa", "ja"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        ar: {
          translation: { "Untitled template": UNTITLED_TEMPLATE["ar"]! },
        },
        fa: {
          translation: { "Untitled template": UNTITLED_TEMPLATE["fa"]! },
        },
        ja: { translation: {} },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  // Route population reads the project id from the current URL.
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const drawOn: (language: string, element: ReactElement) => HTMLElement = (
  language: string,
  element: ReactElement,
): HTMLElement => {
  return render(
    <I18nextProvider i18n={instances[language]!}>
      <div data-testid="holder">{element}</div>
    </I18nextProvider>,
  ).getByTestId("holder");
};

const CLAMPED_CLASSES: Array<string> =
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" ");

describe("the header's people: owners, a commander, who created it", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English name wraps from its own start beside its avatar, as wide as its words",
    (language: string) => {
      drawOn(language, <PersonFactValue name={ENGLISH_PERSON} />);

      const name: HTMLElement = screen.getByTestId("event-person-name");

      expect(name.tagName).toBe("SPAN");
      expect(name.textContent).toBe(ENGLISH_PERSON);
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.getAttribute("class")).toBe(
        `${EVENT_PERSON_NAME_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      // Never lined up by its end, its wrapped lines on the right.
      expect(name).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);

      // The avatar and the name are a row of the page's way.
      const person: HTMLElement = screen.getByTestId("event-person-entry");

      expect(person).not.toHaveAttribute("dir");
      expect(person.lastElementChild).toBe(name);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic name is drawn as it was",
    (language: string) => {
      drawOn(language, <PersonFactValue name={ARABIC_PERSON} />);

      const name: HTMLElement = screen.getByTestId("event-person-name");

      expect(name).not.toHaveAttribute("dir");
      expect(name.getAttribute("class")).toBe(EVENT_PERSON_NAME_CLASS_NAME);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the commander's names read their own way too",
    (language: string) => {
      const fact: EventStatusFact | null = getCommanderFact({
        holding: {
          role: {
            id: "role-1",
            name: "Incident Commander",
            isPrimaryRole: true,
          },
          members: [
            {
              roleId: "role-1",
              userId: "0193c0de-6471-4aaa-8bbb-000000000001",
              name: ENGLISH_PERSON,
              hasProfilePicture: false,
            },
            {
              roleId: "role-1",
              userId: "0193c0de-6471-4aaa-8bbb-000000000002",
              name: ARABIC_PERSON,
              hasProfilePicture: false,
            },
          ],
        },
      });

      drawOn(language, fact!.value as ReactElement);

      const [english, arabic] = screen.getAllByTestId("event-person-name");

      expect(english!.textContent).toBe(ENGLISH_PERSON);
      expect(english).toHaveAttribute("dir", "ltr");
      expect(english).toHaveClass(...CLAMPED_CLASSES);
      expect(arabic!.textContent).toBe(ARABIC_PERSON);
      expect(arabic).not.toHaveAttribute("dir");
    },
  );

  test("on an English page an English name is drawn as it was, an Arabic one reads right to left", () => {
    drawOn(
      "en",
      <>
        <PersonFactValue name={ENGLISH_PERSON} />
        <PersonFactValue name={ARABIC_PERSON} />
      </>,
    );

    const [english, arabic] = screen.getAllByTestId("event-person-name");

    expect(english).not.toHaveAttribute("dir");
    expect(english!.getAttribute("class")).toBe(EVENT_PERSON_NAME_CLASS_NAME);
    expect(arabic).toHaveAttribute("dir", "rtl");
    expect(arabic!.getAttribute("class")).toBe(
      `${EVENT_PERSON_NAME_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
  });
});

describe("the things a header fact names: monitors, an episode, status pages", () => {
  const ENGLISH_MONITOR: string = "checkout-api (eu-west-1, p95 latency)";
  const ENGLISH_PLAIN: string = "Payments DB (read replica)";
  const ARABIC_MONITOR: string = "واجهة الدفع";

  const ITEMS: Array<EventFactLinkItem> = [
    {
      key: "a",
      name: ENGLISH_MONITOR,
      route: new Route(`/dashboard/${PROJECT_ID}/monitors/a`),
    },
    { key: "b", name: ENGLISH_PLAIN },
    {
      key: "c",
      name: ARABIC_MONITOR,
      route: new Route(`/dashboard/${PROJECT_ID}/monitors/c`),
    },
  ];

  // The name's line: the link that names it, or its plain line.
  const lineOf: (name: string) => HTMLElement = (name: string): HTMLElement => {
    const words: HTMLElement = screen.getByText(name);
    const link: HTMLElement | null = words.closest("a");

    return link || words;
  };

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English name - a link or plain words - wraps from its own start, as wide as its words",
    (language: string) => {
      drawOn(
        language,
        <EventFactLinks items={ITEMS} dataTestId="event-fact-links" />,
      );

      const link: HTMLElement = lineOf(ENGLISH_MONITOR);

      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("dir", "ltr");
      expect(link.getAttribute("class")).toBe(
        `${EVENT_FACT_NAME_CLASS_NAME} ${EVENT_FACT_LINK_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(link).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);

      const plain: HTMLElement = lineOf(ENGLISH_PLAIN);

      expect(plain.tagName).toBe("SPAN");
      expect(plain).toHaveAttribute("dir", "ltr");
      expect(plain.getAttribute("class")).toBe(
        `${EVENT_FACT_NAME_CLASS_NAME} ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );

      // The column of names keeps the page's way.
      expect(screen.getByTestId("event-fact-links")).not.toHaveAttribute("dir");
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic name's link is drawn as it was",
    (language: string) => {
      drawOn(language, <EventFactLinks items={ITEMS} />);

      const link: HTMLElement = lineOf(ARABIC_MONITOR);

      expect(link).not.toHaveAttribute("dir");
      expect(link.getAttribute("class")).toBe(
        `${EVENT_FACT_NAME_CLASS_NAME} ${EVENT_FACT_LINK_CLASS_NAME}`,
      );
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: '+N more' is the page's own words, in the page's way",
    (language: string) => {
      drawOn(
        language,
        <EventFactLinks
          items={ITEMS}
          maxVisible={1}
          moreRoute={new Route(`/dashboard/${PROJECT_ID}/monitors`)}
        />,
      );

      // "+2 more" in the reader's digits ("+۲ more" in Persian).
      const more: HTMLElement = Array.from(document.querySelectorAll("a")).find(
        (link: HTMLAnchorElement): boolean => {
          return (
            link.getAttribute("href") === `/dashboard/${PROJECT_ID}/monitors`
          );
        },
      ) as HTMLElement;

      expect(more.textContent).toMatch(/^\+\S+ more$/);

      expect(more).not.toHaveAttribute("dir");
      expect(more.getAttribute("class")).toContain(EVENT_FACT_LINK_CLASS_NAME);
    },
  );

  test("on an English page the names are drawn as they were", () => {
    drawOn("en", <EventFactLinks items={ITEMS} />);

    const link: HTMLElement = lineOf(ENGLISH_MONITOR);
    const plain: HTMLElement = lineOf(ENGLISH_PLAIN);

    expect(link).not.toHaveAttribute("dir");
    expect(link.getAttribute("class")).toBe(
      `max-w-full break-words ${EVENT_FACT_LINK_CLASS_NAME}`,
    );
    expect(plain).not.toHaveAttribute("dir");
    expect(plain.getAttribute("class")).toBe("max-w-full break-words");
    expect(lineOf(ARABIC_MONITOR)).toHaveAttribute("dir", "rtl");
  });
});

describe("an episode's grouping rule, in its header's facts", () => {
  const ENGLISH_RULE: string = "Checkout errors (EU, 5xx) - grouped by monitor";
  const ARABIC_RULE: string = "أخطاء الدفع في أوروبا";

  const groupingValueOn: (
    language: string,
    groupingRuleName: string | undefined,
  ) => EventStatusFact["value"] = (
    language: string,
    groupingRuleName: string | undefined,
  ): EventStatusFact["value"] => {
    return getEpisodeHeaderFacts(
      { groupingRuleName: groupingRuleName, memberNoun: "incident" },
      createTranslator(undefined, language),
    )[0]!.value;
  };

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English rule wraps from its own start, as wide as its words",
    (language: string) => {
      drawOn(language, groupingValueOn(language, ENGLISH_RULE) as ReactElement);

      const rule: HTMLElement = screen.getByTestId(
        EPISODE_GROUPING_RULE_NAME_TEST_ID,
      );

      expect(rule.textContent).toBe(ENGLISH_RULE);
      expect(rule).toHaveAttribute("dir", "ltr");
      expect(rule.getAttribute("class")).toBe(
        `break-words ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
    },
  );

  test.each(["en", ...RIGHT_TO_LEFT_LANGUAGES])(
    "%s: a rule in the page's script is drawn as it reads, and no rule is our own words",
    (language: string) => {
      const name: string = language === "en" ? ENGLISH_RULE : ARABIC_RULE;

      drawOn(language, groupingValueOn(language, name) as ReactElement);

      const rule: HTMLElement = screen.getByTestId(
        EPISODE_GROUPING_RULE_NAME_TEST_ID,
      );

      expect(rule).not.toHaveAttribute("dir");
      expect(rule.getAttribute("class")).toBe("break-words");

      // A manual episode says so in words of the page's: a plain string.
      expect(typeof groupingValueOn(language, undefined)).toBe("string");
    },
  );
});

describe("the on-call policies an incident or an alert paged", () => {
  const policyNamed: (name: string, hasId?: boolean) => OnCallDutyPolicy = (
    name: string,
    hasId: boolean = true,
  ): OnCallDutyPolicy => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();

    if (hasId) {
      policy._id = ObjectID.generate().toString();
    }

    policy.name = name;
    return policy;
  };

  const POLICIES: () => Array<OnCallDutyPolicy> =
    (): Array<OnCallDutyPolicy> => {
      return [
        policyNamed("Primary on-call (EU)."),
        policyNamed("Secondary escalation"),
        policyNamed("خط المناوبة"),
      ];
    };

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: each name is an isolate read its own way, listed with the Arabic comma",
    (language: string) => {
      const holder: HTMLElement = drawOn(
        language,
        <OnCallDutyPoliciesView onCallPolicies={POLICIES()} />,
      );

      const names: Array<HTMLElement> = screen.getAllByTestId(
        "on-call-policy-name",
      );

      expect(
        names.map((name: HTMLElement): string => {
          return `${name.tagName} ${name.getAttribute("dir")}`;
        }),
      ).toEqual(["BDI ltr", "BDI ltr", "BDI rtl"]);

      // Each name is its link's words.
      for (const name of names) {
        expect(name.parentElement!.tagName).toBe("A");
      }

      expect(holder.textContent).toBe(
        "Primary on-call (EU).، Secondary escalation، خط المناوبة",
      );
    },
  );

  test("on an English page the names are listed with a comma, as they were", () => {
    const holder: HTMLElement = drawOn(
      "en",
      <OnCallDutyPoliciesView onCallPolicies={POLICIES().slice(0, 2)} />,
    );

    expect(holder.textContent).toBe(
      "Primary on-call (EU)., Secondary escalation",
    );
  });

  test("in Japanese the names are listed with the ideographic comma", () => {
    const holder: HTMLElement = drawOn(
      "ja",
      <OnCallDutyPoliciesView onCallPolicies={POLICIES().slice(0, 2)} />,
    );

    expect(holder.textContent).toBe(
      "Primary on-call (EU).、Secondary escalation",
    );
  });

  test("a policy with no page of its own is its name alone, read its own way", () => {
    drawOn(
      "fa",
      <OnCallDutyPoliciesView
        onCallPolicies={[policyNamed("Legacy pager rota", false)]}
      />,
    );

    const name: HTMLElement = screen.getByTestId("on-call-policy-name");

    expect(name.tagName).toBe("BDI");
    expect(name).toHaveAttribute("dir", "ltr");
    expect(name.closest("a")).toBeNull();
  });
});

describe("a note template's name and first line", () => {
  const ENGLISH_TEMPLATE: NoteTemplateOption = {
    id: "t1",
    name: "Contained: rollback shipped to every region",
    note: "## Identified\nWe know why checkout failed.",
  };
  const ARABIC_TEMPLATE: NoteTemplateOption = {
    id: "t2",
    name: "تم الاحتواء",
    note: "عرفنا السبب",
  };
  const UNTITLED: NoteTemplateOption = {
    id: "t3",
    name: "",
    note: "",
  };

  const openMenu: (language: string) => Promise<HTMLElement> = async (
    language: string,
  ): Promise<HTMLElement> => {
    drawOn(
      language,
      <NoteTemplateMenu
        loadTemplates={async (): Promise<Array<NoteTemplateOption>> => {
          return [ENGLISH_TEMPLATE, ARABIC_TEMPLATE, UNTITLED];
        }}
        onPick={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("note-template-menu-button"));

    const menu: HTMLElement = await screen.findByTestId("note-template-menu");

    await within(menu).findByText(ENGLISH_TEMPLATE.name);

    return menu;
  };

  const lineReading: (
    menu: HTMLElement,
    testId: string,
    text: string,
  ) => HTMLElement = (
    menu: HTMLElement,
    testId: string,
    text: string,
  ): HTMLElement => {
    const line: HTMLElement | undefined = within(menu)
      .getAllByTestId(testId)
      .find((each: HTMLElement): boolean => {
        return each.textContent === text;
      });

    if (!line) {
      throw new Error(`No ${testId} reads "${text}"`);
    }

    return line;
  };

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English template's lines read left to right, cut short at their own end",
    async (language: string) => {
      const menu: HTMLElement = await openMenu(language);

      const name: HTMLElement = lineReading(
        menu,
        "note-template-name",
        ENGLISH_TEMPLATE.name,
      );
      const preview: HTMLElement = lineReading(
        menu,
        "note-template-preview",
        "Identified",
      );

      expect(name.tagName).toBe("SPAN");
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.getAttribute("class")).toBe(
        `w-full truncate text-sm font-medium text-gray-900 ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(preview).toHaveAttribute("dir", "ltr");
      expect(preview.getAttribute("class")).toBe(
        `w-full truncate text-xs text-gray-500 ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      // The button the two lines are in keeps the page's way.
      expect(name.closest("button")).not.toHaveAttribute("dir");
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic template, and one with no name, are drawn as they were",
    async (language: string) => {
      const menu: HTMLElement = await openMenu(language);

      for (const line of [
        lineReading(menu, "note-template-name", ARABIC_TEMPLATE.name),
        lineReading(menu, "note-template-preview", ARABIC_TEMPLATE.note),
        lineReading(menu, "note-template-name", UNTITLED_TEMPLATE[language]!),
      ]) {
        expect(line).not.toHaveAttribute("dir");
        expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      }
    },
  );

  test("on an English page an English template is drawn as it was", async () => {
    const menu: HTMLElement = await openMenu("en");

    const name: HTMLElement = lineReading(
      menu,
      "note-template-name",
      ENGLISH_TEMPLATE.name,
    );

    expect(name).not.toHaveAttribute("dir");
    expect(name.getAttribute("class")).toBe(
      "w-full truncate text-sm font-medium text-gray-900",
    );
    expect(
      lineReading(menu, "note-template-name", "Untitled template"),
    ).not.toHaveAttribute("dir");
    expect(
      lineReading(menu, "note-template-name", ARABIC_TEMPLATE.name),
    ).toHaveAttribute("dir", "rtl");
  });
});

describe("a runbook's name and description in the runbook picker", () => {
  const ENGLISH_NAME: string = "Restart checkout pods (EU West, all zones)";
  const ENGLISH_DESCRIPTION: string =
    "Drains each node, restarts the checkout deployment and waits for it to be ready again.";
  const ARABIC_NAME: string = "إعادة تشغيل خدمة الدفع";

  const runbookNamed: (name: string, description?: string) => Runbook = (
    name: string,
    description?: string,
  ): Runbook => {
    const runbook: Runbook = new Runbook();
    runbook._id = ObjectID.generate().toString();
    runbook.name = name;

    if (description) {
      runbook.description = description;
    }

    return runbook;
  };

  const openPicker: (language: string) => Promise<void> = async (
    language: string,
  ): Promise<void> => {
    jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<ListResult<Runbook>> => {
        return {
          data: [
            runbookNamed(ENGLISH_NAME, ENGLISH_DESCRIPTION),
            runbookNamed(ARABIC_NAME, "يعيد تشغيل كل العقد"),
          ],
          count: 2,
          skip: 0,
          limit: 200,
        };
      });

    drawOn(language, <RunbookPicker isOpen={true} onClose={() => {}} />);

    await screen.findAllByTestId("runbook-picker-name");
  };

  const nameLine: (name: string) => HTMLElement = (
    name: string,
  ): HTMLElement => {
    return screen
      .getAllByTestId("runbook-picker-name")
      .find((each: HTMLElement): boolean => {
        return each.textContent === name;
      })!;
  };

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English runbook's name is cut short at its own end, and its description's lines start at its own start",
    async (language: string) => {
      await openPicker(language);

      const name: HTMLElement = nameLine(ENGLISH_NAME);

      expect(name.tagName).toBe("SPAN");
      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.getAttribute("class")).toBe(
        `text-sm font-semibold text-gray-900 truncate ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      // Its row, with the book's icon at the line's start, keeps the page's way.
      expect(name.parentElement).not.toHaveAttribute("dir");

      const description: HTMLElement = screen
        .getAllByTestId("runbook-picker-description")
        .find((each: HTMLElement): boolean => {
          return each.textContent === ENGLISH_DESCRIPTION;
        })!;

      /*
       * Cut short to two lines (line-clamp-2): as wide as its words, its
       * "..." kept, rather than aligned to its end.
       */
      expect(description.tagName).toBe("P");
      expect(description).toHaveAttribute("dir", "ltr");
      expect(description.getAttribute("class")).toBe(
        `text-xs text-gray-500 mt-1 line-clamp-2 ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );

      expect(nameLine(ARABIC_NAME)).not.toHaveAttribute("dir");
    },
  );

  test("on an English page an English runbook is drawn as it was", async () => {
    await openPicker("en");

    expect(nameLine(ENGLISH_NAME)).not.toHaveAttribute("dir");
    expect(nameLine(ENGLISH_NAME).getAttribute("class")).toBe(
      "text-sm font-semibold text-gray-900 truncate",
    );
    expect(nameLine(ARABIC_NAME)).toHaveAttribute("dir", "rtl");
  });
});
