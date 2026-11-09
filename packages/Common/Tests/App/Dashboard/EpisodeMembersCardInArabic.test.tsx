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

import EpisodeMembersCard from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembersCard";
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
 * AN EPISODE'S INCIDENTS, READ IN ARABIC.
 *
 * The card under an episode's overview lists its newest incidents. Looked
 * at in Arabic, its title stayed English ("Incidents in this episode") while
 * the locale had it worded, each incident's state said "Resolved" under a
 * header that said "تم الحل", and an English incident title, cut short in a
 * line read right to left, lost its start ("...kout API p95 latency above
 * 2s"). The card is rendered here with the real Dashboard locales.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

const ARABIC: Record<string, unknown> = readLocale("ar");

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";
const ENGLISH_TITLE_ID: string = "55555555-5555-4555-8555-555555555555";
const ARABIC_TITLE_ID: string = "66666666-6666-4666-8666-666666666666";

const ENGLISH_TITLE: string = "Checkout API p95 latency above 2s";
const ARABIC_TITLE: string = "تأخر الدفع في واجهة API";

type BuildIncidentFunction = (options: {
  id: string;
  title: string;
  number: number;
  stateName: string;
  severityName: string;
}) => Incident;

const buildIncident: BuildIncidentFunction = (options: {
  id: string;
  title: string;
  number: number;
  stateName: string;
  severityName: string;
}): Incident => {
  const incident: Incident = new Incident();
  incident.id = new ObjectID(options.id);
  incident.title = options.title;
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

type ServeFunction = (incidents: Array<Incident>) => void;

// The episode's membership rows first, then the incidents they name.
const serve: ServeFunction = (incidents: Array<Incident>): void => {
  getListMock.mockImplementation((...args: Array<any>) => {
    const request: Record<string, any> = args[0];
    const rows: Array<unknown> =
      request["modelType"] === IncidentEpisodeMember
        ? incidents.map((incident: Incident): IncidentEpisodeMember => {
            const membership: IncidentEpisodeMember =
              new IncidentEpisodeMember();
            membership.incidentEpisodeId = new ObjectID(EPISODE_ID);
            membership.incidentId = incident.id!;
            return membership;
          })
        : incidents;

    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: 8,
    });
  });
};

type RenderCardFunction = (language: string) => Promise<void>;

const renderCard: RenderCardFunction = async (
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

type RowFunction = (incidentId: string) => HTMLElement;

const rowOf: RowFunction = (incidentId: string): HTMLElement => {
  const link: HTMLElement | undefined = screen
    .getAllByRole("link")
    .find((element: HTMLElement): boolean => {
      return (element.getAttribute("href") || "").includes(incidentId);
    });

  return link!.closest("li") as HTMLElement;
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      ar: { translation: ARABIC },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  getListMock.mockReset();
  serve([
    buildIncident({
      id: ENGLISH_TITLE_ID,
      title: ENGLISH_TITLE,
      number: 1042,
      stateName: "Resolved",
      severityName: "Critical",
    }),
    buildIncident({
      id: ARABIC_TITLE_ID,
      title: ARABIC_TITLE,
      number: 1041,
      stateName: "Waiting on the vendor",
      severityName: "SEV-2",
    }),
  ]);

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

describe("an episode's incidents, read in Arabic", () => {
  test("the card's title, description and link are Arabic", async () => {
    await renderCard("ar");

    expect(ARABIC["Incidents in this episode"]).toBe("الحوادث في هذه الحلقة");
    expect(screen.getByText("الحوادث في هذه الحلقة")).toBeInTheDocument();
    expect(screen.queryByText("Incidents in this episode")).toBeNull();
    expect(
      screen.getByText(
        "أحدث الحوادث المجمّعة في هذه الحلقة، مع حالتها الحالية وخطورتها.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "عرض كل الحوادث" }),
    ).toBeInTheDocument();
  });

  test("the count beside the title is a label and its count, never a number before the noun", async () => {
    await renderCard("ar");

    expect(ARABIC["{{count}} incidents"]).toBe("الحوادث: {{count}}");
    expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
      "الحوادث: 2",
    );
    expect(screen.getByTestId("episode-members-count")).not.toHaveTextContent(
      "2 الحوادث",
    );
  });

  test("one incident is counted in the singular", async () => {
    serve([
      buildIncident({
        id: ENGLISH_TITLE_ID,
        title: ENGLISH_TITLE,
        number: 1042,
        stateName: "Resolved",
        severityName: "Critical",
      }),
    ]);

    await renderCard("ar");

    expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
      "1 حادثة",
    );
  });

  test("a built-in state and severity are named as the episode's header names them", async () => {
    await renderCard("ar");

    const row: HTMLElement = rowOf(ENGLISH_TITLE_ID);
    const state: HTMLElement = within(row).getByTestId("episode-member-state");
    const severity: HTMLElement = within(row).getByTestId(
      "episode-member-severity",
    );

    expect(state).toHaveTextContent("تم الحل");
    expect(state).toHaveAttribute("title", "الحالة: تم الحل");
    expect(severity).toHaveTextContent("حرجة");
    expect(severity).toHaveAttribute("title", "الخطورة: حرجة");
    expect(within(row).queryByText("Resolved")).toBeNull();
  });

  test("a state or severity the project named itself is shown as it was typed", async () => {
    await renderCard("ar");

    const row: HTMLElement = rowOf(ARABIC_TITLE_ID);

    expect(within(row).getByTestId("episode-member-state")).toHaveTextContent(
      "Waiting on the vendor",
    );
    expect(
      within(row).getByTestId("episode-member-severity"),
    ).toHaveTextContent("SEV-2");
  });

  test("an English title is cut short at its own end, standing where the page's lines start", async () => {
    await renderCard("ar");

    const row: HTMLElement = rowOf(ENGLISH_TITLE_ID);
    const line: HTMLElement = within(row).getByTestId(
      "episode-member-title-line",
    );

    expect(line).toHaveAttribute("dir", "ltr");
    expect(line).toHaveTextContent(ENGLISH_TITLE);
    expect(line.className.split(" ")).toEqual(
      expect.arrayContaining([
        "block",
        "truncate",
        LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      ]),
    );
    // Still one link, named by the whole title, with the title as its tooltip.
    expect(line.closest("a")).toHaveAccessibleName(ENGLISH_TITLE);
    expect(line.closest("a")).toHaveAttribute("title", ENGLISH_TITLE);
  });

  test("an Arabic title on an Arabic page is drawn as it always was", async () => {
    await renderCard("ar");

    const row: HTMLElement = rowOf(ARABIC_TITLE_ID);

    expect(within(row).queryByTestId("episode-member-title-line")).toBeNull();
    expect(within(row).getByRole("link", { name: ARABIC_TITLE })).toHaveClass(
      "truncate",
    );
  });
});

describe("an episode's incidents, read in English", () => {
  test("look as they did: English words, an English title with no line of its own", async () => {
    await renderCard("en");

    expect(screen.getByText("Incidents in this episode")).toBeInTheDocument();
    expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
      "2 incidents",
    );
    expect(
      within(rowOf(ENGLISH_TITLE_ID)).queryByTestId(
        "episode-member-title-line",
      ),
    ).toBeNull();
    expect(
      within(rowOf(ENGLISH_TITLE_ID)).getByRole("link", {
        name: ENGLISH_TITLE,
      }),
    ).toHaveClass("truncate");
    expect(
      within(rowOf(ENGLISH_TITLE_ID)).getByTestId("episode-member-state"),
    ).toHaveTextContent("Resolved");
    expect(
      within(rowOf(ENGLISH_TITLE_ID)).getByTestId("episode-member-state"),
    ).toHaveAttribute("title", "State: Resolved");
  });

  test("an Arabic title on an English page reads right to left, cut at its own end", async () => {
    await renderCard("en");

    const line: HTMLElement = within(rowOf(ARABIC_TITLE_ID)).getByTestId(
      "episode-member-title-line",
    );

    expect(line).toHaveAttribute("dir", "rtl");
    expect(line).toHaveTextContent(ARABIC_TITLE);
  });
});
