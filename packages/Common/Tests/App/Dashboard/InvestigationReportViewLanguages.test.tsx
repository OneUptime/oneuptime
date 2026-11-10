import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";

/*
 * A REPORT WRITTEN IN THE LANGUAGE THE TEAM ASKED FOR, ON THE AI CARD
 * (InvestigationReportView, issue #6542).
 *
 * A team that reads OneUptime in Chinese wrote "用中文回复" in its AI
 * context, and its reports came out in English. OneUptime AI now writes
 * them in Chinese, headings included, and the card lays a Chinese report
 * out exactly as it lays out the English one: the summary lifted on top,
 * the impact under it with a mark for each line, every other section in
 * its place under the report's own heading, the causes ruled out as a
 * list. A right-to-left report keeps its lines in its own direction.
 *
 * react-markdown is mocked in Common jest: the viewer mock below draws the
 * text it is given.
 */

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "report-markdown" },
        props.text,
      );
    },
  };
});

import InvestigationReportView, {
  ComponentProps as ReportViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportView";
import { parseInvestigationReport } from "../../../Utils/AI/InvestigationReport";

const ENGLISH_REPORT: string = [
  "## 🧠 AI — Automated Root Cause Analysis",
  "",
  "**Summary**",
  "Checkout fails because the payments-db connection pool is exhausted [C1].",
  "",
  "**Impact**",
  "- **Users:** about 1,240 failed checkout requests since 14:02 [C2].",
  "- **Services:** checkout-api, and cart-api, which calls it.",
  "- **SLOs:** Checkout availability is At Risk, 38% of its error budget left [C1].",
  "",
  "**Most likely root cause** (medium confidence)",
  "Release 2026.09.14-2 set `DB_POOL_MAX` to 10 [C1].",
  "",
  "**Evidence**",
  "- pool waits rose from 0 to 1,900 [C1]",
  "",
  "**Ruled out**",
  "- **A traffic spike:** checkout requests were flat [C2].",
  "- **A database fault:** payments-db CPU stayed under 20% [C3].",
  "",
  "**Suggested next steps**",
  "1. Roll checkout-api back.",
].join("\n");

const CHINESE_REPORT: string = [
  "## 🧠 AI — Automated Root Cause Analysis",
  "",
  "**摘要**",
  "结账服务因 payments-db 连接池耗尽而失败 [C1]。",
  "",
  "**影响**",
  "- **用户：** 自 14:02 起约 1,240 个失败的结账请求 [C2]。",
  "- **服务：** checkout-api，以及调用它的 cart-api。",
  "- **SLOs：** 结账可用性处于风险中，剩余 38% 的错误预算 [C1]。",
  "",
  "**最可能的根本原因**（中等置信度）",
  "版本 2026.09.14-2 将 `DB_POOL_MAX` 设为 10 [C1]。",
  "",
  "**证据**",
  "- 连接池等待从 0 升至 1,900 [C1]",
  "",
  "**已排除的原因**",
  "- **流量激增：** 结账请求量保持平稳 [C2]。",
  "- **数据库故障：** payments-db 的 CPU 低于 20% [C3]。",
  "",
  "**建议的后续步骤**",
  "1. 回滚 checkout-api。",
].join("\n");

const ARABIC_REPORT: string = [
  "**الملخص**",
  "فشلت خدمة الدفع لأن مجمع اتصالات payments-db استُنفد [C1].",
  "",
  "**التأثير**",
  "- **المستخدمون:** نحو 1,240 طلب دفع فاشل منذ 14:02 [C2].",
  "- **الخدمات:** checkout-api و cart-api التي تستدعيها.",
  "- **أهداف SLO:** توفر الدفع معرض للخطر [C1].",
  "",
  "**السبب الجذري الأكثر احتمالًا** (ثقة متوسطة)",
  "ضبط الإصدار 2026.09.14-2 قيمة `DB_POOL_MAX` على 10 [C1].",
  "",
  "**الأدلة**",
  "- ارتفع انتظار المجمع من 0 إلى 1,900 [C1]",
  "",
  "**الأسباب المستبعدة**",
  "- **ارتفاع مفاجئ في الحركة:** ظل عدد طلبات الدفع ثابتًا [C2].",
  "- **عطل في قاعدة البيانات:** بقي استخدام المعالج في payments-db أقل من 20% [C3].",
  "",
  "**الخطوات التالية المقترحة**",
  "1. أرجع checkout-api إلى الإصدار السابق.",
].join("\n");

function renderReport(markdown: string): void {
  const props: ReportViewProps = {
    analysisMarkdown: markdown,
    report: parseInvestigationReport(markdown),
    analysisTldr: null,
    evidence: [],
    references: [],
    subjectType: "incident",
    onCitationActivate: (): void => {},
  };

  render(<InvestigationReportView {...props} />);
}

// What the card lays the report out as, whatever language it is written in.
interface Layout {
  // Every section's kind, top to bottom: the lifted ones first.
  kinds: Array<string | null>;
  // The mark of each Impact line.
  aspects: Array<string | null>;
  ruledOutCauses: number;
}

function layoutOf(markdown: string): Layout {
  renderReport(markdown);

  const layout: Layout = {
    kinds: Array.from(
      document.querySelectorAll("section[data-section-kind]"),
    ).map((section: Element): string | null => {
      return section.getAttribute("data-section-kind");
    }),
    aspects: screen
      .queryAllByTestId("investigation-impact-line")
      .map((line: HTMLElement): string | null => {
        return line.getAttribute("data-aspect");
      }),
    ruledOutCauses: screen.queryAllByTestId("investigation-ruled-out-cause")
      .length,
  };

  cleanup();

  return layout;
}

function headings(): Array<string> {
  return screen
    .queryAllByRole("heading", { level: 3 })
    .map((heading: HTMLElement): string => {
      return heading.textContent || "";
    });
}

afterEach(() => {
  cleanup();
});

describe("a report in Chinese is laid out as the English one", () => {
  test("the same sections in the same places, the same marks, the same list of causes", () => {
    const english: Layout = layoutOf(ENGLISH_REPORT);

    expect(english).toEqual({
      kinds: [
        "Summary",
        "Impact",
        "RootCause",
        "Evidence",
        "RuledOut",
        "NextSteps",
      ],
      aspects: ["Users", "Services", "Slos"],
      ruledOutCauses: 2,
    });
    expect(layoutOf(CHINESE_REPORT)).toEqual(english);
  });

  test("the summary on top, then each section under the report's own heading", () => {
    renderReport(CHINESE_REPORT);

    expect(headings()).toEqual([
      // The card's own heading for the lifted summary.
      "Summary",
      "影响",
      "最可能的根本原因（中等置信度）",
      "证据",
      "已排除的原因",
      "建议的后续步骤",
    ]);
    expect(
      within(screen.getByLabelText("Investigation summary")).getByText(
        "结账服务因 payments-db 连接池耗尽而失败 [C1]。",
      ),
    ).toBeInTheDocument();
    // The summary is said once: not again in the report below it.
    expect(
      within(screen.getByLabelText("Investigation report")).queryByText(
        "结账服务因 payments-db 连接池耗尽而失败 [C1]。",
      ),
    ).not.toBeInTheDocument();
  });

  test("the impact under its own heading, one line a thing affected, the label first", () => {
    renderReport(CHINESE_REPORT);

    const impact: HTMLElement = screen.getByRole("region", { name: "影响" });
    const lines: Array<HTMLElement> = within(impact).getAllByTestId(
      "investigation-impact-line",
    );

    expect(impact).toHaveAttribute("data-section-kind", "Impact");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveTextContent(
      "**用户:** 自 14:02 起约 1,240 个失败的结账请求 [C2]。",
    );
    for (const line of lines) {
      expect(line.querySelector("svg")).not.toBeNull();
    }
  });

  test("each cause ruled out on a line of its own, the cause first", () => {
    renderReport(CHINESE_REPORT);

    expect(
      screen
        .getAllByTestId("investigation-ruled-out-cause-name")
        .map((name: HTMLElement): string => {
          return name.textContent || "";
        }),
    ).toEqual(["流量激增", "数据库故障"]);
    expect(
      screen.getAllByTestId("investigation-ruled-out-cause-reason")[0],
    ).toHaveTextContent("结账请求量保持平稳 [C2]。");
  });
});

describe("a report written right to left", () => {
  test("is laid out as the English one, each line in its own direction", () => {
    expect(layoutOf(ARABIC_REPORT)).toEqual(layoutOf(ENGLISH_REPORT));

    renderReport(ARABIC_REPORT);

    for (const line of screen.getAllByTestId("investigation-impact-line")) {
      expect(line).toHaveAttribute("dir", "rtl");
    }
    for (const cause of screen.getAllByTestId(
      "investigation-ruled-out-cause",
    )) {
      expect(cause).toHaveAttribute("dir", "rtl");
    }
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "السبب الجذري الأكثر احتمالًا (ثقة متوسطة)",
      }),
    ).toHaveAttribute("dir", "auto");
  });
});
