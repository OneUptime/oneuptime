import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  CASE_ENTITY_LIMIT,
  CaseAiSection,
  CaseEntitiesSection,
  CaseFieldRow,
} from "./CaseSections";
import { lightColors } from "../../theme";
import type { SecurityEntity } from "../../security/caseTerms";

/*
 * What a case's screen says of a case that no other screen says: OneUptime
 * AI's read of it, what it is about, and its facts - three of which a tap
 * changes. AI's read is a suggestion: a word and a sentence, a warning when
 * the case's data tried to steer it, its suggested priority as one tap, and
 * its report folded under it.
 */

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" => {
      return "light";
    },
  };
});

const NOW: number = new Date("2026-09-10T10:00:00.000Z").getTime();

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});

function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];
  return typeof glyph === "string" ? glyph : String.fromCodePoint(glyph);
}

const REPORT: string = [
  "## 🧠 AI — Security Case Triage",
  "",
  "**Summary**",
  "A brute force that ended in a success.",
].join("\n");

function aiSection(
  props: Partial<React.ComponentProps<typeof CaseAiSection>> = {},
): React.JSX.Element {
  return (
    <CaseAiSection
      aiVerdict="Likely Malicious"
      report={REPORT}
      triagedAt="2026-09-10T09:48:00.000Z"
      promptInjectionSuspected={false}
      busy={false}
      onSetSuggestedPriority={jest.fn()}
      {...props}
    />
  );
}

describe("OneUptime AI", () => {
  test("its read in a word and a sentence, and when it read the case", async () => {
    await render(aiSection());

    expect(screen.getByRole("header", { name: "OneUptime AI" })).toBeTruthy();
    expect(screen.getByTestId("case-ai-verdict")).toHaveStyle({
      backgroundColor: lightColors.statusErrorBg,
    });
    expect(screen.getByText("Likely Malicious")).toBeTruthy();
    expect(
      screen.getByText(
        "The evidence points at malicious or unauthorized activity.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Triaged 12m ago")).toBeTruthy();
  });

  test("a case it has not triaged says so, and nothing else", async () => {
    await render(
      aiSection({ aiVerdict: null, report: null, triagedAt: null }),
    );

    expect(screen.getByTestId("case-ai-not-triaged")).toHaveTextContent(
      "OneUptime AI has not triaged this case.",
    );
    expect(screen.queryByTestId("case-ai-verdict")).toBeNull();
    expect(screen.queryByTestId("case-ai-report-toggle")).toBeNull();
  });

  test("a report without a read it can name still shows the report", async () => {
    await render(aiSection({ aiVerdict: "Something new" }));

    expect(screen.queryByTestId("case-ai-verdict")).toBeNull();
    expect(screen.getByTestId("case-ai-report-toggle")).toBeTruthy();
  });

  test("the report is folded under the read, without its brand heading", async () => {
    await render(aiSection());

    expect(screen.queryByTestId("case-ai-report")).toBeNull();
    const toggle: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
      "case-ai-report-toggle",
    );
    expect(toggle.props.accessibilityState).toEqual({ expanded: false });

    await fireEvent.press(toggle);

    expect(screen.getByTestId("case-ai-report")).toBeTruthy();
    expect(screen.getByText(/A brute force that ended in a success\./)).toBeTruthy();
    expect(screen.queryByText(/Security Case Triage/)).toBeNull();
    expect(screen.getByText("Hide the report")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("case-ai-report-toggle"));
    expect(screen.queryByTestId("case-ai-report")).toBeNull();
  });

  test("text in the case that tried to steer it is called out first", async () => {
    await render(aiSection({ promptInjectionSuspected: true }));

    expect(screen.getByTestId("case-ai-injection-warning")).toBeTruthy();
    expect(
      screen.getByText("Text in this case reads like instructions to an AI"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "OneUptime AI treated it as data and leaves the call to you.",
      ),
    ).toBeTruthy();
  });

  test("its suggested priority is one tap, named in the button", async () => {
    const onSetSuggestedPriority: jest.Mock = jest.fn();
    await render(
      aiSection({
        suggestedPriority: { _id: "low", name: "Low" },
        onSetSuggestedPriority,
      }),
    );

    expect(screen.getByText("Suggests Low priority")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Set to Low" }));

    expect(onSetSuggestedPriority).toHaveBeenCalledTimes(1);
  });

  test("while a change is on its way, the suggestion waits", async () => {
    const onSetSuggestedPriority: jest.Mock = jest.fn();
    await render(
      aiSection({
        suggestedPriority: { _id: "low", name: "Low" },
        onSetSuggestedPriority,
        busy: true,
      }),
    );

    await fireEvent.press(screen.getByRole("button", { name: "Set to Low" }));

    expect(onSetSuggestedPriority).not.toHaveBeenCalled();
  });

  test("no suggestion to offer, no row", async () => {
    await render(aiSection());

    expect(screen.queryByTestId("case-ai-suggested-priority")).toBeNull();
  });
});

describe("what the case is about", () => {
  test("each user, host and address, by what it is", async () => {
    await render(
      <CaseEntitiesSection
        entities={[
          { type: "User", value: "alice@acme.test" },
          { type: "IP Address", value: "203.0.113.24" },
          { type: "Host", value: "vpn-gw-01" },
        ]}
      />,
    );

    expect(
      screen.getByRole("header", { name: "What it is about" }),
    ).toBeTruthy();
    expect(screen.getAllByTestId("case-entity")).toHaveLength(3);
    expect(screen.getByText("alice@acme.test")).toBeTruthy();
    expect(screen.getByText("IP address")).toBeTruthy();
    expect(screen.getByText(glyphFor("desktop-outline"))).toBeTruthy();
    expect(screen.getByText("alice@acme.test").props.selectable).toBe(true);
  });

  test("a case about nothing in particular has no section", async () => {
    await render(<CaseEntitiesSection entities={[]} />);

    expect(screen.queryByTestId("case-entities-section")).toBeNull();
  });

  test("a long list is cut, and says how many more there are", async () => {
    const entities: Array<SecurityEntity> = Array.from(
      { length: CASE_ENTITY_LIMIT + 3 },
      (_value: unknown, index: number): SecurityEntity => {
        return { type: "Host", value: `host-${index}` };
      },
    );

    await render(<CaseEntitiesSection entities={entities} />);

    expect(screen.getAllByTestId("case-entity")).toHaveLength(
      CASE_ENTITY_LIMIT,
    );
    expect(screen.getByTestId("case-entities-more")).toHaveTextContent(
      "And 3 more.",
    );
  });
});

describe("a fact of the case", () => {
  test("one that cannot be changed from here only reads, and can be copied", async () => {
    await render(<CaseFieldRow label="Detections" value="14" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("14").props.selectable).toBe(true);
  });

  test("one that can is a button that says what it opens, with a chevron", async () => {
    const onPress: jest.Mock = jest.fn();
    await render(
      <CaseFieldRow
        label="Status"
        value="Investigating"
        dotColor="#FFB224"
        onPress={onPress}
        accessibilityHint="Opens the statuses this case can move to"
      />,
    );

    const row: ReturnType<typeof screen.getByRole> = screen.getByRole(
      "button",
      { name: "Status: Investigating" },
    );
    expect(row.props.accessibilityHint).toBe(
      "Opens the statuses this case can move to",
    );
    expect(screen.getByText(glyphFor("chevron-forward"))).toBeTruthy();

    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("a row is at least a comfortable touch target tall", async () => {
    await render(
      <CaseFieldRow label="Priority" value="High" onPress={jest.fn()} />,
    );

    expect(screen.getByRole("button")).toHaveStyle({ minHeight: 48 });
  });
});
