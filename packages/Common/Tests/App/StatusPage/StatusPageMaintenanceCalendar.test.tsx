import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A status page's calendar buttons: Subscribe to calendar on its Scheduled
 * Events page and Add to calendar on an event's page, each opening the
 * dialog that offers Google Calendar, the device's calendar app and (for
 * the subscription) the link to copy - every address built from where the
 * page is read, on its own domain or at its address under OneUptime.
 *
 * Copy resolves against the status page's real en.json; the page's own
 * settings (private, preview, its id) are stubbed.
 */

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (key: string) => string = (key: string): string => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    return typeof node === "string" ? node : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

type PageState = {
  isPrivate: boolean;
  isPreview: boolean;
  statusPageId: string | null;
};

type PageStateGlobal = typeof globalThis & {
  __maintenanceCalendarPage: PageState;
};

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage", () => {
  const read: () => PageState = (): PageState => {
    return (globalThis as PageStateGlobal).__maintenanceCalendarPage;
  };

  return {
    __esModule: true,
    default: {
      isPrivateStatusPage: (): boolean => {
        return read().isPrivate;
      },
      isPreviewPage: (): boolean => {
        return read().isPreview;
      },
      getStatusPageId: (): string | null => {
        return read().statusPageId;
      },
    },
  };
});

import {
  AddEventToCalendarButton,
  SubscribeToCalendarButton,
} from "../../../../App/FeatureSet/StatusPage/src/Components/MaintenanceCalendar/MaintenanceCalendarButtons";

const PAGE_ID: string = "78000000-0000-4000-8000-000000000001";
const EVENT_ID: string = "78100000-0000-4000-8000-000000000001";

const LOCALES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src/Locales",
);

const english: Record<string, any> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIRECTORY, "en.json"), "utf8"),
) as Record<string, any>;

const CALENDAR_WORDS: Record<string, string> = english["scheduledEvents"][
  "calendar"
] as Record<string, string>;

function setPage(state: Partial<PageState>): void {
  (globalThis as PageStateGlobal).__maintenanceCalendarPage = {
    isPrivate: false,
    isPreview: false,
    statusPageId: null,
    ...state,
  };
}

function setLocation(url: string): void {
  window.history.replaceState({}, "", url);
}

let clipboardText: string | null;

beforeEach(() => {
  setPage({});
  clipboardText = null;

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string): Promise<void> => {
        clipboardText = text;
      },
    },
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function link(testId: string): HTMLAnchorElement {
  return screen.getByTestId(testId) as HTMLAnchorElement;
}

describe("Subscribe to calendar, on the Scheduled Events page", () => {
  test("is not offered on a private page, whose calendar no app could read", () => {
    setPage({ isPrivate: true });

    render(<SubscribeToCalendarButton />);

    expect(
      screen.queryByTestId("maintenance-calendar-subscribe"),
    ).not.toBeInTheDocument();
  });

  test("on the page's own domain: Google, the device's app and the link, all to /maintenance.ics", () => {
    setLocation("/scheduled-events");

    render(<SubscribeToCalendarButton />);

    fireEvent.click(screen.getByTestId("maintenance-calendar-subscribe"));

    const https: string = `${window.location.origin}/maintenance.ics`;
    const webcal: string = `webcal://${window.location.host}/maintenance.ics`;

    expect(screen.getByText(CALENDAR_WORDS["subscribeTitle"]!)).toBeVisible();
    expect(screen.getByText(CALENDAR_WORDS["addHeading"]!)).toBeVisible();

    const google: URL = new URL(link("maintenance-calendar-google").href);

    expect(google.origin).toBe("https://calendar.google.com");
    expect(google.searchParams.get("cid")).toBe(webcal);
    expect(link("maintenance-calendar-google").target).toBe("_blank");
    expect(link("maintenance-calendar-google").rel).toContain("noopener");

    expect(link("maintenance-calendar-device").getAttribute("href")).toBe(
      webcal,
    );
    expect(link("maintenance-calendar-device").hasAttribute("download")).toBe(
      false,
    );

    expect(
      (screen.getByTestId("maintenance-calendar-url") as HTMLInputElement)
        .value,
    ).toBe(https);
    expect(screen.getByText(CALENDAR_WORDS["refreshNote"]!)).toBeVisible();
  });

  test("at the page's address under OneUptime: /status-page/<id>/maintenance.ics", () => {
    setPage({ isPreview: true, statusPageId: PAGE_ID });
    setLocation(`/status-page/${PAGE_ID}/scheduled-events`);

    render(<SubscribeToCalendarButton />);
    fireEvent.click(screen.getByTestId("maintenance-calendar-subscribe"));

    expect(
      (screen.getByTestId("maintenance-calendar-url") as HTMLInputElement)
        .value,
    ).toBe(`${window.location.origin}/status-page/${PAGE_ID}/maintenance.ics`);
  });

  test("Copy link copies the https address and says so for a moment", async () => {
    jest.useFakeTimers();
    setLocation("/scheduled-events");

    render(<SubscribeToCalendarButton />);
    fireEvent.click(screen.getByTestId("maintenance-calendar-subscribe"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("maintenance-calendar-copy"));
    });

    expect(clipboardText).toBe(`${window.location.origin}/maintenance.ics`);
    expect(screen.getByTestId("maintenance-calendar-copy")).toHaveTextContent(
      CALENDAR_WORDS["copied"]!,
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId("maintenance-calendar-copy")).toHaveTextContent(
      CALENDAR_WORDS["copy"]!,
    );
  });

  test("Done closes the dialog", () => {
    render(<SubscribeToCalendarButton />);
    fireEvent.click(screen.getByTestId("maintenance-calendar-subscribe"));

    expect(
      screen.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText(CALENDAR_WORDS["done"]!));

    expect(
      screen.queryByTestId("maintenance-calendar-subscribe-dialog"),
    ).not.toBeInTheDocument();
  });
});

/*
 * Issue #5132: on a status page served over plain http - a self-hosted
 * install reached by a LAN hostname - the browser has no navigator.clipboard.
 * Copy link awaited navigator.clipboard?.writeText(...), which then resolves
 * to undefined without copying anything, and said "Copied!" all the same.
 *
 * It copies through Clipboard.copyToClipboard now: the async clipboard, then
 * the browser's older copy command. "Copied!" only when one of them took the
 * link; otherwise the dialog says the browser did not let it copy, and the
 * link is left selected in its field, to copy by hand.
 */
describe("Copy link copies, or says it could not (issue #5132)", () => {
  const originalExecCommand: PropertyDescriptor | undefined =
    Object.getOwnPropertyDescriptor(document, "execCommand");

  type ExecCommand = (command: string) => boolean;

  function setClipboard(
    writeText: ((text: string) => Promise<void>) | null,
  ): void {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    });
  }

  function setExecCommand(execCommand: ExecCommand | undefined): void {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: execCommand,
    });
  }

  // The legacy copy, recording what it was handed: the scratch field's text.
  function recordingExecCommand(
    result: boolean,
    copied: Array<string>,
  ): ExecCommand {
    return (command: string): boolean => {
      const field: HTMLTextAreaElement | null = document.querySelector(
        "textarea[aria-hidden='true']",
      );

      if (command === "copy" && field) {
        copied.push(
          field.value.slice(field.selectionStart, field.selectionEnd),
        );
      }

      return result;
    };
  }

  function refusingWrite(): (text: string) => Promise<void> {
    return async (): Promise<void> => {
      throw new DOMException("Document is not focused.", "NotAllowedError");
    };
  }

  function openSubscribe(): void {
    setLocation("/scheduled-events");
    render(<SubscribeToCalendarButton />);
    fireEvent.click(screen.getByTestId("maintenance-calendar-subscribe"));
  }

  async function clickCopy(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByTestId("maintenance-calendar-copy"));
    });
  }

  function linkField(): HTMLInputElement {
    return screen.getByTestId("maintenance-calendar-url") as HTMLInputElement;
  }

  function httpsLink(): string {
    return `${window.location.origin}/maintenance.ics`;
  }

  function expectLinkSelectedToCopyByHand(): void {
    expect(document.activeElement).toBe(linkField());
    expect(linkField().selectionStart).toBe(0);
    expect(linkField().selectionEnd).toBe(httpsLink().length);
  }

  beforeEach(() => {
    setExecCommand(undefined);
  });

  afterEach(() => {
    if (originalExecCommand) {
      Object.defineProperty(document, "execCommand", originalExecCommand);
    } else {
      setExecCommand(undefined);
    }
  });

  test("the bug: with no clipboard and no copy command it never says Copied!", async () => {
    setClipboard(null);
    openSubscribe();

    await clickCopy();

    expect(
      screen.getByTestId("maintenance-calendar-copy"),
    ).not.toHaveTextContent(CALENDAR_WORDS["copied"]!);
    expect(screen.getByTestId("maintenance-calendar-copy")).toHaveTextContent(
      CALENDAR_WORDS["copy"]!,
    );
    expect(
      screen.getByTestId("maintenance-calendar-copy-failed"),
    ).toHaveTextContent(CALENDAR_WORDS["copyFailed"]!);
    expectLinkSelectedToCopyByHand();
  });

  test("on a plain-http page (no navigator.clipboard) the browser's copy command copies the link, and only then Copied!", async () => {
    const copied: Array<string> = [];

    setClipboard(null);
    setExecCommand(recordingExecCommand(true, copied));
    openSubscribe();

    await clickCopy();

    expect(copied).toEqual([httpsLink()]);
    expect(screen.getByTestId("maintenance-calendar-copy")).toHaveTextContent(
      CALENDAR_WORDS["copied"]!,
    );
    expect(
      screen.queryByTestId("maintenance-calendar-copy-failed"),
    ).not.toBeInTheDocument();
    // The scratch field the command copied from is gone again.
    expect(document.querySelector("textarea[aria-hidden='true']")).toBeNull();
  });

  test("a clipboard that refuses the write (document not focused) falls back to the copy command", async () => {
    const copied: Array<string> = [];

    setClipboard(refusingWrite());
    setExecCommand(recordingExecCommand(true, copied));
    openSubscribe();

    await clickCopy();

    expect(copied).toEqual([httpsLink()]);
    expect(screen.getByTestId("maintenance-calendar-copy")).toHaveTextContent(
      CALENDAR_WORDS["copied"]!,
    );
  });

  test("refused both ways: says so, and the link is selected in its field to copy by hand", async () => {
    const copied: Array<string> = [];

    setClipboard(refusingWrite());
    setExecCommand(recordingExecCommand(false, copied));
    openSubscribe();

    await clickCopy();

    expect(copied).toEqual([httpsLink()]);
    expect(
      screen.getByTestId("maintenance-calendar-copy"),
    ).not.toHaveTextContent(CALENDAR_WORDS["copied"]!);
    expect(
      screen.getByTestId("maintenance-calendar-copy-failed"),
    ).toHaveTextContent(CALENDAR_WORDS["copyFailed"]!);
    expectLinkSelectedToCopyByHand();
  });

  test("a copy command that throws is a failure too, not an error", async () => {
    setClipboard(null);
    setExecCommand((): boolean => {
      throw new Error("Not supported");
    });
    openSubscribe();

    await clickCopy();

    expect(
      screen.getByTestId("maintenance-calendar-copy-failed"),
    ).toBeInTheDocument();
  });

  test("the failure is said in a status region that is there before it, so a screen reader hears it", async () => {
    setClipboard(null);
    openSubscribe();

    const region: HTMLElement = screen.getByTestId(
      "maintenance-calendar-copy-status",
    );

    expect(region).toHaveAttribute("role", "status");
    expect(region).toBeEmptyDOMElement();

    await clickCopy();

    expect(screen.getByTestId("maintenance-calendar-copy-status")).toBe(region);
    expect(region).toHaveTextContent(CALENDAR_WORDS["copyFailed"]!);
  });

  test("the failure stays while it is read, and a copy that then works replaces it with Copied!", async () => {
    jest.useFakeTimers();
    setClipboard(null);
    openSubscribe();

    await clickCopy();

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(
      screen.getByTestId("maintenance-calendar-copy-failed"),
    ).toBeInTheDocument();

    const copied: Array<string> = [];
    setExecCommand(recordingExecCommand(true, copied));

    await clickCopy();

    expect(copied).toEqual([httpsLink()]);
    expect(
      screen.queryByTestId("maintenance-calendar-copy-failed"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("maintenance-calendar-copy")).toHaveTextContent(
      CALENDAR_WORDS["copied"]!,
    );
  });

  test("never says Copied! before the clipboard has taken the link", async () => {
    let finishWrite: () => void = (): void => {};

    setClipboard((): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        finishWrite = resolve;
      });
    });
    openSubscribe();

    await clickCopy();

    // Still in flight: nothing is claimed.
    expect(screen.getByTestId("maintenance-calendar-copy")).toHaveTextContent(
      CALENDAR_WORDS["copy"]!,
    );

    await act(async () => {
      finishWrite();
    });

    expect(screen.getByTestId("maintenance-calendar-copy")).toHaveTextContent(
      CALENDAR_WORDS["copied"]!,
    );
  });

  test("a keyboard reader stays on Copy link after the browser's copy command, inside the dialog", async () => {
    setClipboard(null);
    // As browsers do: selecting the scratch field moves the focus to it.
    setExecCommand((): boolean => {
      (
        document.querySelector(
          "textarea[aria-hidden='true']",
        ) as HTMLTextAreaElement | null
      )?.focus();
      return true;
    });
    openSubscribe();

    const button: HTMLElement = screen.getByTestId("maintenance-calendar-copy");
    button.focus();

    await clickCopy();

    expect(document.activeElement).toBe(button);
    expect(
      screen.getByTestId("maintenance-calendar-subscribe-dialog"),
    ).toContainElement(document.activeElement as HTMLElement);
  });

  test("closing the dialog while a copy is in flight is quiet", async () => {
    let finishWrite: () => void = (): void => {};

    setClipboard((): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        finishWrite = resolve;
      });
    });
    openSubscribe();

    await clickCopy();
    fireEvent.click(screen.getByText(CALENDAR_WORDS["done"]!));

    await expect(
      act(async () => {
        finishWrite();
      }),
    ).resolves.toBeUndefined();
    expect(
      screen.queryByTestId("maintenance-calendar-subscribe-dialog"),
    ).not.toBeInTheDocument();
  });
});

describe("Add to calendar, on an event's page", () => {
  function renderEvent(): void {
    render(
      <AddEventToCalendarButton
        eventId={EVENT_ID}
        title="Database upgrade"
        startsAt={new Date("2026-10-20T22:00:00.000Z")}
        endsAt={new Date("2026-10-21T01:00:00.000Z")}
      />,
    );

    fireEvent.click(screen.getByTestId("maintenance-calendar-add-event"));
  }

  test("is offered on a private page too: the reader's own browser downloads the file, signed in", () => {
    setPage({ isPrivate: true });

    render(
      <AddEventToCalendarButton
        eventId={EVENT_ID}
        title="Database upgrade"
        startsAt={new Date("2026-10-20T22:00:00.000Z")}
      />,
    );

    expect(
      screen.getByTestId("maintenance-calendar-add-event"),
    ).toBeInTheDocument();
  });

  test("Google Calendar opens with the event filled in, in UTC", () => {
    setLocation(`/scheduled-events/${EVENT_ID}`);
    renderEvent();

    const google: URL = new URL(link("maintenance-calendar-google").href);

    expect(`${google.origin}${google.pathname}`).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(google.searchParams.get("action")).toBe("TEMPLATE");
    expect(google.searchParams.get("text")).toBe("Database upgrade");
    expect(google.searchParams.get("dates")).toBe(
      "20261020T220000Z/20261021T010000Z",
    );
    expect(google.searchParams.get("details")).toBe(
      `${window.location.origin}/scheduled-events/${EVENT_ID}`,
    );
  });

  test("the device's calendar app gets the event alone, as a download", () => {
    setLocation(`/scheduled-events/${EVENT_ID}`);
    renderEvent();

    expect(link("maintenance-calendar-device").getAttribute("href")).toBe(
      `${window.location.origin}/maintenance.ics?event=${EVENT_ID}`,
    );
    expect(link("maintenance-calendar-device").getAttribute("download")).toBe(
      "maintenance.ics",
    );
    expect(screen.getByText(CALENDAR_WORDS["deviceFileHint"]!)).toBeVisible();
  });

  test("at the page's address under OneUptime the file is the page's own", () => {
    setPage({ isPreview: true, statusPageId: PAGE_ID });
    setLocation(`/status-page/${PAGE_ID}/scheduled-events/${EVENT_ID}`);
    renderEvent();

    expect(link("maintenance-calendar-device").getAttribute("href")).toBe(
      `${window.location.origin}/status-page/${PAGE_ID}/maintenance.ics?event=${EVENT_ID}`,
    );
  });

  test("no link to copy and no second heading: the dialog is titled Add to calendar already", () => {
    renderEvent();

    expect(
      screen.queryByTestId("maintenance-calendar-url"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(CALENDAR_WORDS["addHeading"]!),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(CALENDAR_WORDS["refreshNote"]!),
    ).not.toBeInTheDocument();
  });
});

describe("the calendar's words in every status page language", () => {
  const locales: Array<string> = fs
    .readdirSync(LOCALES_DIRECTORY)
    .filter((file: string) => {
      return file.endsWith(".json");
    });

  // Names that read the same in every language.
  const PRODUCT_NAMES: Array<string> = ["google", "device"];

  test("there are seventeen of them", () => {
    expect(locales).toHaveLength(17);
  });

  test.each(locales)("%s has every word, translated", (file: string) => {
    const locale: Record<string, any> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIRECTORY, file), "utf8"),
    ) as Record<string, any>;

    const words: Record<string, string> = (locale["scheduledEvents"]?.[
      "calendar"
    ] || {}) as Record<string, string>;

    expect(Object.keys(words).sort()).toEqual(
      Object.keys(CALENDAR_WORDS).sort(),
    );

    for (const [key, value] of Object.entries(words)) {
      expect({ key, empty: !value.trim() }).toEqual({ key, empty: false });

      if (file !== "en.json" && !PRODUCT_NAMES.includes(key)) {
        expect({ key, sameAsEnglish: value === CALENDAR_WORDS[key] }).toEqual({
          key,
          sameAsEnglish: false,
        });
      }
    }
  });
});
