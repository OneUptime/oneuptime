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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import {
  CloudAccountSavingsSummary,
  CloudCostState,
} from "../../../Types/Cloud/CloudCost";
import {
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
  CloudCommitmentSummary,
} from "../../../Types/Cloud/CloudCommitments";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudCommitmentsCard, {
  COMMITMENTS_SHOWN,
  COMMITMENTS_TITLE,
  getCloudCommitmentCoverageWords,
  getCloudCommitmentKindsToShow,
  getCloudCommitmentRows,
  getCloudCommitmentUseWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCommitmentsCard";
import { CloudAccountRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";

/*
 * COMMITMENTS, on Cloud > Savings and an account's Costs: how much of the
 * last 30 days' spend each account's Savings Plans, reservations and
 * committed use discounts paid for, and how much of them was used - each
 * kind its cloud has on a line of its own, never added together; an
 * account whose commitments could not be read with why; nothing at all
 * when no account has anything to say.
 */

// A translator over one of the Dashboard's locale files, as the page reads it.
function translatorOf(
  locale: Record<string, string>,
  language: string,
): Translator {
  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

const english: Translator = translatorOf(
  englishLocale as unknown as Record<string, string>,
  "en",
);
const german: Translator = translatorOf(
  germanLocale as unknown as Record<string, string>,
  "de",
);

function figures(
  overrides: Partial<CloudCommitmentKindFigures> & {
    kind: CloudCommitmentKind;
  },
): CloudCommitmentKindFigures {
  return {
    coveredSpend: 0,
    onDemandSpend: 0,
    commitmentSpend: null,
    unusedSpend: null,
    ...overrides,
  };
}

function commitments(
  overrides: Partial<CloudCommitmentSummary> = {},
): CloudCommitmentSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    days: 30,
    kinds: [],
    readAt: "2026-11-20T00:00:00.000Z",
    ...overrides,
  };
}

function savings(summary: CloudCommitmentSummary): CloudAccountSavingsSummary {
  return {
    state: CloudCostState.Reading,
    count: 0,
    monthlySavings: 0,
    byKind: {},
    currency: "USD",
    commitments: summary,
    readAt: "2026-11-20T00:00:00.000Z",
  };
}

let next: number = 0;

function account(data: {
  name: string;
  provider?: string;
  summary?: CloudCommitmentSummary | undefined;
}): CloudAccountRow {
  next++;

  return {
    id: new ObjectID(
      `10000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    ),
    name: data.name,
    provider: data.provider || "aws",
    accountId: `${100000000000 + next}`,
    lastSeenAt: new Date(),
    hasConnection: true,
    resourceCount: 3,
    costSummary: null,
    savingsSummary: data.summary ? savings(data.summary) : null,
  };
}

// AWS, with both kinds: Savings Plans covering some, a reservation all used.
const SHOP: CloudAccountRow = account({
  name: "shop-prod",
  summary: commitments({
    kinds: [
      figures({
        kind: CloudCommitmentKind.Reservations,
        coveredSpend: 1200,
        onDemandSpend: 0,
        commitmentSpend: 1000,
        unusedSpend: 0,
      }),
      figures({
        kind: CloudCommitmentKind.SavingsPlans,
        coveredSpend: 7872,
        onDemandSpend: 4428,
        commitmentSpend: 6000,
        unusedSpend: 210,
      }),
    ],
  }),
});

// Google Cloud: a discount whose unused share the export does not say.
const DATA: CloudAccountRow = account({
  name: "data-lake",
  provider: "gcp",
  summary: commitments({
    kinds: [
      figures({
        kind: CloudCommitmentKind.CommittedUseDiscounts,
        coveredSpend: 300,
        onDemandSpend: 700,
        commitmentSpend: 280,
        unusedSpend: null,
      }),
    ],
  }),
});

// Azure, with none: what ran on demand that one would pay less for.
const EU: CloudAccountRow = account({
  name: "eu-shop",
  provider: "azure",
  summary: commitments({
    currency: "EUR",
    kinds: [
      figures({
        kind: CloudCommitmentKind.SavingsPlans,
        coveredSpend: 0,
        onDemandSpend: 950,
        commitmentSpend: 0,
        unusedSpend: 0,
      }),
      // Nothing to cover and none had: no line.
      figures({ kind: CloudCommitmentKind.Reservations }),
    ],
  }),
});

// AWS, refused: why, in the cloud's words.
const REFUSED: CloudAccountRow = account({
  name: "staging",
  summary: commitments({
    state: CloudCostState.NotAllowed,
    message:
      "The role may not read Savings Plans (ce:GetSavingsPlansCoverage). Run the setup command again to allow it.",
  }),
});

// Read, and nothing to say: not listed.
const QUIET: CloudAccountRow = account({
  name: "sandbox",
  summary: commitments({
    kinds: [figures({ kind: CloudCommitmentKind.SavingsPlans })],
  }),
});

// Never read: not listed.
const NEW: CloudAccountRow = account({ name: "brand-new" });

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/savings`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openCard(
  props: Partial<React.ComponentProps<typeof CloudCommitmentsCard>> = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CloudCommitmentsCard
          accounts={[QUIET, REFUSED, EU, DATA, SHOP, NEW]}
          {...props}
        />
      </MemoryRouter>,
    );
  });
}

describe("the lines an account gets", () => {
  test("each kind it has or could have, in its cloud's order; one with nothing to say has none", () => {
    expect(
      getCloudCommitmentKindsToShow({
        provider: "aws",
        summary: SHOP.savingsSummary!.commitments!,
      }).map((entry: CloudCommitmentKindFigures) => {
        return entry.kind;
      }),
    ).toEqual([
      CloudCommitmentKind.SavingsPlans,
      CloudCommitmentKind.Reservations,
    ]);
    expect(
      getCloudCommitmentKindsToShow({
        provider: "azure",
        summary: EU.savingsSummary!.commitments!,
      }).map((entry: CloudCommitmentKindFigures) => {
        return entry.kind;
      }),
    ).toEqual([CloudCommitmentKind.SavingsPlans]);
  });

  test("the accounts listed: those with a commitment first, then by what one could cover; the quiet and the never read left out", () => {
    expect(
      getCloudCommitmentRows([QUIET, REFUSED, EU, DATA, SHOP, NEW]).map(
        (row: { account: CloudAccountRow }) => {
          return row.account.name;
        },
      ),
    ).toEqual(["shop-prod", "data-lake", "eu-shop", "staging"]);
  });
});

describe("the words of a line", () => {
  test("what it covers: a share and its money, all of it, or none with what ran on demand", () => {
    expect(
      getCloudCommitmentCoverageWords({
        figures: SHOP.savingsSummary!.commitments!.kinds[1]!,
        currency: "USD",
        translator: english,
      }),
    ).toEqual({
      headline: "Covers 64%",
      detail: "$7,872 of $12,300",
      percent: 64,
    });
    expect(
      getCloudCommitmentCoverageWords({
        figures: SHOP.savingsSummary!.commitments!.kinds[0]!,
        currency: "USD",
        translator: english,
      }).headline,
    ).toBe("Covers all eligible spend");
    expect(
      getCloudCommitmentCoverageWords({
        figures: EU.savingsSummary!.commitments!.kinds[0]!,
        currency: "EUR",
        translator: english,
      }),
    ).toEqual({
      headline: "No commitment",
      detail: "€950.00 ran at on-demand rates",
      percent: 0,
    });
  });

  test("what of it is used: a share and what was left, all of it, or that its cloud does not say", () => {
    expect(
      getCloudCommitmentUseWords({
        figures: SHOP.savingsSummary!.commitments!.kinds[1]!,
        currency: "USD",
        translator: english,
      }),
    ).toEqual({
      headline: "97% utilized",
      detail: "$210.00 unused",
      hasUnused: true,
    });
    expect(
      getCloudCommitmentUseWords({
        figures: SHOP.savingsSummary!.commitments!.kinds[0]!,
        currency: "USD",
        translator: english,
      }),
    ).toEqual({ headline: "Fully utilized", detail: "", hasUnused: false });
    expect(
      getCloudCommitmentUseWords({
        figures: DATA.savingsSummary!.commitments!.kinds[0]!,
        currency: "USD",
        translator: english,
      }),
    ).toEqual({
      headline: "Utilization not reported",
      detail: "",
      hasUnused: false,
    });
    // No commitment: nothing to say of its use.
    expect(
      getCloudCommitmentUseWords({
        figures: EU.savingsSummary!.commitments!.kinds[0]!,
        currency: "EUR",
        translator: english,
      }),
    ).toBeNull();
  });

  test("in the reader's language: German words and German numbers", () => {
    const coverage: { headline: string; detail: string } =
      getCloudCommitmentCoverageWords({
        figures: SHOP.savingsSummary!.commitments!.kinds[1]!,
        currency: "USD",
        translator: german,
      });

    expect(german.hasTranslation("Covers {{percent}}")).toBe(true);
    expect(coverage.headline).not.toContain("Covers");
    expect(coverage.headline).toContain("64");
    expect(coverage.detail).toContain("7.872");
    expect(
      getCloudCommitmentUseWords({
        figures: SHOP.savingsSummary!.commitments!.kinds[1]!,
        currency: "USD",
        translator: german,
      })!.headline,
    ).not.toContain("utilized");
  });
});

describe("the card", () => {
  test("an account a line, each kind its own: what it covers with a bar, what of it is used", async () => {
    await openCard();

    expect(screen.getByText(COMMITMENTS_TITLE)).toBeInTheDocument();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-commitment-account",
    );
    expect(
      rows.map((row: HTMLElement) => {
        return row.getAttribute("data-state");
      }),
    ).toEqual([
      CloudCostState.Reading,
      CloudCostState.Reading,
      CloudCostState.Reading,
      CloudCostState.NotAllowed,
    ]);

    const shop: HTMLElement = rows[0]!;
    const kinds: Array<HTMLElement> = within(shop).getAllByTestId(
      "cloud-commitment-kind",
    );
    expect(
      kinds.map((kind: HTMLElement) => {
        return kind.getAttribute("data-kind");
      }),
    ).toEqual([
      CloudCommitmentKind.SavingsPlans,
      CloudCommitmentKind.Reservations,
    ]);
    // Each cloud's own name for its kinds.
    expect(kinds[0]).toHaveTextContent("Savings Plans");
    expect(kinds[1]).toHaveTextContent("Reserved Instances");
    expect(
      within(kinds[0]!).getByTestId("cloud-commitment-coverage"),
    ).toHaveTextContent("Covers 64%");
    expect(
      within(kinds[0]!).getByTestId("cloud-commitment-coverage-bar"),
    ).toHaveStyle({ width: "64%" });
    expect(
      within(kinds[0]!).getByTestId("cloud-commitment-use-detail"),
    ).toHaveTextContent("$210.00 unused");
    expect(
      within(kinds[0]!).getByTestId("cloud-commitment-use-detail"),
    ).toHaveClass("text-amber-700");
    expect(
      within(kinds[1]!).getByTestId("cloud-commitment-use"),
    ).toHaveTextContent("Fully utilized");

    // Google Cloud's and Azure's own names.
    expect(rows[1]).toHaveTextContent("Committed use discounts");
    expect(rows[1]).toHaveTextContent("Utilization not reported");
    expect(rows[2]).toHaveTextContent("Savings plans");
    expect(rows[2]).toHaveTextContent("No commitment");
    expect(rows[2]).toHaveTextContent("€950.00 ran at on-demand rates");
    expect(rows[2]).not.toHaveTextContent("Reservations");
    // None: an empty bar, not a sliver.
    expect(
      within(rows[2]!).queryByTestId("cloud-commitment-coverage-bar"),
    ).toBeNull();
  });

  test("each account's name opens its Costs; an account that could not be read says why, in its cloud's words", async () => {
    await openCard();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-commitment-account",
    );

    expect(
      within(rows[0]!).getByTestId("cloud-commitment-account-name"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/accounts/${SHOP.id.toString()}/costs`),
    );

    const refused: HTMLElement = rows[3]!;
    expect(refused).toHaveTextContent("staging");
    expect(
      within(refused).getByTestId("cloud-commitment-message"),
    ).toHaveTextContent("ce:GetSavingsPlansCoverage");
    expect(
      within(refused).getByTestId("cloud-commitment-message"),
    ).toHaveAttribute("dir", "auto");
    expect(within(refused).queryByTestId("cloud-commitment-kind")).toBeNull();
  });

  test("an organization's management account says its figures are every account's", async () => {
    const organization: CloudAccountRow = account({
      name: "management",
      summary: commitments({
        isOrganization: true,
        kinds: [
          figures({
            kind: CloudCommitmentKind.SavingsPlans,
            coveredSpend: 10,
            onDemandSpend: 10,
            commitmentSpend: 10,
            unusedSpend: 0,
          }),
        ],
      }),
    });

    await openCard({ accounts: [organization] });

    expect(screen.getByTestId("cloud-commitments")).toHaveTextContent(
      "Every account of the organization",
    );
  });

  test("on an account's own Costs: its name, not a link to where it already is", async () => {
    await openCard({ accounts: [SHOP], isOneAccount: true });

    expect(screen.queryByTestId("cloud-commitment-account-name")).toBeNull();
    expect(screen.getByTestId("cloud-commitment-account")).toHaveTextContent(
      "shop-prod",
    );
  });

  test(`the first ${COMMITMENTS_SHOWN}, then the rest on asking`, async () => {
    const many: Array<CloudAccountRow> = Array.from(
      { length: COMMITMENTS_SHOWN + 2 },
      (_: unknown, index: number): CloudAccountRow => {
        return account({
          name: `account-${index + 1}`,
          summary: commitments({
            kinds: [
              figures({
                kind: CloudCommitmentKind.SavingsPlans,
                coveredSpend: 100 - index,
                onDemandSpend: 10,
                commitmentSpend: 50,
                unusedSpend: 0,
              }),
            ],
          }),
        });
      },
    );

    await openCard({ accounts: many });

    expect(screen.getAllByTestId("cloud-commitment-account")).toHaveLength(
      COMMITMENTS_SHOWN,
    );

    const toggle: HTMLElement = screen.getByTestId("cloud-commitments-toggle");
    expect(toggle).toHaveTextContent("Show 2 more");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.getAllByTestId("cloud-commitment-account")).toHaveLength(
      COMMITMENTS_SHOWN + 2,
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("Show less");
  });

  test("no account with anything to say: no card at all", async () => {
    await openCard({ accounts: [QUIET, NEW] });

    expect(screen.queryByTestId("cloud-commitments")).toBeNull();
    expect(screen.queryByText(COMMITMENTS_TITLE)).toBeNull();
  });
});
