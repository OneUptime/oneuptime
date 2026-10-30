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
  within,
} from "@testing-library/react";
import type { Mock } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * ADD TO A CASE, the dialog that picks the open case events are kept on
 * (Bulk Actions > Add to Case, and Add to Case in an event's panel),
 * rendered for real against a stand-in list of the project's open cases.
 *
 * Each case is a row of its own, which a person - and a browser check -
 * picks by itself: the row's test id is the picker's with "-option", and
 * the picker's own test id is the whole list's. A check that clicked the
 * list's test id clicked its middle row, whichever case it named, and
 * picked CASE-138 where it meant CASE-141.
 */

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseValues",
  () => {
    return {
      __esModule: true,
      getSecurityCaseValues: async (): Promise<{
        priorities: Array<unknown>;
        statuses: Array<unknown>;
      }> => {
        return { priorities: [], statuses: [] };
      },
    };
  },
);

import AddToCaseModal from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/AddToCaseModal";
import {
  HUNTS_TEST_IDS,
  NO_OPEN_CASES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HOUR: number = 60 * 60 * 1000;

function openCase(
  number: number,
  title: string,
  hoursAgo: number,
): SecurityCase {
  const item: SecurityCase = new SecurityCase();
  item._id = `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  item.caseNumberWithPrefix = `CASE-${number}`;
  item.title = title;
  item.lastDetectedAt = new Date(Date.now() - hoursAgo * HOUR);
  return item;
}

// The latest detection first, as the dialog asks for them.
let cases: Array<SecurityCase>;

beforeEach(() => {
  cases = [
    openCase(142, "Password spray against Okta from 203.0.113.47", 0.2),
    openCase(141, "Known-bad domain resolved by build-runner-07", 0.5),
    openCase(138, "Defender XDR: suspicious PowerShell on web-03", 2),
    openCase(137, "Admin API key created outside the change window", 5),
    openCase(139, "Impossible travel for k.morgan", 7),
  ];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return { data: cases, count: cases.length, skip: 0, limit: 20 };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderModal(
  onPick: (picked: { id: string; number: string }) => void,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <AddToCaseModal eventCount={1} onClose={() => {}} onPick={onPick} />
      </MemoryRouter>,
    );
  });
}

describe("Add to a Case", () => {
  test("lists each open case as a row of its own, inside the picker", async () => {
    await renderModal(() => {});

    const picker: HTMLElement = await screen.findByTestId(
      HUNTS_TEST_IDS.casePicker,
    );
    const rows: Array<HTMLElement> = await within(picker).findAllByTestId(
      HUNTS_TEST_IDS.caseOption,
    );

    expect(HUNTS_TEST_IDS.caseOption).toBe(
      `${HUNTS_TEST_IDS.casePicker}-option`,
    );
    expect(
      rows.map((row: HTMLElement): string => {
        return within(row).getByText(/^CASE-\d+$/).textContent || "";
      }),
    ).toEqual(["CASE-142", "CASE-141", "CASE-138", "CASE-137", "CASE-139"]);
  });

  test("picks the case whose row is clicked, and only once one is picked can it add", async () => {
    const onPick: Mock<(picked: { id: string; number: string }) => void> =
      jest.fn<(picked: { id: string; number: string }) => void>();

    await renderModal(onPick);

    const add: HTMLElement = screen.getByRole("button", {
      name: "Add 1 Event",
    });

    expect(add).toBeDisabled();

    const row: HTMLElement = (
      await screen.findAllByTestId(HUNTS_TEST_IDS.caseOption)
    ).find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes("CASE-141");
    })!;

    fireEvent.click(row);

    expect(row).toHaveAttribute("data-selected", "true");
    expect(add).not.toBeDisabled();

    fireEvent.click(add);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({
      id: "20000000-0000-4000-8000-000000000141",
      number: "CASE-141",
    });
  });

  test("with no open case, says how to start one", async () => {
    cases = [];

    await renderModal(() => {});

    expect(await screen.findByText(NO_OPEN_CASES)).toBeInTheDocument();
    expect(screen.queryAllByTestId(HUNTS_TEST_IDS.caseOption)).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Add 1 Event" })).toBeDisabled();
  });
});
