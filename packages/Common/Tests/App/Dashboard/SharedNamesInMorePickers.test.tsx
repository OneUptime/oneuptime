import {
  afterEach,
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
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();

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

import Label from "../../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Includes from "../../../Types/BaseDatabase/Includes";
import { SharedNameKind } from "../../../Types/Database/SharedNames";
import ScheduleTimelineUtil, {
  ScheduleTimelineResponse,
} from "../../../Types/OnCallDutyPolicy/ScheduleTimeline";
import {
  SHARED_NAME_DETAIL_TEST_ID,
  SHARED_NAME_PILL_TEST_ID,
} from "../../../UI/Components/Dropdown/SharedNameOptionLines";
import { writeReaderDay } from "../../../UI/Utils/ReaderMoments";
import {
  NamedRecordOfList,
  SharedNameFactsReads,
  getIdsSharingAName,
  useSharedNameFacts,
} from "../../../UI/Utils/SharedNameFactsReads";
import { SharedNameFacts } from "../../../UI/Utils/SharedNameOptions";
import { FilterBar } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineToolbar";
import TimelineModel, {
  DEFAULT_FILTERS,
  TimelineData,
  TimelineTeam,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineModel";

/*
 * MORE PICKERS TELL APART THE TEAMS, LABELS AND POLICIES THAT SHARE A NAME
 * (#10314).
 *
 * #10064 put the rule in the Dashboard's pickers; these are the ones it
 * left. Some come with their records' names alone - a schedule's shifts
 * name their on-call policies - and read what tells twins apart again, on
 * their own (SharedNameFactsReads): nothing is read unless two share a
 * name. The schedule timeline's team filter is sent its owner teams by the
 * server, which now says when each was made - never its description, as
 * the names are read as OneUptime - and the filter's Dropdown marks the
 * twins by it.
 */

const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");
const NOVEMBER: Date = new Date("2026-11-05T09:30:00.000Z");

const POLICY_A: string = "0193c0de-d0d0-4aaa-8bbb-0000000000a1";
const POLICY_B: string = "0193c0de-d0d0-4aaa-8bbb-0000000000a2";
const POLICY_C: string = "0193c0de-d0d0-4aaa-8bbb-0000000000a3";

function policy(data: {
  id: string;
  name: string;
  description?: string;
  createdAt?: Date;
}): OnCallDutyPolicy {
  const model: OnCallDutyPolicy = new OnCallDutyPolicy();
  model._id = data.id;
  model.name = data.name;

  if (data.description !== undefined) {
    model.description = data.description;
  }

  if (data.createdAt) {
    model.createdAt = data.createdAt;
  }

  return model;
}

function listOf(data: Array<unknown>): {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

beforeEach(() => {
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("which records of a list share a name", () => {
  test("those whose names read as one name, case and spacing aside; one record listed twice is no twin", () => {
    const records: Array<NamedRecordOfList> = [
      { id: POLICY_A, name: "Payments  EU" },
      { id: POLICY_B, name: "payments eu" },
      { id: POLICY_C, name: "Database" },
      { id: POLICY_C, name: "Database" },
      { id: "", name: "Payments EU" },
    ];

    expect(getIdsSharingAName(records).sort()).toEqual(
      [POLICY_A, POLICY_B].sort(),
    );
    expect(getIdsSharingAName([{ id: POLICY_A, name: "  " }])).toEqual([]);
  });
});

describe("a list of names alone reads its twins again (SharedNameFactsReads)", () => {
  test("only the records that share a name, with what tells them apart, as the reader", async () => {
    getListMock.mockResolvedValue(
      listOf([
        policy({ id: POLICY_A, name: "Payments", description: "EU checkout" }),
        policy({ id: POLICY_B, name: "payments", createdAt: MARCH }),
      ]),
    );

    const facts: Map<string, SharedNameFacts> =
      await SharedNameFactsReads.readFactsOfRecordsSharingAName({
        modelType: OnCallDutyPolicy,
        records: [
          { id: POLICY_A, name: "Payments" },
          { id: POLICY_B, name: "payments" },
          { id: POLICY_C, name: "Database" },
        ],
      });

    expect(getListMock).toHaveBeenCalledTimes(1);

    const asked: Record<string, any> = getListMock.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(asked["modelType"]).toBe(OnCallDutyPolicy);
    expect(asked["query"]["_id"]).toBeInstanceOf(Includes);
    expect((asked["query"]["_id"] as Includes).values.sort()).toEqual(
      [POLICY_A, POLICY_B].sort(),
    );
    expect(asked["select"]).toEqual({
      _id: true,
      name: true,
      description: true,
      createdAt: true,
    });
    expect(asked["limit"]).toBe(2);

    expect(facts.get(POLICY_A)).toEqual({
      kind: SharedNameKind.OnCallPolicy,
      description: "EU checkout",
      createdAt: undefined,
    });
    expect(facts.get(POLICY_B)).toMatchObject({ createdAt: MARCH });
    expect(facts.has(POLICY_C)).toBe(false);
  });

  test("nothing is read when no two share a name", async () => {
    const facts: Map<string, SharedNameFacts> =
      await SharedNameFactsReads.readFactsOfRecordsSharingAName({
        modelType: Label,
        records: [
          { id: POLICY_A, name: "Production" },
          { id: POLICY_B, name: "Staging" },
        ],
      });

    expect(facts.size).toBe(0);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a read that fails leaves them without what sets each apart, and throws nothing", async () => {
    getListMock.mockRejectedValue(new Error("You may not read policies."));

    const facts: Map<string, SharedNameFacts> =
      await SharedNameFactsReads.readFactsOfRecordsSharingAName({
        modelType: OnCallDutyPolicy,
        records: [
          { id: POLICY_A, name: "Payments" },
          { id: POLICY_B, name: "Payments" },
        ],
      });

    expect(facts.size).toBe(0);
  });
});

describe("a component reads its twins' facts once (useSharedNameFacts)", () => {
  const Facts: React.FunctionComponent<{
    records: Array<NamedRecordOfList>;
  }> = (props: { records: Array<NamedRecordOfList> }): React.ReactElement => {
    const facts: Map<string, SharedNameFacts> = useSharedNameFacts(
      OnCallDutyPolicy,
      props.records,
    );

    return (
      <ul>
        {props.records.map((record: NamedRecordOfList) => {
          return (
            <li key={record.id} data-testid={`facts-${record.id}`}>
              {facts.get(record.id)?.createdAt?.toISOString() || "none"}
            </li>
          );
        })}
      </ul>
    );
  };

  test("twins' facts arrive, and the read is not asked again for the same twins", async () => {
    getListMock.mockResolvedValue(
      listOf([
        policy({ id: POLICY_A, name: "Payments", createdAt: MARCH }),
        policy({ id: POLICY_B, name: "Payments", createdAt: NOVEMBER }),
      ]),
    );

    const twins: Array<NamedRecordOfList> = [
      { id: POLICY_A, name: "Payments" },
      { id: POLICY_B, name: "Payments" },
    ];

    const view: ReturnType<typeof render> = render(<Facts records={twins} />);

    await waitFor(() => {
      expect(view.getByTestId(`facts-${POLICY_A}`)).toHaveTextContent(
        MARCH.toISOString(),
      );
    });
    expect(view.getByTestId(`facts-${POLICY_B}`)).toHaveTextContent(
      NOVEMBER.toISOString(),
    );

    // The same twins, as a new list: not read again.
    view.rerender(<Facts records={[...twins]} />);

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a list with no twins reads nothing", async () => {
    const view: ReturnType<typeof render> = render(
      <Facts
        records={[
          { id: POLICY_A, name: "Payments" },
          { id: POLICY_C, name: "Database" },
        ]}
      />,
    );

    expect(view.getByTestId(`facts-${POLICY_A}`)).toHaveTextContent("none");
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("the schedule timeline's team filter", () => {
  const TEAM_A: string = "0193c0de-d0d0-4aaa-8bbb-0000000000b1";
  const TEAM_B: string = "0193c0de-d0d0-4aaa-8bbb-0000000000b2";
  const TEAM_C: string = "0193c0de-d0d0-4aaa-8bbb-0000000000b3";

  function response(teams: Array<Record<string, unknown>>): unknown {
    return {
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-08T00:00:00.000Z",
      generatedAt: "2026-11-01T00:00:00.000Z",
      truncated: false,
      totalScheduleCount: 0,
      schedulesTruncated: false,
      schedules: [],
      teams: teams,
    };
  }

  test("each team says when it was made when the server sends it; a server from before it sends nothing", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      response([
        {
          teamId: TEAM_A,
          teamName: "Platform",
          isCurrentUserMember: true,
          teamCreatedAt: MARCH.toISOString(),
        },
        { teamId: TEAM_C, teamName: "SRE", isCurrentUserMember: false },
      ]),
    );

    expect(parsed.teams).toEqual([
      {
        teamId: TEAM_A,
        teamName: "Platform",
        isCurrentUserMember: true,
        teamCreatedAt: MARCH.toISOString(),
      },
      { teamId: TEAM_C, teamName: "SRE", isCurrentUserMember: false },
    ]);
    expect(parsed.teams[1]).not.toHaveProperty("teamCreatedAt");

    const data: TimelineData = TimelineModel.fromResponse(parsed);

    expect(data.teams[0]!.createdAt).toEqual(MARCH);
    expect(data.teams[1]).not.toHaveProperty("createdAt");
  });

  test("a day the server sends that is no date is no date", () => {
    const data: TimelineData = TimelineModel.fromResponse(
      ScheduleTimelineUtil.parseResponse(
        response([
          {
            teamId: TEAM_A,
            teamName: "Platform",
            isCurrentUserMember: false,
            teamCreatedAt: "not a date",
          },
        ]),
      ),
    );

    expect(data.teams[0]).not.toHaveProperty("createdAt");
  });

  function renderFilterBar(teams: Array<TimelineTeam>): HTMLElement {
    render(
      <FilterBar
        filters={DEFAULT_FILTERS}
        onFiltersChange={() => {}}
        teams={teams}
        isTeamLocked={false}
        groupByTeam={false}
        onGroupByTeamChange={() => {}}
        hasActiveFilters={false}
        onClearFilters={() => {}}
      />,
    );

    const filter: HTMLElement = screen.getByTestId("timeline-team-filter");

    fireEvent.keyDown(within(filter).getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });

    return filter;
  }

  test("two teams of one name are each marked with their list's pill, and told apart by the day each was made", () => {
    renderFilterBar([
      {
        id: TEAM_A,
        name: "Platform",
        isCurrentUserMember: false,
        createdAt: MARCH,
      },
      {
        id: TEAM_B,
        name: "platform",
        isCurrentUserMember: false,
        createdAt: NOVEMBER,
      },
      { id: TEAM_C, name: "SRE", isCurrentUserMember: false },
    ]);

    expect(screen.getAllByTestId(SHARED_NAME_PILL_TEST_ID)).toHaveLength(2);
    expect(
      screen
        .getAllByTestId(SHARED_NAME_DETAIL_TEST_ID)
        .map((element: HTMLElement): string => {
          return element.textContent || "";
        }),
    ).toEqual([
      `Created ${writeReaderDay(MARCH)}`,
      `Created ${writeReaderDay(NOVEMBER)}`,
    ]);
  });

  test("teams of names their own are drawn as before", () => {
    renderFilterBar([
      { id: TEAM_A, name: "Platform", isCurrentUserMember: false },
      { id: TEAM_C, name: "SRE", isCurrentUserMember: false },
    ]);

    expect(screen.queryByTestId(SHARED_NAME_PILL_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(SHARED_NAME_DETAIL_TEST_ID)).toBeNull();
  });
});
