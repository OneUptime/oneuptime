import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();

// Hoisted above the requires: the arrow defers reading the mock until a call.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import EpisodeMembersCard, {
  EPISODE_MEMBER_PILL_NAME_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembersCard";
import {
  INCIDENT_EPISODE_MEMBERSHIP,
  INCIDENT_EPISODE_MEMBER_SELECT,
  getIncidentEpisodeMemberRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembers";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * AN EPISODE'S INCIDENTS: THE STATE AND SEVERITY NAMES A PROJECT TYPED,
 * READ THE WAY THEY ARE WRITTEN (#7086).
 *
 * Each incident in the card under an episode's overview has two pills: its
 * state and its severity. A built-in name (Resolved, Critical) is the
 * reader's word for it; a name the project typed is shown as it was typed.
 * On an Arabic or Persian page such an English name was drawn the page's
 * way in its pill, so one too long for the row lost its start
 * ("...on the vendor (EU)") and its brackets stood at the wrong end.
 *
 * The name is a line of its own now that reads the way it is written
 * (IsolatedLine), as the episode header's own Pill draws it: cut short at
 * its own end, its dot still at the page's start. A name that reads the
 * page's way, and every name on an English page, is drawn exactly as it
 * was. The card is drawn here with the real Dashboard locales.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
};

const LOCALE_FILES: Record<string, Record<string, string>> = {
  en: readLocale("en"),
  ar: readLocale("ar"),
  fa: readLocale("fa"),
};

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";
const TYPED_ENGLISH_ID: string = "55555555-5555-4555-8555-555555555555";
const TYPED_ARABIC_ID: string = "66666666-6666-4666-8666-666666666666";
const BUILT_IN_ID: string = "77777777-7777-4777-8777-777777777777";

const ENGLISH_STATE: string = "Waiting on the vendor (EU)";
const ENGLISH_SEVERITY: string = "SEV-2 (customer facing)";
const ARABIC_STATE: string = "بانتظار المورد";
const ARABIC_SEVERITY: string = "خطورة متوسطة";

type BuildIncidentFunction = (options: {
  id: string;
  number: number;
  stateName: string;
  severityName: string;
}) => Incident;

const buildIncident: BuildIncidentFunction = (options: {
  id: string;
  number: number;
  stateName: string;
  severityName: string;
}): Incident => {
  const incident: Incident = new Incident();
  incident.id = new ObjectID(options.id);
  incident.title = `Checkout API latency ${options.number}`;
  incident.incidentNumber = options.number;
  incident.declaredAt = new Date(Date.now() - options.number * 60 * 1000);

  const state: IncidentState = new IncidentState();
  state.name = options.stateName;
  state.color = new Color("#10b981");
  incident.currentIncidentState = state;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = options.severityName;
  severity.color = new Color("#f97316");
  incident.incidentSeverity = severity;

  return incident;
};

const INCIDENTS: Array<Incident> = [
  buildIncident({
    id: TYPED_ENGLISH_ID,
    number: 3,
    stateName: ENGLISH_STATE,
    severityName: ENGLISH_SEVERITY,
  }),
  buildIncident({
    id: TYPED_ARABIC_ID,
    number: 2,
    stateName: ARABIC_STATE,
    severityName: ARABIC_SEVERITY,
  }),
  buildIncident({
    id: BUILT_IN_ID,
    number: 1,
    stateName: "Resolved",
    severityName: "Critical",
  }),
];

// The episode's membership rows first, then the incidents they name.
const serve: () => void = (): void => {
  getListMock.mockImplementation((...args: Array<any>) => {
    const request: Record<string, any> = args[0];
    const rows: Array<unknown> =
      request["modelType"] === IncidentEpisodeMember
        ? INCIDENTS.map((incident: Incident): IncidentEpisodeMember => {
            const membership: IncidentEpisodeMember =
              new IncidentEpisodeMember();
            membership.incidentEpisodeId = new ObjectID(EPISODE_ID);
            membership.incidentId = incident.id!;
            return membership;
          })
        : INCIDENTS;

    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: 8,
    });
  });
};

const renderCard: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  await act(async () => {
    render(
      <EpisodeMembersCard<Incident, IncidentEpisodeMember>
        modelType={Incident}
        episodeId={new ObjectID(EPISODE_ID)}
        membership={INCIDENT_EPISODE_MEMBERSHIP}
        select={INCIDENT_EPISODE_MEMBER_SELECT}
        sortField="declaredAt"
        toRow={getIncidentEpisodeMemberRow}
        title="Incidents in this episode"
        singularNoun="incident"
        pluralNoun="incidents"
        countTemplate={{
          one: "{{count}} incident",
          other: "{{count}} incidents",
        }}
        viewAllRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS] as Route,
          { modelId: new ObjectID(EPISODE_ID) },
        )}
        getMemberRoute={(memberId: ObjectID): Route => {
          return RouteUtil.populateRouteParams(
            RouteMap[PageMap.INCIDENT_VIEW] as Route,
            { modelId: memberId },
          );
        }}
      />,
    );
  });

  await screen.findAllByTestId("episode-member-row");
};

const rowOf: (incidentId: string) => HTMLElement = (
  incidentId: string,
): HTMLElement => {
  const link: HTMLElement | undefined = screen
    .getAllByRole("link")
    .find((element: HTMLElement): boolean => {
      return (element.getAttribute("href") || "").includes(incidentId);
    });

  return link!.closest("li") as HTMLElement;
};

interface DrawnPill {
  pill: HTMLElement;
  dot: HTMLElement;
  name: HTMLElement;
}

// A row's state or severity pill: its dot, then its name.
const pillOf: (
  incidentId: string,
  testId: "episode-member-state" | "episode-member-severity",
) => DrawnPill = (
  incidentId: string,
  testId: "episode-member-state" | "episode-member-severity",
): DrawnPill => {
  const pill: HTMLElement = within(rowOf(incidentId)).getByTestId(testId);

  expect(pill.children).toHaveLength(2);

  return {
    pill: pill,
    dot: pill.firstElementChild as HTMLElement,
    name: pill.lastElementChild as HTMLElement,
  };
};

const TRUNCATED_LINE_CLASS_NAME: string = `${EPISODE_MEMBER_PILL_NAME_CLASS_NAME} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: LOCALE_FILES["en"]! },
      ar: { translation: LOCALE_FILES["ar"]! },
      fa: { translation: LOCALE_FILES["fa"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  getListMock.mockReset();
  serve();

  const pagePath: string = `/dashboard/${PROJECT_ID}/incidents/episodes/${EPISODE_ID}`;

  window.history.pushState({}, "", pagePath);
  Navigation.setLocation({
    pathname: pagePath,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("a state or severity the project named in English", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: reads left to right in its pill, cut short at its own end",
    async (language: string) => {
      await renderCard(language);

      for (const [testId, typed] of [
        ["episode-member-state", ENGLISH_STATE],
        ["episode-member-severity", ENGLISH_SEVERITY],
      ] as Array<
        ["episode-member-state" | "episode-member-severity", string]
      >) {
        const { pill, dot, name } = pillOf(TYPED_ENGLISH_ID, testId);

        expect(name.tagName).toBe("SPAN");
        expect(name.textContent).toBe(typed);
        expect(name).toHaveAttribute("dir", "ltr");
        expect(name.getAttribute("class")).toBe(TRUNCATED_LINE_CLASS_NAME);

        // The pill keeps the page's way: its dot first, at the page's start.
        expect(pill).not.toHaveAttribute("dir");
        expect(dot).toHaveAttribute("aria-hidden", "true");
        expect(dot).not.toHaveAttribute("dir");
      }
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: its tooltip still names it whole, in a sentence of the reader's",
    async (language: string) => {
      await renderCard(language);

      const { pill } = pillOf(TYPED_ENGLISH_ID, "episode-member-state");
      const sentence: string = LOCALE_FILES[language]!["State: {{name}}"]!;

      expect(pill).toHaveAttribute(
        "title",
        sentence.replace("{{name}}", ENGLISH_STATE),
      );
    },
  );

  test("on an English page is drawn as it always was", async () => {
    await renderCard("en");

    for (const testId of [
      "episode-member-state",
      "episode-member-severity",
    ] as Array<"episode-member-state" | "episode-member-severity">) {
      const { name } = pillOf(TYPED_ENGLISH_ID, testId);

      expect(name).not.toHaveAttribute("dir");
      expect(name.getAttribute("class")).toBe("truncate");
      expect(name.attributes).toHaveLength(1);
    }

    expect(
      pillOf(TYPED_ENGLISH_ID, "episode-member-state").name.textContent,
    ).toBe(ENGLISH_STATE);
  });
});

describe("a state or severity the project named in Arabic", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: reads the page's way, drawn as it was",
    async (language: string) => {
      await renderCard(language);

      const state: DrawnPill = pillOf(TYPED_ARABIC_ID, "episode-member-state");
      const severity: DrawnPill = pillOf(
        TYPED_ARABIC_ID,
        "episode-member-severity",
      );

      expect(state.name.textContent).toBe(ARABIC_STATE);
      expect(state.name).not.toHaveAttribute("dir");
      expect(state.name.getAttribute("class")).toBe("truncate");
      expect(severity.name.textContent).toBe(ARABIC_SEVERITY);
      expect(severity.name).not.toHaveAttribute("dir");
    },
  );

  test("on an English page reads right to left, cut short at its own end", async () => {
    await renderCard("en");

    const { name, pill } = pillOf(TYPED_ARABIC_ID, "episode-member-state");

    expect(name).toHaveAttribute("dir", "rtl");
    expect(name.getAttribute("class")).toBe(TRUNCATED_LINE_CLASS_NAME);
    expect(pill).not.toHaveAttribute("dir");
  });
});

describe("a built-in state or severity", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: is the reader's word for it, in the page's way",
    async (language: string) => {
      await renderCard(language);

      const resolved: string = LOCALE_FILES[language]!["Resolved"]!;
      const critical: string = LOCALE_FILES[language]!["Critical"]!;

      expect(resolved).not.toBe("Resolved");
      expect(critical).not.toBe("Critical");

      const state: DrawnPill = pillOf(BUILT_IN_ID, "episode-member-state");
      const severity: DrawnPill = pillOf(
        BUILT_IN_ID,
        "episode-member-severity",
      );

      expect(state.name.textContent).toBe(resolved);
      expect(state.name).not.toHaveAttribute("dir");
      expect(state.name.getAttribute("class")).toBe("truncate");
      expect(severity.name.textContent).toBe(critical);
      expect(severity.name).not.toHaveAttribute("dir");
    },
  );
});
