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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission, { UserPermission } from "../../../Types/Permission";

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

import CardSections from "../../../UI/Components/Card/CardSections";
import { CARD_RULED_BODY_CLASS_NAME } from "../../../UI/Components/Card/CardSurface";
import CardModelDetail, {
  CARD_MODEL_DETAIL_BODY_CLASS_NAME,
  CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME,
} from "../../../UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Probe from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { resolvePadding, resolveMargin } from "../../ResponsiveSpacing";

/*
 * A detail card's frame (CardModelDetail): its fields' box under the
 * header, and the actions in the header.
 *
 *   - The box is the ruled body a switch card has, padded as the card is,
 *     so the fields' left edge is the title's at every width. It used to
 *     pull itself out 24px on every side whatever the card's padding and
 *     pad its fields 16px: on a phone (card padding 20px) the rule ran 4px
 *     past the card and the fields sat 8px left of the title.
 *   - The header: Edit, the page's own buttons, then a ⋯ holding the
 *     documentation and the demo, as a table keeps them. Those two were
 *     buttons in an outline style with no CSS - no border, no hover - that
 *     read as stray text, and were hidden on phones.
 */

const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

// The card's own padding (Card's CARD_PADDING_CLASS_NAME): 20px, 24px from md.
const CARD_PADDING_IN_PX: (width: number) => number = (
  width: number,
): number => {
  return width >= 768 ? 24 : 20;
};

interface CardOptions {
  documentationLink?: Route | URL | undefined;
  videoLink?: Route | URL | undefined;
  buttons?: Array<ReactElement> | undefined;
  isEditable?: boolean | undefined;
}

const probeCard: (options?: CardOptions) => ReactElement = (
  options?: CardOptions,
): ReactElement => {
  return (
    <CardModelDetail<Probe>
      name="Probe Details"
      cardProps={{
        title: "Probe Details",
        description: "Where the probe runs.",
        buttons: options?.buttons,
      }}
      isEditable={options?.isEditable !== false}
      documentationLink={options?.documentationLink}
      videoLink={options?.videoLink}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
      ]}
      modelDetailProps={{
        modelType: Probe,
        id: "probe-detail",
        modelId: PROBE_ID,
        fields: [
          { field: { name: true }, title: "Name" },
          { field: { description: true }, title: "Description" },
        ],
      }}
    />
  );
};

const renderLoaded: (element: ReactElement) => Promise<void> = async (
  element: ReactElement,
): Promise<void> => {
  render(element);
  await screen.findByText("US East probe", {}, { timeout: WAIT_TIMEOUT });
};

const headerActions: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return Array.from(
    screen.getByTestId("card-header-actions").children,
  ) as Array<HTMLElement>;
};

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  getItemMock.mockReset();
  getItemMock.mockImplementation(() => {
    const probe: Probe = new Probe(PROBE_ID);
    probe.name = "US East probe";
    probe.description = "Runs checks from Virginia";
    return Promise.resolve(probe);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the fields' box", () => {
  test("is the card's ruled body, padded as the card is", async () => {
    await renderLoaded(probeCard());

    const body: HTMLElement = screen.getByTestId("card-model-detail-body");

    expect(body.className).toBe(CARD_MODEL_DETAIL_BODY_CLASS_NAME);
    expect(CARD_MODEL_DETAIL_BODY_CLASS_NAME.startsWith(
      CARD_RULED_BODY_CLASS_NAME,
    )).toBe(true);
    expect(body).toHaveClass("border-t", "border-gray-200");
  });

  test.each([320, 390, 639, 640, 767, 768, 1024, 1280, 1920])(
    "at %ipx the rule meets the card's edges and the fields start where the title does",
    async (width: number) => {
      await renderLoaded(probeCard());

      const body: HTMLElement = screen.getByTestId("card-model-detail-body");
      const margin: { left: number; right: number } = resolveMargin(
        body.className,
        width,
      );
      const padding: { left: number; right: number } = resolvePadding(
        body.className,
        width,
      );

      // Out to the card's edges, exactly: no further.
      expect(margin.left).toBe(-CARD_PADDING_IN_PX(width));
      expect(margin.right).toBe(-CARD_PADDING_IN_PX(width));
      // And back in to the title's edge.
      expect(padding.left).toBe(CARD_PADDING_IN_PX(width));
      expect(padding.right).toBe(CARD_PADDING_IN_PX(width));
    },
  );

  test("in a section of a card it has no rule and no box of its own, as before", async () => {
    await renderLoaded(<CardSections>{probeCard()}</CardSections>);

    const body: HTMLElement = screen.getByTestId("card-model-detail-body");

    expect(body.className).toBe(CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME);
    expect(body.className).not.toContain("border-t");
  });
});

describe("the header's actions", () => {
  test("Edit is a bordered button with a pencil, like a table's Create", async () => {
    await renderLoaded(probeCard());

    const edit: HTMLElement = screen.getByRole("button", {
      name: "Edit Probe",
    });

    expect(edit).toHaveAttribute("data-testid", "card-button");
    expect(edit).toHaveClass("border", "border-gray-300", "bg-white");
    expect(edit.className).not.toContain("btn-outline-secondary");
    expect(edit.querySelector("svg")).not.toBeNull();
  });

  test("the documentation and the demo are in a ⋯ after Edit, not buttons of their own", async () => {
    await renderLoaded(
      probeCard({
        documentationLink: new Route("/docs/probe/custom-probe"),
        videoLink: URL.fromString("https://www.youtube.com/watch?v=demo"),
      }),
    );

    expect(screen.queryByRole("button", { name: "View Documentation" })).toBe(
      null,
    );
    expect(screen.queryByRole("button", { name: "Watch Demo" })).toBe(null);

    const actions: Array<HTMLElement> = headerActions();

    expect(actions).toHaveLength(2);
    expect(
      within(actions[0]!).getByRole("button", { name: "Edit Probe" }),
    ).toBeInTheDocument();
    expect(
      within(actions[1]!).getByTestId("card-model-detail-more-menu"),
    ).toHaveAccessibleName("More options");

    // No header action is drawn in the outline style, which has no CSS.
    expect(
      screen.getByTestId("card-header-actions").innerHTML,
    ).not.toContain("btn-outline-secondary");
  });

  test("the ⋯ opens the documentation and the demo in a new tab", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    await renderLoaded(
      probeCard({
        documentationLink: new Route("/docs/probe/custom-probe"),
        videoLink: URL.fromString("https://www.youtube.com/watch?v=demo"),
      }),
    );

    const more: HTMLElement = screen.getByTestId("card-model-detail-more-menu");

    await act(async () => {
      fireEvent.click(more);
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "View Documentation" }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("card-model-detail-more-menu"));
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Watch Demo" }));

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(String(navigate.mock.calls[0]![0])).toBe("/docs/probe/custom-probe");
    expect(navigate.mock.calls[0]![1]).toEqual({ openInNewTab: true });
    expect(String(navigate.mock.calls[1]![0])).toBe(
      "https://www.youtube.com/watch?v=demo",
    );
    expect(navigate.mock.calls[1]![1]).toEqual({ openInNewTab: true });
  });

  test("the ⋯ is there on a phone too: nothing hides it below md", async () => {
    await renderLoaded(
      probeCard({ documentationLink: new Route("/docs/probe/custom-probe") }),
    );

    const more: HTMLElement = screen.getByTestId("card-model-detail-more-menu");
    let element: HTMLElement | null = more;

    while (element && element !== document.body) {
      expect(element.className || "").not.toMatch(/(^|\s)(max-md:)?hidden\b/);
      element = element.parentElement;
    }
  });

  test("with only one of the two, the ⋯ holds that one", async () => {
    await renderLoaded(
      probeCard({
        videoLink: URL.fromString("https://www.youtube.com/watch?v=demo"),
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("card-model-detail-more-menu"));
    });

    expect(
      await screen.findByRole("menuitem", { name: "Watch Demo" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "View Documentation" })).toBe(
      null,
    );
  });

  test("without either, there is no ⋯", async () => {
    await renderLoaded(probeCard());

    expect(screen.queryByTestId("card-model-detail-more-menu")).toBeNull();
    expect(headerActions()).toHaveLength(1);
  });

  test("the page's own buttons come after Edit and before the ⋯", async () => {
    await renderLoaded(
      probeCard({
        documentationLink: new Route("/docs/probe/custom-probe"),
        buttons: [
          <button key="apply" type="button">
            Apply Template
          </button>,
        ],
      }),
    );

    const actions: Array<HTMLElement> = headerActions();

    expect(
      actions.map((action: HTMLElement): string => {
        return (
          action.querySelector("button")?.getAttribute("aria-label") ||
          action.textContent ||
          ""
        ).trim();
      }),
    ).toEqual(["Edit Probe", "Apply Template", "More options"]);
  });

  test("a read-only card shows only its ⋯", async () => {
    await renderLoaded(
      probeCard({
        isEditable: false,
        documentationLink: new Route("/docs/probe/custom-probe"),
      }),
    );

    expect(screen.queryByRole("button", { name: "Edit Probe" })).toBeNull();
    expect(headerActions()).toHaveLength(1);
    expect(
      screen.getByTestId("card-model-detail-more-menu"),
    ).toBeInTheDocument();
  });
});
