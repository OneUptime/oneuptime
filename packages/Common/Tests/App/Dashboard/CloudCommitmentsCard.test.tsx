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
  COMMITMENT_KIND_CLASS_NAME,
  COMMITMENT_KIND_LABEL_CLASS_NAME,
  getCloudCommitmentCoverageWords,
  getCloudCommitmentKindsToShow,
  getCloudCommitmentRows,
  getCloudCommitmentUseWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCommitmentsCard";
import {
  COMMITMENT_SETUP_STEPS,
  COST_SETUP_DOCS_PATHS,
  COST_SETUP_STEPS,
  getCloudCommitmentSetupStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostWords";
import { cloudConnectionDocsUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectApi";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
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

// A Tailwind variant keyed to the window's width (sm:, md:, lg:...).
const SCREEN_VARIANT: RegExp = /(^|\s)(sm|md|lg|xl|2xl):/;

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
      isReported: true,
    });
    expect(
      getCloudCommitmentUseWords({
        figures: SHOP.savingsSummary!.commitments!.kinds[0]!,
        currency: "USD",
        translator: english,
      }),
    ).toEqual({
      headline: "Fully utilized",
      detail: "",
      hasUnused: false,
      isReported: true,
    });
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
      isReported: false,
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

describe("what to do when an account's are not read", () => {
  test("a refusal on every cloud, and Google Cloud with no billing export named; nothing where no step fits", () => {
    for (const provider of [
      CloudProvider.AWS,
      CloudProvider.Azure,
      CloudProvider.GCP,
    ]) {
      expect(
        getCloudCommitmentSetupStep({
          provider,
          state: CloudCostState.NotAllowed,
        }),
      ).toBe(COMMITMENT_SETUP_STEPS[provider]);
      // A failed read is tried again tomorrow; a read one needs nothing.
      expect(
        getCloudCommitmentSetupStep({ provider, state: CloudCostState.Failed }),
      ).toBeUndefined();
      expect(
        getCloudCommitmentSetupStep({
          provider,
          state: CloudCostState.Reading,
        }),
      ).toBeUndefined();
    }

    // Google Cloud reads them from the billing export, as its costs.
    expect(
      getCloudCommitmentSetupStep({
        provider: CloudProvider.GCP,
        state: CloudCostState.NotSetUp,
      }),
    ).toBe(COST_SETUP_STEPS[CloudProvider.GCP]);
    // A GovCloud account, an Azure offer Cost Management does not answer for.
    expect(
      getCloudCommitmentSetupStep({
        provider: CloudProvider.AWS,
        state: CloudCostState.NotSetUp,
      }),
    ).toBeUndefined();
    expect(
      getCloudCommitmentSetupStep({
        provider: CloudProvider.Azure,
        state: CloudCostState.NotSetUp,
      }),
    ).toBeUndefined();
    // A cloud the card does not know: no step.
    expect(
      getCloudCommitmentSetupStep({
        provider: "oracle",
        state: CloudCostState.NotAllowed,
      }),
    ).toBeUndefined();
  });

  test("Azure's and Google Cloud's steps are their costs' own; AWS's names what it reads", () => {
    expect(COMMITMENT_SETUP_STEPS[CloudProvider.Azure]).toBe(
      COST_SETUP_STEPS[CloudProvider.Azure],
    );
    expect(COMMITMENT_SETUP_STEPS[CloudProvider.GCP]).toBe(
      COST_SETUP_STEPS[CloudProvider.GCP],
    );
    expect(COMMITMENT_SETUP_STEPS[CloudProvider.AWS]).toContain(
      "Savings Plans and Reserved Instances",
    );
  });

  test("in the reader's language", () => {
    expect(
      german.hasTranslation(COMMITMENT_SETUP_STEPS[CloudProvider.AWS]),
    ).toBe(true);
    expect(
      german.translateText(COMMITMENT_SETUP_STEPS[CloudProvider.AWS]),
    ).toContain("Einrichtungsbefehl");
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

    /*
     * What to do, in the reader's words, after the cloud's: the step and
     * its cloud's section of the guide, as Accounts left out says it - so
     * a phone that cuts the cloud's words at three lines still says it.
     */
    const step: HTMLElement = within(refused).getByTestId(
      "cloud-commitment-step",
    );
    expect(step).toHaveTextContent(
      "Run the connection's setup command again: it lets the connection read Savings Plans and Reserved Instances.",
    );
    const guide: HTMLElement = within(step).getByRole("link", {
      name: "Read the guide",
    });
    expect(guide).toHaveAttribute(
      "href",
      cloudConnectionDocsUrl(
        COST_SETUP_DOCS_PATHS[CloudProvider.AWS],
      ).toString(),
    );
    expect(guide).toHaveAttribute("target", "_blank");
    expect(guide).toHaveAttribute("rel", "noopener noreferrer");
    // After the cloud's words, never before them.
    expect(
      within(refused)
        .getByTestId("cloud-commitment-message")
        .compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Accounts that were read have no step.
    for (const row of rows.slice(0, 3)) {
      expect(within(row).queryByTestId("cloud-commitment-step")).toBeNull();
    }
  });

  test("Google Cloud's utilization, which its export does not say, is drawn quieter than a figure", async () => {
    await openCard();

    const notReported: HTMLElement = within(
      screen.getAllByTestId("cloud-commitment-account")[1]!,
    ).getByTestId("cloud-commitment-use");
    expect(notReported).toHaveTextContent("Utilization not reported");
    expect(notReported).toHaveAttribute("data-reported", "false");
    expect(notReported).toHaveClass("text-gray-500");
    expect(notReported).not.toHaveClass("font-medium");

    const reported: HTMLElement = within(
      screen.getAllByTestId("cloud-commitment-account")[0]!,
    ).getAllByTestId("cloud-commitment-use")[0]!;
    expect(reported).toHaveAttribute("data-reported", "true");
    expect(reported).toHaveClass("font-medium", "text-gray-900");
  });

  test("a kind's line is laid out by its account's column, not the window: three side by side, its name over two, or one under another", async () => {
    await openCard();

    const shop: HTMLElement = screen.getAllByTestId(
      "cloud-commitment-account",
    )[0]!;
    const kind: HTMLElement = within(shop).getAllByTestId(
      "cloud-commitment-kind",
    )[0]!;

    // The account's column is the container the line is measured by.
    expect(kind.parentElement!.parentElement).toHaveClass(
      "[container-type:inline-size]",
    );
    expect(kind.className).toBe(COMMITMENT_KIND_CLASS_NAME);
    expect((kind.firstElementChild as HTMLElement).className).toBe(
      COMMITMENT_KIND_LABEL_CLASS_NAME,
    );
    expect(COMMITMENT_KIND_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "grid-cols-1",
        "[@container(min-width:22rem)]:grid-cols-2",
        "[@container(min-width:34rem)]:grid-cols-3",
      ]),
    );
    // Its name over the two figures, then beside them.
    expect(COMMITMENT_KIND_LABEL_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "[@container(min-width:22rem)]:col-span-2",
        "[@container(min-width:34rem)]:col-span-1",
      ]),
    );
    // Never the window's width: a record page's side menu halves the card.
    expect(COMMITMENT_KIND_CLASS_NAME).not.toMatch(SCREEN_VARIANT);
    expect(COMMITMENT_KIND_LABEL_CLASS_NAME).not.toMatch(SCREEN_VARIANT);
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

  test("on an account's own Costs: the page is the account's, so its kinds come first, its name nowhere", async () => {
    await openCard({ accounts: [SHOP], isOneAccount: true });

    const row: HTMLElement = screen.getByTestId("cloud-commitment-account");
    expect(screen.queryByTestId("cloud-commitment-account-name")).toBeNull();
    expect(row).not.toHaveTextContent("shop-prod");
    // No logo either: the row is the kinds alone.
    expect(row.firstElementChild).toHaveClass("[container-type:inline-size]");
    expect(within(row).getAllByTestId("cloud-commitment-kind")).toHaveLength(2);
    expect(
      (row.firstElementChild as HTMLElement).firstElementChild,
    ).toHaveAttribute("data-testid", "cloud-commitment-kinds");
  });

  test("on an account's own Costs, not read: its state, its cloud's words and what to do - still no name", async () => {
    await openCard({ accounts: [REFUSED], isOneAccount: true });

    const row: HTMLElement = screen.getByTestId("cloud-commitment-account");
    expect(row).not.toHaveTextContent("staging");
    expect(row).toHaveTextContent("Needs permission");
    expect(
      within(row).getByTestId("cloud-commitment-message"),
    ).toHaveTextContent("ce:GetSavingsPlansCoverage");
    expect(within(row).getByTestId("cloud-commitment-step")).toHaveTextContent(
      COMMITMENT_SETUP_STEPS[CloudProvider.AWS],
    );
  });

  test("an organization's figures on its management account's own page: the note first, no name", async () => {
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

    await openCard({ accounts: [organization], isOneAccount: true });

    const row: HTMLElement = screen.getByTestId("cloud-commitment-account");
    expect(row).not.toHaveTextContent("management");
    const note: HTMLElement = within(row).getByTestId(
      "cloud-commitment-organization",
    );
    expect(note).toHaveTextContent("Every account of the organization");
    // Nothing above it to keep apart from.
    expect(note).not.toHaveClass("mt-0.5");
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
