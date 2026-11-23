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
} from "@testing-library/react";
import React from "react";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import { searchThroughGetList } from "./AffectedResourceSearchFake";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The picker's search of resources goes through its own endpoint: answered
 * here with nothing, since the subject is its Labels tab.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourceSearchApi",
  () => {
    return {
      __esModule: true,
      searchAffectedResources: (query: unknown): Promise<unknown> => {
        return searchThroughGetList(async () => {
          return { data: [], count: 0 } as never;
        })(query as never);
      },
    };
  },
);

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
    },
  };
});

import AffectedResourcesPicker, {
  AffectedResourcesPayload,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { LABEL_SEARCH_PAGE_SIZE } from "../../../UI/Components/EntityDropdown/LabelSearch";

/*
 * THE AFFECTED RESOURCES PICKER'S LABELS TAB FINDS EVERY LABEL (#10646).
 *
 * It read the project's first 10,000 labels by name the first time it
 * opened and filtered them in the browser, so a label past them could
 * never bulk-add the resources it tags. It searches the server as it is
 * typed in now (useLabelSearch). ModelAPI answers from a project faked
 * whole (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(30000);

const LATE_LABEL_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const KIOSK_MONITOR_ID: string = "a2000000-0000-4000-8000-0000000000a1";

let server: CappedListServer;
let onChange: MockFunction;

beforeEach(() => {
  server = new CappedListServer();

  server.add(
    Label,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Label, [{ _id: LATE_LABEL_ID, name: "WB1500KSK kiosks" }]);
  server.add(Monitor, [
    { _id: KIOSK_MONITOR_ID, name: "Kiosk 02", labels: LATE_LABEL_ID },
  ]);
  server.install();

  onChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openLabelsTab(): Promise<void> {
  render(
    <AffectedResourcesPicker
      resourceTypes={["Monitor"]}
      onChange={(payload: AffectedResourcesPayload): void => {
        onChange(payload);
      }}
    />,
  );

  await act(async () => {
    fireEvent.focus(screen.getByRole("combobox"));
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: /Labels/ }));
  });
}

describe("the Affected Resources picker's Labels tab", () => {
  test("lists 50 labels by name and says how many match, never the project's 10,000", async () => {
    await openLabelsTab();

    await waitFor(() => {
      expect(
        screen.getByTestId("affected-resources-more-labels"),
      ).toHaveTextContent(/Showing 50 of 10,051\. Type to narrow the list\./);
    });

    for (const call of server.callsFor(Label)) {
      expect(call.limit).toBe(LABEL_SEARCH_PAGE_SIZE);
    }
  });

  test("finds a label past the 10,000th on the server, and adds the resources it tags", async () => {
    await openLabelsTab();

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "WB1500KSK" },
      });
    });

    const label: HTMLElement = await screen.findByRole("option", {
      name: /WB1500KSK kiosks/,
    });

    const searched: CappedListCall | undefined = server
      .callsFor(Label)
      .find((call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      });

    expect((searched!.query["name"] as Search<string>).toString()).toBe(
      "WB1500KSK",
    );

    await act(async () => {
      fireEvent.click(label);
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add resources from 1 label" }),
      );
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });

    expect(
      (
        onChange.mock.calls[onChange.mock.calls.length - 1]![0] as {
          monitors?: Array<string>;
        }
      ).monitors,
    ).toEqual([KIOSK_MONITOR_ID]);

    // The resources are read by the label, never every monitor.
    const byLabel: CappedListCall | undefined = server
      .callsFor(Monitor)
      .find((call: CappedListCall): boolean => {
        return call.query["labels"] instanceof Includes;
      });

    expect((byLabel!.query["labels"] as Includes).values).toEqual([
      LATE_LABEL_ID,
    ]);
  });

  test("says when no label matches what is typed", async () => {
    await openLabelsTab();

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "nothing called this" },
      });
    });

    expect(
      await screen.findByText("No labels match “nothing called this”."),
    ).toBeVisible();
  });
});
