import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A SIDE-MENU COUNT KEEPS UP WITH THE LIST IT OPENS (#6856).
 *
 * Bulk deleting or resolving alerts left "Active Alerts 4" beside a list
 * that said "No active alerts" until the page was reloaded. The count read
 * its number when it was drawn and only again when somebody asked, and the
 * bulk run never asked; nor did it hear the changes the server announces,
 * which the list beside it and the header's counts follow.
 *
 * Asserted here, on the count itself:
 *
 *   - it counts again when the page asks (refreshSideMenuCounts), and when
 *     the server announces a change to a record of its kind - for the
 *     project it is drawn in, on the app's live connection, for a kind the
 *     server announces;
 *   - counting the same question again keeps the count on show: no blink
 *     through a bulk action. A new question shows nothing until answered;
 *   - an answer that arrives late never replaces a newer one;
 *   - a recount that fails keeps the count; a first read that fails shows
 *     none;
 *   - once the entry has gone, nothing it started is shown or heard.
 *
 * How often a burst of announcements counts, and the hidden tab, are the
 * hook's (UseLiveCount.test.tsx).
 */

const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      isOnThisPage: () => {
        return false;
      },
      navigate: () => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
let currentProjectId: string | null = PROJECT_ID;

jest.mock("../../../UI/Utils/Project", () => {
  // Required inside the factory: jest.mock is hoisted above the imports.
  const ObjectIDType: any = jest.requireActual(
    "../../../Types/ObjectID",
  ) as any;

  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId
          ? new ObjectIDType.default(currentProjectId)
          : null;
      },
    },
  };
});

interface Subscription {
  modelName: string;
  eventType: string;
  tenantId: string;
  onEvent: (modelId: unknown) => void;
  isStopped: boolean;
}

interface ListenRequest {
  modelType: { new (): { tableName: string } };
  eventType: string;
  tenantId: { toString: () => string };
}

// What a count uses of the connection the app opened (Realtime).
interface OpenConnection {
  listenToModelEvent: (
    listen: ListenRequest,
    onEvent: (modelId: unknown) => void,
  ) => () => void;
}

const subscriptions: Array<Subscription> = [];
let isConnectionStarted: boolean = true;

// The app's live connection, where a count asks for it.
jest.mock("../../../UI/Utils/LiveConnection", () => {
  const connection: OpenConnection = {
    listenToModelEvent: (
      listen: ListenRequest,
      onEvent: (modelId: unknown) => void,
    ): (() => void) => {
      const subscription: Subscription = {
        modelName: new listen.modelType().tableName,
        eventType: listen.eventType,
        tenantId: listen.tenantId.toString(),
        onEvent: onEvent,
        isStopped: false,
      };

      subscriptions.push(subscription);

      return (): void => {
        subscription.isStopped = true;
      };
    },
  };

  return {
    __esModule: true,
    getOpenLiveConnection: (): OpenConnection | null => {
      return isConnectionStarted ? connection : null;
    },
  };
});

import CountModelSideMenuItem, {
  REFRESH_SIDEBAR_COUNT_EVENT,
  refreshSideMenuCounts,
} from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import { REFRESH_SIDEBAR_COUNT_EVENT as EVENT_FROM_ITS_OWN_MODULE } from "../../../UI/Components/SideMenu/SideMenuCountRefresh";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Query from "../../../Types/BaseDatabase/Query";
import Route from "../../../Types/API/Route";

const ACTIVE_ALERTS: Query<Alert> = {
  projectId: PROJECT_ID,
  title: "active",
} as Query<Alert>;

interface Deferred {
  promise: Promise<number>;
  resolve: (value: number) => void;
  reject: (error: Error) => void;
}

const deferred: () => Deferred = (): Deferred => {
  let resolve: (value: number) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<number> = new Promise<number>(
    (yes: (value: number) => void, no: (error: Error) => void) => {
      resolve = yes;
      reject = no;
    },
  );

  return { promise, resolve, reject };
};

type EntryProps = {
  modelType?: { new (): BaseModel } | undefined;
  countQuery?: Query<BaseModel> | undefined;
};

const Entry: (props: EntryProps) => React.ReactElement = (
  props: EntryProps,
): React.ReactElement => {
  return (
    <CountModelSideMenuItem<BaseModel>
      link={{ title: "Active Alerts", to: new Route("/dashboard/alerts") }}
      modelType={"modelType" in props ? props.modelType : Alert}
      countQuery={
        "countQuery" in props
          ? props.countQuery
          : (ACTIVE_ALERTS as Query<BaseModel>)
      }
    />
  );
};

// The number beside the entry (Badge's pill): "" when there is none.
const badgeText: (container: HTMLElement) => string = (
  container: HTMLElement,
): string => {
  const badges: Array<Element> = Array.from(
    container.querySelectorAll("span.rounded-full"),
  );

  return badges
    .map((badge: Element): string => {
      return (badge.textContent || "").trim();
    })
    .join(",");
};

const activeSubscriptions: () => Array<Subscription> =
  (): Array<Subscription> => {
    return subscriptions.filter((subscription: Subscription): boolean => {
      return !subscription.isStopped;
    });
  };

// Announces a change to every count listening for this kind of event.
const announce: (modelName: string, eventType?: string) => void = (
  modelName: string,
  eventType: string = "Update",
): void => {
  act((): void => {
    for (const subscription of activeSubscriptions()) {
      if (
        subscription.modelName === modelName &&
        subscription.eventType === eventType
      ) {
        subscription.onEvent("7b3b1548-23cd-46ab-8359-280eb34362af");
      }
    }
  });
};

const renderEntry: (
  props?: EntryProps,
) => Promise<ReturnType<typeof render>> = async (
  props?: EntryProps,
): Promise<ReturnType<typeof render>> => {
  let rendered: ReturnType<typeof render> | undefined;

  await act(async () => {
    rendered = render(<Entry {...(props || {})} />);
  });

  return rendered!;
};

beforeEach(() => {
  countMock.mockReset();
  subscriptions.length = 0;
  isConnectionStarted = true;
  currentProjectId = PROJECT_ID;
});

afterEach(() => {
  cleanup();
});

describe("the page asks every count to count again", () => {
  test("the event is the one the pages already dispatch, and refreshSideMenuCounts dispatches it", () => {
    expect(REFRESH_SIDEBAR_COUNT_EVENT).toBe("REFRESH_SIDEBAR_COUNTS");
    expect(EVENT_FROM_ITS_OWN_MODULE).toBe(REFRESH_SIDEBAR_COUNT_EVENT);

    const heard: Array<string> = [];
    const listener: (event: Event) => void = (event: Event): void => {
      heard.push(event.type);
    };

    window.addEventListener(REFRESH_SIDEBAR_COUNT_EVENT, listener);
    refreshSideMenuCounts();
    window.removeEventListener(REFRESH_SIDEBAR_COUNT_EVENT, listener);

    expect(heard).toEqual([REFRESH_SIDEBAR_COUNT_EVENT]);
  });

  test("bulk deleting the last four alerts: the count leaves without a reload", async () => {
    countMock.mockResolvedValue(4 as never);
    const { container } = await renderEntry();

    expect(badgeText(container)).toBe("4");

    // The four alerts are gone; the bulk run's end asks.
    countMock.mockResolvedValue(0 as never);

    await act(async () => {
      refreshSideMenuCounts();
    });

    await waitFor(() => {
      expect(badgeText(container)).toBe("");
    });
    expect(countMock).toHaveBeenCalledTimes(2);
  });

  test("the recount asks the same question, with what is asked now", async () => {
    countMock.mockResolvedValue(3 as never);
    await renderEntry();

    await act(async () => {
      refreshSideMenuCounts();
    });

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(2);
    });

    const recount: any = countMock.mock.calls[1]![0];
    expect(recount.modelType).toBe(Alert);
    expect(recount.query).toEqual(ACTIVE_ALERTS);
  });

  test("every count on the page counts again, not only one", async () => {
    countMock.mockImplementation(((options: { modelType: unknown }) => {
      return Promise.resolve(options.modelType === AlertEpisode ? 2 : 5);
    }) as never);

    await act(async () => {
      render(
        <>
          <Entry />
          <Entry modelType={AlertEpisode} />
        </>,
      );
    });

    expect(countMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      refreshSideMenuCounts();
    });

    await waitFor(() => {
      expect(countMock).toHaveBeenCalledTimes(4);
    });
  });
});

describe("counting again keeps the count on show", () => {
  test("while a recount is on its way, the count it had stays - then the new one", async () => {
    countMock.mockResolvedValueOnce(4 as never);
    const { container } = await renderEntry();
    expect(badgeText(container)).toBe("4");

    const recount: Deferred = deferred();
    countMock.mockReturnValueOnce(recount.promise as never);

    await act(async () => {
      refreshSideMenuCounts();
    });

    // Asked, not answered: no blink.
    expect(countMock).toHaveBeenCalledTimes(2);
    expect(badgeText(container)).toBe("4");

    await act(async () => {
      recount.resolve(1);
    });

    expect(badgeText(container)).toBe("1");
  });

  test("a new question shows nothing until it is answered: the old count is not its answer", async () => {
    countMock.mockResolvedValueOnce(4 as never);
    const { container, rerender } = await renderEntry();
    expect(badgeText(container)).toBe("4");

    const answer: Deferred = deferred();
    countMock.mockReturnValueOnce(answer.promise as never);

    await act(async () => {
      rerender(
        <Entry
          countQuery={
            { projectId: PROJECT_ID, title: "other" } as Query<BaseModel>
          }
        />,
      );
    });

    expect(badgeText(container)).toBe("");

    await act(async () => {
      answer.resolve(7);
    });

    expect(badgeText(container)).toBe("7");
  });
});

describe("an answer that arrives late never replaces a newer one", () => {
  test("a slow recount started before a change lands after the quick one started after it", async () => {
    countMock.mockResolvedValueOnce(4 as never);
    const { container } = await renderEntry();

    const slow: Deferred = deferred();
    const quick: Deferred = deferred();
    countMock.mockReturnValueOnce(slow.promise as never);
    countMock.mockReturnValueOnce(quick.promise as never);

    await act(async () => {
      refreshSideMenuCounts();
      refreshSideMenuCounts();
    });

    expect(countMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      quick.resolve(1);
    });
    expect(badgeText(container)).toBe("1");

    // Read before the change: it counted three.
    await act(async () => {
      slow.resolve(3);
    });
    expect(badgeText(container)).toBe("1");
  });

  test("a read of the old question that lands after the new question's answer is not shown", async () => {
    const first: Deferred = deferred();
    countMock.mockReturnValueOnce(first.promise as never);
    const { container, rerender } = await renderEntry();

    countMock.mockResolvedValueOnce(9 as never);

    await act(async () => {
      rerender(
        <Entry
          countQuery={
            { projectId: PROJECT_ID, title: "other" } as Query<BaseModel>
          }
        />,
      );
    });
    expect(badgeText(container)).toBe("9");

    await act(async () => {
      first.resolve(2);
    });
    expect(badgeText(container)).toBe("9");
  });
});

describe("a failed read", () => {
  test("a first read that fails shows no count; a recount that then works shows it", async () => {
    countMock.mockRejectedValueOnce(new Error("Network error") as never);
    const { container } = await renderEntry();

    expect(badgeText(container)).toBe("");
    // No error where a number should be.
    expect(container.textContent).not.toContain("Network error");

    countMock.mockResolvedValueOnce(2 as never);

    await act(async () => {
      refreshSideMenuCounts();
    });

    await waitFor(() => {
      expect(badgeText(container)).toBe("2");
    });
  });

  test("a recount that fails keeps the count it had", async () => {
    countMock.mockResolvedValueOnce(2 as never);
    const { container } = await renderEntry();
    expect(badgeText(container)).toBe("2");

    countMock.mockRejectedValueOnce(new Error("Network error") as never);

    await act(async () => {
      refreshSideMenuCounts();
    });

    expect(countMock).toHaveBeenCalledTimes(2);
    expect(badgeText(container)).toBe("2");
    expect(container.textContent).not.toContain("Network error");
  });
});

describe("nothing to count", () => {
  test("an entry with no question yet reads nothing, hears nothing, and counts once it has one", async () => {
    countMock.mockResolvedValue(6 as never);
    const { container, rerender } = await renderEntry({
      countQuery: undefined,
    });

    expect(countMock).not.toHaveBeenCalled();
    expect(activeSubscriptions()).toHaveLength(0);

    // Asked to count again, it still has nothing to count.
    await act(async () => {
      refreshSideMenuCounts();
    });
    expect(countMock).not.toHaveBeenCalled();
    expect(badgeText(container)).toBe("");

    await act(async () => {
      rerender(<Entry />);
    });

    expect(countMock).toHaveBeenCalledTimes(1);
    expect(badgeText(container)).toBe("6");
    expect(activeSubscriptions().length).toBeGreaterThan(0);
  });

  test("an entry that loses its question drops its count, and a late answer does not bring it back", async () => {
    countMock.mockResolvedValueOnce(4 as never);
    const { container, rerender } = await renderEntry();
    expect(badgeText(container)).toBe("4");

    const late: Deferred = deferred();
    countMock.mockReturnValueOnce(late.promise as never);

    await act(async () => {
      refreshSideMenuCounts();
    });

    await act(async () => {
      rerender(<Entry countQuery={undefined} />);
    });
    expect(badgeText(container)).toBe("");

    await act(async () => {
      late.resolve(4);
    });
    expect(badgeText(container)).toBe("");
  });
});

describe("a record of its kind changed, here or anywhere else", () => {
  test("Active Alerts hears every alert created, changed or deleted in its project", async () => {
    countMock.mockResolvedValue(4 as never);
    await renderEntry();

    expect(
      activeSubscriptions()
        .map((subscription: Subscription): string => {
          return `${subscription.modelName}:${subscription.eventType}:${subscription.tenantId}`;
        })
        .sort(),
    ).toEqual([
      `Alert:Create:${PROJECT_ID}`,
      `Alert:Delete:${PROJECT_ID}`,
      `Alert:Update:${PROJECT_ID}`,
    ]);
  });

  test("a teammate resolves an alert: the count follows without a reload, and stays on show while it counts", async () => {
    countMock.mockResolvedValueOnce(4 as never);
    const { container } = await renderEntry();
    expect(badgeText(container)).toBe("4");

    const recount: Deferred = deferred();
    countMock.mockReturnValueOnce(recount.promise as never);

    announce("Alert", "Update");

    expect(countMock).toHaveBeenCalledTimes(2);
    expect(badgeText(container)).toBe("4");

    await act(async () => {
      recount.resolve(3);
    });

    expect(badgeText(container)).toBe("3");
  });

  test("a deleted alert counts again too", async () => {
    countMock.mockResolvedValueOnce(4 as never);
    const { container } = await renderEntry();

    countMock.mockResolvedValueOnce(3 as never);
    announce("Alert", "Delete");

    await waitFor(() => {
      expect(badgeText(container)).toBe("3");
    });
  });

  test("another kind's changes are not its business", async () => {
    countMock.mockResolvedValue(4 as never);
    await renderEntry();

    announce("Incident", "Update");

    expect(countMock).toHaveBeenCalledTimes(1);
  });

  test("a kind the server announces nothing for (Monitor) is not listened for, and still counts when asked", async () => {
    countMock.mockResolvedValue(2 as never);
    const { container } = await renderEntry({
      modelType: Monitor,
      countQuery: { projectId: PROJECT_ID } as Query<BaseModel>,
    });

    expect(activeSubscriptions()).toHaveLength(0);
    expect(badgeText(container)).toBe("2");

    countMock.mockResolvedValue(1 as never);

    await act(async () => {
      refreshSideMenuCounts();
    });

    await waitFor(() => {
      expect(badgeText(container)).toBe("1");
    });
  });

  test("without the app's live connection, it opens none of its own", async () => {
    isConnectionStarted = false;
    countMock.mockResolvedValue(4 as never);

    const { container } = await renderEntry();

    expect(subscriptions).toHaveLength(0);
    expect(badgeText(container)).toBe("4");
  });

  test("outside a project, nothing is listened for", async () => {
    currentProjectId = null;
    countMock.mockResolvedValue(4 as never);

    await renderEntry();

    expect(subscriptions).toHaveLength(0);
  });

  test("once the entry has gone, it stops listening and nothing it started is shown", async () => {
    countMock.mockResolvedValueOnce(4 as never);
    const { unmount } = await renderEntry();

    expect(activeSubscriptions()).toHaveLength(3);

    const late: Deferred = deferred();
    countMock.mockReturnValueOnce(late.promise as never);

    await act(async () => {
      refreshSideMenuCounts();
    });

    unmount();

    expect(activeSubscriptions()).toHaveLength(0);

    const errors: Array<unknown> = [];
    const errorSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation((...args: Array<unknown>) => {
        errors.push(args);
      });

    await act(async () => {
      late.resolve(1);
    });

    // Nor does a later ask reach it.
    await act(async () => {
      refreshSideMenuCounts();
    });

    errorSpy.mockRestore();

    expect(countMock).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([]);
  });

  test("the count it subscribes for follows the entry's kind: a new kind starts over", async () => {
    countMock.mockResolvedValue(1 as never);
    const { rerender } = await renderEntry();

    expect(
      activeSubscriptions().every((subscription: Subscription): boolean => {
        return subscription.modelName === "Alert";
      }),
    ).toBe(true);

    await act(async () => {
      rerender(<Entry modelType={AlertEpisode} />);
    });

    expect(activeSubscriptions()).toHaveLength(3);
    expect(
      activeSubscriptions().every((subscription: Subscription): boolean => {
        return subscription.modelName === "AlertEpisode";
      }),
    ).toBe(true);
  });

  test("re-rendering with the same question keeps one subscription per event, not one per render", async () => {
    countMock.mockResolvedValue(1 as never);
    const { rerender } = await renderEntry();

    await act(async () => {
      rerender(<Entry />);
      rerender(<Entry />);
    });

    expect(subscriptions).toHaveLength(3);
    expect(activeSubscriptions()).toHaveLength(3);
  });
});
