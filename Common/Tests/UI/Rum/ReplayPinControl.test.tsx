import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Pin / Unpin on the player header.
 *
 * player-shell-14: the previous control swallowed create and delete
 * failures (a 403 or a plan limit showed a spinner and then the same "Pin
 * recording" button), disappeared for the whole visit on any initial load
 * failure, and unpinned on one click. Every one of those is pinned in the
 * other direction here, along with the worker's semantics the copy has to
 * reflect (a pin on a still-recording session waits for finalization; a pin
 * with nothing to protect is deleted by the worker; an unpin's copies go
 * within an hour).
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>) => {
        return createMock(...args);
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

/* Imported after the mock is registered so the component sees it. */
import ReplayPinControl, {
  PENDING_POLL_INTERVAL_MS,
  PIN_PENDING_COPY,
  PIN_REMOVED_COPY,
  PIN_UNPINNED_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayPinControl";

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");
const PIN_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

interface PinRow {
  id: ObjectID;
  materializedAt?: Date | undefined;
  expiresAt?: Date | undefined;
}

function pinRow(overrides?: Partial<PinRow>): PinRow {
  return { id: new ObjectID(PIN_ID), ...overrides };
}

function listResult(rows: Array<PinRow>): {
  data: Array<PinRow>;
  count: number;
} {
  return { data: rows, count: rows.length };
}

function httpError(statusCode: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, { message: message }, {});
}

function renderControl(): ReturnType<typeof render> {
  return render(
    <ReplayPinControl rumApplicationId={APP_ID} sessionId={SESSION_ID} />,
  );
}

beforeEach(() => {
  getListMock.mockReset();
  createMock.mockReset();
  deleteItemMock.mockReset();
});

describe("ReplayPinControl initial load", () => {
  it("offers 'Pin recording' when nothing is pinned", async () => {
    getListMock.mockResolvedValue(listResult([]));

    renderControl();

    expect(await screen.findByTestId("replay-pin-button")).toHaveTextContent(
      "Pin recording",
    );
    expect(screen.queryByTestId("replay-pin-status")).not.toBeInTheDocument();
  });

  it("hides the control only for a permission denial", async () => {
    getListMock.mockRejectedValue(httpError(403, "Forbidden"));

    const { container } = renderControl();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the control with the cause and a Retry on any other load failure", async () => {
    getListMock
      .mockRejectedValueOnce(httpError(500, "Database is unavailable"))
      .mockResolvedValueOnce(listResult([]));

    renderControl();

    expect(await screen.findByTestId("replay-pin-error")).toHaveTextContent(
      "Database is unavailable",
    );

    fireEvent.click(screen.getByTestId("replay-pin-retry"));

    expect(await screen.findByTestId("replay-pin-button")).toHaveTextContent(
      "Pin recording",
    );
    expect(screen.queryByTestId("replay-pin-error")).not.toBeInTheDocument();
  });

  it("says a pending pin protects nothing until the recording ends", async () => {
    getListMock.mockResolvedValue(listResult([pinRow()]));

    renderControl();

    expect(await screen.findByTestId("replay-pin-status")).toHaveTextContent(
      PIN_PENDING_COPY,
    );
    expect(PIN_PENDING_COPY).toContain("when the recording ends");
    expect(PIN_PENDING_COPY).toContain("10 minutes");
  });

  it("shows a materialized pin as protected, with its lapse date", async () => {
    getListMock.mockResolvedValue(
      listResult([
        pinRow({
          materializedAt: new Date("2026-09-01T10:00:00Z"),
          expiresAt: new Date("2028-09-01T10:00:00Z"),
        }),
      ]),
    );

    renderControl();

    const status: HTMLElement = await screen.findByTestId("replay-pin-status");

    expect(status).toHaveTextContent("Pinned");
    expect(status.getAttribute("title")).toContain("pinned retention until");
  });
});

describe("ReplayPinControl pin", () => {
  it("creates the pin and reloads into the pending state", async () => {
    getListMock
      .mockResolvedValueOnce(listResult([]))
      .mockResolvedValueOnce(listResult([pinRow()]));
    createMock.mockResolvedValue({});

    renderControl();

    fireEvent.click(await screen.findByTestId("replay-pin-button"));

    expect(await screen.findByTestId("replay-pin-status")).toHaveTextContent(
      PIN_PENDING_COPY,
    );
    expect(createMock).toHaveBeenCalledTimes(1);

    const created: { model: { sessionId?: string } } = createMock.mock
      .calls[0]![0] as { model: { sessionId?: string } };

    expect(created.model.sessionId).toBe(SESSION_ID);
  });

  it("surfaces a create failure with the server's message and offers a retry", async () => {
    getListMock.mockResolvedValue(listResult([]));
    createMock.mockRejectedValueOnce(
      httpError(402, "Pinned recordings are not included in your plan"),
    );

    renderControl();

    fireEvent.click(await screen.findByTestId("replay-pin-button"));

    expect(await screen.findByTestId("replay-pin-error")).toHaveTextContent(
      "Pinned recordings are not included in your plan",
    );
    expect(screen.getByTestId("replay-pin-button")).toHaveTextContent(
      "Retry pin",
    );

    /* The retry runs the create again and clears the error on success. */
    createMock.mockResolvedValueOnce({});
    getListMock.mockResolvedValue(listResult([pinRow()]));

    fireEvent.click(screen.getByTestId("replay-pin-button"));

    expect(await screen.findByTestId("replay-pin-status")).toHaveTextContent(
      PIN_PENDING_COPY,
    );
    expect(screen.queryByTestId("replay-pin-error")).not.toBeInTheDocument();
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe("ReplayPinControl unpin", () => {
  const protectedRow: PinRow = pinRow({
    materializedAt: new Date("2026-09-01T10:00:00Z"),
  });

  it("asks for confirmation before deleting, and says what happens to the copies", async () => {
    getListMock.mockResolvedValue(listResult([protectedRow]));

    renderControl();

    fireEvent.click(await screen.findByTestId("replay-unpin-button"));

    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Unpin this recording?",
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "removed within an hour",
    );
  });

  it("cancelling the confirmation deletes nothing", async () => {
    getListMock.mockResolvedValue(listResult([protectedRow]));

    renderControl();

    fireEvent.click(await screen.findByTestId("replay-unpin-button"));
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal-title")).not.toBeInTheDocument();
    });

    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("replay-pin-status")).toHaveTextContent("Pinned");
  });

  it("confirming deletes the pin and tells the viewer the copy goes within an hour", async () => {
    getListMock
      .mockResolvedValueOnce(listResult([protectedRow]))
      .mockResolvedValueOnce(listResult([]));
    deleteItemMock.mockResolvedValue(undefined);

    renderControl();

    fireEvent.click(await screen.findByTestId("replay-unpin-button"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    /*
     * The status element exists before and after the unpin (it flips from
     * "Pinned" to the unpinned copy), so wait on the content, not the node.
     */
    await waitFor(() => {
      expect(screen.getByTestId("replay-pin-status")).toHaveTextContent(
        PIN_UNPINNED_COPY,
      );
    });
    expect(PIN_UNPINNED_COPY).toContain("within an hour");
    expect(deleteItemMock).toHaveBeenCalledTimes(1);

    const deleted: { id: ObjectID } = deleteItemMock.mock.calls[0]![0] as {
      id: ObjectID;
    };

    expect(deleted.id.toString()).toBe(PIN_ID);
    /* The viewer can pin again from here. */
    expect(screen.getByTestId("replay-pin-button")).toHaveTextContent(
      "Pin recording",
    );
  });

  it("surfaces a delete failure inside the confirmation and keeps the pin", async () => {
    getListMock.mockResolvedValue(listResult([protectedRow]));
    deleteItemMock.mockRejectedValueOnce(
      httpError(500, "Could not reach the database"),
    );

    renderControl();

    fireEvent.click(await screen.findByTestId("replay-unpin-button"));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.getByTestId("modal")).toHaveTextContent(
        "Could not reach the database",
      );
    });

    /* Still pinned, still confirmable. */
    expect(screen.getByTestId("replay-pin-status")).toHaveTextContent("Pinned");
    expect(screen.getByTestId("modal-title")).toBeInTheDocument();
  });
});

describe("ReplayPinControl pending poll", () => {
  it("polls a pending pin and, when the worker has removed it, says so instead of reverting silently", async () => {
    jest.useFakeTimers();

    try {
      getListMock
        .mockResolvedValueOnce(listResult([pinRow()]))
        .mockResolvedValueOnce(listResult([]));

      renderControl();

      expect(await screen.findByTestId("replay-pin-status")).toHaveTextContent(
        PIN_PENDING_COPY,
      );

      await act(async () => {
        jest.advanceTimersByTime(PENDING_POLL_INTERVAL_MS + 10);
      });

      await waitFor(() => {
        expect(screen.getByTestId("replay-pin-status")).toHaveTextContent(
          PIN_REMOVED_COPY,
        );
      });
      expect(PIN_REMOVED_COPY).toContain("already expired");
      expect(getListMock).toHaveBeenCalledTimes(2);
      /* Pinning again is offered, but never as a silent "Pin recording". */
      expect(screen.getByTestId("replay-pin-button")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("promotes a pending pin to protected once the materializer stamps it", async () => {
    jest.useFakeTimers();

    try {
      getListMock
        .mockResolvedValueOnce(listResult([pinRow()]))
        .mockResolvedValueOnce(
          listResult([pinRow({ materializedAt: new Date() })]),
        );

      renderControl();

      expect(await screen.findByTestId("replay-pin-status")).toHaveTextContent(
        PIN_PENDING_COPY,
      );

      await act(async () => {
        jest.advanceTimersByTime(PENDING_POLL_INTERVAL_MS + 10);
      });

      await waitFor(() => {
        expect(screen.getByTestId("replay-pin-status")).toHaveTextContent(
          "Pinned",
        );
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the pending state through a transient poll failure", async () => {
    jest.useFakeTimers();

    try {
      getListMock
        .mockResolvedValueOnce(listResult([pinRow()]))
        .mockRejectedValueOnce(httpError(502, "Bad gateway"));

      renderControl();

      expect(await screen.findByTestId("replay-pin-status")).toHaveTextContent(
        PIN_PENDING_COPY,
      );

      await act(async () => {
        jest.advanceTimersByTime(PENDING_POLL_INTERVAL_MS + 10);
      });

      await waitFor(() => {
        expect(getListMock).toHaveBeenCalledTimes(2);
      });

      expect(screen.getByTestId("replay-pin-status")).toHaveTextContent(
        PIN_PENDING_COPY,
      );
      expect(screen.queryByTestId("replay-pin-error")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
