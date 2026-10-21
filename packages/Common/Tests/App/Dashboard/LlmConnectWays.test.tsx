import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  LLM_CONNECT_DEFAULT_WAY,
  LLM_CONNECT_WAYS,
  LLM_CONNECT_WAY_KEYS,
  LlmConnectWay,
  LlmConnectWayChip,
  getLlmConnectWayChips,
  isLlmConnectWayKey,
  readLlmConnectWay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Connect/LlmConnectWays";
import LlmUsagePage, {
  LLM_USAGE_SOURCES,
  readLlmUsageSource,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Llm/Usage";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

/*
 * The rules behind AI / LLM > Connect's three ways and Usage's two sources,
 * without the network:
 *
 *   - the ways come in one order, and a page opens on the one the address
 *     names, else the reader's last pick, else your apps;
 *   - what a way's card says about it: calls arriving, how many accounts or
 *     tools are connected, and whether any is not working - nothing while
 *     it is not known or not set up;
 *   - Usage's source is the product's view switch, says what the picked
 *     source is, and keeps it in the address.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageBreakdown",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        return ReactActual.createElement("div", {
          "data-testid": "calls-usage",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmProviderUsage",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;
        return ReactActual.createElement("div", {
          "data-testid": "provider-usage",
        });
      },
    };
  },
);

afterEach(() => {
  cleanup();
});

describe("the three ways", () => {
  test("your apps, your provider accounts, your company's AI tools - in that order, each with its own picture", () => {
    expect(
      LLM_CONNECT_WAYS.map((way: LlmConnectWay): string => {
        return way.key;
      }),
    ).toEqual(["apps", "providers", "tools"]);
    expect(LLM_CONNECT_WAY_KEYS).toEqual(["apps", "providers", "tools"]);
    expect(
      LLM_CONNECT_WAYS.map((way: LlmConnectWay): string => {
        return way.title;
      }),
    ).toEqual([
      "Your apps",
      "Your AI provider accounts",
      "Your company's AI tools",
    ]);
    expect(
      new Set(
        LLM_CONNECT_WAYS.map((way: LlmConnectWay): string => {
          return way.icon;
        }),
      ).size,
    ).toBe(3);
  });

  test("what is a way, and what is not", () => {
    for (const key of ["apps", "providers", "tools"]) {
      expect(isLlmConnectWayKey(key)).toBe(true);
    }

    for (const value of ["", "Apps", "companyTools", null, undefined, 3]) {
      expect(isLlmConnectWayKey(value)).toBe(false);
    }
  });

  test.each([
    // The address wins.
    ["providers", "tools", "providers"],
    ["tools", "apps", "tools"],
    // No way in the address: the last pick.
    [null, "tools", "tools"],
    // A way the address names wrongly does not count.
    ["everything", "providers", "providers"],
    ["", "apps", "apps"],
  ] as Array<[string | null, "apps" | "providers" | "tools", string]>)(
    "address %p, last pick %p: opens on %p",
    (
      fromAddress: string | null,
      remembered: "apps" | "providers" | "tools",
      expected: string,
    ) => {
      expect(readLlmConnectWay({ fromAddress, remembered })).toBe(expected);
    },
  );

  test("with nothing to go on, your apps", () => {
    expect(LLM_CONNECT_DEFAULT_WAY).toBe("apps");
    expect(
      readLlmConnectWay({
        fromAddress: null,
        remembered: "nonsense" as unknown as "apps",
      }),
    ).toBe("apps");
  });
});

describe("what a way's card says", () => {
  function chipsOf(
    key: "apps" | "providers" | "tools",
    status: {
      isSetUp: boolean | undefined;
      connected: number;
      failing: number;
    },
  ): Array<string> {
    return getLlmConnectWayChips(key, status).map(
      (chip: LlmConnectWayChip): string => {
        return chip.count === undefined
          ? `${chip.tone}:${chip.text}`
          : `${chip.tone}:${chip.text.replace("{{count}}", String(chip.count))}`;
      },
    );
  }

  test("your apps: receiving AI calls once one has arrived, and nothing before", () => {
    expect(
      chipsOf("apps", { isSetUp: true, connected: 0, failing: 0 }),
    ).toEqual(["success:Receiving AI calls"]);
    expect(
      chipsOf("apps", { isSetUp: false, connected: 0, failing: 0 }),
    ).toEqual([]);
    expect(
      chipsOf("apps", { isSetUp: undefined, connected: 0, failing: 0 }),
    ).toEqual([]);
  });

  test("one connection is connected; more are counted", () => {
    expect(
      chipsOf("providers", { isSetUp: true, connected: 1, failing: 0 }),
    ).toEqual(["success:Connected"]);
    expect(
      chipsOf("tools", { isSetUp: true, connected: 4, failing: 0 }),
    ).toEqual(["success:Connected (4)"]);
  });

  test("any not working is said beside them", () => {
    expect(
      chipsOf("providers", { isSetUp: true, connected: 2, failing: 1 }),
    ).toEqual(["success:Connected (2)", "danger:Not working"]);
  });

  test("nothing connected, or not known yet: nothing", () => {
    expect(
      chipsOf("providers", { isSetUp: false, connected: 0, failing: 0 }),
    ).toEqual([]);
    expect(
      chipsOf("tools", { isSetUp: undefined, connected: 0, failing: 0 }),
    ).toEqual([]);
  });
});

describe("Usage's two sources", () => {
  const props: PageComponentProps = {
    pageRoute: new Route(`/dashboard/${PROJECT_ID}/llm/usage`),
    currentProject: null,
    hasPaymentMethod: true,
  };

  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/llm/usage`);
  });

  test("your AI calls and provider accounts, with the pictures Connect uses", () => {
    expect(
      LLM_USAGE_SOURCES.map((source: { value: string; label: string }) => {
        return [source.value, source.label];
      }),
    ).toEqual([
      ["calls", "Your AI calls"],
      ["providers", "Provider accounts"],
    ]);
    expect(LLM_USAGE_SOURCES[0]!.icon).toBe(LLM_CONNECT_WAYS[0]!.icon);
    expect(LLM_USAGE_SOURCES[1]!.icon).toBe(LLM_CONNECT_WAYS[1]!.icon);
  });

  test.each([
    ["providers", "providers"],
    ["calls", "calls"],
    [null, "calls"],
    ["bill", "calls"],
  ] as Array<[string | null, string]>)(
    "?source=%p reads as %p",
    (value: string | null, expected: string) => {
      expect(readLlmUsageSource(value)).toBe(expected);
    },
  );

  test("opens on your AI calls: the view switch, what the source is, and its usage", () => {
    render(<LlmUsagePage {...props} />);

    const calls: HTMLElement = screen.getByTestId("llm-usage-source-calls");

    expect(screen.getByRole("group", { name: "Usage source" })).toBe(
      screen.getByTestId("llm-usage-source"),
    );
    expect(calls).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("llm-usage-source-providers")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByTestId("llm-usage-source-description"),
    ).toHaveTextContent("What your apps and coding tools send");
    expect(screen.getByTestId("calls-usage")).toBeInTheDocument();
    expect(screen.queryByTestId("provider-usage")).not.toBeInTheDocument();
  });

  test("picking provider accounts shows them, says what they are, and keeps it in the address", () => {
    render(<LlmUsagePage {...props} />);

    fireEvent.click(screen.getByTestId("llm-usage-source-providers"));

    expect(screen.getByTestId("provider-usage")).toBeInTheDocument();
    expect(screen.queryByTestId("calls-usage")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("llm-usage-source-description"),
    ).toHaveTextContent("What your connected accounts were billed");
    expect(new URL(window.location.href).searchParams.get("source")).toBe(
      "providers",
    );

    fireEvent.click(screen.getByTestId("llm-usage-source-calls"));

    expect(new URL(window.location.href).searchParams.get("source")).toBe(null);
  });

  test("a link to provider accounts opens on them", () => {
    goTo(`/dashboard/${PROJECT_ID}/llm/usage?source=providers`);

    render(<LlmUsagePage {...props} />);

    expect(screen.getByTestId("provider-usage")).toBeInTheDocument();
    expect(screen.getByTestId("llm-usage-source-providers")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
