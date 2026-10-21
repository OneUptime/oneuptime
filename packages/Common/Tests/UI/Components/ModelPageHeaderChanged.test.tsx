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
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A resource's name and labels are edited in one place: the details card at
 * the top of its Settings page. The page header above that card - "Host -
 * web-01", with the labels beside it - belongs to the layout's ModelPage,
 * which read it once and kept the old name until a reload.
 *
 * The card now announces a save (ModelHeaderEvents), and ModelPage reads its
 * header again when the announcement is for the record it shows, and only
 * then. These tests render the real ModelPage against a fake API.
 */

const getItemMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

import ModelPage from "../../../UI/Components/Page/ModelPage";
import {
  announceModelHeaderChanged,
  MODEL_HEADER_CHANGED_EVENT,
  subscribeToModelHeaderChanged,
} from "../../../UI/Components/Page/ModelHeaderEvents";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import ObjectID from "../../../Types/ObjectID";

const HOST_A: string = "11111111-1111-4111-8111-111111111111";
const HOST_B: string = "22222222-2222-4222-8222-222222222222";

function buildHost(id: string, name: string, labelNames: Array<string>): Host {
  const host: Host = new Host();
  host.id = new ObjectID(id);
  host.name = name;
  host.labels = labelNames.map((labelName: string, index: number): Label => {
    const label: Label = new Label();
    label.id = new ObjectID(`33333333-3333-4333-8333-33333333333${index}`);
    label.name = labelName;
    return label;
  });
  return host;
}

function layoutFor(hostId: string): ReactElement {
  return (
    <ModelPage
      title="Host"
      modelType={Host}
      modelId={new ObjectID(hostId)}
      modelNameField="name"
    >
      <div data-testid="child-page">{`Settings of ${hostId}`}</div>
    </ModelPage>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

beforeEach(() => {
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ModelPage, when a tab saves the record's name or labels", () => {
  test("reads its header again and shows the new name and labels, keeping the page mounted", async () => {
    getItemMock
      .mockResolvedValueOnce(buildHost(HOST_A, "web-01", ["prod"]) as never)
      .mockResolvedValueOnce(
        buildHost(HOST_A, "Front end", ["prod", "eu"]) as never,
      );

    render(layoutFor(HOST_A));
    await flush();

    expect(heading()).toHaveTextContent("Host - web-01");
    const page: HTMLElement = screen.getByTestId("child-page");

    await act(async () => {
      announceModelHeaderChanged({
        modelType: Host,
        modelId: new ObjectID(HOST_A),
      });
    });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(heading()).toHaveTextContent("Host - Front end");
    expect(screen.getByText("eu")).toBeInTheDocument();
    // The tab that saved was never unmounted for the refresh.
    expect(screen.getByTestId("child-page")).toBe(page);
    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });

  test("ignores a save of another record of the same kind", async () => {
    getItemMock.mockResolvedValue(buildHost(HOST_A, "web-01", []) as never);

    render(layoutFor(HOST_A));
    await flush();

    await act(async () => {
      announceModelHeaderChanged({
        modelType: Host,
        modelId: new ObjectID(HOST_B),
      });
    });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("ignores a save of a record of another kind with the same id", async () => {
    getItemMock.mockResolvedValue(buildHost(HOST_A, "web-01", []) as never);

    render(layoutFor(HOST_A));
    await flush();

    await act(async () => {
      announceModelHeaderChanged({
        modelType: KubernetesCluster,
        modelId: new ObjectID(HOST_A),
      });
    });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("follows the record it shows after moving to another one", async () => {
    getItemMock
      .mockResolvedValueOnce(buildHost(HOST_A, "web-01", []) as never)
      .mockResolvedValueOnce(buildHost(HOST_B, "web-02", []) as never)
      .mockResolvedValueOnce(buildHost(HOST_B, "Back end", []) as never);

    const view: RenderResult = render(layoutFor(HOST_A));
    await flush();

    view.rerender(layoutFor(HOST_B));
    await flush();
    expect(heading()).toHaveTextContent("Host - web-02");

    // The record it left: nothing.
    await act(async () => {
      announceModelHeaderChanged({
        modelType: Host,
        modelId: new ObjectID(HOST_A),
      });
    });
    await flush();
    expect(getItemMock).toHaveBeenCalledTimes(2);

    // The record it shows now.
    await act(async () => {
      announceModelHeaderChanged({
        modelType: Host,
        modelId: new ObjectID(HOST_B),
      });
    });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(3);
    expect(heading()).toHaveTextContent("Host - Back end");
  });

  test("keeps the header on screen when the re-read fails", async () => {
    getItemMock
      .mockResolvedValueOnce(buildHost(HOST_A, "web-01", []) as never)
      .mockRejectedValueOnce(new Error("Network blip") as never);

    render(layoutFor(HOST_A));
    await flush();

    await act(async () => {
      announceModelHeaderChanged({
        modelType: Host,
        modelId: new ObjectID(HOST_A),
      });
    });
    await flush();

    expect(heading()).toHaveTextContent("Host - web-01");
    expect(screen.getByTestId("child-page")).toBeInTheDocument();
  });

  test("stops listening once unmounted", async () => {
    getItemMock.mockResolvedValue(buildHost(HOST_A, "web-01", []) as never);

    const view: RenderResult = render(layoutFor(HOST_A));
    await flush();
    view.unmount();

    await act(async () => {
      announceModelHeaderChanged({
        modelType: Host,
        modelId: new ObjectID(HOST_A),
      });
    });
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("ModelHeaderEvents", () => {
  test("announces the table name and the id, and a subscriber hears only its own record", () => {
    const heard: Array<string> = [];
    const seen: Array<unknown> = [];
    const spy: (event: Event) => void = (event: Event): void => {
      seen.push((event as CustomEvent).detail);
    };
    window.addEventListener(MODEL_HEADER_CHANGED_EVENT, spy);

    const unsubscribe: () => void = subscribeToModelHeaderChanged({
      modelType: Host,
      modelId: new ObjectID(HOST_A),
      onChanged: (): void => {
        heard.push("a");
      },
    });

    announceModelHeaderChanged({
      modelType: Host,
      modelId: new ObjectID(HOST_A),
    });
    announceModelHeaderChanged({
      modelType: Host,
      modelId: new ObjectID(HOST_B),
    });

    expect(heard).toEqual(["a"]);
    expect(seen[0]).toEqual({ tableName: "Host", modelId: HOST_A });

    unsubscribe();
    announceModelHeaderChanged({
      modelType: Host,
      modelId: new ObjectID(HOST_A),
    });
    expect(heard).toEqual(["a"]);

    window.removeEventListener(MODEL_HEADER_CHANGED_EVENT, spy);
  });
});
