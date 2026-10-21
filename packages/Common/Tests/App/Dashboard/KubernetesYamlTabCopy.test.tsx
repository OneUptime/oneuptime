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
} from "@testing-library/react";
import * as React from "react";

/*
 * A Kubernetes resource's YAML tab: Copy in its card header. It called
 * navigator.clipboard.writeText without awaiting it and said "Copied!" at
 * once - so a refused write still said Copied!, and on a page served over
 * plain http, where the browser has no clipboard API, the click threw
 * (issue #5132). It copies through the shared helper now and says Copied!
 * only once the YAML is on the clipboard, Copy failed when it is not.
 */

type FetchRaw = () => Promise<Record<string, unknown> | null>;

const fetchRawMock: ReturnType<typeof jest.fn<FetchRaw>> = jest.fn<FetchRaw>();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      fetchRawK8sObject: (): Promise<Record<string, unknown> | null> => {
        return fetchRawMock();
      },
    };
  },
);

import KubernetesYamlTab from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesYamlTab";

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

const originalExecCommand: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(document, "execCommand");

function installClipboard(writeText: WriteTextMock | undefined): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
}

function installExecCommand(
  execCommand: ((command: string) => boolean) | undefined,
): void {
  Object.defineProperty(document, "execCommand", {
    value: execCommand,
    configurable: true,
    writable: true,
  });
}

async function renderTab(): Promise<void> {
  await act(async () => {
    render(
      <KubernetesYamlTab
        clusterIdentifier="prod-eu"
        resourceType="Deployment"
        resourceName="api"
        namespace="default"
      />,
    );
  });
}

function copyButton(): HTMLElement {
  return screen.getByRole("button", { name: /Cop/ });
}

async function pressCopy(): Promise<void> {
  await act(async () => {
    fireEvent.click(copyButton());
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  installExecCommand(undefined);
  fetchRawMock.mockResolvedValue({
    kind: "Deployment",
    metadata: { name: "api", namespace: "default" },
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  installClipboard(undefined);
  fetchRawMock.mockReset();

  if (originalExecCommand) {
    Object.defineProperty(document, "execCommand", originalExecCommand);
  } else {
    installExecCommand(undefined);
  }
});

describe("Kubernetes YAML tab - Copy", () => {
  test("copies the YAML and only then says Copied!, for two seconds", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    installClipboard(writeText);
    await renderTab();

    expect(copyButton()).toHaveTextContent("Copy");

    await pressCopy();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain("kind: Deployment");
    expect(writeText.mock.calls[0]![0]).toContain("name: api");
    expect(copyButton()).toHaveTextContent("Copied!");

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(copyButton()).not.toHaveTextContent("Copied!");
  });

  test("the bug: a refused write never says Copied!", async () => {
    installClipboard(
      jest.fn<(text: string) => Promise<void>>(async (): Promise<void> => {
        throw new DOMException("Clipboard denied", "NotAllowedError");
      }),
    );
    await renderTab();

    await pressCopy();

    expect(copyButton()).not.toHaveTextContent("Copied!");
    expect(copyButton()).toHaveTextContent("Copy failed");
  });

  test("the bug: with no clipboard API the click no longer throws", async () => {
    installClipboard(undefined);

    const errors: Array<unknown> = [];
    const onError: (event: ErrorEvent) => void = (event: ErrorEvent): void => {
      errors.push(event.error);
    };
    window.addEventListener("error", onError);

    await renderTab();
    await pressCopy();

    window.removeEventListener("error", onError);

    expect(errors).toEqual([]);
    expect(copyButton()).toHaveTextContent("Copy failed");
  });

  test("on a plain-http page it copies through the browser's copy command", async () => {
    installClipboard(undefined);
    let copied: string = "";
    installExecCommand((): boolean => {
      copied =
        (
          document.querySelector(
            "textarea[aria-hidden='true']",
          ) as HTMLTextAreaElement | null
        )?.value || "";
      return true;
    });
    await renderTab();

    await pressCopy();

    expect(copied).toContain("kind: Deployment");
    expect(copyButton()).toHaveTextContent("Copied!");
  });

  test("Copy failed goes back to Copy after four seconds", async () => {
    installClipboard(undefined);
    await renderTab();

    await pressCopy();

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });

    expect(copyButton()).toHaveTextContent("Copy");
    expect(copyButton()).not.toHaveTextContent("Copy failed");
  });
});
