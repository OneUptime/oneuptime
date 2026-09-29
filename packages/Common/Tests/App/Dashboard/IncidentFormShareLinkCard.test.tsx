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
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * An incident form's Share Link card (issue #4114): the link anyone can open
 * to report an incident, copying it, opening it, and Reset Link.
 *
 * Only the network, the permission gate, the clipboard and the translation
 * lookup are stubbed: the card, ResetObjectID behind it and their dialogs are
 * the real ones, so a reset is made the way a person makes it - press Reset
 * Link, read the confirmation, confirm, close the result.
 */

let mockTranslate: (value: string) => string = (value: string): string => {
  return value;
};

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return typeof value === "string" && value
            ? mockTranslate(value)
            : value;
        },
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" && value
            ? mockTranslate(value)
            : value;
        },
      };
    },
  };
});

/*
 * A refused request is an async function that throws, not
 * mockRejectedValue: the card's imports load zone.js, whose patched Promise
 * reports a rejected one as unhandled although the card catches it.
 */
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import IncidentFormShareLinkCard from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormShareLinkCard";
import IncidentFormCopy from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormCopy";
import {
  getIncidentFormShareLink,
  INCIDENT_FORM_PUBLIC_ROUTE_SEGMENT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentForm/IncidentFormShareLink";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import ObjectID from "../../../Types/ObjectID";
import { ACCOUNTS_URL } from "../../../UI/Config";
import Clipboard from "../../../UI/Utils/Clipboard";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

const FORM_ID: string = "f0f0f0f0-0000-4000-8000-0000000000ff";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NEW_SHARE_KEY: string = "0b1d3c5e-7f90-4a1b-8c2d-3e4f5a6b7c8d";

// The link the card must show for a key: Accounts, then the form's route.
function expectedLink(shareKey: string): string {
  return `${ACCOUNTS_URL.toString()}/incident-form/${shareKey}`;
}

interface StoredForm {
  shareKey?: string | undefined;
  isEnabled?: boolean | undefined;
}

let storedForm: StoredForm | null | Error = null;
let gate: PermissionGateResult = { isAllowed: true };
let copyToClipboardSpy: SpyInstance;
let permissionCheckSpy: SpyInstance;

beforeEach(() => {
  mockTranslate = (value: string): string => {
    return value;
  };
  storedForm = { shareKey: SHARE_KEY, isEnabled: true };
  gate = { isAllowed: true };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (storedForm instanceof Error) {
      throw storedForm;
    }

    if (!storedForm) {
      return null;
    }

    const form: IncidentForm = new IncidentForm();
    form._id = FORM_ID;

    if (storedForm.shareKey) {
      form.shareKey = new ObjectID(storedForm.shareKey);
    }

    if (storedForm.isEnabled !== undefined) {
      form.isEnabled = storedForm.isEnabled;
    }

    return form;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);

  permissionCheckSpy = getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return gate;
    },
  );

  jest.spyOn(ObjectID, "generate").mockImplementation((): ObjectID => {
    return new ObjectID(NEW_SHARE_KEY);
  });

  copyToClipboardSpy = getJestSpyOn(
    Clipboard,
    "copyToClipboard",
  ).mockImplementation(async (): Promise<boolean> => {
    return true;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(refresher: boolean = false): Promise<RenderResult> {
  let result: RenderResult | undefined;

  await act(async (): Promise<void> => {
    result = render(
      <MemoryRouter>
        <IncidentFormShareLinkCard
          modelId={new ObjectID(FORM_ID)}
          refresher={refresher}
        />
      </MemoryRouter>,
    );
  });

  return result!;
}

async function renderLoadedCard(): Promise<RenderResult> {
  const result: RenderResult = await renderCard();

  await waitFor(() => {
    expect(screen.getByTestId("incident-form-share-link")).toBeInTheDocument();
  });

  return result;
}

function shownLink(): string {
  return screen.getByTestId("incident-form-share-link").textContent || "";
}

function cardButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId("card-button");
}

function resetLinkButton(): HTMLElement {
  const button: HTMLElement | undefined = cardButtons().find(
    (candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes("Reset Link");
    },
  );

  expect(button).toBeDefined();
  return button!;
}

function openFormLink(): HTMLAnchorElement {
  return screen.getByText("Open Form").closest("a") as HTMLAnchorElement;
}

describe("the link", () => {
  test("reads the form's share key and Enabled, and nothing else", async () => {
    await renderLoadedCard();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };

    expect(request.modelType).toBe(IncidentForm);
    expect(request.id.toString()).toBe(FORM_ID);
    expect(request.select).toEqual({ shareKey: true, isEnabled: true });
  });

  test("is the Accounts app's incident-form route with the form's share key", async () => {
    await renderLoadedCard();

    expect(shownLink()).toBe(expectedLink(SHARE_KEY));
    expect(INCIDENT_FORM_PUBLIC_ROUTE_SEGMENT).toBe("incident-form");
    expect(getIncidentFormShareLink(SHARE_KEY).toString()).toBe(
      expectedLink(SHARE_KEY),
    );
  });

  test("never carries the form's own id", async () => {
    await renderLoadedCard();

    expect(shownLink()).not.toContain(FORM_ID);
  });

  test("building a link leaves the shared Accounts URL alone", () => {
    const before: string = ACCOUNTS_URL.toString();

    getIncidentFormShareLink(SHARE_KEY);
    getIncidentFormShareLink(new ObjectID(NEW_SHARE_KEY));

    expect(ACCOUNTS_URL.toString()).toBe(before);
    expect(
      getIncidentFormShareLink(new ObjectID(NEW_SHARE_KEY)).toString(),
    ).toBe(expectedLink(NEW_SHARE_KEY));
  });

  test("Copy Link copies the whole link and says so", async () => {
    await renderLoadedCard();

    const copyButton: HTMLElement = screen.getByRole("button", {
      name: "Copy Link",
    });

    expect(copyButton).toHaveTextContent("Copy Link");

    await act(async (): Promise<void> => {
      fireEvent.click(copyButton);
    });

    expect(copyToClipboardSpy).toHaveBeenCalledWith(expectedLink(SHARE_KEY));

    await waitFor(() => {
      expect(copyButton).toHaveTextContent("Copied!");
    });
  });

  test("Open Form opens the link in a new tab", async () => {
    await renderLoadedCard();

    const link: HTMLAnchorElement = openFormLink();

    expect(link.getAttribute("href")).toBe(expectedLink(SHARE_KEY));
    expect(link.getAttribute("target")).toBe("_blank");
  });

  test("the card is titled Share Link and explains who can use the link", async () => {
    await renderLoadedCard();

    expect(screen.getByTestId("card-details-heading")).toHaveTextContent(
      "Share Link",
    );
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      IncidentFormCopy.shareLinkDescription,
    );
  });
});

describe("a form that is turned off", () => {
  test("says nothing while the form is on", async () => {
    await renderLoadedCard();

    expect(
      screen.queryByTestId("incident-form-share-link-turned-off"),
    ).not.toBeInTheDocument();
  });

  test("says its link shows a 'not available' message", async () => {
    storedForm = { shareKey: SHARE_KEY, isEnabled: false };

    await renderLoadedCard();

    expect(
      screen.getByTestId("incident-form-share-link-turned-off"),
    ).toHaveTextContent(
      "This form is turned off, so its link shows a 'not available' message.",
    );
    // The link is still there to copy, for when it is turned back on.
    expect(shownLink()).toBe(expectedLink(SHARE_KEY));
  });

  test("a form whose Enabled was not read counts as on, the column's default", async () => {
    storedForm = { shareKey: SHARE_KEY };

    await renderLoadedCard();

    expect(
      screen.queryByTestId("incident-form-share-link-turned-off"),
    ).not.toBeInTheDocument();
  });

  test("the card reads the form again when the page asks, and shows the change", async () => {
    const result: RenderResult = await renderLoadedCard();

    storedForm = { shareKey: SHARE_KEY, isEnabled: false };

    await act(async (): Promise<void> => {
      result.rerender(
        <MemoryRouter>
          <IncidentFormShareLinkCard
            modelId={new ObjectID(FORM_ID)}
            refresher={true}
          />
        </MemoryRouter>,
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("incident-form-share-link-turned-off"),
      ).toBeInTheDocument();
    });

    expect(getItemMock).toHaveBeenCalledTimes(2);
  });

  test("the same refresher value does not read the form again", async () => {
    const result: RenderResult = await renderLoadedCard();

    await act(async (): Promise<void> => {
      result.rerender(
        <MemoryRouter>
          <IncidentFormShareLinkCard
            modelId={new ObjectID(FORM_ID)}
            refresher={false}
          />
        </MemoryRouter>,
      );
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("reading the form again", () => {
  /*
   * Each read waits until the test answers it, in any order, with the form
   * as it is at that moment (storedForm), or with "not found".
   */
  type Answer = (form: StoredForm | null) => void;

  const pendingAnswers: Array<Answer> = [];

  function answerReadsByHand(): void {
    pendingAnswers.length = 0;

    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void) => {
        pendingAnswers.push((form: StoredForm | null): void => {
          if (!form) {
            resolve(null);
            return;
          }

          const model: IncidentForm = new IncidentForm();
          model._id = FORM_ID;

          if (form.shareKey) {
            model.shareKey = new ObjectID(form.shareKey);
          }

          if (form.isEnabled !== undefined) {
            model.isEnabled = form.isEnabled;
          }

          resolve(model);
        });
      });
    });
  }

  async function answer(index: number, form: StoredForm | null): Promise<void> {
    await act(async (): Promise<void> => {
      pendingAnswers[index]!(form);
    });
  }

  function rerenderWith(
    result: RenderResult,
    modelId: string,
    refresher: boolean,
  ): Promise<void> {
    return act(async (): Promise<void> => {
      result.rerender(
        <MemoryRouter>
          <IncidentFormShareLinkCard
            modelId={new ObjectID(modelId)}
            refresher={refresher}
          />
        </MemoryRouter>,
      );
    });
  }

  test("keeps the link on screen meanwhile, with no loader and no blink", async () => {
    answerReadsByHand();

    const result: RenderResult = await renderCard();

    await answer(0, { shareKey: SHARE_KEY, isEnabled: true });

    expect(shownLink()).toBe(expectedLink(SHARE_KEY));

    await rerenderWith(result, FORM_ID, true);

    expect(pendingAnswers).toHaveLength(2);
    // The second read has not been answered yet.
    expect(shownLink()).toBe(expectedLink(SHARE_KEY));
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
    expect(cardButtons()).toHaveLength(1);

    await answer(1, { shareKey: SHARE_KEY, isEnabled: false });

    expect(
      screen.getByTestId("incident-form-share-link-turned-off"),
    ).toBeInTheDocument();
  });

  test("shows the latest read, even when an earlier one answers last", async () => {
    answerReadsByHand();

    const result: RenderResult = await renderCard();

    await answer(0, { shareKey: SHARE_KEY, isEnabled: true });
    await rerenderWith(result, FORM_ID, true);
    await rerenderWith(result, FORM_ID, false);

    expect(pendingAnswers).toHaveLength(3);

    // The newest read: the form was turned off.
    await answer(2, { shareKey: SHARE_KEY, isEnabled: false });
    // A slower, older read that still saw it on.
    await answer(1, { shareKey: SHARE_KEY, isEnabled: true });

    expect(
      screen.getByTestId("incident-form-share-link-turned-off"),
    ).toBeInTheDocument();
  });

  test("a read again that finds no form says so, and the old link goes", async () => {
    answerReadsByHand();

    const result: RenderResult = await renderCard();

    await answer(0, { shareKey: SHARE_KEY, isEnabled: true });
    await rerenderWith(result, FORM_ID, true);
    await answer(1, null);

    expect(
      screen.queryByTestId("incident-form-share-link"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(IncidentFormCopy.shareLinkNotFound),
    ).toBeInTheDocument();
    expect(cardButtons()).toHaveLength(0);
  });

  test("another form's page never shows this form's link while its own loads", async () => {
    const OTHER_FORM_ID: string = "0e0e0e0e-0000-4000-8000-0000000000ee";
    const OTHER_SHARE_KEY: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

    answerReadsByHand();

    const result: RenderResult = await renderCard();

    await answer(0, { shareKey: SHARE_KEY, isEnabled: true });
    await rerenderWith(result, OTHER_FORM_ID, false);

    expect(
      screen.queryByTestId("incident-form-share-link"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(cardButtons()).toHaveLength(0);

    const request: { id: ObjectID } = getItemMock.mock.calls[1]![0] as {
      id: ObjectID;
    };

    expect(request.id.toString()).toBe(OTHER_FORM_ID);

    await answer(1, { shareKey: OTHER_SHARE_KEY, isEnabled: true });

    expect(shownLink()).toBe(expectedLink(OTHER_SHARE_KEY));
  });
});

describe("Reset Link", () => {
  test("is the card's button", async () => {
    await renderLoadedCard();

    expect(cardButtons()).toHaveLength(1);
    expect(resetLinkButton()).not.toBeDisabled();
  });

  test("asks first, saying the current link stops working", async () => {
    await renderLoadedCard();

    await act(async (): Promise<void> => {
      fireEvent.click(resetLinkButton());
    });

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Reset Link");
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      IncidentFormCopy.resetLinkConfirmation,
    );
    expect(IncidentFormCopy.resetLinkConfirmation).toContain(
      "the current one stops working at once",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Reset Link",
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("cancelling changes nothing", async () => {
    await renderLoadedCard();

    await act(async (): Promise<void> => {
      fireEvent.click(resetLinkButton());
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    });

    expect(screen.queryByTestId("modal-title")).not.toBeInTheDocument();
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(shownLink()).toBe(expectedLink(SHARE_KEY));
  });

  test("writes a fresh key to the form's shareKey, then shows the new link", async () => {
    await renderLoadedCard();

    await act(async (): Promise<void> => {
      fireEvent.click(resetLinkButton());
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateByIdMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(request.modelType).toBe(IncidentForm);
    expect(request.id.toString()).toBe(FORM_ID);
    // Only the key: nothing else about the form changes.
    expect(request.data).toEqual({ shareKey: NEW_SHARE_KEY });
    expect(ObjectID.isValidUUID(String(request.data["shareKey"]))).toBe(true);

    // What happened, in words about the link rather than about a column.
    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent("New Link");
    });
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      IncidentFormCopy.newLinkDescription,
    );

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    expect(screen.queryByTestId("modal-title")).not.toBeInTheDocument();
    expect(shownLink()).toBe(expectedLink(NEW_SHARE_KEY));
    expect(openFormLink().getAttribute("href")).toBe(
      expectedLink(NEW_SHARE_KEY),
    );

    // The new link, not the old one, is what Copy Link copies now.
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Link" }));
    });

    expect(copyToClipboardSpy).toHaveBeenLastCalledWith(
      expectedLink(NEW_SHARE_KEY),
    );
    // The form was not read again: the card shows the key it sent.
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });

  test("a refused reset keeps the old link and says why", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to update this form.");
    });

    await renderLoadedCard();

    await act(async (): Promise<void> => {
      fireEvent.click(resetLinkButton());
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    /*
     * ResetObjectID shows the reason over the confirmation, which stays open
     * underneath so the reset can be tried again or cancelled.
     */
    await waitFor(() => {
      expect(screen.getAllByTestId("modal-title")).toHaveLength(2);
    });

    const titles: Array<string> = screen
      .getAllByTestId("modal-title")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    expect(titles).toEqual(["Reset Link", "Reset Error"]);
    expect(
      screen.getAllByTestId("confirm-modal-description")[1],
    ).toHaveTextContent("You do not have permission to update this form.");

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getAllByTestId("modal-footer-submit-button")[1]!);
    });

    expect(screen.getAllByTestId("modal-title")).toHaveLength(1);

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    });

    expect(screen.queryByTestId("modal-title")).not.toBeInTheDocument();
    expect(shownLink()).toBe(expectedLink(SHARE_KEY));
    // Nothing was shown as a new link.
    expect(screen.queryByText(IncidentFormCopy.newLinkDescription)).toBeNull();
  });

  test("a viewer who may not update the form can still copy and open the link, but Reset Link is locked and says why", async () => {
    gate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Incident Form.",
    };

    await renderLoadedCard();

    const button: HTMLElement = resetLinkButton();

    expect(button).toBeDisabled();

    fireEvent.mouseEnter(button.parentElement as HTMLElement);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "You do not have permission to update this Incident Form.",
    );

    fireEvent.click(button);

    expect(screen.queryByTestId("modal-title")).not.toBeInTheDocument();

    // Reading a form is enough to share it.
    expect(shownLink()).toBe(expectedLink(SHARE_KEY));
    expect(
      screen.getByRole("button", { name: "Copy Link" }),
    ).not.toBeDisabled();
    expect(openFormLink().getAttribute("href")).toBe(expectedLink(SHARE_KEY));
  });

  test("the gate is asked about updating an incident form", async () => {
    await renderLoadedCard();

    expect(
      permissionCheckSpy.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          call[0] instanceof IncidentForm && call[1] === ModelAction.Update
        );
      }),
    ).toBe(true);
  });
});

describe("before there is a link", () => {
  test("while loading: a loader, and no link or button", async () => {
    let finishLoading: (value: unknown) => void = (): void => {};

    getItemMock.mockImplementation((): Promise<unknown> => {
      return new Promise((resolve: (value: unknown) => void) => {
        finishLoading = resolve;
      });
    });

    await renderCard();

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(
      screen.queryByTestId("incident-form-share-link"),
    ).not.toBeInTheDocument();
    expect(cardButtons()).toHaveLength(0);
    expect(screen.getByTestId("card-details-heading")).toHaveTextContent(
      "Share Link",
    );

    await act(async (): Promise<void> => {
      finishLoading(null);
    });
  });

  test("a load that failed says why, with no button", async () => {
    storedForm = new Error("Incident forms are not on your plan.");

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("Incident forms are not on your plan."),
      ).toBeInTheDocument();
    });

    expect(cardButtons()).toHaveLength(0);
    expect(
      screen.queryByTestId("incident-form-share-link"),
    ).not.toBeInTheDocument();
  });

  test("a form that cannot be found says so, with no button", async () => {
    storedForm = null;

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText(
          "This form's link could not be loaded. The form may have been deleted.",
        ),
      ).toBeInTheDocument();
    });

    expect(cardButtons()).toHaveLength(0);
  });

  test("a form read without its key is treated the same way", async () => {
    storedForm = { isEnabled: true };

    await renderCard();

    await waitFor(() => {
      expect(
        screen.getByText(IncidentFormCopy.shareLinkNotFound),
      ).toBeInTheDocument();
    });

    expect(cardButtons()).toHaveLength(0);
  });
});

describe("translation", () => {
  test("everything the card draws itself goes through the lookup", async () => {
    mockTranslate = (value: string): string => {
      return `[de] ${value}`;
    };
    storedForm = { shareKey: SHARE_KEY, isEnabled: false };

    await renderLoadedCard();

    expect(screen.getByTestId("card-details-heading")).toHaveTextContent(
      "[de] Share Link",
    );
    expect(
      screen.getByRole("button", { name: "[de] Copy Link" }),
    ).toHaveTextContent("[de] Copy Link");
    expect(screen.getByText("[de] Open Form")).toBeInTheDocument();
    expect(
      screen.getByTestId("incident-form-share-link-turned-off"),
    ).toHaveTextContent(`[de] ${IncidentFormCopy.formTurnedOff}`);
    expect(resetLinkButton()).toHaveTextContent("[de] Reset Link");

    // The link itself is never translated.
    expect(shownLink()).toBe(expectedLink(SHARE_KEY));

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "[de] Copy Link" }));
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "[de] Copy Link" }),
      ).toHaveTextContent("[de] Copied!");
    });
  });
});
