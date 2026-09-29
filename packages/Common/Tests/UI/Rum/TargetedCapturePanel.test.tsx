import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Record this user's next session", pinned to one application.
 *
 * settings-setup-13: the reference is trimmed before it is sent (the server
 * HMACs it verbatim, the recorder compares verbatim) and a superseded
 * request's `finally` no longer re-enables the buttons under a newer one.
 * settings-setup-14: viewers without the edit permission see the reason,
 * not a form that fails after they type; Enter submits; the armed copy
 * says "page load that supplies this reference at load time".
 */

const postMock: MockFunction = getJestMockFunction();
const isMasterAdminMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminMock() as boolean;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
    },
  };
});

import TargetedCapturePanel, {
  normalizeUserRef,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/TargetedCapturePanel";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";

function pendingResponse(isPending: boolean): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, { isPending: isPending }, {});
}

beforeEach(() => {
  postMock.mockReset();
  isMasterAdminMock.mockReset();
  isMasterAdminMock.mockReturnValue(true);
});

describe("normalizeUserRef", () => {
  it("trims and NFC-normalises so the reference matches what the page will send", () => {
    expect(normalizeUserRef("  jane@example.com ")).toBe("jane@example.com");
    expect(normalizeUserRef("é")).toBe("é");
    expect(normalizeUserRef("   ")).toBe("");
  });
});

describe("TargetedCapturePanel", () => {
  it("without the edit permission shows the reason and no form", () => {
    isMasterAdminMock.mockReturnValue(false);

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    expect(
      screen.getByTestId("targeted-capture-no-permission"),
    ).toHaveTextContent("Edit RUM Application permission");
    expect(screen.queryByTestId("targeted-capture-user-ref")).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("sends the TRIMMED reference for the pinned application and shows the load-time armed copy", async () => {
    postMock.mockResolvedValue(pendingResponse(true));

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "jane@example.com " },
    });
    fireEvent.click(screen.getByTestId("targeted-capture-arm"));

    const armed: HTMLElement = await screen.findByTestId(
      "targeted-capture-armed",
    );

    expect(postMock).toHaveBeenCalledTimes(1);
    expect((postMock.mock.calls[0]![0] as { data: JSONObject }).data).toEqual({
      rumApplicationId: APP_ID,
      userRef: "jane@example.com",
      action: "set",
    });
    expect(armed).toHaveTextContent(
      "The next page load that supplies this reference at load time will be recorded",
    );
    expect(armed).not.toHaveTextContent("identifies with this reference");
  });

  it("Enter in the reference field arms the target", async () => {
    postMock.mockResolvedValue(pendingResponse(true));

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "user-1" },
    });
    fireEvent.keyDown(screen.getByTestId("targeted-capture-user-ref"), {
      key: "Enter",
      code: "Enter",
    });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });

  it("a blank reference cannot be armed", () => {
    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "   " },
    });

    expect(screen.getByTestId("targeted-capture-arm")).toBeDisabled();
  });

  it("status and clear report the pending state honestly", async () => {
    postMock.mockResolvedValue(pendingResponse(false));

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "user-1" },
    });
    fireEvent.click(screen.getByTestId("targeted-capture-status"));

    await screen.findByTestId("targeted-capture-not-pending");

    expect(
      (postMock.mock.calls[0]![0] as { data: JSONObject }).data["action"],
    ).toBe("status");
  });

  it("a superseded request neither lands its result nor re-enables the buttons early (settings-setup-13)", async () => {
    let resolveFirst: (value: HTTPResponse<JSONObject>) => void = (): void => {
      /* replaced below */
    };
    let resolveSecond: (value: HTTPResponse<JSONObject>) => void = (): void => {
      /* replaced below */
    };

    postMock
      .mockImplementationOnce((): Promise<HTTPResponse<JSONObject>> => {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (value: HTTPResponse<JSONObject>) => void): void => {
            resolveFirst = resolve;
          },
        );
      })
      .mockImplementationOnce((): Promise<HTTPResponse<JSONObject>> => {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (value: HTTPResponse<JSONObject>) => void): void => {
            resolveSecond = resolve;
          },
        );
      });

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "user-1" },
    });
    fireEvent.click(screen.getByTestId("targeted-capture-arm"));

    /* Editing the reference supersedes the in-flight request. */
    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "user-2" },
    });
    fireEvent.click(screen.getByTestId("targeted-capture-arm"));

    expect(postMock).toHaveBeenCalledTimes(2);

    resolveFirst(pendingResponse(true));

    /* The first response must not print "armed" for user-2, nor free the buttons. */
    await waitFor(() => {
      expect(screen.getByTestId("targeted-capture-arm")).toBeDisabled();
    });
    expect(screen.queryByTestId("targeted-capture-armed")).toBeNull();

    resolveSecond(pendingResponse(true));

    const armed: HTMLElement = await screen.findByTestId(
      "targeted-capture-armed",
    );

    expect(armed).toHaveTextContent("user-2");
    expect(screen.getByTestId("targeted-capture-arm")).not.toBeDisabled();
  });

  it("a server refusal is shown as its message", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not authorized" }, {}),
    );

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "user-1" },
    });
    fireEvent.click(screen.getByTestId("targeted-capture-arm"));

    expect(
      await screen.findByTestId("targeted-capture-error"),
    ).toHaveTextContent("Not authorized");
  });
});
