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
  within,
} from "@testing-library/react";
import * as React from "react";
import HuntFormFilters, {
  renderHuntFormFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntFormFilters";
import { HUNTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import { SecurityHuntFilters } from "../../../Types/SecurityEvent/SecurityHunt";
import { EXCLUDED_FILTER_CHIP_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A HUNT'S FILTERS IN ITS EDIT FORM (HuntFormFilters): the chips the Events
 * sidebar made, drawn as the Events explorer draws them over its list -
 * "Severity: High", "Status is not: Failure" in red, an attribute by its
 * key, a source by its service's name - each with its x, and Clear all
 * once there are two. What is taken off is taken off the form's value.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SOURCE_ID: string = "3d000000-0000-4000-8000-000000000001";

let changes: Array<SecurityHuntFilters>;
let serviceReads: number;
let serviceFailure: Error | null;

beforeEach(() => {
  changes = [];
  serviceReads = 0;
  serviceFailure = null;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (options: {
    modelType: unknown;
  }) => {
    expect(options.modelType).toBe(Service);
    serviceReads++;

    if (serviceFailure) {
      throw serviceFailure;
    }

    const service: Service = new Service();
    service._id = SOURCE_ID;
    service.name = "Payments API";

    return { data: [service], count: 1, skip: 0, limit: 100 };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderChips(value: unknown): Promise<HTMLElement> {
  await act(async () => {
    render(
      <HuntFormFilters
        value={value}
        onChange={(filters: SecurityHuntFilters) => {
          changes.push(filters);
        }}
      />,
    );
  });

  return screen.getByTestId(HUNTS_TEST_IDS.formFilters);
}

// A chip as it reads: its key, then its value (the two sit apart, not run together).
function chipText(chip: Element): string {
  return Array.from(chip.children)
    .map((part: Element): string => {
      return (part.textContent || "").replace(/\s+/g, " ").trim();
    })
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" ");
}

function chipTexts(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("span.inline-flex")).map(
    (chip: Element): string => {
      return chipText(chip);
    },
  );
}

describe("a hunt's filters in its Edit form", () => {
  test("are drawn as the Events explorer draws them: by the sidebar's titles, an attribute by its key, each value its own", async () => {
    const chips: HTMLElement = await renderChips({
      severityName: ["High", "Critical"],
      "attributes.device.hostname": ["web-01"],
    });

    expect(chipTexts(chips)).toEqual([
      "Severity: High",
      "Severity: Critical",
      "device.hostname: web-01",
    ]);
    // No source among them: no service is read.
    expect(serviceReads).toBe(0);
  });

  test("a value left out says so in words, in the sidebar's red", async () => {
    const chips: HTMLElement = await renderChips({
      "!statusName": ["Failure"],
    });
    const excluded: HTMLElement = within(chips).getByTestId(
      EXCLUDED_FILTER_CHIP_TEST_ID,
    );

    expect(chipText(excluded)).toBe("Status is not: Failure");
    expect(excluded.className).toContain("text-red-700");
  });

  test("a chip's x takes off just its value", async () => {
    const chips: HTMLElement = await renderChips({
      severityName: ["High", "Critical"],
      "!statusName": ["Failure"],
    });

    await act(async () => {
      fireEvent.click(within(chips).getByTitle("Remove Severity: High"));
    });

    expect(changes).toEqual([
      { severityName: ["Critical"], "!statusName": ["Failure"] },
    ]);
  });

  test("the last value of a field taken off takes the field with it", async () => {
    const chips: HTMLElement = await renderChips({
      severityName: ["High"],
      "!statusName": ["Failure"],
    });

    await act(async () => {
      fireEvent.click(
        within(chips).getByTitle("Remove Status is not: Failure"),
      );
    });

    expect(changes).toEqual([{ severityName: ["High"] }]);
  });

  test("Clear all, once there are two, takes every chip off", async () => {
    const chips: HTMLElement = await renderChips({
      severityName: ["High"],
      className: ["Authentication"],
    });

    await act(async () => {
      fireEvent.click(within(chips).getByRole("button", { name: "Clear all" }));
    });

    expect(changes).toEqual([{}]);
  });

  test("one chip alone has its x, and no Clear all", async () => {
    const chips: HTMLElement = await renderChips({ severityName: ["High"] });

    expect(
      within(chips).queryByRole("button", { name: "Clear all" }),
    ).toBeNull();
    expect(within(chips).getAllByRole("button")).toHaveLength(1);
  });

  test("a source is read by its service's name, once the project's services are read", async () => {
    const chips: HTMLElement = await renderChips({
      primaryEntityId: [SOURCE_ID],
    });

    await waitFor(() => {
      expect(chipTexts(chips)).toEqual(["Source: Payments API"]);
    });
    expect(serviceReads).toBe(1);
  });

  test("a source whose services could not be read keeps its id, and can still be taken off", async () => {
    serviceFailure = new Error("The server is unavailable.");

    const chips: HTMLElement = await renderChips({
      primaryEntityId: [SOURCE_ID],
    });

    await waitFor(() => {
      expect(serviceReads).toBe(1);
    });
    expect(chipTexts(chips)).toEqual([`Source: ${SOURCE_ID}`]);

    await act(async () => {
      fireEvent.click(within(chips).getByTitle(`Remove Source: ${SOURCE_ID}`));
    });

    expect(changes).toEqual([{}]);
  });

  test("the form's Filters field draws them from the form's values, and hands each change to the form", async () => {
    const formChanges: Array<unknown> = [];

    await act(async () => {
      render(
        renderHuntFormFilters(
          {
            filters: { severityName: ["High", "Critical"] },
          } as unknown as FormValues<SecurityHunt>,
          {
            onChange: (value: unknown) => {
              formChanges.push(value);
            },
          } as never,
        ),
      );
    });

    const chips: HTMLElement = screen.getByTestId(HUNTS_TEST_IDS.formFilters);

    expect(chipTexts(chips)).toEqual(["Severity: High", "Severity: Critical"]);

    await act(async () => {
      fireEvent.click(within(chips).getByTitle("Remove Severity: Critical"));
    });

    expect(formChanges).toEqual([{ severityName: ["High"] }]);
  });
});
