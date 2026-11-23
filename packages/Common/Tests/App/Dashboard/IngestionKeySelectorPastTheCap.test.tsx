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
import { MemoryRouter } from "react-router-dom";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import IngestionKeySelector, {
  INGESTION_KEYS_READ_LIMIT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE INGESTION KEY PICKER OFFERS EVERY KEY OF THE GUIDE'S TYPE (#10646).
 *
 * Every ingestion guide's first step read the project's keys unsorted, 50 of
 * them - the newest - so an older key could not be picked at all, however
 * it was named. The picker reads the first keys by name now, searches the
 * rest on the server as it is typed in (the shared Dropdown's
 * onSearchTextChange), and keeps a key picked from the search whatever is
 * searched next. ModelAPI answers from a project faked whole
 * (CappedListServer).
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(30000);

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const LATE_KEY_ID: string = "b1000000-0000-4000-8000-0000000000aa";
const OTHER_TYPE_KEY_ID: string = "b1000000-0000-4000-8000-0000000000ab";

let server: CappedListServer;
let onSelectedKeyChange: MockFunction;

beforeEach(() => {
  server = new CappedListServer();

  // More keys of the guide's type than one read lists, named before "WB".
  server.add(
    TelemetryIngestionKey,
    namesSortingFirst(INGESTION_KEYS_READ_LIMIT + 10).map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name: name,
          keyType: TelemetryIngestionKeyType.Server,
          secretKey: `secret-${name}`,
          isEnabled: true,
        };
      },
    ),
  );
  server.add(TelemetryIngestionKey, [
    {
      _id: LATE_KEY_ID,
      name: "WB kiosk collector",
      keyType: TelemetryIngestionKeyType.Server,
      secretKey: "secret-of-the-late-key",
      isEnabled: true,
    },
    // Another type's key: never offered to this guide.
    {
      _id: OTHER_TYPE_KEY_ID,
      name: "WB kiosk browser",
      keyType: TelemetryIngestionKeyType.Browser,
      secretKey: "secret-of-a-browser-key",
      isEnabled: true,
    },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );

  onSelectedKeyChange = getJestMockFunction();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function keyReads(): Array<CappedListCall> {
  return server.callsFor(TelemetryIngestionKey);
}

async function renderSelector(): Promise<void> {
  render(
    <MemoryRouter>
      <IngestionKeySelector
        endpointLabel="OneUptime URL"
        endpointValue="https://oneuptime.example.com"
        keyTypeFilter={TelemetryIngestionKeyType.Server}
        newKeyName="Kubernetes key"
        onSelectedKeyChange={(key: TelemetryIngestionKey | null): void => {
          onSelectedKeyChange(key);
        }}
      />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
}

async function search(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: text },
    });
  });
}

function lastPickedSecret(): string | undefined {
  const key: TelemetryIngestionKey | null | undefined = onSelectedKeyChange.mock
    .calls[onSelectedKeyChange.mock.calls.length - 1]?.[0] as
    | TelemetryIngestionKey
    | null
    | undefined;

  return key?.secretKey?.toString();
}

describe("the ingestion key picker", () => {
  test("reads the first keys of the guide's type by name, never the newest few unsorted", async () => {
    await renderSelector();

    const first: CappedListCall = keyReads()[0]!;

    expect(first.sort).toEqual({ name: SortOrder.Ascending });
    expect(first.limit).toBe(INGESTION_KEYS_READ_LIMIT);
    expect(first.query["keyType"]).toBe(TelemetryIngestionKeyType.Server);

    // The first by name is picked, and its token shown.
    expect(lastPickedSecret()).toBe("secret-AP000001");
  });

  test("finds a key past the first ones on the server, within the guide's type, and keeps it picked whatever is searched next", async () => {
    await renderSelector();
    await search("WB kiosk");

    const option: HTMLElement = await screen.findByRole("option", {
      name: "WB kiosk collector",
    });

    // Never another type's key, however its name matches.
    expect(
      screen.queryByRole("option", { name: "WB kiosk browser" }),
    ).toBeNull();

    const searched: CappedListCall | undefined = keyReads().find(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect((searched!.query["name"] as Search<string>).toString()).toBe(
      "WB kiosk",
    );
    expect(searched!.query["keyType"]).toBe(TelemetryIngestionKeyType.Server);

    await act(async () => {
      fireEvent.click(option);
    });

    expect(lastPickedSecret()).toBe("secret-of-the-late-key");
    expect(screen.getByText("secret-of-the-late-key")).toBeVisible();

    // Another search: the key picked stays picked, its token shown.
    await search("AP00000");

    await waitFor(() => {
      expect(
        keyReads().filter((call: CappedListCall): boolean => {
          return call.query["name"] instanceof Search;
        }),
      ).toHaveLength(2);
    });

    expect(screen.getByText("secret-of-the-late-key")).toBeVisible();
    expect(lastPickedSecret()).toBe("secret-of-the-late-key");
  });
});
