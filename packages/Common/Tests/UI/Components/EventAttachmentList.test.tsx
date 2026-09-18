import EventAttachmentList, {
  EventAttachment,
} from "../../../UI/Components/AttachmentList/EventAttachmentList";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A private status page serves note attachments behind the reader's
 * session. The cards are plain links, and a plain link gets none of the API
 * class's refresh-and-replay, so a reader who had the page open past the
 * 15-minute access token opened every attachment as a 401. Given a
 * refreshSession, a click refreshes before the new tab loads; without one
 * (public pages) the cards stay the plain links they were.
 */

const ATTACHMENT: EventAttachment = {
  name: "postmortem.pdf",
  downloadUrl:
    "/status-page-api/incident-public-note/attachment/sp/incident/note/file",
};

interface FakeTab {
  opener: unknown;
  closed: boolean;
  location: { href: string };
}

type WindowOpenMock = SpyInstance<typeof window.open>;

// Lets every pending promise chain run to completion.
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/*
 * Whether the component took the click over, read after React has handled
 * it. jsdom does not implement navigation, so the link's own default is
 * stopped here too, once that has been recorded.
 */
let lastClickWasPrevented: boolean | null = null;

const recordAndStopClick: (event: MouseEvent) => void = (
  event: MouseEvent,
): void => {
  lastClickWasPrevented = event.defaultPrevented;
  event.preventDefault();
};

let windowOpen: WindowOpenMock;
let tab: FakeTab;

beforeEach(() => {
  lastClickWasPrevented = null;
  document.addEventListener("click", recordAndStopClick);

  tab = { opener: window, closed: false, location: { href: "" } };
  windowOpen = jest.spyOn(window, "open").mockImplementation((): Window => {
    return tab as unknown as Window;
  });
});

afterEach(() => {
  cleanup();
  document.removeEventListener("click", recordAndStopClick);
  jest.restoreAllMocks();
});

describe("EventAttachmentList", () => {
  test("without refreshSession the card is a plain link the browser follows by itself", () => {
    render(<EventAttachmentList attachments={[ATTACHMENT]} />);

    const link: HTMLElement = screen.getByTitle(ATTACHMENT.name);

    expect(link).toHaveAttribute("href", ATTACHMENT.downloadUrl);
    expect(link).toHaveAttribute("target", "_blank");

    fireEvent.click(link);

    expect(lastClickWasPrevented).toBe(false);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  test("with refreshSession a click refreshes the session first, then opens the attachment", async () => {
    let finishRefresh: (value: boolean) => void = (): void => {};
    const refreshSession: ReturnType<typeof jest.fn<() => Promise<boolean>>> =
      jest.fn<() => Promise<boolean>>((): Promise<boolean> => {
        return new Promise<boolean>(
          (resolve: (value: boolean) => void): void => {
            finishRefresh = resolve;
          },
        );
      });

    render(
      <EventAttachmentList
        attachments={[ATTACHMENT]}
        refreshSession={refreshSession}
      />,
    );

    const link: HTMLElement = screen.getByTitle(ATTACHMENT.name);

    // The href stays for middle-click and "copy link address".
    expect(link).toHaveAttribute("href", ATTACHMENT.downloadUrl);

    fireEvent.click(link);

    expect(lastClickWasPrevented).toBe(true);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith("", "_blank");

    await flushPromises();
    expect(tab.location.href).toBe("");

    finishRefresh(true);
    await flushPromises();

    expect(tab.location.href).toBe(ATTACHMENT.downloadUrl);
  });

  test("with refreshSession a modified click is still left to the browser", () => {
    const refreshSession: ReturnType<typeof jest.fn<() => Promise<boolean>>> =
      jest.fn<() => Promise<boolean>>(async (): Promise<boolean> => {
        return true;
      });

    render(
      <EventAttachmentList
        attachments={[ATTACHMENT]}
        refreshSession={refreshSession}
      />,
    );

    fireEvent.click(screen.getByTitle(ATTACHMENT.name), { metaKey: true });

    expect(lastClickWasPrevented).toBe(false);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  test("the inline variant, used for timeline notes, takes the same refresh", () => {
    const refreshSession: ReturnType<typeof jest.fn<() => Promise<boolean>>> =
      jest.fn<() => Promise<boolean>>(async (): Promise<boolean> => {
        return true;
      });

    render(
      <EventAttachmentList
        attachments={[ATTACHMENT]}
        variant="inline"
        showHeader={false}
        showCount={false}
        refreshSession={refreshSession}
      />,
    );

    fireEvent.click(screen.getByTitle(ATTACHMENT.name));

    expect(lastClickWasPrevented).toBe(true);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});
