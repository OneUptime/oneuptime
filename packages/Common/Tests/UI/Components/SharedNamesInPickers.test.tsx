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

/*
 * PICKERS TELL APART THE TEAMS, LABELS, ON-CALL POLICIES AND SCHEDULES
 * THAT SHARE A NAME (#10064).
 *
 * Records named alike before names were held to one record each keep their
 * names, and every picker drew them alike: two "Production" labels in a
 * monitor's Labels, two "Primary" schedules in an escalation rule. Each
 * picker now draws such twins by one rule (Utils/SharedNameOptions): the
 * pill the record's own list draws ("Same name as another label"), and a
 * line that sets each apart - its description, or when it was made - in
 * the open list, and that line after the name of a picked one. Drawn here
 * as each picker draws them: the Dropdown, the EntityDropdown every form's
 * record field is, and the people picker's search list.
 */

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
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { BulkLabelReads } from "../../../UI/Components/BulkUpdate/BulkLabelActions";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import {
  SHARED_NAME_DETAIL_TEST_ID,
  SHARED_NAME_PILL_TEST_ID,
  SHARED_NAME_VALUE_DETAIL_TEST_ID,
} from "../../../UI/Components/Dropdown/SharedNameOptionLines";
import EntityDropdown from "../../../UI/Components/EntityDropdown/EntityDropdown";
import PeopleSearchPopup from "../../../UI/Components/PeoplePicker/PeopleSearchPopup";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";
import { AnchoredFieldPopup } from "../../../UI/Types/UseAnchoredFieldPopup";
import { writeReaderDay } from "../../../UI/Utils/ReaderMoments";
import { getSharedNameFacts } from "../../../UI/Utils/SharedNameOptions";

const MARCH: Date = new Date("2024-03-05T09:30:00.000Z");
const NOVEMBER: Date = new Date("2026-11-05T09:30:00.000Z");

type NamedModel = Label | Team | OnCallDutyPolicy | OnCallDutyPolicySchedule;

function record<TModel extends NamedModel>(
  type: { new (): TModel },
  data: { id: string; name: string; description?: string; createdAt?: Date },
): TModel {
  const model: TModel = new type();
  const fields: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  model._id = data.id;
  fields["name"] = data.name;
  fields["description"] = data.description;
  fields["createdAt"] = data.createdAt;

  return model;
}

// An option as a picker's builder makes it: its name, and its record's facts.
function optionOf(model: NamedModel): DropdownOption {
  return {
    value: model._id!,
    label: (model as unknown as { name: string }).name,
    isUserContent: true,
    sharedName: getSharedNameFacts(model),
  };
}

function openMenu(): void {
  fireEvent.keyDown(screen.getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });
}

function optionRows(name: string): Array<HTMLElement> {
  return screen.getAllByRole("option").filter((row: HTMLElement): boolean => {
    return (row.textContent || "").trim().startsWith(name);
  });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  getListMock.mockReset();
});

describe("the Dropdown", () => {
  test.each([
    [
      "labels",
      Label,
      "Same name as another label",
      ["Customer-facing services", "Internal tools"],
    ],
    [
      "teams",
      Team,
      "Same name as another team",
      ["Runs the clusters", "Runs the databases"],
    ],
    [
      "on-call policies",
      OnCallDutyPolicy,
      "Same name as another policy",
      ["Pages the platform team", "Pages the data team"],
    ],
    [
      "on-call schedules",
      OnCallDutyPolicySchedule,
      "Same name as another schedule",
      ["Weekday rotation", "Weekend rotation"],
    ],
  ])(
    "marks %s that share a name with their list's pill and their own description, and nothing else",
    (
      _kind: string,
      type: { new (): NamedModel },
      pill: string,
      descriptions: Array<string>,
    ) => {
      render(
        <Dropdown
          options={[
            optionOf(
              record(type, {
                id: "a",
                name: "Primary",
                description: descriptions[0]!,
              }),
            ),
            optionOf(
              record(type, {
                id: "b",
                name: "primary ",
                description: descriptions[1]!,
              }),
            ),
            optionOf(record(type, { id: "c", name: "Secondary" })),
          ]}
          onChange={(): void => {}}
        />,
      );

      openMenu();

      const twins: Array<HTMLElement> = [
        ...optionRows("Primary"),
        ...optionRows("primary"),
      ];

      expect(twins).toHaveLength(2);

      for (const [index, twin] of twins.entries()) {
        expect(
          within(twin).getByTestId(SHARED_NAME_PILL_TEST_ID),
        ).toHaveTextContent(pill);
        expect(
          within(twin).getByTestId(SHARED_NAME_DETAIL_TEST_ID),
        ).toHaveTextContent(descriptions[index]!);
      }

      const other: HTMLElement = optionRows("Secondary")[0]!;
      expect(
        within(other).queryByTestId(SHARED_NAME_PILL_TEST_ID),
      ).not.toBeInTheDocument();
      expect(
        within(other).queryByTestId(SHARED_NAME_DETAIL_TEST_ID),
      ).not.toBeInTheDocument();
    },
  );

  test("twins with no description are told apart by the day each was made", () => {
    render(
      <Dropdown
        options={[
          optionOf(
            record(Label, { id: "a", name: "Production", createdAt: MARCH }),
          ),
          optionOf(
            record(Label, {
              id: "b",
              name: "Production",
              createdAt: NOVEMBER,
            }),
          ),
        ]}
        onChange={(): void => {}}
      />,
    );

    openMenu();

    const details: Array<string> = screen
      .getAllByTestId(SHARED_NAME_DETAIL_TEST_ID)
      .map((detail: HTMLElement): string => {
        return detail.textContent || "";
      });

    expect(details).toEqual([
      `Created ${writeReaderDay(MARCH)}`,
      `Created ${writeReaderDay(NOVEMBER)}`,
    ]);
  });

  test("a picked twin says what sets it apart after its name, so two picked read as two", () => {
    const first: DropdownOption = optionOf(
      record(Label, {
        id: "a",
        name: "Production",
        description: "Customer-facing services",
      }),
    );
    const second: DropdownOption = optionOf(
      record(Label, {
        id: "b",
        name: "Production",
        description: "Internal tools",
      }),
    );

    render(
      <Dropdown
        isMultiSelect={true}
        options={[first, second]}
        value={[first, second]}
        onChange={(): void => {}}
      />,
    );

    expect(
      screen
        .getAllByTestId(SHARED_NAME_VALUE_DETAIL_TEST_ID)
        .map((detail: HTMLElement): string => {
          return (detail.textContent || "").replace(/\s+/g, " ").trim();
        }),
    ).toEqual(["· Customer-facing services", "· Internal tools"]);
  });

  test("a label and a team of one name are no twins", () => {
    render(
      <Dropdown
        options={[
          optionOf(record(Label, { id: "a", name: "Platform" })),
          optionOf(record(Team, { id: "b", name: "Platform" })),
        ]}
        onChange={(): void => {}}
      />,
    );

    openMenu();

    expect(
      screen.queryByTestId(SHARED_NAME_PILL_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("the EntityDropdown every form's record field is", () => {
  test("reads what tells labels apart with its search, and marks the twins it finds", async () => {
    getListMock.mockImplementation(async (): Promise<any> => {
      return {
        data: [
          record(Label, {
            id: "a",
            name: "Production",
            description: "Customer-facing services",
          }),
          record(Label, {
            id: "b",
            name: "Production",
            description: "Internal tools",
          }),
          record(Label, { id: "c", name: "Staging" }),
        ],
        count: 3,
      };
    });

    render(
      <EntityDropdown
        isMultiSelect={true}
        modelType={Label}
        labelField="name"
        valueField="_id"
        placeholder="Select Labels"
        onChange={(): void => {}}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox"));

    await waitFor(() => {
      expect(screen.getAllByTestId(SHARED_NAME_PILL_TEST_ID)).toHaveLength(2);
    });

    expect(
      screen
        .getAllByTestId(SHARED_NAME_DETAIL_TEST_ID)
        .map((detail: HTMLElement): string => {
          return detail.textContent || "";
        }),
    ).toEqual(["Customer-facing services", "Internal tools"]);

    // The search read the columns that tell them apart.
    const select: Record<string, unknown> = getListMock.mock.calls[0]![0]
      .select as Record<string, unknown>;
    expect(select).toMatchObject({
      _id: true,
      name: true,
      description: true,
      createdAt: true,
    });
  });

  test("a record of any other kind is read and drawn as before", async () => {
    getListMock.mockImplementation(async (): Promise<any> => {
      return { data: [], count: 0 };
    });

    render(
      <EntityDropdown
        modelType={Monitor}
        labelField="name"
        valueField="_id"
        placeholder="Select Monitor"
        onChange={(): void => {}}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    const select: Record<string, unknown> = getListMock.mock.calls[0]![0]
      .select as Record<string, unknown>;
    expect(select["description"]).toBeUndefined();
    expect(select["createdAt"]).toBeUndefined();
  });

  test("a picked twin's chip says what sets it apart", async () => {
    getListMock.mockImplementation(async (): Promise<any> => {
      return { data: [], count: 0 };
    });

    const first: DropdownOption = optionOf(
      record(Team, { id: "a", name: "Platform", description: "Clusters" }),
    );
    const second: DropdownOption = optionOf(
      record(Team, { id: "b", name: "Platform", description: "Databases" }),
    );

    render(
      <EntityDropdown
        isMultiSelect={true}
        options={[first, second]}
        value={["a", "b"]}
        placeholder="Select Teams"
        onChange={(): void => {}}
      />,
    );

    const chips: Array<HTMLElement> = screen.getAllByTestId(
      "entity-dropdown-chip",
    );

    expect(
      chips.map((chip: HTMLElement): string => {
        return (
          within(chip).getByTestId(SHARED_NAME_VALUE_DETAIL_TEST_ID)
            .textContent || ""
        )
          .replace(/\s+/g, " ")
          .trim();
      }),
    ).toEqual(["· Clusters", "· Databases"]);
  });
});

describe("the people picker's search list", () => {
  const OPEN_POPUP: AnchoredFieldPopup = {
    isPopupOpen: true,
    popupPosition: {
      top: 120,
      bottom: undefined,
      left: 40,
      maxHeight: 380,
      width: 320,
    },
    popupRef: { current: null },
    popupId: "people-search-shared-names",
    portalTarget: document.body,
  } as unknown as AnchoredFieldPopup;

  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/11111111-1111-4111-8111-111111111111/on-call-duty",
    );

    (
      Element.prototype as unknown as { scrollIntoView: () => void }
    ).scrollIntoView = (): void => {};
  });

  test("marks teams, schedules and policies that share a name, each with what sets it apart, reading it with them", async () => {
    getListMock.mockImplementation(async (request: any): Promise<any> => {
      if (request.modelType === Team) {
        return {
          data: [
            record(Team, {
              id: "0000000b-0000-4000-8000-000000000001",
              name: "Platform",
              description: "Runs the clusters",
            }),
            record(Team, {
              id: "0000000b-0000-4000-8000-000000000002",
              name: "Platform",
              description: "Runs the databases",
            }),
          ],
          count: 2,
        };
      }

      if (request.modelType === OnCallDutyPolicySchedule) {
        return {
          data: [
            record(OnCallDutyPolicySchedule, {
              id: "0000000c-0000-4000-8000-000000000001",
              name: "Primary",
              createdAt: MARCH,
            }),
            record(OnCallDutyPolicySchedule, {
              id: "0000000c-0000-4000-8000-000000000002",
              name: "primary",
              createdAt: NOVEMBER,
            }),
          ],
          count: 2,
        };
      }

      if (request.modelType === OnCallDutyPolicy) {
        return {
          data: [
            record(OnCallDutyPolicy, {
              id: "0000000d-0000-4000-8000-000000000001",
              name: "Escalate",
              description: "Pages the platform team",
            }),
            record(OnCallDutyPolicy, {
              id: "0000000d-0000-4000-8000-000000000002",
              name: "Escalate",
              description: "Pages the data team",
            }),
            record(OnCallDutyPolicy, {
              id: "0000000d-0000-4000-8000-000000000003",
              name: "Backup",
            }),
          ],
          count: 3,
        };
      }

      if (request.modelType === TeamMember) {
        return { data: [], count: 0 };
      }

      return { data: [], count: 0 };
    });

    render(
      <PeopleSearchPopup
        popup={OPEN_POPUP}
        kinds={[
          PeoplePickerKind.Team,
          PeoplePickerKind.OnCallSchedule,
          PeoplePickerKind.OnCallPolicy,
        ]}
        selectedKeys={new Set<string>()}
        selectionMode="add"
        onPick={(): void => {}}
        ariaLabel="Notify"
      />,
    );

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Notify",
    });

    await waitFor(() => {
      expect(
        within(dialog).getAllByTestId(SHARED_NAME_PILL_TEST_ID),
      ).toHaveLength(6);
    });

    const rowOf: (id: string) => HTMLElement = (id: string): HTMLElement => {
      return dialog.querySelector(`[data-id="${id}"]`) as HTMLElement;
    };

    expect(
      within(rowOf("0000000b-0000-4000-8000-000000000001")).getByTestId(
        SHARED_NAME_PILL_TEST_ID,
      ),
    ).toHaveTextContent("Same name as another team");
    expect(
      within(rowOf("0000000b-0000-4000-8000-000000000002")).getByTestId(
        SHARED_NAME_DETAIL_TEST_ID,
      ),
    ).toHaveTextContent("Runs the databases");
    expect(
      within(rowOf("0000000c-0000-4000-8000-000000000001")).getByTestId(
        SHARED_NAME_PILL_TEST_ID,
      ),
    ).toHaveTextContent("Same name as another schedule");
    expect(
      within(rowOf("0000000c-0000-4000-8000-000000000002")).getByTestId(
        SHARED_NAME_DETAIL_TEST_ID,
      ),
    ).toHaveTextContent(`Created ${writeReaderDay(NOVEMBER)}`);
    expect(
      within(rowOf("0000000d-0000-4000-8000-000000000001")).getByTestId(
        SHARED_NAME_PILL_TEST_ID,
      ),
    ).toHaveTextContent("Same name as another policy");
    // A policy with no twin is drawn as before.
    expect(
      within(rowOf("0000000d-0000-4000-8000-000000000003")).queryByTestId(
        SHARED_NAME_PILL_TEST_ID,
      ),
    ).not.toBeInTheDocument();

    // Each kind's read selected what tells its records apart.
    for (const type of [Team, OnCallDutyPolicySchedule, OnCallDutyPolicy]) {
      const read: any = getListMock.mock.calls.find((call: Array<any>) => {
        return call[0].modelType === type;
      });

      expect(read![0].select).toMatchObject({
        description: true,
        createdAt: true,
      });
    }
  });
});

describe("Remove Labels, whose labels come through a relation", () => {
  test("reads the labels that share a name on their own, with what tells them apart", async () => {
    getListMock.mockImplementation(async (): Promise<any> => {
      return {
        data: [
          record(Label, {
            id: "a",
            name: "Production",
            description: "Customer-facing services",
          }),
          record(Label, { id: "b", name: "Production", createdAt: MARCH }),
        ],
        count: 2,
      };
    });

    const facts: Map<string, unknown> =
      await BulkLabelReads.readFactsOfLabelsSharingAName([
        record(Label, { id: "a", name: "Production" }),
        record(Label, { id: "b", name: "production" }),
        record(Label, { id: "c", name: "Staging" }),
      ]);

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]![0].query._id.values.sort()).toEqual([
      "a",
      "b",
    ]);
    expect(facts.get("a")).toMatchObject({
      description: "Customer-facing services",
    });
    expect(facts.get("b")).toMatchObject({ createdAt: MARCH });
    expect(facts.has("c")).toBe(false);
  });

  test("reads nothing when no two share a name, and marks them all the same when the read fails", async () => {
    await BulkLabelReads.readFactsOfLabelsSharingAName([
      record(Label, { id: "a", name: "Production" }),
      record(Label, { id: "c", name: "Staging" }),
    ]);

    expect(getListMock).not.toHaveBeenCalled();

    getListMock.mockImplementation(async (): Promise<any> => {
      throw new Error("no read access");
    });

    const facts: Map<string, unknown> =
      await BulkLabelReads.readFactsOfLabelsSharingAName([
        record(Label, { id: "a", name: "Production" }),
        record(Label, { id: "b", name: "Production" }),
      ]);

    expect(facts.size).toBe(0);
  });
});
