import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import TeamOrLabelPicker, {
  TEAM_OR_LABEL_SEARCH_LIMIT,
  readTeamOrLabelOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryIngestionBudget/TeamOrLabelPicker";
import {
  applyTeamOrLabelPick,
  getTeamOrLabelOptionValue,
  TEAM_OR_LABEL_FIELD_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryIngestionBudget/TeamLabelBudgetsTable";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import TelemetryIngestionTeamLabelBudget from "../../../Models/DatabaseModels/TelemetryIngestionTeamLabelBudget";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DropdownOptionGroup } from "../../../UI/Components/Dropdown/Dropdown";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

/*
 * WHOSE BUDGET IT IS, PAST THE PROJECT'S FIRST 10,000 TEAMS AND LABELS
 * (#10764).
 *
 * A new team or label budget's one picker read the project's first 10,000
 * teams and labels by name and offered them whole, so a team or a label past
 * them could not be given a budget. It searches the server for each kind as
 * it opens and as the person types - 50 of each by name, archived labels
 * left out - and keeps the one picked named. On a fake project of 10,050 of
 * each (CappedListServer), as the list routes answer.
 */

const LATE_TEAM_ID: string = "aaaaaaaa-0000-4000-8000-0000000000a1";
const LATE_LABEL_ID: string = "aaaaaaaa-0000-4000-8000-0000000000a2";
const ARCHIVED_LABEL_ID: string = "aaaaaaaa-0000-4000-8000-0000000000a3";

const ENGLISH: Translator = {
  translateText: (text: string | undefined): string | undefined => {
    return text;
  },
  translateTemplate: (text: string): string => {
    return text;
  },
} as unknown as Translator;

let server: CappedListServer;
let changes: Array<string | null>;

function project(): void {
  server.add(
    Team,
    namesSortingFirst(10050, "AP").map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name };
      },
    ),
  );
  server.add(Team, [{ _id: LATE_TEAM_ID, name: "Warehouse team" }]);
  server.add(
    Label,
    namesSortingFirst(10050, "AP").map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name,
          isArchived: false,
        };
      },
    ),
  );
  server.add(Label, [
    {
      _id: LATE_LABEL_ID,
      name: "warehouse-label",
      color: "#6366f1",
      isArchived: false,
    },
    { _id: ARCHIVED_LABEL_ID, name: "warehouse-old", isArchived: true },
  ]);
}

// The form keeps the pick, as the budget form does.
function PickerHarness(): ReactElement {
  const [value, setValue] = useState<string | null>(null);

  return (
    <TeamOrLabelPicker
      value={value}
      placeholder="Choose a team or a label"
      dataTestId="budget-picker"
      onChange={(next: string | null) => {
        changes.push(next);
        setValue(next);
      }}
    />
  );
}

async function typeInPicker(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: text },
    });
  });
}

function optionNames(groups: Array<DropdownOptionGroup>): Array<string> {
  return groups.flatMap((group: DropdownOptionGroup): Array<string> => {
    return group.options.map((option: { label: string }): string => {
      return option.label;
    });
  });
}

beforeEach(() => {
  changes = [];
  server = new CappedListServer().install();
  project();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("readTeamOrLabelOptions", () => {
  test("nothing typed: the first 50 teams and 50 live labels by name, in two groups - never 10,000 of each", async () => {
    const groups: Array<DropdownOptionGroup> = await readTeamOrLabelOptions({
      search: "",
      translator: ENGLISH,
    });

    expect(
      groups.map((group: DropdownOptionGroup): string => {
        return group.label;
      }),
    ).toEqual(["Teams", "Labels"]);
    expect(groups[0]!.options).toHaveLength(TEAM_OR_LABEL_SEARCH_LIMIT);
    expect(groups[1]!.options).toHaveLength(TEAM_OR_LABEL_SEARCH_LIMIT);

    const [teamRead] = server.callsFor(Team);
    const [labelRead] = server.callsFor(Label);

    expect(teamRead!.limit).toBe(TEAM_OR_LABEL_SEARCH_LIMIT);
    expect(teamRead!.sort).toEqual({ name: SortOrder.Ascending });
    expect(labelRead!.limit).toBe(TEAM_OR_LABEL_SEARCH_LIMIT);
    // Archived labels are never offered for a new budget.
    expect(labelRead!.query["isArchived"]).toBe(false);
  });

  test("a team and a label past the first 10,000 are found by what is typed - an archived label never", async () => {
    const groups: Array<DropdownOptionGroup> = await readTeamOrLabelOptions({
      search: " warehouse ",
      translator: ENGLISH,
    });

    expect(optionNames(groups)).toEqual(["Warehouse team", "warehouse-label"]);
    expect(
      groups.flatMap((group: DropdownOptionGroup) => {
        return group.options.map((option: { value: unknown }) => {
          return option.value;
        });
      }),
    ).toEqual([
      getTeamOrLabelOptionValue({ teamId: LATE_TEAM_ID }),
      getTeamOrLabelOptionValue({ labelId: LATE_LABEL_ID }),
    ]);

    const searched: Array<CappedListCall> = [
      ...server.callsFor(Team),
      ...server.callsFor(Label),
    ];

    for (const call of searched) {
      expect(call.query["name"]).toBeInstanceOf(Search);
      expect((call.query["name"] as Search<string>).toString()).toBe(
        "warehouse",
      );
    }
  });

  test("a kind with none that match is left out, not drawn as an empty group", async () => {
    const groups: Array<DropdownOptionGroup> = await readTeamOrLabelOptions({
      search: "warehouse-l",
      translator: ENGLISH,
    });

    expect(
      groups.map((group: DropdownOptionGroup): string => {
        return group.label;
      }),
    ).toEqual(["Labels"]);
  });
});

describe("the budget form's Team or Label picker", () => {
  test("asks the server as it opens, and again for what is typed - finding one past the first 10,000", async () => {
    render(<PickerHarness />);

    await waitFor(() => {
      expect(server.callsFor(Team)).toHaveLength(1);
    });

    await typeInPicker("warehouse");

    expect(await screen.findByText("warehouse-label")).toBeInTheDocument();
    expect(screen.getByText("Warehouse team")).toBeInTheDocument();
    expect(screen.queryByText("warehouse-old")).toBeNull();
    // Asked for what was typed, once typing rested.
    expect(
      server.callsFor(Label).some((call: CappedListCall): boolean => {
        return (
          call.query["name"] instanceof Search &&
          (call.query["name"] as Search<string>).toString() === "warehouse"
        );
      }),
    ).toBe(true);
  });

  test("a label past them is picked as the budget's, and stays named while other searches come and go", async () => {
    render(<PickerHarness />);

    await typeInPicker("warehouse");

    const option: HTMLElement = await screen.findByText("warehouse-label");

    await act(async () => {
      fireEvent.click(option);
    });

    expect(changes[changes.length - 1]).toBe(
      getTeamOrLabelOptionValue({ labelId: LATE_LABEL_ID }),
    );

    // Another search that does not find it: the pick keeps its name.
    await typeInPicker("AP000001");
    await waitFor(() => {
      expect(
        server.callsFor(Team).some((call: CappedListCall): boolean => {
          return (
            call.query["name"] instanceof Search &&
            (call.query["name"] as Search<string>).toString() === "AP000001"
          );
        }),
      ).toBe(true);
    });
    await act(async () => {
      fireEvent.blur(screen.getByRole("combobox"));
    });

    expect(screen.getByText("warehouse-label")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(LATE_LABEL_ID);
  });

  test("the pick becomes the budget's label - or its team - on create", () => {
    const budget: TelemetryIngestionTeamLabelBudget = applyTeamOrLabelPick(
      new TelemetryIngestionTeamLabelBudget(),
      {
        [TEAM_OR_LABEL_FIELD_KEY]: getTeamOrLabelOptionValue({
          labelId: LATE_LABEL_ID,
        }),
      },
    );

    expect(budget.labelId?.toString()).toBe(LATE_LABEL_ID);
    expect(budget.teamId).toBeUndefined();

    const teamBudget: TelemetryIngestionTeamLabelBudget = applyTeamOrLabelPick(
      new TelemetryIngestionTeamLabelBudget(),
      {
        [TEAM_OR_LABEL_FIELD_KEY]: getTeamOrLabelOptionValue({
          teamId: LATE_TEAM_ID,
        }),
      },
    );

    expect(teamBudget.teamId?.toString()).toBe(LATE_TEAM_ID);
  });

  test("a read that fails offers nothing, and says nothing went wrong in a way that blocks the form", async () => {
    server.list = (): never => {
      throw new Error("Payment required");
    };

    render(<PickerHarness />);

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("combobox"), {
        key: "ArrowDown",
        code: "ArrowDown",
      });
    });

    expect(screen.queryByText("Warehouse team")).toBeNull();
    expect(changes).toEqual([]);
  });
});
