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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import HuntFormFilters from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntFormFilters";
import { HUNTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import { getHuntSourceValues } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsModel";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { SecurityHuntFilters } from "../../../Types/SecurityEvent/SecurityHunt";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

/*
 * A HUNT'S SAVED SOURCES, PAST THE PROJECT'S FIRST 10,000 SERVICES
 * (#10921).
 *
 * A hunt saved from the Events sidebar keeps its sources as services' ids,
 * and its Edit form drew each by its service's name - looked for among the
 * project's first 10,000 services by name. A source past them read as its
 * bare id, and so did one deleted since. They are read by the ids the hunt
 * holds now: every source named, however many services the project has,
 * one gone as "No longer available" - in the reader's words - taken off by
 * its x like any other chip, and never dropped or changed by anything else
 * the form does. ModelAPI answers from a project faked whole
 * (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const LATE_SOURCE_ID: string = "3d000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_SOURCE_ID: string = "3d000000-0000-4000-8000-0000000000ab";
const DELETED_SOURCE_ID: string = "3d000000-0000-4000-8000-0000000000dd";

let server: CappedListServer;
let changes: Array<SecurityHuntFilters>;

beforeEach(() => {
  changes = [];
  server = new CappedListServer();

  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: LATE_SOURCE_ID, name: "WB kiosk payments" },
    { _id: OTHER_LATE_SOURCE_ID, name: "WB kiosk login" },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderChips(
  value: unknown,
  wrap?: ((element: React.ReactElement) => React.ReactElement) | undefined,
): Promise<HTMLElement> {
  const element: React.ReactElement = (
    <HuntFormFilters
      value={value}
      onChange={(filters: SecurityHuntFilters) => {
        changes.push(filters);
      }}
    />
  );

  await act(async () => {
    render(wrap ? wrap(element) : element);
  });

  return screen.getByTestId(HUNTS_TEST_IDS.formFilters);
}

function chipTexts(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("span.inline-flex")).map(
    (chip: Element): string => {
      return Array.from(chip.children)
        .map((part: Element): string => {
          return (part.textContent || "").replace(/\s+/g, " ").trim();
        })
        .filter((part: string): boolean => {
          return part.length > 0;
        })
        .join(" ");
    },
  );
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

describe("a hunt's sources in its Edit form", () => {
  test("a source past the project's first 10,000 services keeps its name: read by its id", async () => {
    const chips: HTMLElement = await renderChips({
      primaryEntityId: [LATE_SOURCE_ID],
    });

    await waitFor(() => {
      expect(chipTexts(chips)).toEqual(["Source: WB kiosk payments"]);
    });

    // One read, by the id the hunt holds: never the first 10,000 by name.
    expect(serviceReads()).toHaveLength(1);
    expect(serviceReads()[0]!.query["_id"]).toBeInstanceOf(Includes);
    expect(serviceReads()[0]!.limit).toBe(1);
    expect(serviceReads()[0]!.limit).toBeLessThan(LIMIT_PER_PROJECT);
  });

  test("a source left out is named too, in the sidebar's red words", async () => {
    const chips: HTMLElement = await renderChips({
      "!primaryEntityId": [OTHER_LATE_SOURCE_ID],
    });

    await waitFor(() => {
      expect(chipTexts(chips)).toEqual(["Source is not: WB kiosk login"]);
    });
  });

  test("a source deleted since reads No longer available, and is taken off by its x", async () => {
    const chips: HTMLElement = await renderChips({
      primaryEntityId: [LATE_SOURCE_ID, DELETED_SOURCE_ID],
      severityName: ["High"],
    });

    await waitFor(() => {
      expect(chipTexts(chips)).toEqual([
        "Source: WB kiosk payments",
        "Source: No longer available",
        "Severity: High",
      ]);
    });

    // Never its bare id.
    expect(chips.textContent).not.toContain(DELETED_SOURCE_ID);

    await act(async () => {
      fireEvent.click(
        within(chips).getByTitle("Remove Source: No longer available"),
      );
    });

    // Its own value comes off - the one the hunt holds - and nothing else.
    expect(changes).toEqual([
      { primaryEntityId: [LATE_SOURCE_ID], severityName: ["High"] },
    ]);
  });

  test("a source past the 10,000th survives a change to another filter: the hunt is saved with it as it holds it", async () => {
    const chips: HTMLElement = await renderChips({
      primaryEntityId: [LATE_SOURCE_ID, DELETED_SOURCE_ID],
      severityName: ["High", "Critical"],
    });

    await waitFor(() => {
      expect(chipTexts(chips)[0]).toBe("Source: WB kiosk payments");
    });

    await act(async () => {
      fireEvent.click(within(chips).getByTitle("Remove Severity: High"));
    });

    expect(changes).toEqual([
      {
        primaryEntityId: [LATE_SOURCE_ID, DELETED_SOURCE_ID],
        severityName: ["Critical"],
      },
    ]);
  });

  test("many sources are read by their ids in pages of 500, each once", async () => {
    const many: Array<string> = Array.from({ length: 600 }, (): string => {
      return ObjectID.generate().toString();
    });

    const chips: HTMLElement = await renderChips({
      primaryEntityId: [...many, LATE_SOURCE_ID, LATE_SOURCE_ID.toUpperCase()],
    });

    await waitFor(() => {
      expect(chipTexts(chips)).toContain("Source: WB kiosk payments");
    });

    expect(serviceReads()).toHaveLength(2);

    for (const call of serviceReads()) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
      expect(call.limit).toBeLessThanOrEqual(500);
    }
  });

  test("a source that is no id is drawn as written, and never read", async () => {
    const chips: HTMLElement = await renderChips({
      primaryEntityId: ["payments-api"],
    });

    expect(chipTexts(chips)).toEqual(["Source: payments-api"]);
    expect(serviceReads()).toHaveLength(0);
  });

  test("No longer available reads in the reader's language", async () => {
    const GERMAN: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const german: i18n = createInstance();

    await german.init({
      lng: "de",
      resources: { de: { translation: GERMAN } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    const chips: HTMLElement = await renderChips(
      { primaryEntityId: [DELETED_SOURCE_ID, LATE_SOURCE_ID] },
      (element: React.ReactElement): React.ReactElement => {
        return <I18nextProvider i18n={german}>{element}</I18nextProvider>;
      },
    );

    await waitFor(() => {
      expect(chips.textContent).toContain(GERMAN["No longer available"]!);
    });
    expect(chips.textContent).toContain("WB kiosk payments");
    expect(chips.textContent).not.toContain("No longer available");
  });
});

describe("the sources a hunt's filters name", () => {
  test("kept or left out, each once, as written", () => {
    expect(
      getHuntSourceValues({
        primaryEntityId: [LATE_SOURCE_ID, LATE_SOURCE_ID.toUpperCase()],
        "!primaryEntityId": [OTHER_LATE_SOURCE_ID],
        severityName: ["High"],
      }),
    ).toEqual([LATE_SOURCE_ID, OTHER_LATE_SOURCE_ID]);
  });

  test("none in filters that name none, or in no filters at all", () => {
    expect(getHuntSourceValues({ severityName: ["High"] })).toEqual([]);
    expect(getHuntSourceValues(undefined)).toEqual([]);
    expect(getHuntSourceValues("not filters")).toEqual([]);
  });
});
