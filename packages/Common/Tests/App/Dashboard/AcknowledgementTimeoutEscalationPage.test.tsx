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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

/*
 * A POLICY'S ESCALATION RULES PAGE, WITH THE ACKNOWLEDGEMENT TIMEOUT FOLDED
 * AWAY (issue #5123).
 *
 * "This is an advanced feature, so if you choose to build it, please make
 * sure it is hidden and it is not visible by default to the user." - the
 * maintainer. The page shows the escalation rules and the Repeat Policy as
 * it did; under them, one quiet More settings fold, folded every time the
 * page opens, that names what it holds - and, while the policy pages again,
 * after how long - so nobody has to open it to know.
 *
 * The page, the fold and the card are the real ones; the escalation rules
 * and the Repeat Policy above them are stood in for, and the network and the
 * permission snapshot are stubbed.
 */

configure({ asyncUtilTimeout: 15000 });

const POLICY_ID: string = "4e000000-0000-4000-8000-0000000000f2";
const PROJECT_ID: string = "4e000000-0000-4000-8000-0000000000f3";

let stored: JSONObject = {};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        const item: Record<string, unknown> = new data.modelType() as Record<
          string,
          unknown
        >;
        return Object.assign(item, { _id: POLICY_ID }, stored);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: Record<string, unknown>;
      }): Promise<{ data: unknown }> => {
        stored = {
          ...stored,
          acknowledgementTimeoutInMinutes:
            data.model["acknowledgementTimeoutInMinutes"],
        } as JSONObject;
        return { data: data.model };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("4e000000-0000-4000-8000-0000000000f2");
      },
      navigate: (): void => {
        return undefined;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("4e000000-0000-4000-8000-0000000000f3");
      },
    },
  };
});

/*
 * The escalation rules and the Repeat Policy above the fold, stood in for.
 * The rules' stand-in shows the minutes the page hands its Escalation
 * summary, which ends by saying the policy pages again while it does.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules",
  () => {
    return {
      __esModule: true,
      default: (props: {
        acknowledgementTimeoutInMinutes?: number | null | undefined;
      }): React.ReactElement => {
        return (
          <div
            data-testid="escalation-rules-stand-in"
            data-summary-minutes={String(
              props.acknowledgementTimeoutInMinutes ?? "none",
            )}
          />
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatPolicy",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="repeat-policy-stand-in" />;
      },
    };
  },
);

import OnCallPolicyEscalation from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Escalation";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

beforeEach(() => {
  stored = {};
  expect(PROJECT_ID).toBeTruthy();
});

afterEach(() => {
  cleanup();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 4; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function renderPage(policy: JSONObject): Promise<HTMLElement> {
  stored = policy;
  render(
    <OnCallPolicyEscalation
      pageRoute={undefined as never}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );
  await settle();

  return screen.getByTestId("on-call-policy-more-settings");
}

function header(fold: HTMLElement): HTMLElement {
  return within(fold).getByTestId("folded-section-header");
}

function body(fold: HTMLElement): HTMLElement {
  return within(fold).getByTestId("folded-section-body");
}

describe("a policy's Escalation Rules page", () => {
  test("shows the rules and the Repeat Policy first, and the timeout only under More settings", async () => {
    const fold: HTMLElement = await renderPage({});

    const rules: HTMLElement = screen.getByTestId("escalation-rules-stand-in");
    const repeat: HTMLElement = screen.getByTestId("repeat-policy-stand-in");

    // In this order on the page.
    expect(
      rules.compareDocumentPosition(repeat) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      repeat.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(within(fold).getByTestId("folded-section-title")).toHaveTextContent(
      "More settings",
    );
  });

  test("More settings is folded when the page opens: the timeout is not in sight", async () => {
    const fold: HTMLElement = await renderPage({});

    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
    expect(body(fold)).toHaveClass("invisible");
    expect(body(fold)).toHaveClass("max-h-0");
  });

  test("folded, it names what it holds, as not set while the policy does not page again", async () => {
    const fold: HTMLElement = await renderPage({
      acknowledgementTimeoutInMinutes: null,
    });

    const item: HTMLElement = within(fold).getByTestId("folded-section-item");

    expect(item).toHaveTextContent(/^Acknowledgement Timeout$/);
    expect(item).toHaveAttribute("data-item-set", "false");
  });

  test("folded, it says after how long while the policy pages again", async () => {
    const fold: HTMLElement = await renderPage({
      acknowledgementTimeoutInMinutes: 30,
    });

    await waitFor(() => {
      expect(within(fold).getByTestId("folded-section-item")).toHaveAttribute(
        "data-item-set",
        "true",
      );
    });

    expect(within(fold).getByTestId("folded-section-item")).toHaveTextContent(
      "Acknowledgement Timeout: 30 min",
    );
    // Still folded: knowing it is on does not need the card open.
    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });

  test("opened, it shows the card, and a change shows on the fold at once", async () => {
    const fold: HTMLElement = await renderPage({});

    await act(async () => {
      fireEvent.click(header(fold));
    });
    await settle();

    expect(header(fold)).toHaveAttribute("aria-expanded", "true");
    expect(body(fold)).not.toHaveClass("invisible");
    expect(
      within(body(fold)).getByText("Acknowledgement Timeout"),
    ).toBeVisible();
    expect(
      within(body(fold)).getByTestId("acknowledgement-timeout-summary"),
    ).toHaveTextContent("Don't page again");

    await act(async () => {
      fireEvent.click(within(body(fold)).getByRole("button", { name: "Edit" }));
    });
    await settle();

    const dialog: HTMLElement = await screen.findByTestId("modal");

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "Page again" }),
      );
    });
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await settle();

    await waitFor(() => {
      expect(
        within(body(fold)).getByTestId("acknowledgement-timeout-summary"),
      ).toHaveTextContent("Page again if not resolved within 30 minutes");
    });

    // Folded again, the fold says what it is set to now.
    await act(async () => {
      fireEvent.click(header(fold));
    });
    await settle();

    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
    expect(within(fold).getByTestId("folded-section-item")).toHaveTextContent(
      "Acknowledgement Timeout: 30 min",
    );
  });

  test("the Escalation summary at the top hears what the card read: none while it does not page again", async () => {
    await renderPage({ acknowledgementTimeoutInMinutes: null });

    expect(screen.getByTestId("escalation-rules-stand-in")).toHaveAttribute(
      "data-summary-minutes",
      "none",
    );
  });

  test("the Escalation summary at the top hears the minutes while it pages again, folded or not", async () => {
    const fold: HTMLElement = await renderPage({
      acknowledgementTimeoutInMinutes: 45,
    });

    await waitFor(() => {
      expect(screen.getByTestId("escalation-rules-stand-in")).toHaveAttribute(
        "data-summary-minutes",
        "45",
      );
    });
    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });

  test("a change saved on the card reaches the summary at once", async () => {
    const fold: HTMLElement = await renderPage({});

    await act(async () => {
      fireEvent.click(header(fold));
    });
    await settle();

    await act(async () => {
      fireEvent.click(within(body(fold)).getByRole("button", { name: "Edit" }));
    });
    await settle();

    const dialog: HTMLElement = await screen.findByTestId("modal");

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "Page again" }),
      );
    });
    await settle();

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await settle();

    await waitFor(() => {
      expect(screen.getByTestId("escalation-rules-stand-in")).toHaveAttribute(
        "data-summary-minutes",
        "30",
      );
    });
  });

  test("the page is the policy's Escalation Rules page", () => {
    expect(PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION).toBeDefined();
  });
});

/*
 * A link to the timeout - the docs, a search result, another page - opens
 * More settings at its card: the folded header names it at the card's own
 * place (its title's, #acknowledgement-timeout), which the card holds.
 */
describe("a link to the Acknowledgement Timeout", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "#");
  });

  test("names it at the card's place", async () => {
    const fold: HTMLElement = await renderPage({});

    expect(
      within(fold)
        .getByTestId("folded-section-item")
        .getAttribute("data-item-key"),
    ).toBe("acknowledgement-timeout");
    // The card is in the fold, at that place.
    expect(fold).toContainElement(
      document.getElementById("acknowledgement-timeout"),
    );
  });

  test("opened at #acknowledgement-timeout, More settings opens there", async () => {
    window.history.replaceState(null, "", "#acknowledgement-timeout");

    const fold: HTMLElement = await renderPage({});

    expect(header(fold)).toHaveAttribute("aria-expanded", "true");
  });

  test("opened anywhere else, it stays folded", async () => {
    window.history.replaceState(null, "", "#repeat-policy");

    const fold: HTMLElement = await renderPage({});

    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });
});
