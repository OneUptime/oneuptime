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
import { getJestSpyOn } from "../../Spy";

/*
 * A status page's Security -> Access page (the old "Authentication
 * Settings", at the same address): the "Who can see this status page" card
 * (StatusPageAccessCard, which has a suite of its own), then a folded
 * Advanced section holding the IP allowlist - which applies whoever the
 * page is open to, and which few pages need.
 *
 * It used to be three cards: an "Is Visible to Public" switch, a "Master
 * Password" card with its own switch and a button for the password, and the
 * IP whitelist. None of them is left: who can see the page is one choice.
 *
 * The allowlist card is recorded rather than drawn (CardModelDetail has
 * suites of its own): what matters is what the page hands it - and what the
 * folded section says, which is the real section.
 */

type Recorded = { kind: string; props: Record<string, unknown> };

interface RecorderStore {
  latest: Map<string, Recorded>;
}

const store: RecorderStore = { latest: new Map<string, Recorded>() };

(
  globalThis as unknown as { __accessPageRecorded: RecorderStore }
).__accessPageRecorded = store;

type Recorder = (
  kind: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (kind: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    const name: string = (props["name"] as string | undefined) || kind;

    (
      globalThis as unknown as { __accessPageRecorded: RecorderStore }
    ).__accessPageRecorded.latest.set(name, { kind: kind, props: props });

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", {
      "data-testid": "recorded-card",
      "data-card": name,
      "data-kind": kind,
    });
  };
};

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return { __esModule: true, default: mockRecorder("card-model-detail") };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCard",
  () => {
    return { __esModule: true, default: mockRecorder("access-card") };
  },
);

import StatusPageAccessPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/AuthenticationSettings";
import StatusPageAccessCopy, {
  STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID,
  STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../UI/Components/Types/FieldType";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";
const ALLOWLIST_CARD: string = "Status Page > IP Allowlist";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: false,
};

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

let plan: PlanType | null = null;

beforeEach(() => {
  store.latest.clear();
  plan = null;

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(STATUS_PAGE_ID));

  getJestSpyOn(ProjectUtil, "getCurrentPlan").mockImplementation(
    (): PlanType | null => {
      return plan;
    },
  );

  getJestSpyOn(
    SubscriptionPlan,
    "isFeatureAccessibleOnCurrentPlan",
  ).mockImplementation((needed: unknown, current: unknown): boolean => {
    return (
      PLAN_ORDER.indexOf(current as PlanType) >=
      PLAN_ORDER.indexOf(needed as PlanType)
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(<StatusPageAccessPage {...PAGE_PROPS} />);
  });
}

function propsOf(name: string): Record<string, unknown> {
  const card: Recorded | undefined = store.latest.get(name);

  expect([name, Boolean(card)]).toEqual([name, true]);

  return card!.props;
}

type FieldShape = {
  field?: Record<string, unknown>;
  title?: string;
  fieldType?: string;
  required?: boolean;
  description?: string;
  placeholder?: string;
  customValidation?: (values: Record<string, unknown>) => string | null;
  getElement?: (item: StatusPage) => ReactElement;
};

function formFields(): Array<FieldShape> {
  return propsOf(ALLOWLIST_CARD)["formFields"] as Array<FieldShape>;
}

function detailFields(): Array<FieldShape> {
  return (
    propsOf(ALLOWLIST_CARD)["modelDetailProps"] as Record<string, unknown>
  )["fields"] as Array<FieldShape>;
}

// What the allowlist card reads, handed to the page as the card would.
async function loadAllowlist(ipWhitelist: string | undefined): Promise<void> {
  const item: StatusPage = new StatusPage();

  if (ipWhitelist !== undefined) {
    item.ipWhitelist = ipWhitelist;
  }

  const onItemLoaded: (item: StatusPage) => void = (
    propsOf(ALLOWLIST_CARD)["modelDetailProps"] as {
      onItemLoaded: (item: StatusPage) => void;
    }
  ).onItemLoaded;

  await act(async () => {
    onItemLoaded(item);
  });
}

function advancedSection(): HTMLElement {
  return screen.getByTestId(STATUS_PAGE_ACCESS_ADVANCED_SECTION_TEST_ID);
}

describe("the page", () => {
  test("opens on who can see the page, then a folded Advanced section with the IP allowlist", async () => {
    await renderPage();

    const cards: Array<string | null> = screen
      .getAllByTestId("recorded-card")
      .map((element: HTMLElement): string | null => {
        return element.getAttribute("data-card");
      });

    expect(cards).toEqual(["access-card", ALLOWLIST_CARD]);

    expect(
      within(advancedSection()).getAllByTestId("recorded-card").length,
    ).toBe(1);
    expect(
      within(advancedSection()).getByTestId("recorded-card"),
    ).toHaveAttribute("data-card", ALLOWLIST_CARD);
  });

  test("the choice is for this status page", async () => {
    await renderPage();

    expect(
      (propsOf("access-card")["statusPageId"] as ObjectID).toString(),
    ).toBe(STATUS_PAGE_ID);
  });

  test("no card is left of the switches and the password button", async () => {
    await renderPage();

    for (const gone of [
      "Status Page > Authentication Settings",
      "Status Page > Master Password",
      "Status Page > IP Whitelist",
    ]) {
      expect([gone, store.latest.has(gone)]).toEqual([gone, false]);
    }

    expect(screen.queryByText("Is Visible to Public")).not.toBeInTheDocument();
    expect(screen.queryByText("Set Master Password")).not.toBeInTheDocument();
    expect(screen.queryByText(/whitelist/i)).not.toBeInTheDocument();
  });
});

describe("the folded Advanced section", () => {
  test("is folded, and names what is in it", async () => {
    await renderPage();

    const toggle: HTMLElement = within(advancedSection()).getByRole("button", {
      name: "More settings",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(toggle)).toEqual(["IP Allowlist"]);

    // Open, it says what it is for.
    fireEvent.click(toggle);

    expect(advancedSection()).toHaveTextContent(
      StatusPageAccessCopy.advancedDescription,
    );
  });

  test("with no allowlist: every address may open the page, and nothing is configured", async () => {
    await renderPage();
    await loadAllowlist(undefined);

    expect(advancedSection()).toHaveTextContent(
      StatusPageAccessCopy.advancedSummaryOpen,
    );
    expect(setChips(advancedSection())).toEqual([]);
  });

  test("with an allowlist: it says so, folded, and says Configured", async () => {
    await renderPage();
    await loadAllowlist("203.0.113.7\n10.0.0.0/8");

    expect(advancedSection()).toHaveTextContent(
      StatusPageAccessCopy.advancedSummaryConfigured,
    );
    expect(hasSetChip(advancedSection())).toBe(true);
  });

  test("a list of blank lines is in force on the server, so it is Configured too", async () => {
    await renderPage();
    await loadAllowlist("\n  \n");

    expect(hasSetChip(advancedSection())).toBe(true);
  });

  test("opens from its title", async () => {
    await renderPage();

    const toggle: HTMLElement = within(advancedSection()).getByRole("button", {
      name: "More settings",
    });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the IP allowlist card", () => {
  test("is the IP Allowlist, with what it does and how to leave it", async () => {
    await renderPage();

    const props: Record<string, unknown> = propsOf(ALLOWLIST_CARD);
    const cardProps: Record<string, unknown> = props["cardProps"] as Record<
      string,
      unknown
    >;

    expect(cardProps["title"]).toBe("IP Allowlist");
    expect(cardProps["description"]).toBe(
      StatusPageAccessCopy.ipAllowlistDescription,
    );
    expect(props["editButtonText"]).toBe("Edit IP Allowlist");
    expect(props["isEditable"]).toBe(true);
    expect(
      (props["modelDetailProps"] as Record<string, unknown>)["modelId"],
    ).toEqual(new ObjectID(STATUS_PAGE_ID));
  });

  test("its form is the one list, not required, with what a line may hold", async () => {
    await renderPage();

    expect(formFields()).toHaveLength(1);

    const field: FieldShape = formFields()[0]!;

    expect(field.field).toEqual({ ipWhitelist: true });
    expect(field.title).toBe("IP Allowlist");
    expect(field.fieldType).toBe(FormFieldSchemaType.LongText);
    expect(field.required).toBe(false);
    expect(field.description).toBe(
      StatusPageAccessCopy.ipAllowlistFieldDescription,
    );
  });

  test("its form refuses a list the server would misread", async () => {
    await renderPage();

    const validate: (values: Record<string, unknown>) => string | null =
      formFields()[0]!.customValidation!;

    expect(validate({ ipWhitelist: "" })).toBeNull();
    expect(validate({ ipWhitelist: "203.0.113.7\n10.0.0.0/8" })).toBeNull();
    expect(validate({ ipWhitelist: "\n \n" })).toBe(
      StatusPageAccessCopy.ipAllowlistBlank,
    );
    expect(validate({ ipWhitelist: "office.example.com" })).toBe(
      "office.example.com is not an IP address or an IPv4 range such as 10.0.0.0/8.",
    );
  });

  test.each([PlanType.Free, PlanType.Growth])(
    "on %s, it names the Scale plan it needs",
    async (current: PlanType) => {
      plan = current;

      await renderPage();

      const rightElement: ReactElement = (
        propsOf(ALLOWLIST_CARD)["cardProps"] as Record<string, unknown>
      )["rightElement"] as ReactElement;

      expect(rightElement).toBeTruthy();

      render(rightElement);

      expect(screen.getByText("Scale Plan")).toBeInTheDocument();
    },
  );

  test.each([PlanType.Scale, PlanType.Enterprise, null])(
    "on %s, no plan is named",
    async (current: PlanType | null) => {
      plan = current;

      await renderPage();

      expect(
        (propsOf(ALLOWLIST_CARD)["cardProps"] as Record<string, unknown>)[
          "rightElement"
        ],
      ).toBeUndefined();
    },
  );

  describe("shows the list", () => {
    function shown(ipWhitelist: string | undefined): HTMLElement {
      const field: FieldShape = detailFields()[0]!;

      expect(field.field).toEqual({ ipWhitelist: true });
      expect(field.title).toBe("IP Allowlist");
      expect(field.fieldType).toBe(FieldType.LongText);

      const item: StatusPage = new StatusPage();

      if (ipWhitelist !== undefined) {
        item.ipWhitelist = ipWhitelist;
      }

      const view: ReturnType<typeof render> = render(field.getElement!(item));

      return view.container;
    }

    test("one address or range a line, as typed", async () => {
      await renderPage();

      const container: HTMLElement = shown(" 203.0.113.7 \n\n10.0.0.0/8\n");
      const list: HTMLElement = within(container).getByTestId(
        STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID,
      );

      expect(
        within(list)
          .getAllByRole("listitem")
          .map((item: HTMLElement): string => {
            return item.textContent || "";
          }),
      ).toEqual(["203.0.113.7", "10.0.0.0/8"]);
    });

    test("an empty list says every address may open the page", async () => {
      await renderPage();

      expect(shown(undefined)).toHaveTextContent(
        StatusPageAccessCopy.ipAllowlistEmpty,
      );
      cleanup();
      await renderPage();
      expect(shown("")).toHaveTextContent(
        StatusPageAccessCopy.ipAllowlistEmpty,
      );
    });

    test("a list of blank lines says no address may", async () => {
      await renderPage();

      expect(shown("\n \n")).toHaveTextContent(
        StatusPageAccessCopy.ipAllowlistNoAddress,
      );
    });
  });
});
