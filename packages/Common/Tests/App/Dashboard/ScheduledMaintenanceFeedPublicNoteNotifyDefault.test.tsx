/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  flush,
  NOTIFY_FLAG,
  NOTIFYING_DESCRIPTION,
  notifyCheckbox,
  notifyDescription,
  openNoteDialog,
  postedModelType,
  postedPayload,
  postNote,
  renderAndSettle,
  UNTICKED_ON_NOTIFYING_EVENT_DESCRIPTION,
  writeNote,
} from "./FeedNoteDialogHelpers";

/*
 * A scheduled maintenance event created without notifying status page
 * subscribers ("When the event is scheduled" off) should not have its first
 * public note be what tells them. The Scheduled Maintenance Feed's "Add
 * Public Note" opens the event's Notes page composer in a dialog, and its
 * "Notify status page subscribers" starts unticked on such an event, says
 * why, and the note is posted with an explicit false - never left out for
 * the server to decide. Nothing changes for an event that did notify, or for
 * private notes.
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

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
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "10000000-0000-4000-8000-000000000001",
        );
      },
      getCurrentProject: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Components/Markdown.tsx/MarkdownEditor", () => {
  const ReactModule: typeof React = jest.requireActual("react") as typeof React;
  return {
    __esModule: true,
    default: (props: {
      initialValue?: string;
      onChange?: (value: string) => void;
    }): ReactElement => {
      const [value, setValue] = ReactModule.useState<string>(
        props.initialValue || "",
      );
      return (
        <textarea
          aria-label="Note text"
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setValue(event.target.value);
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

/* Keep the test about the notes, not markdown parsing or timeline chrome. */
jest.mock("../../../UI/Components/Feed/Feed", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "rendered-feed" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookPicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import ScheduledMaintenanceFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceFeed";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";

const EVENT_ID: string = "55555555-5555-4555-8555-555555555555";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");

function feed(
  notifyStatusPageSubscribersByDefault?: boolean | undefined,
): ReactElement {
  return (
    <ScheduledMaintenanceFeedElement
      scheduledMaintenanceId={new ObjectID(EVENT_ID)}
      refreshToken={0}
      notifyStatusPageSubscribersByDefault={
        notifyStatusPageSubscribersByDefault
      }
    />
  );
}

async function openPublicNote(
  notifyStatusPageSubscribersByDefault?: boolean | undefined,
): Promise<HTMLElement> {
  await renderAndSettle(feed(notifyStatusPageSubscribersByDefault));
  return await openNoteDialog("Add Public Note");
}

beforeEach(() => {
  window.localStorage.clear();
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: DEFAULT_LIMIT,
  } as never);
  createMock.mockImplementation(async (...args: Array<any>) => {
    return { data: args[0].model };
  });
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  createMock.mockReset();
  jest.restoreAllMocks();
});

describe("Scheduled Maintenance Feed public note: event created without notifying subscribers", () => {
  test("starts 'Notify status page subscribers' unticked", async () => {
    const dialog: HTMLElement = await openPublicNote(false);

    expect(notifyCheckbox(dialog)).not.toBeChecked();
  });

  test("explains why the box starts unticked", async () => {
    const dialog: HTMLElement = await openPublicNote(false);

    expect(notifyDescription(dialog)).toBe(
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    );
    expect(notifyDescription(dialog)).toBe(
      "Unticked by default because status page subscribers were not notified when this scheduled maintenance event was created.",
    );
  });

  test("posts an explicit false when the box is left unticked", async () => {
    const dialog: HTMLElement = await openPublicNote(false);

    writeNote(dialog, "The failover starts in ten minutes.");
    await postNote(dialog);

    const payload: Record<string, unknown> = postedPayload(createMock);
    expect(postedModelType(createMock)).toBe(ScheduledMaintenancePublicNote);
    expect(Object.keys(payload)).toContain(NOTIFY_FLAG);
    expect(payload[NOTIFY_FLAG]).toBe(false);
  });

  test("ticking the box notifies after all", async () => {
    const dialog: HTMLElement = await openPublicNote(false);

    fireEvent.click(notifyCheckbox(dialog));
    expect(notifyCheckbox(dialog)).toBeChecked();
    expect(notifyDescription(dialog)).toBe(NOTIFYING_DESCRIPTION);

    writeNote(dialog, "Telling them now.");
    await postNote(dialog);

    expect(postedPayload(createMock)[NOTIFY_FLAG]).toBe(true);
  });

  test("attaches the note to this event, posted now", async () => {
    const dialog: HTMLElement = await openPublicNote(false);

    writeNote(dialog, "Attached to the event.");
    await postNote(dialog);

    const payload: Record<string, unknown> = postedPayload(createMock);
    expect(payload["scheduledMaintenanceId"]).toMatchObject({
      value: EVENT_ID,
    });
    expect(payload["postedAt"]).toMatchObject({ value: NOW.toISOString() });
  });
});

describe("Scheduled Maintenance Feed public note: event created with subscribers notified", () => {
  test("starts the box ticked, saying the note will notify", async () => {
    const dialog: HTMLElement = await openPublicNote(true);

    expect(notifyCheckbox(dialog)).toBeChecked();
    expect(notifyDescription(dialog)).toBe(NOTIFYING_DESCRIPTION);
  });

  test("posts true when the box is left ticked", async () => {
    const dialog: HTMLElement = await openPublicNote(true);

    writeNote(dialog, "An update.");
    await postNote(dialog);

    expect(postedPayload(createMock)[NOTIFY_FLAG]).toBe(true);
  });

  test("unticking says the note still goes on the status page, and posts false", async () => {
    const dialog: HTMLElement = await openPublicNote(true);

    fireEvent.click(notifyCheckbox(dialog));
    expect(notifyDescription(dialog)).toBe(
      UNTICKED_ON_NOTIFYING_EVENT_DESCRIPTION,
    );
    expect(notifyDescription(dialog)).not.toBe(
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    );

    writeNote(dialog, "A small fix.");
    await postNote(dialog);

    expect(postedPayload(createMock)[NOTIFY_FLAG]).toBe(false);
  });
});

describe("Scheduled Maintenance Feed public note: no default passed (backwards compatible)", () => {
  test("starts the box ticked", async () => {
    const dialog: HTMLElement = await openPublicNote(undefined);

    expect(notifyCheckbox(dialog)).toBeChecked();
  });

  test("a feed rendered without the prop at all behaves the same", async () => {
    await renderAndSettle(
      <ScheduledMaintenanceFeedElement
        scheduledMaintenanceId={new ObjectID(EVENT_ID)}
      />,
    );
    const dialog: HTMLElement = await openNoteDialog("Add Public Note");

    expect(notifyCheckbox(dialog)).toBeChecked();
  });
});

describe("Scheduled Maintenance Feed public note: the default follows the page", () => {
  /*
   * The page passes the flag once the event has loaded, and again after a
   * refresh. The next dialog opened must use the current value.
   */
  test("a dialog opened after the default turns off starts unticked", async () => {
    const view: RenderResult = await renderAndSettle(feed(true));

    view.rerender(feed(false));
    await flush();
    const dialog: HTMLElement = await openNoteDialog("Add Public Note");

    expect(notifyCheckbox(dialog)).not.toBeChecked();
    expect(notifyDescription(dialog)).toBe(
      PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
    );
  });

  test("a dialog opened after the default turns back on starts ticked", async () => {
    const view: RenderResult = await renderAndSettle(feed(false));

    view.rerender(feed(true));
    await flush();
    const dialog: HTMLElement = await openNoteDialog("Add Public Note");

    expect(notifyCheckbox(dialog)).toBeChecked();
    expect(notifyDescription(dialog)).toBe(NOTIFYING_DESCRIPTION);
  });
});

describe("Scheduled Maintenance Feed private note is unaffected", () => {
  test.each([
    ["off", false],
    ["on", true],
    ["not passed", undefined],
  ])(
    "with the default %s, the private note has no notify box and posts no flag",
    async (_label: string, notifyByDefault: boolean | undefined) => {
      await renderAndSettle(feed(notifyByDefault));
      const dialog: HTMLElement = await openNoteDialog("Add Private Note");

      expect(
        within(dialog).queryByRole("checkbox", {
          name: "Notify status page subscribers",
        }),
      ).toBeNull();
      expect(
        screen.queryByRole("dialog", { name: "Add Public Note" }),
      ).toBeNull();

      writeNote(dialog, "For the team.");
      await postNote(dialog);

      const payload: Record<string, unknown> = postedPayload(createMock);
      expect(postedModelType(createMock)).toBe(
        ScheduledMaintenanceInternalNote,
      );
      expect(Object.keys(payload)).not.toContain(NOTIFY_FLAG);
      expect(payload["scheduledMaintenanceId"]).toMatchObject({
        value: EVENT_ID,
      });
    },
  );
});
