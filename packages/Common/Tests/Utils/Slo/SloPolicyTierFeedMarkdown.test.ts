import { describe, expect, test } from "@jest/globals";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import FeedMarkdown, { MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  SloFeedMarkdown,
  getSloPolicyTierChangedFeedMarkdown,
} from "../../../Utils/Slo/SloFeedMarkdown";
import { getSloPolicyTierColor } from "../../../Utils/Slo/SloStatusColor";

/*
 * ErrorBudgetPolicyTierChanged: what the SLO feed says when an SLO enters,
 * moves between or leaves the tiers of its error budget policy. Feeds render
 * without the viewer's safe mode, so every name is placed as text and the
 * tier's "what we do" - Markdown a person wrote - as Markdown.
 */

const SLO_LINK: MarkdownText = FeedMarkdown.asMarkdown(
  "[SLO Checkout](https://oneuptime.com/dashboard/project-1/slos/slo-1)",
);

const RELIABILITY_FIRST: {
  name: string;
  thresholdPercentage: number;
  whatWeDo: string;
} = {
  name: "Reliability first",
  thresholdPercentage: 25,
  whatWeDo: "Only **reliability** work ships.\n\n- critical fixes\n- rollbacks",
};

function changed(
  overrides: Partial<Parameters<typeof getSloPolicyTierChangedFeedMarkdown>[0]>,
): SloFeedMarkdown {
  return getSloPolicyTierChangedFeedMarkdown({
    sloMarkdownLink: SLO_LINK,
    previousTierName: "Caution",
    newTier: RELIABILITY_FIRST,
    isEscalation: true,
    errorBudgetRemainingPercentage: 18.5,
    errorBudgetRemainingSeconds: 480,
    ...overrides,
  });
}

describe("getSloPolicyTierChangedFeedMarkdown", () => {
  test("entering a more severe tier", () => {
    const markdown: SloFeedMarkdown = changed({});

    expect(markdown.feedInfoInMarkdown).toBe(
      "📉 [SLO Checkout](https://oneuptime.com/dashboard/project-1/slos/slo-1) entered the **Reliability first** tier of its error budget policy (was **Caution**).",
    );
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Error budget policy tier**: Caution → Reliability first",
    );
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Error budget remaining**: 18.5% (8 minutes)",
    );
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Tier applies while**: the error budget left is at or below 25%",
    );
  });

  test("entering the first tier says nothing about one before it", () => {
    const markdown: SloFeedMarkdown = changed({ previousTierName: null });

    expect(markdown.feedInfoInMarkdown).toBe(
      "📉 [SLO Checkout](https://oneuptime.com/dashboard/project-1/slos/slo-1) entered the **Reliability first** tier of its error budget policy.",
    );
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Error budget policy tier**: none → Reliability first",
    );
  });

  test("recovering to a less severe tier", () => {
    const markdown: SloFeedMarkdown = changed({
      previousTierName: "Budget exhausted",
      isEscalation: false,
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      "📈 [SLO Checkout](https://oneuptime.com/dashboard/project-1/slos/slo-1) recovered to the **Reliability first** tier of its error budget policy (was **Budget exhausted**).",
    );
  });

  test("leaving the last tier", () => {
    const markdown: SloFeedMarkdown = changed({
      newTier: null,
      isEscalation: false,
      errorBudgetRemainingPercentage: 61,
      errorBudgetRemainingSeconds: 1580,
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      "✅ [SLO Checkout](https://oneuptime.com/dashboard/project-1/slos/slo-1) left the **Caution** tier of its error budget policy: its error budget is above every tier again.",
    );
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Error budget policy tier**: Caution → none",
    );
    expect(markdown.moreInformationInMarkdown).not.toContain("What we do");
    expect(markdown.moreInformationInMarkdown).not.toContain(
      "Tier applies while",
    );
  });

  test("an overspent budget says by how much", () => {
    const markdown: SloFeedMarkdown = changed({
      errorBudgetRemainingPercentage: -12.5,
      errorBudgetRemainingSeconds: -324,
    });

    expect(markdown.moreInformationInMarkdown).toContain(
      "**Error budget remaining**: -12.5% (over budget by 5 minutes)",
    );
  });

  test("the tier's agreement goes in as the Markdown the team wrote", () => {
    const markdown: SloFeedMarkdown = changed({});

    expect(markdown.moreInformationInMarkdown).toContain(
      "**What we do**:\n\nOnly **reliability** work ships.\n\n- critical fixes\n- rollbacks",
    );
  });

  test("a blank agreement adds no empty heading", () => {
    const markdown: SloFeedMarkdown = changed({
      newTier: { ...RELIABILITY_FIRST, whatWeDo: "   " },
    });

    expect(markdown.moreInformationInMarkdown).not.toContain("What we do");
  });

  test("tier names are text: they cannot restyle the item or move a link", () => {
    const markdown: SloFeedMarkdown = changed({
      previousTierName: "**x**](https://evil)",
      newTier: {
        ...RELIABILITY_FIRST,
        name: "[Click](https://evil) _now_",
      },
    });

    expect(markdown.feedInfoInMarkdown).not.toContain("[Click](https://evil)");
    expect(markdown.feedInfoInMarkdown).not.toContain("**x**](https://evil)");
    expect(markdown.moreInformationInMarkdown).not.toContain(
      "[Click](https://evil)",
    );
  });
});

describe("getSloPolicyTierColor", () => {
  test("a tier at 0% is red like Budget Exhausted, any other yellow, none green", () => {
    expect(getSloPolicyTierColor({ thresholdPercentage: 0 })).toBe(Red);
    expect(getSloPolicyTierColor({ thresholdPercentage: "0" })).toBe(Red);
    expect(getSloPolicyTierColor({ thresholdPercentage: 25 })).toBe(Yellow);
    expect(getSloPolicyTierColor({ thresholdPercentage: 100 })).toBe(Yellow);
    expect(getSloPolicyTierColor(null)).toBe(Green);
    expect(getSloPolicyTierColor(undefined)).toBe(Green);
  });

  test("a tier with no valid threshold is still a tier: yellow", () => {
    expect(getSloPolicyTierColor({ thresholdPercentage: "x" })).toBe(Yellow);
  });
});
