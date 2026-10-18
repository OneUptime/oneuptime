import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";
import SessionReplayCaptureTrigger from "../../../Types/Rum/SessionReplayCaptureTrigger";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Edit Policy on an application's Replay Policy page, rendered for real.
 *
 * "Shouldnt this be two buttons ... to make it easier for people to
 * understand whats going on." (the maintainer, on a setting whose one
 * description explained both of its modes)
 *
 * When to upload a recording, Masking mode and Consent were dropdowns under
 * one description that named every mode. They are answers to pick now, each
 * with one line under it; Ignored error patterns is asked for only when it
 * can do something; the dialog is named after the policy it edits; and an
 * emptied number box saves the number its placeholder promised instead of
 * an empty string the columns refuse.
 */

const postMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

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
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (): Promise<{ data: Array<unknown>; count: number }> => {
        return Promise.resolve({ data: [], count: 0 });
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import RumApplicationSessionReplaySettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplaySettings";
import { clearSessionReplayHealthStore } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";

const WAIT_TIMEOUT: number = 20000;

const PROJECT_ID: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5c";
const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000002";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}/session-replay-settings`;

function makeApplication(overrides?: Partial<RumApplication>): RumApplication {
  const application: RumApplication = new RumApplication();

  application.id = new ObjectID(APP_ID);
  application.isSessionReplayEnabled = true;
  application.sessionReplayCaptureTrigger = SessionReplayCaptureTrigger.Always;
  application.sessionReplaySamplePercentage = 100;
  application.sessionReplayMaskingMode =
    SessionReplayMaskingMode.MaskSensitiveInputsOnly;
  application.sessionReplayConsentMode = SessionReplayConsentMode.NotRequired;
  application.sessionReplayCaptureUserIdentity = true;
  application.sessionReplayCaptureGeo = true;
  application.sessionReplayRecordCanvas = false;
  application.sessionReplayRetentionInDays = 7;
  application.sessionReplayLcpBudgetMs = 0;
  application.sessionReplayLongTaskBudgetMs = 0;
  application.sessionReplaySlowRequestBudgetMs = 0;

  Object.assign(application, overrides || {});

  return application;
}

let application: () => RumApplication = (): RumApplication => {
  return makeApplication();
};

function renderPage(): void {
  render(
    <MemoryRouter>
      <RumApplicationSessionReplaySettings
        pageRoute={new Route(PAGE_PATH)}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );
}

async function openEditPolicy(): Promise<HTMLElement> {
  const card: HTMLElement = await waitFor(
    (): HTMLElement => {
      const element: HTMLElement | null =
        document.getElementById("replay-policy");

      expect(element).not.toBeNull();
      expect(
        within(element as HTMLElement).getByText("Masking"),
      ).toBeInTheDocument();

      return element as HTMLElement;
    },
    { timeout: WAIT_TIMEOUT },
  );

  fireEvent.click(within(card).getByRole("button", { name: "Edit Policy" }));

  return await screen.findByTestId("modal", {}, { timeout: WAIT_TIMEOUT });
}

async function openStep(modal: HTMLElement, title: string): Promise<void> {
  const progress: HTMLElement = await within(modal).findByRole(
    "navigation",
    { name: "Progress" },
    { timeout: WAIT_TIMEOUT },
  );

  const step: HTMLElement | undefined = within(progress)
    .getAllByRole("listitem")
    .find((item: HTMLElement): boolean => {
      return (item.textContent || "").trim() === title;
    });

  expect(step).toBeDefined();
  fireEvent.click(step as HTMLElement);

  await waitFor(
    () => {
      expect(
        (
          progress.querySelector("[aria-current='step']")?.textContent || ""
        ).trim(),
      ).toBe(title);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

/* The answers of one question, in order, as the dialog draws them. */
function answersOf(group: HTMLElement): Array<string> {
  return within(group)
    .getAllByRole("radio")
    .map((radio: HTMLElement): string => {
      const label: HTMLElement | null = group.querySelector(
        `label[for="${radio.id}"]`,
      );

      return (label?.textContent || "").trim();
    });
}

async function findQuestion(
  modal: HTMLElement,
  title: string,
): Promise<HTMLElement> {
  return await within(modal).findByRole(
    "radiogroup",
    { name: new RegExp(`^${title}`) },
    { timeout: WAIT_TIMEOUT },
  );
}

/* The line under an answer: what its radio is described by. */
function lineOf(radio: HTMLElement): string {
  const id: string | null = radio.getAttribute("aria-describedby");

  expect(id).not.toBeNull();

  return (document.getElementById(id as string)?.textContent || "").trim();
}

function savedModel(): Record<string, unknown> {
  expect(createOrUpdateMock).toHaveBeenCalledTimes(1);

  const call: Array<unknown> = createOrUpdateMock.mock
    .calls[0] as Array<unknown>;

  return (call[0] as { model: Record<string, unknown> }).model;
}

async function saveFromLastStep(modal: HTMLElement): Promise<void> {
  await openStep(modal, "Limits");

  await act(async () => {
    fireEvent.click(within(modal).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(
    () => {
      expect(createOrUpdateMock).toHaveBeenCalled();
    },
    { timeout: WAIT_TIMEOUT },
  );
}

beforeEach(() => {
  postMock.mockReset();
  getItemMock.mockReset();
  createOrUpdateMock.mockReset();
  clearSessionReplayHealthStore();
  window.history.replaceState({}, "", PAGE_PATH);

  application = (): RumApplication => {
    return makeApplication();
  };

  postMock.mockImplementation((): Promise<HTTPResponse<JSONObject>> => {
    return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
  });

  getItemMock.mockImplementation((): Promise<RumApplication> => {
    return Promise.resolve(application());
  });

  createOrUpdateMock.mockImplementation(
    (): Promise<HTTPResponse<JSONObject>> => {
      return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
    },
  );
});

afterEach(() => {
  cleanup();
  clearSessionReplayHealthStore();
});

describe("Edit Session Replay Policy", () => {
  it("is named after the policy it edits, not the application", async () => {
    renderPage();
    const modal: HTMLElement = await openEditPolicy();

    expect(
      within(modal).getByText("Edit Session Replay Policy"),
    ).toBeInTheDocument();
    expect(within(modal).queryByText("Edit RUM Application")).toBeNull();
  });

  it("asks when to upload as two answers, each with its line, on the policy's answer", async () => {
    renderPage();
    const modal: HTMLElement = await openEditPolicy();
    const question: HTMLElement = await findQuestion(
      modal,
      "When to upload a recording",
    );

    expect(answersOf(question)).toEqual(["Always", "On error or frustration"]);

    const always: HTMLElement = within(question).getByRole("radio", {
      name: "Always",
    });
    const onError: HTMLElement = within(question).getByRole("radio", {
      name: "On error or frustration",
    });

    expect(always).toBeChecked();
    expect(onError).not.toBeChecked();
    expect(lineOf(always)).toBe(
      "Uploads every sampled session, whether or not anything goes wrong.",
    );
    expect(lineOf(onError)).toBe(
      "Uploads only sessions where something goes wrong, at a fraction of the cost.",
    );

    // No dropdown, and no sentence above the answers naming both modes.
    expect(within(modal).queryByRole("combobox")).toBeNull();
    expect(
      within(modal).queryByText(
        /Always uploads every sampled session\. On error or frustration/,
      ),
    ).toBeNull();
  });

  it("asks for ignored error patterns only when uploads wait for something to go wrong", async () => {
    renderPage();
    const modal: HTMLElement = await openEditPolicy();
    const question: HTMLElement = await findQuestion(
      modal,
      "When to upload a recording",
    );

    expect(within(modal).queryByText("Ignored error patterns")).toBeNull();

    fireEvent.click(
      within(question).getByRole("radio", { name: "On error or frustration" }),
    );

    expect(
      await within(modal).findByText(
        "Ignored error patterns",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(question).getByRole("radio", { name: "Always" }));

    await waitFor(
      () => {
        expect(within(modal).queryByText("Ignored error patterns")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  it("opens an application that uploads on error on that answer, with its patterns", async () => {
    application = (): RumApplication => {
      return makeApplication({
        sessionReplayCaptureTrigger:
          SessionReplayCaptureTrigger.OnErrorOrFrustration,
        sessionReplayIgnoreErrorPatterns: ["ResizeObserver loop"],
      });
    };

    renderPage();
    const modal: HTMLElement = await openEditPolicy();
    const question: HTMLElement = await findQuestion(
      modal,
      "When to upload a recording",
    );

    expect(
      within(question).getByRole("radio", { name: "On error or frustration" }),
    ).toBeChecked();
    expect(
      await within(modal).findByText(
        "Ignored error patterns",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
  });

  it("asks what to mask as three answers, least to most private, each with its line", async () => {
    application = (): RumApplication => {
      return makeApplication({
        sessionReplayMaskingMode: SessionReplayMaskingMode.MaskAllText,
      });
    };

    renderPage();
    const modal: HTMLElement = await openEditPolicy();
    await openStep(modal, "Masking");

    const question: HTMLElement = await findQuestion(modal, "Masking mode");

    expect(answersOf(question)).toEqual([
      "Mask sensitive inputs only",
      "Mask inputs only",
      "Mask all text",
    ]);
    expect(
      within(question).getByRole("radio", { name: "Mask all text" }),
    ).toBeChecked();
    expect(
      lineOf(
        within(question).getByRole("radio", {
          name: "Mask sensitive inputs only",
        }),
      ),
    ).toBe(
      "Hides passwords and card fields. Page text and other inputs are recorded.",
    );
    expect(
      lineOf(within(question).getByRole("radio", { name: "Mask all text" })),
    ).toBe("Hides all text. A replay shows the page's layout only.");

    // One short line above them: what to do about anything else sensitive.
    expect(
      within(modal).getByText(
        "For other sensitive data, pick a stricter mode or add selectors below.",
      ),
    ).toBeInTheDocument();
  });

  it("asks for consent as two answers, each with its line", async () => {
    renderPage();
    const modal: HTMLElement = await openEditPolicy();
    await openStep(modal, "Consent & Identity");

    const question: HTMLElement = await findQuestion(modal, "Consent");

    expect(answersOf(question)).toEqual(["Not required", "Require explicit"]);
    expect(
      within(question).getByRole("radio", { name: "Not required" }),
    ).toBeChecked();
    expect(
      lineOf(within(question).getByRole("radio", { name: "Require explicit" })),
    ).toBe("Nothing uploads until your page calls grantConsent().");
  });

  it("saves the answers picked as the values the columns always held", async () => {
    renderPage();
    const modal: HTMLElement = await openEditPolicy();

    fireEvent.click(
      within(await findQuestion(modal, "When to upload a recording")).getByRole(
        "radio",
        { name: "On error or frustration" },
      ),
    );

    await openStep(modal, "Masking");
    fireEvent.click(
      within(await findQuestion(modal, "Masking mode")).getByRole("radio", {
        name: "Mask inputs only",
      }),
    );

    await openStep(modal, "Consent & Identity");
    fireEvent.click(
      within(await findQuestion(modal, "Consent")).getByRole("radio", {
        name: "Require explicit",
      }),
    );

    await saveFromLastStep(modal);

    const model: Record<string, unknown> = savedModel();

    expect(model["sessionReplayCaptureTrigger"]).toBe(
      SessionReplayCaptureTrigger.OnErrorOrFrustration,
    );
    expect(model["sessionReplayMaskingMode"]).toBe(
      SessionReplayMaskingMode.MaskInputsOnly,
    );
    expect(model["sessionReplayConsentMode"]).toBe(
      SessionReplayConsentMode.RequireExplicit,
    );
  });

  it("saves an untouched policy with the values it opened with", async () => {
    renderPage();
    const modal: HTMLElement = await openEditPolicy();

    await saveFromLastStep(modal);

    const model: Record<string, unknown> = savedModel();

    expect(model["sessionReplayCaptureTrigger"]).toBe(
      SessionReplayCaptureTrigger.Always,
    );
    expect(model["sessionReplayMaskingMode"]).toBe(
      SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    );
    expect(model["sessionReplayConsentMode"]).toBe(
      SessionReplayConsentMode.NotRequired,
    );
  });

  it("saves an emptied number as the number its box promised, never an empty string", async () => {
    application = (): RumApplication => {
      return makeApplication({
        sessionReplaySamplePercentage: 40,
        sessionReplayLcpBudgetMs: 4000,
        sessionReplayMonthlyBudgetInGB: 5,
      });
    };

    renderPage();
    const modal: HTMLElement = await openEditPolicy();

    const samplePercentage: HTMLElement = await within(
      modal,
    ).findByDisplayValue("40", {}, { timeout: WAIT_TIMEOUT });
    fireEvent.change(samplePercentage, { target: { value: "" } });

    await openStep(modal, "Performance & Tracing");
    fireEvent.change(
      await within(modal).findByDisplayValue(
        "4000",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
      { target: { value: "" } },
    );

    await openStep(modal, "Limits");
    fireEvent.change(
      await within(modal).findByDisplayValue(
        "5",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
      { target: { value: "" } },
    );

    await saveFromLastStep(modal);

    const model: Record<string, unknown> = savedModel();

    // Every sampled session (the placeholder's 100), no budget, no ceiling.
    expect(model["sessionReplaySamplePercentage"]).toBe(100);
    expect(model["sessionReplayLcpBudgetMs"]).toBe(0);
    expect(model["sessionReplayMonthlyBudgetInGB"]).toBeNull();
  });
});
