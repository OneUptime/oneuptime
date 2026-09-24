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
import { Mock } from "jest-mock";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import Clipboard from "../../../UI/Utils/Clipboard";
import {
  ATTRIBUTES_VIEW_PREFERENCE,
  resetPreferencesForTesting,
} from "../../../UI/Components/AttributesJSON/AttributesJSONPreferences";

/*
 * A log's attributes in the details panel: "Copy JSON" copies them with
 * their types (the old copy quoted every number and boolean), the format
 * menu offers the nested shape, and the List / JSON switch shows the same
 * JSON in place. The panel's own per-row copy and filter controls stay.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: () => {
        return "mocked error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import LogDetailsPanel from "../../../UI/Components/LogsViewer/components/LogDetailsPanel";

const SERVICE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
);

const LOG_ATTRIBUTES: JSONObject = {
  "http.request.method": "POST",
  "http.response.status_code": 502,
  "retry.attempt": 3,
  "cache.hit": false,
  "k8s.pod.name": "checkout-7d9f",
  "user.roles": ["admin", "support"],
};

const copyMock: Mock<(text: string) => Promise<boolean>> =
  jest.fn<(text: string) => Promise<boolean>>();

function makeLog(attributes: JSONObject | undefined): Log {
  const log: Log = new Log();
  log.body = "upstream request failed";
  log.time = new Date("2026-09-23T10:15:00.000Z");
  log.severityText = LogSeverity.Error;
  log.primaryEntityId = SERVICE_ID;
  if (attributes) {
    log.attributes = attributes;
  }
  return log;
}

function copied(index: number = 0): unknown {
  return JSON.parse(copyMock.mock.calls[index]![0]);
}

function copyControl(): HTMLElement {
  return screen.getByTestId("log-attributes-copy-json");
}

beforeEach(() => {
  window.localStorage.clear();
  resetPreferencesForTesting();
  postMock.mockReset();
  getListMock.mockReset();
  postMock.mockResolvedValue({ data: { before: [], after: [] } });
  getListMock.mockResolvedValue({ data: [], count: 0 });
  copyMock.mockReset();
  copyMock.mockResolvedValue(true);
  jest
    .spyOn(Clipboard, "copyToClipboard")
    .mockImplementation(
      copyMock as unknown as typeof Clipboard.copyToClipboard,
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("LogDetailsPanel attributes as JSON", () => {
  test("Copy JSON copies the log's attributes with their types intact", async () => {
    render(<LogDetailsPanel log={makeLog(LOG_ATTRIBUTES)} serviceMap={{}} />);

    await act(async () => {
      fireEvent.click(
        within(copyControl()).getByRole("button", { name: "Copy JSON" }),
      );
    });

    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copied()).toEqual({
      "cache.hit": false,
      "http.request.method": "POST",
      "http.response.status_code": 502,
      "k8s.pod.name": "checkout-7d9f",
      "retry.attempt": 3,
      "user.roles": ["admin", "support"],
    });
  });

  test("the format menu copies the nested shape", async () => {
    render(<LogDetailsPanel log={makeLog(LOG_ATTRIBUTES)} serviceMap={{}} />);

    await act(async () => {
      fireEvent.click(
        within(copyControl()).getByRole("button", {
          name: "Choose JSON format",
        }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: /Nested/ }));
    });

    expect(copied()).toEqual({
      cache: { hit: false },
      http: { request: { method: "POST" }, response: { status_code: 502 } },
      k8s: { pod: { name: "checkout-7d9f" } },
      retry: { attempt: 3 },
      user: { roles: ["admin", "support"] },
    });
  });

  test("the header counts the attributes", () => {
    render(<LogDetailsPanel log={makeLog(LOG_ATTRIBUTES)} serviceMap={{}} />);

    const header: HTMLElement = copyControl().closest("header") as HTMLElement;
    expect(header).toHaveTextContent("Attributes");
    expect(header).toHaveTextContent("6");
  });

  test("the JSON view replaces the list, and List brings it back", () => {
    render(<LogDetailsPanel log={makeLog(LOG_ATTRIBUTES)} serviceMap={{}} />);

    expect(screen.getByTitle("Copy http.request.method")).toBeInTheDocument();

    const toggle: HTMLElement = screen.getByTestId(
      "log-attributes-view-toggle",
    );
    fireEvent.click(within(toggle).getByRole("button", { name: "JSON" }));

    const json: HTMLElement = screen.getByTestId("log-attributes-json");
    expect(json).toHaveTextContent('"http.response.status_code": 502');
    expect(json).toHaveTextContent('"cache.hit": false');
    expect(
      screen.queryByTitle("Copy http.request.method"),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(ATTRIBUTES_VIEW_PREFERENCE.storageKey),
    ).toBe("json");

    fireEvent.click(within(toggle).getByRole("button", { name: "List" }));

    expect(screen.queryByTestId("log-attributes-json")).not.toBeInTheDocument();
    expect(screen.getByTitle("Copy http.request.method")).toBeInTheDocument();
  });

  test("opens in the JSON view when that was the last choice", () => {
    window.localStorage.setItem(ATTRIBUTES_VIEW_PREFERENCE.storageKey, "json");

    render(<LogDetailsPanel log={makeLog(LOG_ATTRIBUTES)} serviceMap={{}} />);

    expect(screen.getByTestId("log-attributes-json")).toBeInTheDocument();
  });

  test("filter-by and per-row copy still work in the list", () => {
    const onFilterByAttribute: ReturnType<typeof jest.fn> = jest.fn();

    render(
      <LogDetailsPanel
        log={makeLog(LOG_ATTRIBUTES)}
        serviceMap={{}}
        onFilterByAttribute={onFilterByAttribute}
      />,
    );

    fireEvent.click(screen.getByTitle("Filter by retry.attempt: 3"));
    expect(onFilterByAttribute).toHaveBeenCalledWith("retry.attempt", "3");
    expect(screen.getByTitle("Copy retry.attempt")).toBeInTheDocument();
  });

  test("a log without attributes has no attributes section", () => {
    render(<LogDetailsPanel log={makeLog(undefined)} serviceMap={{}} />);

    expect(
      screen.queryByTestId("log-attributes-copy-json"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("log-attributes-view-toggle"),
    ).not.toBeInTheDocument();
  });
});
