import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { Translator } from "../../../Types/Translator";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Record a specific user's next session" in the reader's language (issue
 * #6369). Its heading, paragraphs, labels, buttons, notes and its answers
 * were English in every language. Each is looked up now; the reference the
 * person typed, the attribute and the calls in its notes are drawn as
 * written, inside the sentence that names them.
 *
 * The lookups here are marked, ⟦like this⟧, so a sentence drawn without one
 * shows up unmarked.
 */

type TranslatorModule = typeof import("../../../Types/Translator");

const postMock: MockFunction = getJestMockFunction();
const isMasterAdminMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
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
      getProjectPermissions: (): null => {
        return null;
      },
    },
  };
});

// Every lookup a component makes comes back marked, in German.
jest.mock("../../../UI/Utils/Translation", () => {
  const translatorModule: TranslatorModule =
    jest.requireActual("../../../Types/Translator") as TranslatorModule;
  const translateString: (value: string | undefined) => string | undefined = (
    value: string | undefined,
  ): string | undefined => {
    return value ? `⟦${value}⟧` : value;
  };
  const translator: Translator = translatorModule.createTranslator(
    translateString,
    "de",
  );

  return {
    __esModule: true,
    default: () => {
      return {
        translateString: translateString,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? translateString(value) : value;
        },
        translateTemplate: translator.translateTemplate,
        translatePlural: translator.translatePlural,
        translateTerm: translator.translateTerm,
        hasTranslation: translator.hasTranslation,
        formatNumber: translator.formatNumber,
        language: translator.language,
      };
    },
  };
});

import TargetedCapturePanel from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/TargetedCapturePanel";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";

// The text outside every ⟦…⟧: what was drawn without a lookup.
function outsideMarks(text: string): string {
  let depth: number = 0;
  let outside: string = "";

  for (const character of text) {
    if (character === "⟦") {
      depth += 1;
    } else if (character === "⟧") {
      depth -= 1;
    } else if (depth === 0) {
      outside += character;
    }
  }

  return outside;
}

// The words of an element no lookup produced, leaving out code.
function wordsNotLookedUp(element: HTMLElement): string {
  const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

  copy.querySelectorAll("code").forEach((node: Element): void => {
    node.remove();
  });

  return outsideMarks(copy.textContent || "")
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
}

function pendingResponse(isPending: boolean): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, { isPending: isPending }, {});
}

beforeEach(() => {
  postMock.mockReset();
  getListMock.mockReset();
  isMasterAdminMock.mockReset();
  isMasterAdminMock.mockReturnValue(true);
});

describe("TargetedCapturePanel in the reader's language", () => {
  it("draws its heading, labels, buttons and notes looked up", () => {
    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    const panel: HTMLElement = screen.getByTestId("targeted-capture-panel");

    expect(panel).toHaveTextContent("⟦Record a specific user's next session⟧");
    expect(panel).toHaveTextContent("⟦End-user reference⟧");
    expect(screen.getByTestId("targeted-capture-status")).toHaveTextContent(
      "⟦Check whether a target is pending⟧",
    );
    expect(screen.getByTestId("targeted-capture-clear")).toHaveTextContent(
      "⟦Cancel target⟧",
    );
    expect(panel).toHaveTextContent("⟦Consent gates still apply.⟧");
    // One sentence around the attribute and the calls it names.
    expect(panel).toHaveTextContent(
      "⟦The user's page must supply the same reference at load time (data-oneuptime-user-ref or the init global) for the one-shot to fire. An identify() call later in the session",
    );

    expect(wordsNotLookedUp(panel)).toBe("");
  });

  it("says a target is armed in one sentence, the reference as it was typed", async () => {
    postMock.mockResolvedValue(pendingResponse(true));

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "jane@example.com " },
    });
    fireEvent.click(screen.getByTestId("targeted-capture-arm"));

    const armed: HTMLElement = await screen.findByTestId(
      "targeted-capture-armed",
    );

    expect(armed).toHaveTextContent(
      "⟦Target armed for jane@example.com. The next page load that supplies this reference at load time will be recorded from its first event. It expires in 24 hours.⟧",
    );
    expect(wordsNotLookedUp(armed)).toBe("");
  });

  it("says no target is pending, looked up", async () => {
    postMock.mockResolvedValue(pendingResponse(false));

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    fireEvent.change(screen.getByTestId("targeted-capture-user-ref"), {
      target: { value: "user-1" },
    });
    fireEvent.click(screen.getByTestId("targeted-capture-status"));

    expect(
      await screen.findByTestId("targeted-capture-not-pending"),
    ).toHaveTextContent(
      "⟦No target is pending for this reference. Either none was set, it expired, or the user's session already consumed it.⟧",
    );
  });

  it("tells someone who cannot arm a target why, looked up", () => {
    isMasterAdminMock.mockReturnValue(false);

    render(<TargetedCapturePanel rumApplicationId={APP_ID} />);

    expect(
      screen.getByTestId("targeted-capture-no-permission"),
    ).toHaveTextContent(
      "⟦Arming a recording of a named person is a capture-policy change, so it needs the Edit RUM Application permission",
    );
  });

  it("names the applications to pick from as they were named", async () => {
    getListMock.mockResolvedValue({
      data: [
        { _id: "0193c0de-1111-4aaa-8bbb-000000000002", name: "Checkout" },
        { _id: "0193c0de-1111-4aaa-8bbb-000000000003", name: "Storefront" },
      ],
      count: 2,
    });

    render(<TargetedCapturePanel />);

    expect(await screen.findByText("Checkout")).toBeInTheDocument();
    expect(screen.queryByText("⟦Checkout⟧")).toBeNull();
    expect(screen.getByText("⟦Application⟧")).toBeInTheDocument();
  });
});
