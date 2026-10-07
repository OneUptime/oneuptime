import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The test meeting a connection is checked with: in the connection form,
 * for settings not saved yet, and on its own from the connections table.
 * It is the one check that proves the credentials, the provider-side
 * permission and the host work together, so what it shows on success (the
 * real meeting's link) and on failure (the provider's own reason) is the
 * whole point.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import VideoCallTestPanel from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallTestPanel";
import { VideoCallTestResult } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallApi";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (
      resolvePromise: (value: T) => void,
      rejectPromise: (error: Error) => void,
    ) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );

  return { promise, resolve, reject };
}

const ZOOM_MEETING: VideoCallTestResult = {
  provider: VideoCallProvider.Zoom,
  joinUrl: "https://example.zoom.us/j/81234567890?pwd=abc",
};

function testButton(): HTMLElement {
  return screen.getByTestId("video-call-test-button");
}

afterEach(() => {
  cleanup();
});

describe("VideoCallTestPanel", () => {
  test("offers a test meeting, and says nothing has been tried yet", () => {
    render(
      <VideoCallTestPanel
        providerTitle="Zoom"
        runTest={getJestMockFunction() as never}
      />,
    );

    expect(screen.getByText("Start a test meeting")).toBeInTheDocument();
    expect(testButton()).toHaveTextContent("Start test meeting");
    expect(testButton()).toBeEnabled();
    expect(screen.queryByTestId("video-call-test-passed")).toBeNull();
    expect(screen.queryByTestId("video-call-test-failed")).toBeNull();
  });

  test("cannot run while a required credential is missing", () => {
    const runTest: MockFunction = getJestMockFunction();

    render(
      <VideoCallTestPanel
        providerTitle="Zoom"
        runTest={runTest as never}
        disabledReason="Fill in Client secret to start a test meeting."
      />,
    );

    expect(testButton()).toBeDisabled();
    fireEvent.click(testButton());
    expect(runTest).not.toHaveBeenCalled();
  });

  test("says it is starting the meeting while it waits, and cannot be pressed twice", async () => {
    const deferred: Deferred<VideoCallTestResult> =
      createDeferred<VideoCallTestResult>();
    const runTest: MockFunction = getJestMockFunction().mockReturnValue(
      deferred.promise,
    );

    render(
      <VideoCallTestPanel providerTitle="Zoom" runTest={runTest as never} />,
    );

    fireEvent.click(testButton());

    expect(testButton()).toHaveTextContent("Starting test meeting…");
    expect(testButton()).toBeDisabled();

    fireEvent.click(testButton());
    expect(runTest).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(ZOOM_MEETING);
      await deferred.promise;
    });
  });

  test("shows the meeting it started, with a link that opens it in a new tab", async () => {
    const runTest: MockFunction =
      getJestMockFunction().mockResolvedValue(ZOOM_MEETING);

    render(
      <VideoCallTestPanel providerTitle="Zoom" runTest={runTest as never} />,
    );

    fireEvent.click(testButton());

    const passed: HTMLElement = await screen.findByTestId(
      "video-call-test-passed",
    );

    expect(passed).toHaveAttribute("role", "status");
    expect(within(passed).getByText("Test meeting created")).toBeVisible();

    const link: HTMLElement = within(passed).getByRole("link", {
      name: ZOOM_MEETING.joinUrl,
    });

    expect(link).toHaveAttribute("href", ZOOM_MEETING.joinUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(passed).getByTestId("video-call-logo-Zoom")).toBeVisible();
    expect(testButton()).toHaveTextContent("Test again");
  });

  test("shows the provider's own reason when the meeting could not start", async () => {
    const runTest: MockFunction = getJestMockFunction().mockRejectedValue(
      new Error(
        "Zoom rejected the client secret. Copy it again from the app's App Credentials page.",
      ),
    );

    render(
      <VideoCallTestPanel providerTitle="Zoom" runTest={runTest as never} />,
    );

    fireEvent.click(testButton());

    const failed: HTMLElement = await screen.findByTestId(
      "video-call-test-failed",
    );

    expect(failed).toHaveAttribute("role", "alert");
    expect(
      within(failed).getByText(
        "Zoom could not start a meeting with these settings",
      ),
    ).toBeVisible();
    expect(
      within(failed).getByText(
        "Zoom rejected the client secret. Copy it again from the app's App Credentials page.",
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("video-call-test-passed")).toBeNull();
  });

  test("a second try replaces the first one's answer", async () => {
    const runTest: MockFunction = getJestMockFunction()
      .mockRejectedValueOnce(new Error("The policy is not applied yet."))
      .mockResolvedValueOnce(ZOOM_MEETING);

    render(
      <VideoCallTestPanel providerTitle="Zoom" runTest={runTest as never} />,
    );

    fireEvent.click(testButton());
    await screen.findByTestId("video-call-test-failed");

    fireEvent.click(testButton());
    await screen.findByTestId("video-call-test-passed");

    expect(screen.queryByTestId("video-call-test-failed")).toBeNull();
    expect(runTest).toHaveBeenCalledTimes(2);
  });

  test("runs once, as soon as it opens, when the table's Test asks it to", async () => {
    const runTest: MockFunction =
      getJestMockFunction().mockResolvedValue(ZOOM_MEETING);

    const { rerender } = render(
      <VideoCallTestPanel
        providerTitle="Zoom"
        runTest={runTest as never}
        startImmediately={true}
      />,
    );

    await screen.findByTestId("video-call-test-passed");

    rerender(
      <VideoCallTestPanel
        providerTitle="Zoom"
        runTest={runTest as never}
        startImmediately={true}
      />,
    );

    expect(runTest).toHaveBeenCalledTimes(1);
  });
});
