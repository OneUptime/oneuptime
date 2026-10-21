import ErrorBoundary from "../../../UI/Components/ErrorBoundary";
import ForeignDomMutationGuard, {
  MAX_LOGGED_TOLERATED_CALLS,
} from "../../../UI/Utils/ForeignDomMutationGuard";
import { act, fireEvent, render, RenderResult } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Browser extensions move nodes React manages - a translator wraps text in
 * <font>, a password manager wraps or re-parents a field, an assistant takes
 * an element out. React's next commit then asks the old parent to remove the
 * node, or to insert a new one before it, and the DOM throws NotFoundError,
 * which takes the whole page under the nearest error boundary down with it.
 *
 * Each scenario below is run twice: once on the platform as it is, to show
 * the extension's edit really does crash the page into the error screen, and
 * once with the guard installed, where the page has to keep rendering what
 * the app asked for. The second half of each pair fails without the guard.
 *
 * Assertions use plain DOM checks rather than jest-dom matchers: Common's
 * tsconfig does not list testing-library__jest-dom in "types".
 */

const FALLBACK_TEST_ID: string = "error-boundary-fallback";

const consoleErrorSpy: jest.SpyInstance = jest.spyOn(console, "error");
const consoleWarnSpy: jest.SpyInstance = jest.spyOn(console, "warn");

beforeEach(() => {
  consoleErrorSpy.mockImplementation(() => {});
  consoleWarnSpy.mockImplementation(() => {});
});

afterEach(() => {
  ForeignDomMutationGuard.uninstallForTesting();
  consoleErrorSpy.mockReset();
  consoleWarnSpy.mockReset();
  document.body.innerHTML = "";
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

type WrapFunction = (node: Node, tagName: string) => HTMLElement;

// What a translator or a password manager does: put a node of ours in theirs.
const wrap: WrapFunction = (node: Node, tagName: string): HTMLElement => {
  const wrapper: HTMLElement = document.createElement(tagName);
  node.parentNode!.insertBefore(wrapper, node);
  wrapper.appendChild(node);
  return wrapper;
};

type ElementNamesFunction = (parent: Element) => Array<string>;

const childNames: ElementNamesFunction = (parent: Element): Array<string> => {
  return Array.from(parent.childNodes).map((child: ChildNode): string => {
    return child.nodeType === Node.TEXT_NODE
      ? `#text(${child.textContent})`
      : `${child.nodeName.toLowerCase()}(${child.textContent})`;
  });
};

type HasFallbackFunction = (result: RenderResult) => boolean;

const hasFallback: HasFallbackFunction = (result: RenderResult): boolean => {
  return result.queryByTestId(FALLBACK_TEST_ID) !== null;
};

describe("the platform without the guard: the failure it exists for", () => {
  test("removing a node an extension wrapped throws NotFoundError", () => {
    const parent: HTMLDivElement = document.createElement("div");
    const child: HTMLSpanElement = document.createElement("span");
    parent.appendChild(child);
    wrap(child, "font");

    let thrown: unknown = null;

    try {
      parent.removeChild(child);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as DOMException).name).toBe("NotFoundError");
  });

  test("inserting before a node an extension wrapped throws NotFoundError", () => {
    const parent: HTMLDivElement = document.createElement("div");
    const reference: HTMLSpanElement = document.createElement("span");
    parent.appendChild(reference);
    wrap(reference, "font");

    let thrown: unknown = null;

    try {
      parent.insertBefore(document.createElement("b"), reference);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as DOMException).name).toBe("NotFoundError");
  });
});

describe("removeChild with the guard", () => {
  beforeEach(() => {
    ForeignDomMutationGuard.install();
  });

  test("a node an extension wrapped is taken out of the wrapper, returned and logged", () => {
    const parent: HTMLDivElement = document.createElement("div");
    const child: HTMLSpanElement = document.createElement("span");
    child.textContent = "ours";
    parent.appendChild(child);
    const wrapper: HTMLElement = wrap(child, "font");

    expect(parent.removeChild(child)).toBe(child);
    expect(child.parentNode).toBeNull();
    expect(wrapper.parentNode).toBe(parent);
    expect(wrapper.childNodes).toHaveLength(0);
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain(
      "Removed a <span> from the <font> wrapped around it inside a <div>",
    );
  });

  test("a node wrapped several levels deep is still taken out", () => {
    const parent: HTMLDivElement = document.createElement("div");
    const child: Text = document.createTextNode("Hello");
    parent.appendChild(child);
    const inner: HTMLElement = wrap(child, "font");
    wrap(inner, "font");

    parent.removeChild(child);

    expect(child.parentNode).toBeNull();
    expect(parent.textContent).toBe("");
  });

  test("a node that has left the parent altogether is left where the extension put it", () => {
    const parent: HTMLDivElement = document.createElement("div");
    const elsewhere: HTMLDivElement = document.createElement("div");
    const child: HTMLSpanElement = document.createElement("span");
    parent.appendChild(child);
    elsewhere.appendChild(child);

    expect(parent.removeChild(child)).toBe(child);
    expect(child.parentNode).toBe(elsewhere);
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain(
      "Skipped removing a <span> from a <div> it is no longer inside.",
    );
  });

  test("a node an extension already removed is a no-op", () => {
    const parent: HTMLDivElement = document.createElement("div");
    const child: HTMLSpanElement = document.createElement("span");
    parent.appendChild(child);
    child.remove();

    expect(parent.removeChild(child)).toBe(child);
    expect(child.parentNode).toBeNull();
  });

  test("a real child is removed exactly as before, without a warning", () => {
    const parent: HTMLDivElement = document.createElement("div");
    const first: HTMLSpanElement = document.createElement("span");
    const second: HTMLSpanElement = document.createElement("span");
    parent.append(first, second);

    expect(parent.removeChild(first)).toBe(first);
    expect(Array.from(parent.childNodes)).toEqual([second]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test("anything that is not a node still fails the way the platform fails", () => {
    const parent: HTMLDivElement = document.createElement("div");

    expect(() => {
      parent.removeChild(null as unknown as Node);
    }).toThrow(TypeError);
    expect(() => {
      parent.removeChild("text" as unknown as Node);
    }).toThrow(TypeError);
  });
});

describe("insertBefore with the guard", () => {
  beforeEach(() => {
    ForeignDomMutationGuard.install();
  });

  test("goes in front of the wrapper an extension put around the reference, keeping the order", () => {
    const list: HTMLUListElement = document.createElement("ul");
    const second: HTMLLIElement = document.createElement("li");
    second.textContent = "b";
    list.appendChild(second);
    wrap(second, "font");

    const first: HTMLLIElement = document.createElement("li");
    first.textContent = "a";

    expect(list.insertBefore(first, second)).toBe(first);
    expect(childNames(list)).toEqual(["li(a)", "font(b)"]);
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain(
      "Inserted a <li> into a <ul> in front of the <font> now wrapped around the <li> it was meant to go before.",
    );
  });

  test("goes at the end when the reference has left the parent altogether", () => {
    const list: HTMLUListElement = document.createElement("ul");
    const kept: HTMLLIElement = document.createElement("li");
    kept.textContent = "kept";
    const gone: HTMLLIElement = document.createElement("li");
    list.append(kept, gone);
    gone.remove();

    const added: HTMLLIElement = document.createElement("li");
    added.textContent = "added";

    expect(list.insertBefore(added, gone)).toBe(added);
    expect(childNames(list)).toEqual(["li(kept)", "li(added)"]);
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain(
      "at the end, because it no longer holds the <li>",
    );
  });

  test("a real reference, a null reference and a DocumentFragment behave exactly as before", () => {
    const list: HTMLUListElement = document.createElement("ul");
    const last: HTMLLIElement = document.createElement("li");
    last.textContent = "c";
    list.appendChild(last);

    const first: HTMLLIElement = document.createElement("li");
    first.textContent = "a";
    list.insertBefore(first, last);

    const fragment: DocumentFragment = document.createDocumentFragment();
    const middle: HTMLLIElement = document.createElement("li");
    middle.textContent = "b";
    fragment.appendChild(middle);
    list.insertBefore(fragment, last);

    const appended: HTMLLIElement = document.createElement("li");
    appended.textContent = "d";
    list.insertBefore(appended, null);

    expect(childNames(list)).toEqual(["li(a)", "li(b)", "li(c)", "li(d)"]);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test("an insertion that is wrong for any other reason still throws the platform's error", () => {
    const outer: HTMLDivElement = document.createElement("div");
    const inner: HTMLDivElement = document.createElement("div");
    outer.appendChild(inner);

    let thrown: unknown = null;

    try {
      inner.insertBefore(outer, null);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as DOMException).name).toBe("HierarchyRequestError");
  });
});

describe("installing the guard", () => {
  test("is idempotent: a second install keeps the first wrapper", () => {
    const platformRemoveChild: Node["removeChild"] = Node.prototype.removeChild;

    ForeignDomMutationGuard.install();
    const guardedRemoveChild: Node["removeChild"] = Node.prototype.removeChild;
    const guardedInsertBefore: Node["insertBefore"] =
      Node.prototype.insertBefore;
    ForeignDomMutationGuard.install();

    expect(guardedRemoveChild).not.toBe(platformRemoveChild);
    expect(Node.prototype.removeChild).toBe(guardedRemoveChild);
    expect(Node.prototype.insertBefore).toBe(guardedInsertBefore);
  });

  test("a second copy of the module (another bundle, a hot reload) finds the guard already in place", () => {
    ForeignDomMutationGuard.install();
    const guardedRemoveChild: Node["removeChild"] = Node.prototype.removeChild;

    jest.isolateModules(() => {
      // A fresh registry: the module is evaluated again, with its own state.
      const SecondCopy: typeof ForeignDomMutationGuard = (
        jest.requireActual("../../../UI/Utils/ForeignDomMutationGuard") as {
          default: typeof ForeignDomMutationGuard;
        }
      ).default;

      expect(SecondCopy).not.toBe(ForeignDomMutationGuard);
      expect(SecondCopy.isInstalled()).toBe(true);
      SecondCopy.install();
    });

    expect(Node.prototype.removeChild).toBe(guardedRemoveChild);
  });

  test("isInstalled follows install, and uninstalling puts the platform back", () => {
    const platformRemoveChild: Node["removeChild"] = Node.prototype.removeChild;
    const platformInsertBefore: Node["insertBefore"] =
      Node.prototype.insertBefore;

    expect(ForeignDomMutationGuard.isInstalled()).toBe(false);
    ForeignDomMutationGuard.install();
    expect(ForeignDomMutationGuard.isInstalled()).toBe(true);

    ForeignDomMutationGuard.uninstallForTesting();

    expect(ForeignDomMutationGuard.isInstalled()).toBe(false);
    expect(Node.prototype.removeChild).toBe(platformRemoveChild);
    expect(Node.prototype.insertBefore).toBe(platformInsertBefore);
  });

  test("logs the first tolerated calls only, and says so on the last one it logs", () => {
    ForeignDomMutationGuard.install();
    const parent: HTMLDivElement = document.createElement("div");

    for (
      let index: number = 0;
      index < MAX_LOGGED_TOLERATED_CALLS + 5;
      index++
    ) {
      parent.removeChild(document.createElement("span"));
    }

    expect(consoleWarnSpy).toHaveBeenCalledTimes(MAX_LOGGED_TOLERATED_CALLS);
    expect(
      consoleWarnSpy.mock.calls[MAX_LOGGED_TOLERATED_CALLS - 1]![0],
    ).toContain("Further calls like this are not logged.");
    expect(consoleWarnSpy.mock.calls[0]![0]).not.toContain(
      "Further calls like this are not logged.",
    );
  });
});

/*
 * The page scenarios. Each renders under the app's own ErrorBoundary, lets an
 * "extension" edit the DOM React rendered, then has React commit an update
 * that touches the edited node.
 */

interface GreetingProps {
  name: string | null;
}

// Two adjacent text nodes in one paragraph, the first one optional.
const Greeting: FunctionComponent<GreetingProps> = (
  props: GreetingProps,
): ReactElement => {
  return (
    <p data-testid="greeting">
      {props.name}
      {" is signed in"}
    </p>
  );
};

interface SignInStepProps {
  step: "email" | "password";
}

// A two-step form: the email field is swapped for the password field.
const SignInStep: FunctionComponent<SignInStepProps> = (
  props: SignInStepProps,
): ReactElement => {
  return (
    <form data-testid="form">
      {props.step === "email" ? (
        <input key="email" data-testid="email" type="email" />
      ) : (
        <input key="password" data-testid="password" type="password" />
      )}
    </form>
  );
};

interface ItemListProps {
  items: Array<string>;
}

const ItemList: FunctionComponent<ItemListProps> = (
  props: ItemListProps,
): ReactElement => {
  return (
    <ul data-testid="list">
      {props.items.map((item: string): ReactElement => {
        return <li key={item}>{item}</li>;
      })}
    </ul>
  );
};

interface PageScenario {
  name: string;
  first: ReactElement;
  // What the extension does to the DOM the first render produced.
  edit: (container: HTMLElement) => void;
  second: ReactElement;
  // What has to be on screen after the second render, with the guard.
  expectRendered: (container: HTMLElement) => void;
}

const SCENARIOS: Array<PageScenario> = [
  {
    name: "a translator wraps a text node in <font>, then the text goes away",
    first: <Greeting name="Nawaz" />,
    edit: (container: HTMLElement): void => {
      const paragraph: Element = container.querySelector("p")!;
      wrap(paragraph.firstChild!, "font");
    },
    second: <Greeting name={null} />,
    expectRendered: (container: HTMLElement): void => {
      expect(container.querySelector("p")!.textContent).toBe(" is signed in");
    },
  },
  {
    name: "a password manager wraps a field, then the form swaps it for the next one",
    first: <SignInStep step="email" />,
    edit: (container: HTMLElement): void => {
      wrap(
        container.querySelector("[data-testid='email']")!,
        "com-1password-field",
      );
    },
    second: <SignInStep step="password" />,
    expectRendered: (container: HTMLElement): void => {
      expect(container.querySelector("[data-testid='email']")).toBeNull();
      expect(
        container.querySelector("[data-testid='password']"),
      ).not.toBeNull();
    },
  },
  {
    name: "an extension wraps a list item, then an item is added in front of it",
    first: <ItemList items={["b", "c"]} />,
    edit: (container: HTMLElement): void => {
      wrap(container.querySelector("li")!, "font");
    },
    second: <ItemList items={["a", "b", "c"]} />,
    expectRendered: (container: HTMLElement): void => {
      expect(childNames(container.querySelector("ul")!)).toEqual([
        "li(a)",
        "font(b)",
        "li(c)",
      ]);
    },
  },
  {
    name: "an extension takes an element out of the page, then the app removes it too",
    first: <ItemList items={["a", "b"]} />,
    edit: (container: HTMLElement): void => {
      container.querySelectorAll("li")[1]!.remove();
    },
    second: <ItemList items={["a"]} />,
    expectRendered: (container: HTMLElement): void => {
      expect(childNames(container.querySelector("ul")!)).toEqual(["li(a)"]);
    },
  },
];

describe.each(SCENARIOS)("$name", (scenario: PageScenario) => {
  type RunScenarioFunction = () => RenderResult;

  const runScenario: RunScenarioFunction = (): RenderResult => {
    const result: RenderResult = render(
      <ErrorBoundary>{scenario.first}</ErrorBoundary>,
    );

    scenario.edit(result.container);

    act(() => {
      result.rerender(<ErrorBoundary>{scenario.second}</ErrorBoundary>);
    });

    return result;
  };

  test("without the guard, the extension's edit crashes the page into the error screen", () => {
    const result: RenderResult = runScenario();

    expect(hasFallback(result)).toBe(true);
    expect(
      consoleErrorSpy.mock.calls.some((call: Array<unknown>): boolean => {
        return call.some((argument: unknown): boolean => {
          return (argument as Error)?.name === "NotFoundError";
        });
      }),
    ).toBe(true);
  });

  test("with the guard, the page keeps rendering what the app asked for", () => {
    ForeignDomMutationGuard.install();

    const result: RenderResult = runScenario();

    expect(hasFallback(result)).toBe(false);
    scenario.expectRendered(result.container);

    // And it keeps working: the next update commits normally.
    act(() => {
      result.rerender(<ErrorBoundary>{scenario.first}</ErrorBoundary>);
    });

    expect(hasFallback(result)).toBe(false);
  });
});

describe("foreign nodes beside React's, with or without the guard", () => {
  test.each([false, true])(
    "an extension's own elements inside React-managed containers never disturb React (guard installed: %s)",
    (withGuard: boolean) => {
      if (withGuard) {
        ForeignDomMutationGuard.install();
      }

      const result: RenderResult = render(
        <ErrorBoundary>
          <ItemList items={["a", "b"]} />
        </ErrorBoundary>,
      );
      const list: HTMLElement = result.getByTestId("list");

      // A password manager's field button beside ours, and a badge before them.
      list.appendChild(document.createElement("com-1password-button"));
      list.insertBefore(document.createElement("ext-badge"), list.firstChild);
      // Something injected straight into the React root container.
      result.container.appendChild(
        document.createElement("com-1password-menu"),
      );

      act(() => {
        result.rerender(
          <ErrorBoundary>
            <ItemList items={["c", "a"]} />
          </ErrorBoundary>,
        );
      });

      expect(hasFallback(result)).toBe(false);
      expect(
        Array.from(list.querySelectorAll("li")).map((item: Element): string => {
          return item.textContent || "";
        }),
      ).toEqual(["c", "a"]);
      expect(list.querySelector("com-1password-button")).not.toBeNull();
      expect(list.querySelector("ext-badge")).not.toBeNull();
      expect(
        result.container.querySelector("com-1password-menu"),
      ).not.toBeNull();
    },
  );
});

describe("React's own work is untouched by the guard", () => {
  beforeEach(() => {
    ForeignDomMutationGuard.install();
  });

  test("keyed lists reorder, grow and shrink correctly through many updates", () => {
    const orders: Array<Array<string>> = [
      ["a", "b", "c", "d", "e"],
      ["e", "d", "c", "b", "a"],
      ["c", "a", "e"],
      ["f", "c", "g", "a", "e", "h"],
      [],
      ["a"],
      ["b", "a", "c"],
    ];

    const result: RenderResult = render(<ItemList items={orders[0]!} />);

    for (const order of orders) {
      act(() => {
        result.rerender(<ItemList items={order} />);
      });

      expect(
        Array.from(result.getByTestId("list").children).map(
          (item: Element): string => {
            return item.textContent || "";
          },
        ),
      ).toEqual(order);
    }

    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test("conditional content mounts and unmounts without a single tolerated call", () => {
    const result: RenderResult = render(<SignInStep step="email" />);

    for (const step of ["password", "email", "password"] as const) {
      act(() => {
        result.rerender(<SignInStep step={step} />);
      });

      expect(result.queryByTestId(step)).not.toBeNull();
    }

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("when a foreign edit gets past the guard, the boundary never leaves a blank screen", () => {
  interface CrashableProps {
    items: Array<string>;
  }

  const Shell: FunctionComponent<CrashableProps> = (
    props: CrashableProps,
  ): ReactElement => {
    return (
      <div>
        <header data-testid="app-header">OneUptime</header>
        <main>
          {/* The route-level boundary, like the Dashboard's App.tsx. */}
          <ErrorBoundary resetKey={props.items.join(",")}>
            <ItemList items={props.items} />
          </ErrorBoundary>
        </main>
      </div>
    );
  };

  test("the root boundary shows a readable, actionable fallback instead of an empty root", () => {
    const result: RenderResult = render(
      <ErrorBoundary>
        <ItemList items={["b"]} />
      </ErrorBoundary>,
    );

    wrap(result.container.querySelector("li")!, "font");

    act(() => {
      result.rerender(
        <ErrorBoundary>
          <ItemList items={["a", "b"]} />
        </ErrorBoundary>,
      );
    });

    const fallback: HTMLElement = result.getByTestId(FALLBACK_TEST_ID);

    expect(result.container.childNodes.length).toBeGreaterThan(0);
    expect(fallback.querySelector("[role='alert']")!.textContent).toContain(
      "Something went wrong",
    );
    expect(result.queryByTestId("error-boundary-reload")).not.toBeNull();
    expect(result.queryByTestId("error-boundary-try-again")).not.toBeNull();
  });

  test("Try again rebuilds the page from fresh DOM", () => {
    const result: RenderResult = render(
      <ErrorBoundary>
        <ItemList items={["b"]} />
      </ErrorBoundary>,
    );

    wrap(result.container.querySelector("li")!, "font");

    act(() => {
      result.rerender(
        <ErrorBoundary>
          <ItemList items={["a", "b"]} />
        </ErrorBoundary>,
      );
    });

    expect(hasFallback(result)).toBe(true);

    fireEvent.click(result.getByTestId("error-boundary-try-again"));

    expect(hasFallback(result)).toBe(false);
    expect(
      Array.from(result.getByTestId("list").children).map(
        (item: Element): string => {
          return item.textContent || "";
        },
      ),
    ).toEqual(["a", "b"]);
  });

  test("a route-level boundary keeps the header up, and the next navigation recovers the page", () => {
    const result: RenderResult = render(<Shell items={["b"]} />);

    wrap(result.container.querySelector("li")!, "font");

    act(() => {
      result.rerender(<Shell items={["a", "b"]} />);
    });

    expect(hasFallback(result)).toBe(true);
    expect(result.getByTestId("app-header").textContent).toBe("OneUptime");

    act(() => {
      result.rerender(<Shell items={["c"]} />);
    });

    expect(hasFallback(result)).toBe(false);
    expect(result.getByTestId("list").textContent).toBe("c");
  });
});
