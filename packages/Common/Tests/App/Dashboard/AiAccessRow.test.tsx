import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  AI_ACCESS_ALLOWLIST_EMPTY_TEXT,
  AI_ACCESS_ALLOWLIST_INTRO_TEXT,
  AiAccessActionPanel,
  AiAccessAllowlist,
  AiAccessBadgeElement,
  AiAccessHint,
  AiAccessPermissionNote,
  AiAccessProtections,
  AiAccessRow,
  AiAccessRows,
  AiAccessSetBy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessRow";
import {
  AI_ACCESS_PROTECTIONS_TITLE,
  AiAccessBadgeTone,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAccessModes";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * The reader's wordings, by English key: none (English) unless a test sets
 * them. A jest.mock factory may only read variables named mock*.
 */
let mockWordings: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return mockWordings[value] ?? value;
        },
      };
    },
  };
});

/*
 * The building blocks of "What AI may do", rendered on their own: a row
 * (icon, title, badge, sentence, and whatever the row carries), the badge
 * in each tone, the hint, the allowlist in effect, the folded every-mode
 * protections, the admin note and the to-do panel.
 */

let consoleErrorSpy: ReturnType<typeof jest.spyOn> | null = null;

// React warns through console.error, e.g. a <div> inside a <p>.
function watchConsoleErrors(): void {
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
    // collected, asserted on below
  });
}

function consoleErrors(): Array<string> {
  return (consoleErrorSpy?.mock.calls || []).map(
    (call: Array<unknown>): string => {
      return call.map(String).join(" ");
    },
  );
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  consoleErrorSpy = null;
  mockWordings = {};
});

describe("a row", () => {
  test("shows the title, the badge and the sentence under its own test ids", () => {
    render(
      <AiAccessRow
        icon={IconProp.MagnifyingGlass}
        title="Investigation"
        badge={{ text: "On", tone: "on" }}
        sentence="AI may run read-only db diagnostics on this database server."
        dataTestId="ai-access-investigation"
      />,
    );

    const row: HTMLElement = screen.getByTestId("ai-access-investigation");
    expect(row).toHaveTextContent("Investigation");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Investigation",
    );
    expect(
      screen.getByTestId("ai-access-investigation-badge"),
    ).toHaveTextContent("On");
    expect(
      screen.getByTestId("ai-access-investigation-value"),
    ).toHaveTextContent(
      "AI may run read-only db diagnostics on this database server.",
    );
  });

  test("the badge sits right after the title, not across the card", () => {
    render(
      <AiAccessRow
        icon={IconProp.WrenchScrewdriver}
        title="Fixes"
        badge={{ text: "Off", tone: "off" }}
        sentence="AI never proposes or runs a fix."
        dataTestId="ai-access-fixes"
      />,
    );

    const heading: HTMLElement = screen.getByRole("heading", { level: 3 });
    expect(heading.nextElementSibling).toBe(
      screen.getByTestId("ai-access-fixes-badge"),
    );
  });

  test("renders what it carries under the sentence", () => {
    render(
      <AiAccessRow
        icon={IconProp.WrenchScrewdriver}
        title="Fixes"
        badge={{ text: "Off", tone: "off" }}
        sentence="AI never proposes or runs a fix."
        dataTestId="ai-access-fixes"
      >
        <p data-testid="carried">A next step</p>
      </AiAccessRow>,
    );

    const sentence: HTMLElement = screen.getByTestId("ai-access-fixes-value");
    const carried: HTMLElement = screen.getByTestId("carried");
    expect(
      sentence.compareDocumentPosition(carried) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a row whose children were all left out has no empty block under it", () => {
    const { container } = render(
      <AiAccessRow
        icon={IconProp.WrenchScrewdriver}
        title="Fixes"
        badge={{ text: "Ask for approval", tone: "on" }}
        sentence="AI proposes fixes."
        dataTestId="ai-access-fixes"
      >
        {null}
        {false}
        {undefined}
      </AiAccessRow>,
    );

    const sentence: HTMLElement = screen.getByTestId("ai-access-fixes-value");
    expect(sentence.nextElementSibling).toBeNull();
    expect(container.querySelector(".mt-3.space-y-3")).toBeNull();
  });

  test.each<[AiAccessBadgeTone, string]>([
    ["off", "bg-gray-100"],
    ["on", "bg-emerald-50"],
  ])(
    "the icon tile takes the %s tone",
    (tone: AiAccessBadgeTone, tileClass: string) => {
      render(
        <AiAccessRow
          icon={IconProp.WrenchScrewdriver}
          title="Fixes"
          badge={{ text: "x", tone }}
          sentence="s"
          dataTestId="row"
        />,
      );

      const tile: Element | null = screen.getByTestId("row").firstElementChild;
      expect(tile).toHaveClass(tileClass);
      // Decorative: the title and badge already say it.
      expect(tile).toHaveAttribute("aria-hidden", "true");
    },
  );

  test("rows sit in one divided list", () => {
    render(
      <AiAccessRows>
        <AiAccessRow
          icon={IconProp.MagnifyingGlass}
          title="Investigation"
          badge={{ text: "On", tone: "on" }}
          sentence="a"
          dataTestId="first"
        />
        <AiAccessRow
          icon={IconProp.WrenchScrewdriver}
          title="Fixes"
          badge={{ text: "Off", tone: "off" }}
          sentence="b"
          dataTestId="second"
        />
      </AiAccessRows>,
    );

    const rows: HTMLElement = screen.getByTestId("ai-access-rows");
    expect(rows).toHaveClass("divide-y");
    expect(rows.children).toHaveLength(2);
    expect(rows.children[0]).toBe(screen.getByTestId("first"));
    expect(rows.children[1]).toBe(screen.getByTestId("second"));
  });
});

describe("the badge", () => {
  test.each<[AiAccessBadgeTone, string]>([
    ["off", "text-gray-600"],
    ["on", "text-emerald-700"],
  ])("in the %s tone", (tone: AiAccessBadgeTone, textClass: string) => {
    render(
      <AiAccessBadgeElement
        badge={{ text: "Label", tone }}
        dataTestId="badge"
      />,
    );

    const badge: HTMLElement = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("Label");
    expect(badge).toHaveClass(textClass);
    expect(badge).toHaveAttribute("data-tone", tone);
  });

  test("its dot is decorative", () => {
    render(
      <AiAccessBadgeElement
        badge={{ text: "On", tone: "on" }}
        dataTestId="badge"
      />,
    );

    expect(
      screen.getByTestId("badge").querySelector("[aria-hidden='true']"),
    ).not.toBeNull();
  });
});

/*
 * "When fixes are enabled, why does it show in yellow?" Nothing on/off in
 * the card draws in a warning colour any more: amber is for the to-do
 * panel alone.
 */
describe("no on/off look is a warning", () => {
  test.each<[AiAccessBadgeTone]>([["off"], ["on"]])(
    "a %s badge and its row tile draw no amber, yellow or indigo",
    (tone: AiAccessBadgeTone) => {
      render(
        <AiAccessRow
          icon={IconProp.WrenchScrewdriver}
          title="Fixes"
          badge={{ text: "Bypass approval", tone }}
          sentence="s"
          dataTestId="row"
        />,
      );

      const row: HTMLElement = screen.getByTestId("row");
      expect(row.innerHTML).not.toMatch(/amber|yellow|indigo/);
    },
  );
});

describe("where the settings are set", () => {
  test("set by the agent: a lock, the words, and no action", () => {
    render(
      <AiAccessSetBy
        text="Set by the agent's configuration."
        isSetByAgent={true}
        dataTestId="set-by"
      />,
    );

    const line: HTMLElement = screen.getByTestId("set-by");
    expect(line).toHaveAttribute("data-set-by-agent", "true");
    expect(screen.getByTestId("set-by-text")).toHaveTextContent(
      "Set by the agent's configuration.",
    );
    expect(screen.queryByTestId("set-by-action")).toBeNull();
    // Gray, like the card around it: not a banner, not a warning.
    expect(line).toHaveClass("bg-gray-50");
    expect(line.innerHTML).not.toMatch(/amber|yellow|bg-blue-50/);
  });

  test("chosen here: the words and a button that shows how to move them to the agent", () => {
    const onAction: () => void = jest.fn();
    render(
      <AiAccessSetBy
        text="Chosen on this page."
        isSetByAgent={false}
        actionText="Show how"
        onAction={onAction}
        dataTestId="set-by"
      />,
    );

    expect(screen.getByTestId("set-by")).toHaveAttribute(
      "data-set-by-agent",
      "false",
    );
    const action: HTMLElement = screen.getByTestId("set-by-action");
    expect(action.tagName).toBe("BUTTON");
    expect(action).toHaveAttribute("type", "button");
    expect(action).toHaveTextContent("Show how");
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test("an action without a handler is not drawn", () => {
    render(
      <AiAccessSetBy
        text="Chosen on this page."
        isSetByAgent={false}
        actionText="Show how"
        dataTestId="set-by"
      />,
    );

    expect(screen.queryByTestId("set-by-action")).toBeNull();
  });
});

describe("the hint", () => {
  test("shows its text under its test id", () => {
    render(
      <AiAccessHint
        text="Want AI to propose fixes? Click Change and choose Ask for approval."
        dataTestId="ai-access-fixes-off-hint"
      />,
    );

    expect(screen.getByTestId("ai-access-fixes-off-hint")).toHaveTextContent(
      "Want AI to propose fixes? Click Change and choose Ask for approval.",
    );
  });

  /*
   * Icon renders its svg inside a div, so the hint (and the action panel's
   * heading) must not be a <p>: React reports a <div> inside a <p>.
   */
  test("nests its icon validly", () => {
    watchConsoleErrors();
    render(
      <>
        <AiAccessHint text="Hint" dataTestId="hint" />
        <AiAccessActionPanel
          title="Give the agent write access"
          dataTestId="panel"
        >
          <p>Body</p>
        </AiAccessActionPanel>
        <AiAccessPermissionNote
          canText="can"
          cannotText="cannot"
          dataTestId="note"
        />
        <AiAccessProtections protections={["One."]} />
      </>,
    );

    expect(screen.getByTestId("hint").tagName).toBe("DIV");
    expect(
      consoleErrors().filter((message: string): boolean => {
        return message.includes("validateDOMNesting");
      }),
    ).toEqual([]);
  });
});

describe("the allowlist in effect", () => {
  test("lists each pattern, in order, after saying what they do", () => {
    render(
      <AiAccessAllowlist
        title="Command allowlist"
        patterns={["docker stop web", "docker restart api"]}
        dataTestId="ai-command-allowlist-in-effect"
      />,
    );

    const allowlist: HTMLElement = screen.getByTestId(
      "ai-command-allowlist-in-effect",
    );
    expect(allowlist).toHaveTextContent("Command allowlist");
    expect(allowlist).toHaveTextContent(AI_ACCESS_ALLOWLIST_INTRO_TEXT);
    expect(
      screen.getAllByRole("listitem").map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual(["docker stop web", "docker restart api"]);
    expect(allowlist).not.toHaveTextContent(AI_ACCESS_ALLOWLIST_EMPTY_TEXT);
  });

  test("the same pattern twice is listed twice", () => {
    render(
      <AiAccessAllowlist
        title="kubectl allowlist"
        patterns={["kubectl rollout restart *", "kubectl rollout restart *"]}
        dataTestId="kubectl-allowlist-in-effect"
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("an empty list says None, and what that means", () => {
    render(
      <AiAccessAllowlist
        title="Command allowlist"
        patterns={[]}
        dataTestId="ai-command-allowlist-in-effect"
      />,
    );

    expect(
      screen.getByTestId("ai-command-allowlist-in-effect"),
    ).toHaveTextContent("None — riskier fixes always wait for approval.");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("the allowlist's edit action", () => {
  test("is a button beside the title when the page offers one", () => {
    const onEdit: () => void = jest.fn();
    render(
      <AiAccessAllowlist
        title="kubectl allowlist"
        patterns={["kubectl rollout restart * -n web"]}
        dataTestId="allowlist"
        editText="Edit"
        onEdit={onEdit}
      />,
    );

    const edit: HTMLElement = screen.getByTestId("allowlist-edit");
    expect(edit.tagName).toBe("BUTTON");
    expect(edit).toHaveTextContent("Edit");
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test("is not drawn without its words", () => {
    render(
      <AiAccessAllowlist
        title="kubectl allowlist"
        patterns={[]}
        dataTestId="allowlist"
        onEdit={(): void => {
          return undefined;
        }}
      />,
    );

    expect(screen.queryByTestId("allowlist-edit")).toBeNull();
  });
});

describe("the every-mode protections", () => {
  test("are folded until asked for, then list every clause", () => {
    render(
      <AiAccessProtections
        protections={["Denied commands never run.", "A drain needs a human."]}
      />,
    );

    const details: HTMLElement = screen.getByTestId("ai-access-protections");
    expect(details.tagName).toBe("DETAILS");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(AI_ACCESS_PROTECTIONS_TITLE);

    fireEvent.click(screen.getByText(AI_ACCESS_PROTECTIONS_TITLE));
    // jsdom does not toggle <details> on a click; open it the way the browser does.
    (details as HTMLDetailsElement).open = true;
    expect(details).toHaveAttribute("open");

    expect(
      Array.from(
        screen.getByTestId("ai-access-protections-list").querySelectorAll("li"),
      ).map((item: Element): string => {
        return item.textContent || "";
      }),
    ).toEqual(["Denied commands never run.", "A drain needs a human."]);
  });
});

describe("the admin note", () => {
  test("says what the editor can change first, then what needs more", () => {
    render(
      <AiAccessPermissionNote
        canText="You can turn investigation on or off."
        cannotText="Turning fixes on needs Project Owner."
        dataTestId="note"
      />,
    );

    const lines: Array<string> = Array.from(
      screen.getByTestId("note").querySelectorAll("p"),
    ).map((line: Element): string => {
      return line.textContent || "";
    });
    expect(lines).toEqual([
      "You can turn investigation on or off.",
      "Turning fixes on needs Project Owner.",
    ]);
  });
});

describe("the to-do panel", () => {
  test("shows its title, then what it carries", () => {
    render(
      <AiAccessActionPanel
        title="Give the agent write access"
        dataTestId="ai-access-write-commands"
      >
        <p data-testid="body">The agent is read-only.</p>
      </AiAccessActionPanel>,
    );

    const panel: HTMLElement = screen.getByTestId("ai-access-write-commands");
    expect(panel).toHaveTextContent("Give the agent write access");
    expect(panel).toHaveClass("border-amber-200");
    expect(panel).toContainElement(screen.getByTestId("body"));
  });
});

/*
 * Like Card, Pill and Alert, each building block looks up the text it is
 * handed: a page hands it the English key. They used to draw every text
 * prop as given, so "Investigation", "Fixes", "On"/"Off", the fixes-mode
 * summaries and the hints read English in every language. A pseudo-locale
 * wraps each wording in ‹ ›; text already in the reader's language passes
 * through unchanged.
 */
describe("in the reader's language", () => {
  function pseudo(...keys: Array<string>): void {
    mockWordings = {};
    for (const key of keys) {
      mockWordings[key] = `‹${key}›`;
    }
  }

  test("a row's title, badge and sentence", () => {
    pseudo("Fixes", "Off", "AI never proposes or runs a fix.");
    render(
      <AiAccessRow
        icon={IconProp.WrenchScrewdriver}
        title="Fixes"
        badge={{ text: "Off", tone: "off" }}
        sentence="AI never proposes or runs a fix."
        dataTestId="ai-access-fixes"
      />,
    );

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "‹Fixes›",
    );
    expect(screen.getByTestId("ai-access-fixes-badge")).toHaveTextContent(
      "‹Off›",
    );
    expect(screen.getByTestId("ai-access-fixes-value")).toHaveTextContent(
      "‹AI never proposes or runs a fix.›",
    );
  });

  test("a badge on its own", () => {
    pseudo("Connected");
    render(
      <AiAccessBadgeElement
        badge={{ text: "Connected", tone: "on" }}
        dataTestId="badge"
      />,
    );

    expect(screen.getByTestId("badge")).toHaveTextContent("‹Connected›");
  });

  test("where the settings are set, and its action", () => {
    pseudo("Chosen on this page.", "Show how");
    render(
      <AiAccessSetBy
        text="Chosen on this page."
        isSetByAgent={false}
        actionText="Show how"
        onAction={(): void => {
          return undefined;
        }}
        dataTestId="set-by"
      />,
    );

    expect(screen.getByTestId("set-by-text")).toHaveTextContent(
      "‹Chosen on this page.›",
    );
    expect(screen.getByTestId("set-by-action")).toHaveTextContent(
      "‹Show how›",
    );
  });

  test("the hint", () => {
    pseudo("Want AI to propose fixes? Click Change and choose Ask for approval.");
    render(
      <AiAccessHint
        text="Want AI to propose fixes? Click Change and choose Ask for approval."
        dataTestId="hint"
      />,
    );

    expect(screen.getByTestId("hint")).toHaveTextContent(
      "‹Want AI to propose fixes? Click Change and choose Ask for approval.›",
    );
  });

  test("the allowlist: its title, its edit action and its own words; never the patterns", () => {
    pseudo(
      "kubectl allowlist",
      "Edit",
      AI_ACCESS_ALLOWLIST_INTRO_TEXT,
      AI_ACCESS_ALLOWLIST_EMPTY_TEXT,
      "kubectl rollout restart *",
    );
    render(
      <>
        <AiAccessAllowlist
          title="kubectl allowlist"
          patterns={["kubectl rollout restart *"]}
          editText="Edit"
          onEdit={(): void => {
            return undefined;
          }}
          dataTestId="allowlist"
        />
        <AiAccessAllowlist
          title="kubectl allowlist"
          patterns={[]}
          dataTestId="empty-allowlist"
        />
      </>,
    );

    const allowlist: HTMLElement = screen.getByTestId("allowlist");
    expect(allowlist).toHaveTextContent("‹kubectl allowlist›");
    expect(allowlist).toHaveTextContent(`‹${AI_ACCESS_ALLOWLIST_INTRO_TEXT}›`);
    expect(screen.getByTestId("allowlist-edit")).toHaveTextContent("‹Edit›");
    // A pattern is what the user typed: it is never translated.
    expect(screen.getByRole("listitem")).toHaveTextContent(
      /^kubectl rollout restart \*$/,
    );
    expect(screen.getByTestId("empty-allowlist")).toHaveTextContent(
      `‹${AI_ACCESS_ALLOWLIST_EMPTY_TEXT}›`,
    );
  });

  test("the every-mode protections: the title and each line", () => {
    pseudo(AI_ACCESS_PROTECTIONS_TITLE, "Denied commands never run.");
    render(<AiAccessProtections protections={["Denied commands never run."]} />);

    const details: HTMLElement = screen.getByTestId("ai-access-protections");
    expect(details).toHaveTextContent(`‹${AI_ACCESS_PROTECTIONS_TITLE}›`);
    expect(
      screen.getByTestId("ai-access-protections-list").textContent,
    ).toBe("‹Denied commands never run.›");
  });

  test("the admin note and the to-do panel", () => {
    pseudo(
      "You can turn investigation on or off.",
      "Turning fixes on needs Project Owner.",
      "Give the agent write access",
    );
    render(
      <>
        <AiAccessPermissionNote
          canText="You can turn investigation on or off."
          cannotText="Turning fixes on needs Project Owner."
          dataTestId="note"
        />
        <AiAccessActionPanel
          title="Give the agent write access"
          dataTestId="panel"
        >
          <p>Body</p>
        </AiAccessActionPanel>
      </>,
    );

    expect(
      Array.from(screen.getByTestId("note").querySelectorAll("p")).map(
        (line: Element): string => {
          return line.textContent || "";
        },
      ),
    ).toEqual([
      "‹You can turn investigation on or off.›",
      "‹Turning fixes on needs Project Owner.›",
    ]);
    expect(screen.getByTestId("panel")).toHaveTextContent(
      "‹Give the agent write access›",
    );
  });

  // A caller that hands in text already translated gets it back as it is.
  test("text already in the reader's language passes through", () => {
    pseudo("Fixes");
    render(
      <AiAccessRow
        icon={IconProp.WrenchScrewdriver}
        title="‹Fixes›"
        badge={{ text: "Aus", tone: "off" }}
        sentence="Die KI schlägt nie einen Fix vor."
        dataTestId="row"
      />,
    );

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      /^‹Fixes›$/,
    );
    expect(screen.getByTestId("row-badge")).toHaveTextContent("Aus");
    expect(screen.getByTestId("row-value")).toHaveTextContent(
      "Die KI schlägt nie einen Fix vor.",
    );
  });
});
