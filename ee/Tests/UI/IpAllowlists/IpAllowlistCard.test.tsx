import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { getJestSpyOn } from "Common/Tests/Spy";

/*
 * The Enterprise IP allowlist card (ee/Dashboard/IpAllowlists/IpAllowlistCard)
 * of a private status page, a public dashboard and a form: each page words it
 * its own way, and the card is the same.
 *
 * The card is a CardModelDetail, recorded rather than drawn (it has suites of
 * its own): what matters is what the card hands it - its words, the one
 * field and its validation, the plan's pill, how the list is shown - and that
 * it tells the page each allowlist it reads. Above it, the license notice
 * says what a lapsed license leaves.
 */

type Recorded = Record<string, unknown>;

const recordedCards: Array<Recorded> = [];
let licenseModeForTest: string = "editable";

jest.mock("Common/UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      (
        globalThis as unknown as { __ipAllowlistCards: Array<Recorded> }
      ).__ipAllowlistCards.push(props);

      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement("div", {
        "data-testid": "recorded-card",
        "data-card": String(props["name"]),
      });
    },
  };
});

jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return (
          globalThis as unknown as { __ipAllowlistLicenseMode: () => string }
        ).__ipAllowlistLicenseMode();
      },
    };
  },
);

(
  globalThis as unknown as { __ipAllowlistCards: Array<Recorded> }
).__ipAllowlistCards = recordedCards;
(
  globalThis as unknown as { __ipAllowlistLicenseMode: () => string }
).__ipAllowlistLicenseMode = (): string => {
  return licenseModeForTest;
};

import IpAllowlistCard from "../../../Dashboard/IpAllowlists/IpAllowlistCard";
import { IpAllowlistCardProps } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import StatusPageAccessCopy, {
  STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID,
} from "@oneuptime/dashboard/Components/StatusPage/StatusPageAccessCopy";
import DashboardSharingCopy, {
  DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID,
} from "@oneuptime/dashboard/Components/Dashboard/Sharing/DashboardSharingCopy";
import IpAllowlistCopy from "@oneuptime/dashboard/Components/IpAllowlist/IpAllowlistCopy";
import FormsCopy from "@oneuptime/dashboard/Components/FormBuilder/FormsCopy";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import Form from "Common/Models/DatabaseModels/Form";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";

const RECORD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const PLAN_ORDER: Array<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

let plan: PlanType | null = null;

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

// The three pages' words, as each page hands them over.
const PAGES: Array<[string, IpAllowlistCardProps]> = [
  [
    "a status page",
    {
      modelType: StatusPage,
      modelId: RECORD_ID,
      cardName: "Status Page > IP Allowlist",
      modelDetailId: "model-detail-status-page-ip-allowlist",
      title: StatusPageAccessCopy.ipAllowlistTitle,
      description: StatusPageAccessCopy.ipAllowlistDescription,
      editButtonText: StatusPageAccessCopy.ipAllowlistEditButton,
      fieldDescription: StatusPageAccessCopy.ipAllowlistFieldDescription,
      emptyText: StatusPageAccessCopy.ipAllowlistEmpty,
      noAddressText: StatusPageAccessCopy.ipAllowlistNoAddress,
      entriesTestId: STATUS_PAGE_IP_ALLOWLIST_ENTRIES_TEST_ID,
    },
  ],
  [
    "a dashboard",
    {
      modelType: Dashboard,
      modelId: RECORD_ID,
      cardName: "Dashboard > IP Allowlist",
      modelDetailId: "model-detail-dashboard-ip-allowlist",
      title: IpAllowlistCopy.title,
      description: DashboardSharingCopy.ipAllowlistDescription,
      editButtonText: IpAllowlistCopy.editButton,
      fieldDescription: IpAllowlistCopy.fieldDescription,
      emptyText: DashboardSharingCopy.ipAllowlistEmpty,
      noAddressText: DashboardSharingCopy.ipAllowlistNoAddress,
      entriesTestId: DASHBOARD_IP_ALLOWLIST_ENTRIES_TEST_ID,
    },
  ],
  [
    "a form",
    {
      modelType: Form,
      modelId: RECORD_ID,
      cardName: "Form > Access",
      modelDetailId: "model-detail-form-access",
      title: FormsCopy.ipAllowlistTitle,
      // A form's Share page calls the card Access, and the list IP Allowlist.
      cardTitle: "Access",
      description: FormsCopy.accessDescription,
      editButtonText: FormsCopy.editIpAllowlist,
      fieldDescription: FormsCopy.ipAllowlistDescription,
      emptyText: FormsCopy.ipAllowlistEmpty,
      noAddressText: FormsCopy.ipAllowlistNoAddress,
      entriesTestId: "form-ip-allowlist",
    },
  ],
];

const STATUS_PAGE_PROPS: IpAllowlistCardProps = PAGES[0]![1];

beforeEach(() => {
  recordedCards.length = 0;
  licenseModeForTest = "editable";
  plan = null;

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

const renderCard: (props: IpAllowlistCardProps) => Recorded = (
  props: IpAllowlistCardProps,
): Recorded => {
  render(<IpAllowlistCard {...props} />);

  expect(recordedCards).toHaveLength(1);

  return recordedCards[0]!;
};

const formFields: (card: Recorded) => Array<FieldShape> = (
  card: Recorded,
): Array<FieldShape> => {
  return card["formFields"] as Array<FieldShape>;
};

const detailFields: (card: Recorded) => Array<FieldShape> = (
  card: Recorded,
): Array<FieldShape> => {
  return (card["modelDetailProps"] as Record<string, unknown>)[
    "fields"
  ] as Array<FieldShape>;
};

describe.each(PAGES)(
  "the card of %s",
  (_label: string, props: IpAllowlistCardProps) => {
    test("is the page's IP allowlist, in its own words, for its own record", () => {
      const card: Recorded = renderCard(props);
      const cardProps: Record<string, unknown> = card["cardProps"] as Record<
        string,
        unknown
      >;

      expect(card["name"]).toBe(props.cardName);
      expect(cardProps["title"]).toBe(props.cardTitle || props.title);
      expect(cardProps["description"]).toBe(props.description);
      expect(card["editButtonText"]).toBe(props.editButtonText);
      expect(card["isEditable"]).toBe(true);

      const detail: Record<string, unknown> = card[
        "modelDetailProps"
      ] as Record<string, unknown>;

      expect(detail["modelType"]).toBe(props.modelType);
      expect(detail["modelId"]).toEqual(RECORD_ID);
      expect(detail["id"]).toBe(props.modelDetailId);
    });

    test("names the list by the allowlist's own title, whatever the card is called", () => {
      const card: Recorded = renderCard(props);

      expect(formFields(card)[0]!.title).toBe(props.title);
      expect(detailFields(card)[0]!.title).toBe(props.title);
    });

    test("its form is the one list, not required, with what a line may hold", () => {
      const fields: Array<FieldShape> = formFields(renderCard(props));

      expect(fields).toHaveLength(1);
      expect(fields[0]!.field).toEqual({ ipWhitelist: true });
      expect(fields[0]!.title).toBe(props.title);
      expect(fields[0]!.fieldType).toBe(FormFieldSchemaType.LongText);
      expect(fields[0]!.required).toBe(false);
      expect(fields[0]!.description).toBe(props.fieldDescription);
    });

    test("its form refuses a list the server would misread", () => {
      const validate: (values: Record<string, unknown>) => string | null =
        formFields(renderCard(props))[0]!.customValidation!;

      expect(validate({ ipWhitelist: "" })).toBeNull();
      expect(validate({ ipWhitelist: "203.0.113.7\n10.0.0.0/8" })).toBeNull();
      expect(validate({ ipWhitelist: "\n \n" })).toBe(IpAllowlistCopy.blank);
      expect(validate({ ipWhitelist: "office.example.com" })).toBe(
        "office.example.com is not an IP address or an IPv4 range such as 10.0.0.0/8.",
      );
    });

    test("one address or range a line, as typed", () => {
      const field: FieldShape = detailFields(renderCard(props))[0]!;

      expect(field.field).toEqual({ ipWhitelist: true });
      expect(field.fieldType).toBe(FieldType.LongText);

      const item: StatusPage = new StatusPage();
      item.ipWhitelist = " 203.0.113.7 \n\n10.0.0.0/8\n";

      const view: ReturnType<typeof render> = render(field.getElement!(item));

      expect(
        within(view.container)
          .getAllByRole("listitem")
          .map((entry: HTMLElement): string => {
            return entry.textContent || "";
          }),
      ).toEqual(["203.0.113.7", "10.0.0.0/8"]);
      expect(
        within(view.container).getByTestId(props.entriesTestId),
      ).toBeInTheDocument();
    });

    test("an empty list says what that means, and a list of blank lines says no address may", () => {
      const field: FieldShape = detailFields(renderCard(props))[0]!;

      expect(
        render(field.getElement!(new StatusPage())).container,
      ).toHaveTextContent(props.emptyText);
      cleanup();

      const blank: StatusPage = new StatusPage();
      blank.ipWhitelist = "\n \n";

      expect(render(field.getElement!(blank)).container).toHaveTextContent(
        props.noAddressText,
      );
    });
  },
);

describe("the plan it needs on OneUptime Cloud", () => {
  test.each([PlanType.Free, PlanType.Growth])(
    "on %s, it names the Scale plan beside the title",
    (current: PlanType) => {
      plan = current;

      const rightElement: ReactElement = (
        renderCard(STATUS_PAGE_PROPS)["cardProps"] as Record<string, unknown>
      )["rightElement"] as ReactElement;

      expect(rightElement).toBeTruthy();

      render(rightElement);

      expect(screen.getByText("Scale Plan")).toBeInTheDocument();
    },
  );

  test.each([PlanType.Scale, PlanType.Enterprise, null])(
    "on %s, no plan is named",
    (current: PlanType | null) => {
      plan = current;

      expect(
        (renderCard(STATUS_PAGE_PROPS)["cardProps"] as Record<string, unknown>)[
          "rightElement"
        ],
      ).toBeUndefined();
    },
  );
});

describe("what the page is told", () => {
  test("each allowlist read, so the page can say whether one is in force", () => {
    const loaded: Array<string> = [];

    const card: Recorded = renderCard({
      ...STATUS_PAGE_PROPS,
      onLoaded: (allowlist: string) => {
        loaded.push(allowlist);
      },
    });

    const onItemLoaded: (item: StatusPage) => void = (
      card["modelDetailProps"] as { onItemLoaded: (item: StatusPage) => void }
    ).onItemLoaded;

    const listed: StatusPage = new StatusPage();
    listed.ipWhitelist = "10.0.0.1";
    onItemLoaded(listed);
    onItemLoaded(new StatusPage());

    expect(loaded).toEqual(["10.0.0.1", ""]);
  });
});

describe("the license", () => {
  test("a valid license draws no notice", () => {
    renderCard(STATUS_PAGE_PROPS);

    expect(
      screen.queryByTestId(
        "enterprise-setting-license-read-only-notice-ip-allowlists",
      ),
    ).not.toBeInTheDocument();
  });

  test("a lapsed license says the allowlist is still enforced and can only be removed, and the card stays", () => {
    licenseModeForTest = "read-only";

    renderCard(STATUS_PAGE_PROPS);

    expect(
      screen.getByTestId(
        "enterprise-setting-license-read-only-notice-ip-allowlists",
      ),
    ).toHaveTextContent(
      "An allowlist already set is still enforced, and you can still remove it.",
    );
    expect(screen.getByTestId("recorded-card")).toBeInTheDocument();
  });

  test("a license that leaves IP allowlists out says so", () => {
    licenseModeForTest = "not-included";

    renderCard(STATUS_PAGE_PROPS);

    expect(
      screen.getByTestId(
        "enterprise-setting-license-not-included-notice-ip-allowlists",
      ),
    ).toBeInTheDocument();
  });
});

describe("the card's title", () => {
  test("a form's card is called Access, as its Share page always called it", () => {
    const card: Recorded = renderCard(PAGES[2]![1]);

    expect((card["cardProps"] as Record<string, unknown>)["title"]).toBe(
      "Access",
    );
    expect(formFields(card)[0]!.title).toBe(FormsCopy.ipAllowlistTitle);
  });

  test("a status page's and a dashboard's cards are called by the allowlist's own title", () => {
    for (const [, props] of PAGES.slice(0, 2)) {
      cleanup();
      recordedCards.length = 0;

      const card: Recorded = renderCard(props);

      expect((card["cardProps"] as Record<string, unknown>)["title"]).toBe(
        props.title,
      );
    }
  });
});
