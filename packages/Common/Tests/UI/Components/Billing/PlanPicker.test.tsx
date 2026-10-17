import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import PlanPicker from "../../../../UI/Components/Billing/PlanPicker/PlanPicker";
import SubscriptionPlan from "../../../../Types/Billing/SubscriptionPlan";
import { BillingPeriod } from "../../../../Types/Billing/SubscriptionPlanPricing";
import { PRICING_PAGE_URL } from "../../../../Types/Billing/PayAsYouGoPricing";
import Input from "../../../../UI/Components/Input/Input";
import { NEW_TAB_DESCRIPTION } from "../../../../UI/Components/Markdown.tsx/MarkdownLink";

/*
 * The plan picker of the Create New Project dialog (PlanPicker): one radio
 * per plan, under a Monthly | Yearly switch, over a line that says what the
 * picked plan costs. Its value is the plan's Stripe price for the period
 * shown, so the period travels with the plan.
 */

const FREE: SubscriptionPlan = new SubscriptionPlan(
  "price_free_month",
  "price_free_year",
  "Free",
  0,
  0,
  1,
  0,
);
const GROWTH: SubscriptionPlan = new SubscriptionPlan(
  "price_growth_month",
  "price_growth_year",
  "Growth",
  22,
  20,
  2,
  14,
);
const SCALE: SubscriptionPlan = new SubscriptionPlan(
  "price_scale_month",
  "price_scale_year",
  "Scale",
  99,
  84,
  3,
  14,
);
const ENTERPRISE: SubscriptionPlan = new SubscriptionPlan(
  "price_enterprise_month",
  "price_enterprise_year",
  "Enterprise",
  -1,
  -1,
  4,
  14,
);

const CLOUD_PLANS: Array<SubscriptionPlan> = [FREE, GROWTH, SCALE, ENTERPRISE];

const onChange: MockFunction = getJestMockFunction();

/*
 * The picker as a form holds it: the value it is given is the last one it
 * handed out.
 */
const Controlled: (props: {
  plans?: Array<SubscriptionPlan>;
  initialValue?: string;
  initialPeriod?: BillingPeriod;
  error?: string;
}) => ReactElement = (props: {
  plans?: Array<SubscriptionPlan>;
  initialValue?: string;
  initialPeriod?: BillingPeriod;
  error?: string;
}): ReactElement => {
  const [value, setValue] = useState<string>(props.initialValue || "");

  return (
    <>
      <PlanPicker
        plans={props.plans || CLOUD_PLANS}
        value={value}
        initialPeriod={props.initialPeriod}
        error={props.error}
        onChange={(planId: string) => {
          onChange(planId);
          setValue(planId);
        }}
      />
      <button
        type="button"
        data-testid="set-from-outside"
        onClick={() => {
          setValue("price_scale_month");
        }}
      >
        set
      </button>
    </>
  );
};

function radio(planName: string): HTMLInputElement {
  return screen.getByRole("radio", { name: planName }) as HTMLInputElement;
}

function row(planName: string): HTMLElement {
  return screen.getByTestId(`plan-picker-option-${planName}`);
}

function period(name: "monthly" | "yearly"): HTMLElement {
  return screen.getByTestId(`plan-picker-period-${name}`);
}

function termsText(): string {
  return (screen.queryByTestId("plan-picker-terms")?.textContent || "").trim();
}

function describedText(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") || "")
    .split(" ")
    .filter((id: string): boolean => {
      return id.length > 0;
    })
    .map((id: string): string => {
      return (document.getElementById(id)?.textContent || "").trim();
    })
    .join(" | ");
}

beforeEach(() => {
  onChange.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PlanPicker", () => {
  it("lists the plans in the deployment's order, each a radio named by the plan", () => {
    render(<Controlled />);

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: "Plan",
    });
    const names: Array<string> = within(group)
      .getAllByRole("radio")
      .map((element: HTMLElement): string => {
        return (
          document.getElementById(element.getAttribute("aria-labelledby")!)
            ?.textContent || ""
        );
      });

    expect(names).toEqual(["Free", "Growth", "Scale", "Enterprise"]);

    // One group: the browser moves between them with the arrow keys.
    const groupNames: Set<string | null> = new Set(
      within(group)
        .getAllByRole("radio")
        .map((element: HTMLElement): string | null => {
          return element.getAttribute("name");
        }),
    );
    expect(groupNames.size).toBe(1);
  });

  it("reads each plan's trial, who it is for and its price with its radio", () => {
    render(<Controlled />);

    // Real spaces between the price's pieces: "$20 per user", not "$20per user".
    expect(describedText(radio("Growth"))).toBe(
      "14-day free trial | For teams. On-call, workflows, integrations and API access. | $20 per user / month billed yearly",
    );
    expect(describedText(radio("Free"))).toBe(
      "For one person getting started. | $0",
    );
    expect(describedText(radio("Enterprise"))).toBe(
      "14-day free trial | Custom terms, a dedicated engineer and phone support. | Custom Price",
    );
  });

  it("opens on Yearly, with the yearly prices", () => {
    render(<Controlled />);

    expect(period("yearly")).toHaveAttribute("aria-pressed", "true");
    expect(period("monthly")).toHaveAttribute("aria-pressed", "false");
    expect(within(row("Growth")).getByText("$20")).toBeVisible();
    expect(within(row("Scale")).getByText("$84")).toBeVisible();
    expect(within(row("Growth")).getByText("billed yearly")).toBeVisible();
  });

  it("opens on the period it is told to when nothing is picked", () => {
    render(<Controlled initialPeriod={BillingPeriod.Monthly} />);

    expect(period("monthly")).toHaveAttribute("aria-pressed", "true");
    expect(within(row("Growth")).getByText("$22")).toBeVisible();
  });

  it("opens on the period of the price it is given, with that plan picked", () => {
    render(<Controlled initialValue="price_growth_month" />);

    expect(period("monthly")).toHaveAttribute("aria-pressed", "true");
    expect(radio("Growth")).toBeChecked();
    expect(termsText()).toContain("Then $22 per user, billed monthly.");
  });

  it("follows a value set from outside, period and all", () => {
    render(<Controlled initialValue="price_growth_year" />);

    act(() => {
      fireEvent.click(screen.getByTestId("set-from-outside"));
    });

    expect(radio("Scale")).toBeChecked();
    expect(period("monthly")).toHaveAttribute("aria-pressed", "true");
    expect(within(row("Scale")).getByText("$99")).toBeVisible();
  });

  it("picking a plan hands out its price for the period shown", () => {
    render(<Controlled />);

    act(() => {
      fireEvent.click(radio("Scale"));
    });
    expect(onChange).toHaveBeenLastCalledWith("price_scale_year");
    expect(radio("Scale")).toBeChecked();
    expect(row("Scale")).toHaveAttribute("data-selected", "true");

    act(() => {
      fireEvent.click(period("monthly"));
    });
    act(() => {
      fireEvent.click(radio("Growth"));
    });
    expect(onChange).toHaveBeenLastCalledWith("price_growth_month");
  });

  it("clicking anywhere on a plan's row picks it", () => {
    render(<Controlled />);

    act(() => {
      fireEvent.click(within(row("Enterprise")).getByText("Custom Price"));
    });

    expect(onChange).toHaveBeenLastCalledWith("price_enterprise_year");
    expect(radio("Enterprise")).toBeChecked();
  });

  it("switching the period keeps the picked plan, at the other period's price", () => {
    render(<Controlled initialValue="price_growth_year" />);

    act(() => {
      fireEvent.click(period("monthly"));
    });
    expect(onChange).toHaveBeenLastCalledWith("price_growth_month");
    expect(radio("Growth")).toBeChecked();
    expect(within(row("Growth")).getByText("$22")).toBeVisible();

    act(() => {
      fireEvent.click(period("yearly"));
    });
    expect(onChange).toHaveBeenLastCalledWith("price_growth_year");
  });

  it("switching the period with nothing picked picks nothing", () => {
    render(<Controlled />);

    act(() => {
      fireEvent.click(period("monthly"));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(within(row("Scale")).getByText("$99")).toBeVisible();
    expect(screen.queryByTestId("plan-picker-terms")).toBeNull();
  });

  it("pressing the period already shown does nothing", () => {
    render(<Controlled initialValue="price_growth_year" />);

    act(() => {
      fireEvent.click(period("yearly"));
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("says what picking the plan means, in a region a screen reader hears", () => {
    render(<Controlled initialValue="price_free_year" />);

    const panel: HTMLElement = screen.getByTestId("plan-picker-terms");

    expect(panel).toHaveAttribute("aria-live", "polite");
    expect(
      within(panel).getByTestId("plan-picker-terms-headline"),
    ).toHaveTextContent("Free forever.");

    act(() => {
      fireEvent.click(radio("Scale"));
    });

    expect(
      within(panel).getByTestId("plan-picker-terms-headline"),
    ).toHaveTextContent("Free for 14 days, no card needed to start.");
    expect(
      within(panel).getByTestId("plan-picker-terms-details"),
    ).toHaveTextContent(
      "Then $1,008 per user, billed yearly. Active monitors and telemetry are pay as you go. Compare plans",
    );
  });

  it("links to the pricing page to compare the plans, in a new tab", () => {
    render(<Controlled initialValue="price_free_year" />);

    const link: HTMLElement = screen.getByTestId("plan-picker-compare-plans");

    expect(link.getAttribute("href")).toBe(PRICING_PAGE_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("marks the link as opening a new tab, and keeps it whole on one line", () => {
    render(<Controlled initialValue="price_growth_year" />);

    const link: HTMLElement = screen.getByTestId("plan-picker-compare-plans");

    // What a screen reader is told, as every link to a tab of its own says.
    expect(link).toHaveAttribute("aria-description", NEW_TAB_DESCRIPTION);
    // The mark a sighted reader sees for the same thing.
    expect(link.querySelector("svg")).not.toBeNull();
    // "Compare / plans" broke over two lines at the end of a long note.
    expect(link).toHaveClass("whitespace-nowrap");
    expect(link).toHaveTextContent("Compare plans");
  });

  it("shows what yearly saves, worked out from the prices", () => {
    render(<Controlled />);

    expect(screen.getByTestId("plan-picker-saving")).toHaveTextContent(
      "Save up to 15%",
    );
  });

  it("says nothing about saving when no plan is cheaper yearly", () => {
    const flat: SubscriptionPlan = new SubscriptionPlan(
      "flat_month",
      "flat_year",
      "Growth",
      20,
      20,
      2,
      0,
    );

    render(<Controlled plans={[FREE, flat]} />);

    expect(screen.queryByTestId("plan-picker-saving")).toBeNull();
    expect(screen.queryByText(/Save/)).toBeNull();
  });

  it("shows the form's error under the plans, and marks the group invalid", () => {
    render(<Controlled error="Plan is required." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Plan is required.");
    expect(screen.getByRole("radiogroup", { name: "Plan" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("reads the error with the group, and draws the plans in the red a text field takes", () => {
    render(<Controlled error="Plan is required." />);

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: "Plan",
    });

    expect(group).toHaveAccessibleDescription("Plan is required.");
    expect(group).toHaveAttribute("data-invalid", "true");

    // Input's own error border, which the dark theme softens as well.
    for (const planName of ["Free", "Growth", "Scale", "Enterprise"]) {
      expect(row(planName)).toHaveClass("border-red-300");
      expect(row(planName)).not.toHaveClass("border-gray-200");
    }
  });

  it("writes its error as the dialog's text fields write theirs", () => {
    /*
     * The Create New Project dialog can show "Project Name is required."
     * (Input) and "Plan is required." at once: they were two reds at two
     * gaps.
     */
    const { container } = render(
      <Input value="" onChange={() => {}} error="Project Name is required." />,
    );
    const inputError: HTMLElement = within(container).getByRole("alert");

    render(<Controlled error="Plan is required." />);

    const planError: HTMLElement | undefined = screen
      .getAllByRole("alert")
      .find((element: HTMLElement): boolean => {
        return element.textContent === "Plan is required.";
      });

    expect(planError).toBeDefined();
    expect(planError?.className).toBe(inputError.className);
  });

  it("has no red outline without an error", () => {
    render(<Controlled initialValue="price_growth_year" />);

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: "Plan",
    });

    expect(group).not.toHaveAttribute("data-invalid");
    expect(group).not.toHaveAttribute("aria-describedby");

    for (const planName of ["Free", "Growth", "Scale", "Enterprise"]) {
      expect(row(planName).className).not.toContain("red");
    }

    expect(row("Free")).toHaveClass("border-gray-200");
    expect(row("Growth")).toHaveClass("border-indigo-300");
  });

  it("keeps each piece of a price whole, with how it is billed on a line of its own", () => {
    render(<Controlled />);

    const price: HTMLElement = within(row("Growth")).getByText("$20")
      .parentElement as HTMLElement;
    const unit: HTMLElement = within(price).getByText("per user / month");
    const caption: HTMLElement = within(price).getByText("billed yearly");

    /*
     * "оплата / ежегодно": a 360px phone in Russian broke the caption in
     * two, and put the dot that led it at the start of a line.
     */
    expect(unit).toHaveClass("whitespace-nowrap");
    expect(caption).toHaveClass("whitespace-nowrap");
    expect(caption).toHaveClass("block");
    expect(price.textContent).not.toContain("·");
  });

  it("is not invalid without an error", () => {
    render(<Controlled />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("radiogroup", { name: "Plan" }),
    ).not.toHaveAttribute("aria-invalid");
  });

  it("names the billing period switch for a screen reader", () => {
    render(<Controlled />);

    const switcher: HTMLElement = screen.getByRole("group", {
      name: "Billing period",
    });

    expect(within(switcher).getAllByRole("button")).toHaveLength(2);
    expect(within(switcher).getByText("Monthly")).toBeVisible();
    expect(within(switcher).getByText("Yearly")).toBeVisible();
  });
});
