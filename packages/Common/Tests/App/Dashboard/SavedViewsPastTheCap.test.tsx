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
import TelemetrySavedViewsControl from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl";
import { SAVED_VIEWS_READ_LIMIT } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/SavedViewReads";
import MetricSavedView from "../../../Models/DatabaseModels/MetricSavedView";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import ObjectID from "../../../Types/ObjectID";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * AN EXPLORER'S SAVED VIEWS, PAST ITS FIRST 100 (#10646).
 *
 * The Traces, Metrics and Exceptions explorers (TelemetrySavedViewsControl)
 * read their first 100 saved views by name and knew no other: a view a link
 * opened that sorted past them was taken for one deleted - not applied, and
 * its id dropped from the link - the project's default past them was never
 * applied, and a view past them could not be picked. The control reads the
 * view a link names and the default by themselves now, counts every view,
 * and searches the rest on the server as its list is typed in. ModelAPI
 * answers from a project faked whole (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(30000);

const PROJECT_ID: string = "00000000-0000-4000-8000-0000000000a1";
const LATE_VIEW_ID: string = "c2000000-0000-4000-8000-0000000000aa";
const LATE_DEFAULT_ID: string = "c2000000-0000-4000-8000-0000000000ab";
const DELETED_VIEW_ID: string = "c2000000-0000-4000-8000-0000000000dd";

const VIEWS_BEFORE_WB: number = SAVED_VIEWS_READ_LIMIT + 20;

let server: CappedListServer;
let applied: Array<TelemetrySavedViewState>;
let onSelectionChange: MockFunction;

function addViews(withDefault: boolean): void {
  server.add(
    MetricSavedView,
    namesSortingFirst(VIEWS_BEFORE_WB).map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name: name,
          query: { search: name },
          isDefault: false,
        };
      },
    ),
  );
  server.add(MetricSavedView, [
    {
      _id: LATE_VIEW_ID,
      name: "WB kiosk errors",
      query: { search: "kiosk" },
      isDefault: false,
    },
    {
      _id: LATE_DEFAULT_ID,
      name: "WB lobby default",
      query: { search: "lobby" },
      isDefault: withDefault,
    },
  ]);
}

beforeEach(() => {
  server = new CappedListServer();
  applied = [];
  onSelectionChange = getJestMockFunction();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderControl(data: {
  initialSavedViewId?: string | undefined;
}): Promise<void> {
  server.install();

  await act(async () => {
    render(
      <TelemetrySavedViewsControl<MetricSavedView>
        modelType={MetricSavedView}
        savedViewNoun="Metric"
        explorerLabel="metrics"
        hasInitialUrlState={Boolean(data.initialSavedViewId)}
        initialSavedViewId={data.initialSavedViewId}
        onSelectionChange={(id: string | null): void => {
          onSelectionChange(id);
        }}
        captureCurrentState={(): TelemetrySavedViewState => {
          return {};
        }}
        applyState={(state: TelemetrySavedViewState): void => {
          applied.push(state);
        }}
      />,
    );
  });
}

function viewReads(): Array<CappedListCall> {
  return server.callsFor(MetricSavedView);
}

describe("an explorer's saved views past its first 100", () => {
  test("a view a link names past the first 100 is read by its id and applied, never dropped from the link", async () => {
    addViews(false);

    await renderControl({ initialSavedViewId: LATE_VIEW_ID });

    await waitFor(() => {
      expect(applied).toContainEqual({ search: "kiosk" });
    });

    const byId: CappedListCall | undefined = viewReads().find(
      (call: CappedListCall): boolean => {
        return call.query["_id"] instanceof Includes;
      },
    );

    expect((byId!.query["_id"] as Includes).values.map(String)).toEqual([
      LATE_VIEW_ID,
    ]);
    // The link keeps the view: it is never reported gone.
    expect(onSelectionChange).not.toHaveBeenCalledWith(null);
  });

  test("a view a link names that is deleted since is reported gone, so the link stops naming it", async () => {
    addViews(false);

    await renderControl({ initialSavedViewId: DELETED_VIEW_ID });

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith(null);
    });
    expect(applied).toEqual([]);
  });

  test("the project's default past the first 100 is read by itself and applied", async () => {
    addViews(true);

    await renderControl({});

    await waitFor(() => {
      expect(applied).toContainEqual({ search: "lobby" });
    });

    const byDefault: CappedListCall | undefined = viewReads().find(
      (call: CappedListCall): boolean => {
        return call.query["isDefault"] === true;
      },
    );

    expect(byDefault!.limit).toBe(1);
  });

  test("counts every view, and finds one past the first 100 by a search on the server", async () => {
    addViews(false);

    await renderControl({});

    const trigger: HTMLElement = await screen.findByRole("button", {
      name: /Saved Views/,
    });

    expect(trigger).toHaveTextContent(String(VIEWS_BEFORE_WB + 2));

    await act(async () => {
      fireEvent.click(trigger);
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Search saved views..."), {
        target: { value: "WB kiosk" },
      });
    });

    const late: HTMLElement = await screen.findByRole("button", {
      name: "WB kiosk errors",
    });

    const searched: CappedListCall | undefined = viewReads().find(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect((searched!.query["name"] as Search<string>).toString()).toBe(
      "WB kiosk",
    );

    await act(async () => {
      fireEvent.click(late);
    });

    expect(applied).toContainEqual({ search: "kiosk" });
    expect(onSelectionChange).toHaveBeenLastCalledWith(LATE_VIEW_ID);
  });

  test("a project whose views are all read reads nothing more", async () => {
    server.add(MetricSavedView, [
      {
        _id: LATE_VIEW_ID,
        name: "Only view",
        query: { search: "only" },
        isDefault: false,
      },
    ]);

    await renderControl({ initialSavedViewId: DELETED_VIEW_ID });

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith(null);
    });

    // One read: it held every view, so the gone one is gone.
    expect(viewReads()).toHaveLength(1);
  });
});
