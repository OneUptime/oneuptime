import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * What an event kept to the team until its publish time (#5249) says about
 * itself on the Dashboard:
 *
 *   - its header's band (ScheduledMaintenancePublishingNotice): "Not on
 *     status pages yet - It shows on its status pages from <time>", naming
 *     its subscribers only when they are told it is scheduled then, with
 *     Publish Now - which asks first, as it tells customers, clears the
 *     publish time and reads the event again; locked, saying why, for a
 *     reader who may not change the time, and not offered at all while the
 *     permissions are not known;
 *   - the Shown on Status Page cell of the list of events
 *     (ScheduledMaintenanceStatusPagesCell): its pages, and from when.
 *
 * The real components are drawn; only the network, the clock and the
 * permission gate are stubbed.
 */

const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import ScheduledMaintenancePublishingNotice, {
  PUBLISHING_NOTICE_TEST_ID,
  PUBLISH_NOW_BUTTON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenancePublishingNotice";
import ScheduledMaintenanceStatusPagesCell, {
  SHOWS_FROM_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceStatusPagesCell";
import { PublishingNoticeCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenancePublishing";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const EVENT_ID: ObjectID = new ObjectID("7a7a7a7a-0000-4000-8000-0000000000aa");

// The customer's example: created on 1 October, published on 24 November.
const NOW: Date = new Date("2026-10-01T08:00:00.000Z");
const PUBLISH_AT: Date = new Date("2026-11-24T09:00:00.000Z");

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const german: i18n = createInstance();

let gate: PermissionGateResult = { isAllowed: true };

beforeAll(async () => {
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
        ) as Record<string, string>,
      },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  gate = { isAllowed: true };
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  OneUptimeDate.setUserTimezone(Timezone.UTC);

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

function shownTime(date: Date): string {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
}

function renderNotice(options?: {
  areSubscribersTold?: boolean;
  onPublished?: () => void;
  language?: i18n;
}): void {
  const notice: ReactElement = (
    <ScheduledMaintenancePublishingNotice
      scheduledMaintenanceId={EVENT_ID}
      publishAt={PUBLISH_AT}
      areSubscribersTold={options?.areSubscribersTold !== false}
      onPublished={options?.onPublished || ((): void => {})}
    />
  );

  render(
    options?.language ? (
      <I18nextProvider i18n={options.language}>{notice}</I18nextProvider>
    ) : (
      notice
    ),
  );
}

describe("the header's band while an event waits for its publish time", () => {
  test("says plainly it is not on its status pages yet, from when, and that its subscribers hear then", () => {
    renderNotice();

    const notice: HTMLElement = screen.getByTestId(PUBLISHING_NOTICE_TEST_ID);

    expect(notice).toHaveTextContent("Not on status pages yet");
    expect(notice).toHaveTextContent(
      `It shows on its status pages from ${shownTime(PUBLISH_AT)}, when their subscribers are told it is scheduled.`,
    );

    // The time is a machine-readable instant too.
    expect(
      within(notice).getByTestId("scheduled-maintenance-publish-at"),
    ).toHaveAttribute("dateTime", PUBLISH_AT.toISOString());
  });

  test("an event whose subscribers are told nothing promises them nothing", () => {
    renderNotice({ areSubscribersTold: false });

    const notice: HTMLElement = screen.getByTestId(PUBLISHING_NOTICE_TEST_ID);

    expect(notice).toHaveTextContent(
      `It shows on its status pages from ${shownTime(PUBLISH_AT)}.`,
    );
    expect(notice).not.toHaveTextContent("subscribers");
  });

  test("writes the time in the reader's timezone", () => {
    OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

    renderNotice();

    // 09:00 UTC is half past two in the afternoon in India.
    expect(screen.getByTestId("scheduled-maintenance-publish-at")).toHaveTextContent(
      "02:30 PM",
    );
  });

  test("Publish Now asks first, saying what it does, and publishes the event right away", async () => {
    const onPublished: MockFunction = getJestMockFunction();

    renderNotice({ onPublished: onPublished as unknown as () => void });

    fireEvent.click(screen.getByTestId(PUBLISH_NOW_BUTTON_TEST_ID));
    await flush();

    const dialog: HTMLElement = screen.getByRole("dialog");

    expect(dialog).toHaveTextContent("Publish this event now?");
    expect(dialog).toHaveTextContent(
      "It shows on its status pages at once, and their subscribers are told it is scheduled.",
    );
    // Nothing is written until the dialog says so.
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Publish Now" }));
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateByIdMock.mock.calls[0]![0]).toEqual({
      modelType: ScheduledMaintenance,
      id: EVENT_ID,
      data: { publishOnStatusPageAt: null },
    });
    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the dialog of an event whose subscribers are told nothing says only that it shows", async () => {
    renderNotice({ areSubscribersTold: false });

    fireEvent.click(screen.getByTestId(PUBLISH_NOW_BUTTON_TEST_ID));
    await flush();

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "It shows on its status pages at once.",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("subscribers");
  });

  test("cancelled, nothing is written", async () => {
    renderNotice();

    fireEvent.click(screen.getByTestId(PUBLISH_NOW_BUTTON_TEST_ID));
    await flush();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a failed publish says why in the dialog, and the event is not read as published", async () => {
    const onPublished: MockFunction = getJestMockFunction();
    updateByIdMock.mockRejectedValue(
      new Error("You do not have permission to edit this event.") as never,
    );

    renderNotice({ onPublished: onPublished as unknown as () => void });

    fireEvent.click(screen.getByTestId(PUBLISH_NOW_BUTTON_TEST_ID));
    await flush();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Publish Now",
      }),
    );
    await flush();

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "You do not have permission to edit this event.",
    );
    expect(onPublished).not.toHaveBeenCalled();
  });

  test("a reader who may not change the publish time sees Publish Now locked, saying why", () => {
    gate = {
      isAllowed: false,
      disabledReason: PublishingNoticeCopy.noPermission,
    };

    renderNotice();

    const button: HTMLElement = screen.getByTestId(PUBLISH_NOW_BUTTON_TEST_ID);

    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(screen.queryByRole("dialog")).toBeNull();
    // The band still says when it shows.
    expect(screen.getByTestId(PUBLISHING_NOTICE_TEST_ID)).toHaveTextContent(
      "Not on status pages yet",
    );
  });

  test("while the permissions are not known, Publish Now is not offered at all", () => {
    gate = { isAllowed: false };

    renderNotice();

    expect(screen.queryByTestId(PUBLISH_NOW_BUTTON_TEST_ID)).toBeNull();
    expect(screen.getByTestId(PUBLISHING_NOTICE_TEST_ID)).toBeInTheDocument();
  });

  test("asks the gate about the column it writes", () => {
    renderNotice();

    expect(PermissionGate.checkColumnUpdate).toHaveBeenCalledWith(
      expect.any(ScheduledMaintenance),
      "publishOnStatusPageAt",
      { sentence: PublishingNoticeCopy.noPermission },
    );
  });

  test("reads in the reader's language", () => {
    renderNotice({ language: german });

    const notice: HTMLElement = screen.getByTestId(PUBLISHING_NOTICE_TEST_ID);

    expect(notice).toHaveTextContent(german.t("Not on status pages yet"));
    expect(german.t("Not on status pages yet")).not.toBe(
      "Not on status pages yet",
    );
    expect(
      screen.getByRole("button", { name: german.t("Publish Now") }),
    ).toBeInTheDocument();
    // The sentence is German, its time slotted in where German puts it.
    expect(notice).toHaveTextContent(
      german
        .t(
          "It shows on its status pages from {{time}}, when their subscribers are told it is scheduled.",
        )
        .split("{{time}}")[0]!
        .trim(),
    );
  });
});

describe("the Shown on Status Page cell of the list of events", () => {
  function eventOn(options: {
    isVisibleOnStatusPage?: boolean;
    publishOnStatusPageAt?: Date | undefined;
    statusPageNames?: Array<string>;
  }): ScheduledMaintenance {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = EVENT_ID.toString();
    event.isVisibleOnStatusPage = options.isVisibleOnStatusPage !== false;

    if (options.publishOnStatusPageAt) {
      event.publishOnStatusPageAt = options.publishOnStatusPageAt;
    }

    event.statusPages = (options.statusPageNames || ["Acme Public"]).map(
      (name: string, index: number): StatusPage => {
        const page: StatusPage = new StatusPage();
        page._id = `9b9b9b9b-0000-4000-8000-00000000000${index}`;
        page.name = name;
        return page;
      },
    );

    return event;
  }

  function renderCell(event: ScheduledMaintenance): void {
    render(
      <MemoryRouter>
        <ScheduledMaintenanceStatusPagesCell item={event} />
      </MemoryRouter>,
    );
  }

  test("names the pages of an event kept to the team, and from when it shows on them", () => {
    renderCell(eventOn({ publishOnStatusPageAt: PUBLISH_AT }));

    expect(screen.getByText("Acme Public")).toBeInTheDocument();
    expect(screen.getByTestId(SHOWS_FROM_TEST_ID)).toHaveTextContent(
      `Shows from ${shownTime(PUBLISH_AT)}`,
    );
  });

  test.each([
    ["published from the start", {}],
    [
      "published already",
      { publishOnStatusPageAt: new Date("2026-09-24T09:00:00.000Z") },
    ],
    [
      "hidden from its status pages",
      { isVisibleOnStatusPage: false, publishOnStatusPageAt: PUBLISH_AT },
    ],
    [
      "on no status page",
      { statusPageNames: [], publishOnStatusPageAt: PUBLISH_AT },
    ],
  ] as Array<[string, Parameters<typeof eventOn>[0]]>)(
    "says nothing more for an event %s",
    (_label: string, options: Parameters<typeof eventOn>[0]) => {
      renderCell(eventOn(options));

      expect(screen.queryByTestId(SHOWS_FROM_TEST_ID)).toBeNull();
    },
  );
});
