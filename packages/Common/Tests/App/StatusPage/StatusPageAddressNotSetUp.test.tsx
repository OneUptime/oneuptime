/**
 * @jest-environment-options {"url": "http://203.0.113.5:8080/accounts/register"}
 */
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Clipboard from "../../../UI/Utils/Clipboard";
import API from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import AddressNotSetUp from "../../../../App/FeatureSet/StatusPage/src/Components/AddressNotSetUp/AddressNotSetUp";
import StatusPageMasterPage from "../../../../App/FeatureSet/StatusPage/src/Components/MasterPage/MasterPage";
import {
  AddressNotSetUpError,
  AddressNotSetUpFacts,
  AddressNotSetUpKind,
  NO_STATUS_PAGE_STATUS_CODES,
  PASS_HOST_HEADER_LINES,
  SentencePiece,
  VALUE_MARK,
  getAddressNotSetUpFacts,
  hostnameOf,
  isIpAddressHost,
  isLoopbackHost,
  isNoStatusPageAnswer,
  markedValues,
  sentencePieces,
} from "../../../../App/FeatureSet/StatusPage/src/Utils/AddressNotSetUp";
import { getJestSpyOn } from "../../Spy";

/*
 * The page a status page address shows when nothing is set up there.
 *
 * OneUptime serves its own pages only at HOST; every other address is taken
 * for a status page's custom domain. A newcomer who opened their new install
 * at the server's IP address (HOST still localhost) - or through a proxy that
 * rewrote the host name - used to get a blank page that said "Status Page ID
 * not found" (issues #1425, #2418, #1291, #2195, #2376). This page says which
 * of those it is and what to do.
 *
 * The page is opened at http://203.0.113.5:8080/accounts/register (the
 * docblock above), as a newcomer does. Translations resolve against the
 * status page's real en.json and never fall back to a default: a key missing
 * from the locales renders as the bare key, so these tests fail on it.
 */

let billingEnabledForTest: boolean = false;
let hostForTest: string = "localhost";
let protocolForTest: string = "http";
// What i18next says the reader's language reads in: "rtl" for Persian.
let directionForTest: string = "ltr";

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  Object.defineProperty(mocked, "HOST", {
    get: (): string => {
      return hostForTest;
    },
  });

  mocked["env"] = (key: string): string => {
    if (key === "HTTP_PROTOCOL") {
      return protocolForTest;
    }

    return (actual["env"] as (key: string) => string)(key);
  };

  return mocked;
});

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (
    key: string,
    options?: Record<string, unknown>,
  ) => string = (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof node !== "string") {
      return key;
    }

    return node.replace(
      /\{\{(\w+)\}\}/g,
      (_placeholder: string, name: string): string => {
        return String(options?.[name] ?? "");
      },
    );
  };

  return {
    // The master page loads the status page's i18n setup, which plugs this in.
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
    useTranslation: () => {
      return {
        t: translate,
        i18n: {
          resolvedLanguage: "en",
          language: "en",
          dir: (): string => {
            return directionForTest;
          },
        },
      };
    },
  };
});

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "StatusPage",
  "src",
  "Locales",
);
const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

type Locale = Record<string, any>;

// A step's number: 1 or 2.
const STEP_NUMBER: RegExp = /^[12]$/;

const readLocale: (directory: string, file: string) => Locale = (
  directory: string,
  file: string,
): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(directory, file), "utf8"),
  ) as Locale;
};

const ENGLISH: Record<string, string> = readLocale(LOCALES_DIR, "en.json")[
  "errors"
]["addressNotSetUp"] as Record<string, string>;

const factsFor: (
  overrides: Partial<{
    visitedHost: string;
    configuredHost: string;
    configuredProtocol: string;
    isSelfHosted: boolean;
  }>,
) => AddressNotSetUpFacts = (
  overrides: Partial<{
    visitedHost: string;
    configuredHost: string;
    configuredProtocol: string;
    isSelfHosted: boolean;
  }>,
): AddressNotSetUpFacts => {
  return getAddressNotSetUpFacts({
    visitedHost: "203.0.113.5:8080",
    configuredHost: "localhost",
    configuredProtocol: "http",
    isSelfHosted: true,
    ...overrides,
  });
};

describe("what the page says, from the address opened and HOST", () => {
  test("a self-hosted OneUptime opened at its server's address while HOST is localhost", () => {
    expect(factsFor({})).toEqual({
      kind: AddressNotSetUpKind.NotHost,
      visitedHost: "203.0.113.5:8080",
      configuredHost: "localhost",
      hostLine: "HOST=203.0.113.5:8080",
      configuredUrl: null,
      canBeStatusPageDomain: false,
      isStatusPageDomainLikelier: false,
    });
  });

  test("opened at a domain name while HOST is another one: open where it is set up, and the domain may be a status page's", () => {
    expect(
      factsFor({
        visitedHost: "status.example.com",
        configuredHost: "oneuptime.example.com",
        configuredProtocol: "https",
      }),
    ).toEqual({
      kind: AddressNotSetUpKind.NotHost,
      visitedHost: "status.example.com",
      configuredHost: "oneuptime.example.com",
      hostLine: "HOST=status.example.com",
      configuredUrl: "https://oneuptime.example.com",
      canBeStatusPageDomain: true,
      isStatusPageDomainLikelier: true,
    });
  });

  test("a domain name opened while HOST is still localhost: setting HOST is the likelier fix", () => {
    const facts: AddressNotSetUpFacts = factsFor({
      visitedHost: "monitoring.example.com",
    });

    expect(facts.kind).toBe(AddressNotSetUpKind.NotHost);
    expect(facts.canBeStatusPageDomain).toBe(true);
    expect(facts.isStatusPageDomainLikelier).toBe(false);
  });

  test("anything but https is opened over http, as OneUptime builds its links", () => {
    expect(
      factsFor({
        configuredHost: "oneuptime.example.com",
        configuredProtocol: "HTTPS",
      }).configuredUrl,
    ).toBe("http://oneuptime.example.com");
  });

  test.each(["oneuptime.example.com", "OneUptime.Example.com"])(
    "opened at HOST itself (%s): the request reached OneUptime under another name, which only a proxy does",
    (visited: string) => {
      const facts: AddressNotSetUpFacts = factsFor({
        visitedHost: visited,
        configuredHost: "oneuptime.example.com",
      });

      expect(facts.kind).toBe(AddressNotSetUpKind.ProxyRewroteHost);
      // OneUptime's own address is never a status page's domain.
      expect(facts.canBeStatusPageDomain).toBe(false);
      expect(facts.isStatusPageDomainLikelier).toBe(false);
    },
  );

  test("OneUptime Cloud: nobody visiting can change HOST, so only that no status page is here", () => {
    const facts: AddressNotSetUpFacts = factsFor({
      visitedHost: "status.example.com",
      configuredHost: "oneuptime.com",
      isSelfHosted: false,
    });

    expect(facts.kind).toBe(AddressNotSetUpKind.NoStatusPage);
    expect(facts.canBeStatusPageDomain).toBe(true);
    expect(facts.isStatusPageDomainLikelier).toBe(true);
  });

  test("an empty HOST is never mistaken for the address opened", () => {
    expect(factsFor({ visitedHost: "", configuredHost: "" }).kind).toBe(
      AddressNotSetUpKind.NotHost,
    );
  });

  test.each([
    ["example.com:8080", "example.com"],
    ["Example.COM", "example.com"],
    ["[::1]:8080", "[::1]"],
    ["2001:db8::1", "2001:db8::1"],
    ["localhost", "localhost"],
  ])("the host name of %s is %s", (host: string, hostname: string) => {
    expect(hostnameOf(host)).toBe(hostname);
  });

  test("this computer and IP addresses can never be a status page's domain", () => {
    for (const host of [
      "localhost",
      "localhost:8080",
      "127.0.0.1",
      "[::1]:80",
    ]) {
      expect({ host, loopback: isLoopbackHost(host) }).toEqual({
        host,
        loopback: true,
      });
    }

    for (const host of ["203.0.113.5", "203.0.113.5:8080", "[2001:db8::1]"]) {
      expect({ host, ip: isIpAddressHost(host) }).toEqual({ host, ip: true });
    }

    expect(isIpAddressHost("status.example.com")).toBe(false);
    expect(isLoopbackHost("localhost.example.com")).toBe(false);
  });

  test("the error the master page throws is told apart from every other one", () => {
    const error: Error = new AddressNotSetUpError();

    expect(error).toBeInstanceOf(AddressNotSetUpError);
    expect(error).toBeInstanceOf(Error);
    expect(new Error("x")).not.toBeInstanceOf(AddressNotSetUpError);
  });

  test("only the API's 'no status page has this domain' answers are taken for one: 400 and 404", () => {
    expect(NO_STATUS_PAGE_STATUS_CODES).toEqual([400, 404]);

    for (const statusCode of [400, 404]) {
      expect({ statusCode, answer: isNoStatusPageAnswer(statusCode) }).toEqual({
        statusCode,
        answer: true,
      });
    }

    // A firewall, a rate limit or a failing server in front of a real status page.
    for (const statusCode of [401, 403, 405, 408, 413, 429, 500, 502, 503]) {
      expect({ statusCode, answer: isNoStatusPageAnswer(statusCode) }).toEqual({
        statusCode,
        answer: false,
      });
    }
  });

  test("a sentence translated with marked values comes back in pieces: words, then each value by name", () => {
    const marked: Record<string, string> = markedValues([
      "visited",
      "configured",
    ]);

    expect(marked).toEqual({
      visited: `${VALUE_MARK}visited${VALUE_MARK}`,
      configured: `${VALUE_MARK}configured${VALUE_MARK}`,
    });

    const pieces: Array<SentencePiece> = sentencePieces(
      `You opened ${marked["visited"]}, but this OneUptime is set up to open at ${marked["configured"]}.`,
      ["visited", "configured"],
    );

    expect(pieces).toEqual([
      { text: "You opened " },
      { value: "visited" },
      { text: ", but this OneUptime is set up to open at " },
      { value: "configured" },
      { text: "." },
    ]);

    // A value first, last or alone leaves no empty words around it.
    expect(sentencePieces(marked["visited"] as string, ["visited"])).toEqual([
      { value: "visited" },
    ]);
    // Words with no value stay words; a name it was not given stays words too.
    expect(sentencePieces("No status page here.", ["visited"])).toEqual([
      { text: "No status page here." },
    ]);
    expect(
      sentencePieces(`a ${marked["configured"]} b`, ["visited"]).map(
        (piece: SentencePiece): string | undefined => {
          return piece.value;
        },
      ),
    ).toEqual([undefined, undefined, undefined]);
  });
});

describe("the page", () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    directionForTest = "ltr";
  });

  test("it reads right to left in a language that does, and the lines to copy stay left to right", () => {
    directionForTest = "rtl";

    render(<AddressNotSetUp facts={factsFor({})} />);

    expect(
      screen.getByTestId("status-page-address-not-set-up"),
    ).toHaveAttribute("dir", "rtl");
    // Each line to type, with its Copy button, reads left to right.
    for (const testId of [
      "address-not-set-up-host-line",
      "address-not-set-up-restart",
    ]) {
      expect(screen.getByTestId(testId).closest("[dir]")).toHaveAttribute(
        "dir",
        "ltr",
      );
      expect(screen.getByTestId(testId).closest("[dir]")).toContainElement(
        screen.getByTestId(`${testId}-copy`),
      );
    }
  });

  test("and left to right in English", () => {
    render(<AddressNotSetUp facts={factsFor({})} />);

    expect(
      screen.getByTestId("status-page-address-not-set-up"),
    ).toHaveAttribute("dir", "ltr");
  });

  test("opened at the server's address while HOST is localhost: the line to copy, the command, and Helm", () => {
    render(<AddressNotSetUp facts={factsFor({})} />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: ENGLISH["title"] as string,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("address-not-set-up-description").textContent,
    ).toBe(
      "You opened 203.0.113.5:8080, but this OneUptime is set up to open at localhost.",
    );
    expect(screen.getByTestId("address-not-set-up-host-line").textContent).toBe(
      "HOST=203.0.113.5:8080",
    );
    expect(screen.getByTestId("address-not-set-up-restart").textContent).toBe(
      "npm start",
    );
    expect(screen.getByText(ENGLISH["helm"] as string)).toBeInTheDocument();

    // No link to localhost, which is the reader's own computer.
    expect(
      screen.queryByTestId("address-not-set-up-open-configured"),
    ).not.toBeInTheDocument();
    // An IP address cannot be a status page's domain.
    expect(
      screen.queryByTestId("address-not-set-up-domain"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("address-not-set-up-proxy"),
    ).not.toBeInTheDocument();
  });

  test("opened at another domain: where OneUptime opens, as a link, and how a status page's domain gets here", () => {
    render(
      <AddressNotSetUp
        facts={factsFor({
          visitedHost: "status.example.com",
          configuredHost: "oneuptime.example.com",
          configuredProtocol: "https",
        })}
      />,
    );

    const link: HTMLElement = screen.getByTestId(
      "address-not-set-up-open-configured",
    );

    expect(link).toHaveAttribute("href", "https://oneuptime.example.com");
    expect(link).toHaveTextContent("Open OneUptime at oneuptime.example.com");
    expect(screen.getByTestId("address-not-set-up-domain")).toHaveTextContent(
      ENGLISH["domainSteps"] as string,
    );
    expect(screen.getByTestId("address-not-set-up-host-line").textContent).toBe(
      "HOST=status.example.com",
    );
  });

  test("opened at HOST through a proxy that rewrote the host name: the proxy lines, and no HOST to change", () => {
    render(
      <AddressNotSetUp
        facts={factsFor({
          visitedHost: "oneuptime.example.com",
          configuredHost: "oneuptime.example.com",
        })}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: ENGLISH["proxyTitle"] as string,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("address-not-set-up-proxy")).toHaveTextContent(
      ENGLISH["proxySteps"] as string,
    );
    for (const entry of PASS_HOST_HEADER_LINES) {
      expect(
        screen.getByTestId(
          `address-not-set-up-proxy-${entry.proxy.toLowerCase()}`,
        ),
      ).toHaveTextContent(entry.line);
    }
    expect(
      screen.queryByTestId("address-not-set-up-host"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("address-not-set-up-open-configured"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("address-not-set-up-domain"),
    ).not.toBeInTheDocument();
  });

  test("OneUptime Cloud: no status page here, and how a domain gets one - never config.env", () => {
    render(
      <AddressNotSetUp
        facts={factsFor({
          visitedHost: "status.example.com",
          configuredHost: "oneuptime.com",
          configuredProtocol: "https",
          isSelfHosted: false,
        })}
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: ENGLISH["noPageTitle"] as string,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("address-not-set-up-description").textContent,
    ).toBe("status.example.com is not the address of a status page.");
    expect(screen.getByTestId("address-not-set-up-domain")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("config.env");
    expect(document.body).not.toHaveTextContent("HOST");
  });

  test("copying the HOST line says Copied! once it is on the clipboard", async () => {
    const copied: Array<string> = [];

    getJestSpyOn(Clipboard, "copyToClipboard").mockImplementation(
      async (text: string): Promise<boolean> => {
        copied.push(text);
        return true;
      },
    );

    render(<AddressNotSetUp facts={factsFor({})} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("address-not-set-up-host-line-copy"));
    });

    expect(copied).toEqual(["HOST=203.0.113.5:8080"]);
    expect(
      screen.getByTestId("address-not-set-up-host-line-copy"),
    ).toHaveTextContent(ENGLISH["copied"] as string);
    // Said to a screen reader too, as it happens.
    expect(
      screen.getByTestId("address-not-set-up-host-line-copy-status"),
    ).toHaveTextContent(ENGLISH["copied"] as string);
    expect(
      screen.queryByTestId("address-not-set-up-host-line-copy-failed"),
    ).not.toBeInTheDocument();
    // The other line keeps its own Copy.
    expect(
      screen.getByTestId("address-not-set-up-restart-copy"),
    ).toHaveTextContent(ENGLISH["copy"] as string);
  });

  test("a browser that refuses to copy is said so, and the line is selected to copy by hand", async () => {
    getJestSpyOn(Clipboard, "copyToClipboard").mockResolvedValue(false);
    const selected: Array<HTMLElement | null | undefined> = [];

    getJestSpyOn(Clipboard, "selectForManualCopy").mockImplementation(
      (element: HTMLElement | null | undefined): void => {
        selected.push(element);
      },
    );

    render(<AddressNotSetUp facts={factsFor({})} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("address-not-set-up-host-line-copy"));
    });

    expect(
      screen.getByTestId("address-not-set-up-host-line-copy-failed"),
    ).toHaveTextContent(ENGLISH["copyFailed"] as string);
    expect(
      screen.getByTestId("address-not-set-up-host-line-copy"),
    ).toHaveTextContent(ENGLISH["copy"] as string);
    expect(selected).toEqual([
      screen.getByTestId("address-not-set-up-host-line"),
    ]);
    // The line is selected for the reader, so the page says so - not "select it".
    expect(ENGLISH["copyFailed"]).toBe(
      "Your browser didn't let this page copy the line. It's selected above, so you can copy it yourself.",
    );
    // Said under the line that failed, and no other.
    expect(
      screen.queryByTestId("address-not-set-up-restart-copy-failed"),
    ).not.toBeInTheDocument();
  });

  const headingsOf: () => Array<string | null> = (): Array<string | null> => {
    return screen
      .getAllByRole("heading", { level: 2 })
      .map((heading: HTMLElement) => {
        return heading.textContent;
      });
  };

  test("a second domain name on a configured install: one h1, the status page's domain first, then HOST", () => {
    render(
      <AddressNotSetUp
        facts={factsFor({
          visitedHost: "status.example.com",
          configuredHost: "oneuptime.example.com",
        })}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(headingsOf()).toEqual([
      ENGLISH["domainHeading"],
      ENGLISH["hostHeading"],
    ]);
  });

  test("a domain name while HOST is still localhost: HOST first, then the status page's domain", () => {
    render(
      <AddressNotSetUp
        facts={factsFor({ visitedHost: "monitoring.example.com" })}
      />,
    );

    expect(headingsOf()).toEqual([
      ENGLISH["hostHeading"],
      ENGLISH["domainHeading"],
    ]);
  });
});

describe("the lines to type, the addresses and the link", () => {
  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    directionForTest = "ltr";
  });

  test("every line to type has its own Copy button, which copies that line exactly", async () => {
    const copied: Array<string> = [];

    getJestSpyOn(Clipboard, "copyToClipboard").mockImplementation(
      async (text: string): Promise<boolean> => {
        copied.push(text);
        return true;
      },
    );

    // The HOST line and the command.
    render(<AddressNotSetUp facts={factsFor({})} />);

    for (const testId of [
      "address-not-set-up-host-line",
      "address-not-set-up-restart",
    ]) {
      await act(async () => {
        fireEvent.click(screen.getByTestId(`${testId}-copy`));
      });
    }

    expect(copied).toEqual(["HOST=203.0.113.5:8080", "npm start"]);

    cleanup();

    // The proxy lines.
    render(
      <AddressNotSetUp
        facts={factsFor({
          visitedHost: "oneuptime.example.com",
          configuredHost: "oneuptime.example.com",
        })}
      />,
    );

    for (const entry of PASS_HOST_HEADER_LINES) {
      await act(async () => {
        fireEvent.click(
          screen.getByTestId(
            `address-not-set-up-proxy-${entry.proxy.toLowerCase()}-copy`,
          ),
        );
      });
    }

    expect(copied.slice(2)).toEqual(
      PASS_HOST_HEADER_LINES.map((entry: { line: string }): string => {
        return entry.line;
      }),
    );
  });

  test("a Copy button is a real button, named Copy and described by the line it copies", () => {
    render(<AddressNotSetUp facts={factsFor({})} />);

    const buttons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: ENGLISH["copy"] as string,
    });

    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      expect(button).toHaveAttribute("type", "button");

      const line: HTMLElement | null = document.getElementById(
        button.getAttribute("aria-describedby") as string,
      );

      expect(line).not.toBeNull();
      expect(line?.tagName).toBe("CODE");
    }

    expect(
      buttons.map((button: HTMLElement) => {
        return document.getElementById(
          button.getAttribute("aria-describedby") as string,
        )?.textContent;
      }),
    ).toEqual(["HOST=203.0.113.5:8080", "npm start"]);
  });

  test("a long address is drawn whole, breaking between its parts, and nothing is added to the line", () => {
    const visitedHost: string =
      "observability-monitoring.eu-west-production.internal.example-corporation.co.uk:8443";

    render(<AddressNotSetUp facts={factsFor({ visitedHost })} />);

    const line: HTMLElement = screen.getByTestId(
      "address-not-set-up-host-line",
    );

    // Not a field that scrolls its end out of sight: the whole line, as text.
    expect(line.tagName).toBe("CODE");
    expect(line.textContent).toBe(`HOST=${visitedHost}`);
    expect(line.className).toContain("break-words");
    expect(line.className).toContain("select-all");
    // A place to break after "=", each "." and "-", and the ":" before the port.
    expect(line.querySelectorAll("wbr")).toHaveLength(11);
  });

  test("the addresses in the sentence are drawn apart from its words", () => {
    render(
      <AddressNotSetUp
        facts={factsFor({
          visitedHost: "status.example.com",
          configuredHost: "oneuptime.example.com",
        })}
      />,
    );

    const visited: HTMLElement = screen.getByTestId(
      "address-not-set-up-visited",
    );
    const configured: HTMLElement = screen.getByTestId(
      "address-not-set-up-configured",
    );

    expect(visited.textContent).toBe("status.example.com");
    expect(configured.textContent).toBe("oneuptime.example.com");

    for (const value of [visited, configured]) {
      expect(value.className).toContain("font-medium");
      expect(value.className).toContain("text-gray-900");
      expect(
        screen.getByTestId("address-not-set-up-description"),
      ).toContainElement(value);
    }

    // No mark is left in what is drawn.
    expect(document.body.textContent).not.toContain(VALUE_MARK);
  });

  test("the browser's tab says the page's title, and its own title again once the page is gone", () => {
    document.title = "Status Page";

    const { unmount } = render(<AddressNotSetUp facts={factsFor({})} />);

    expect(document.title).toBe(ENGLISH["title"]);

    unmount();

    expect(document.title).toBe("Status Page");
  });

  test("the link to where OneUptime opens keeps its arrow by its last word, pointing the way the language reads", () => {
    render(
      <AddressNotSetUp
        facts={factsFor({
          visitedHost: "status.example.com",
          configuredHost: "oneuptime.example.com",
        })}
      />,
    );

    const link: HTMLElement = screen.getByTestId(
      "address-not-set-up-open-configured",
    );
    const arrow: HTMLElement = screen.getByTestId(
      "address-not-set-up-open-configured-chevron",
    );

    // In the link's own line of text, not a box beside a wrapped block.
    expect(link).toContainElement(arrow);
    expect(arrow.tagName.toLowerCase()).toBe("svg");
    expect(arrow.getAttribute("class")).toContain("inline-block");
    expect(arrow.getAttribute("class")).toContain("rtl:rotate-180");
    expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(link.className).not.toContain("flex");
    // A keyboard reader sees where it is.
    expect(link.className).toContain("focus-visible:outline");
    expect(link).toHaveAccessibleName(
      "Open OneUptime at oneuptime.example.com",
    );
  });

  test("the steps' numbers are for the eye: the list itself tells a screen reader the order", () => {
    render(<AddressNotSetUp facts={factsFor({})} />);

    const steps: Array<HTMLElement> = screen.getAllByRole("listitem");

    expect(steps).toHaveLength(2);

    for (const step of steps) {
      expect(step.querySelector("[aria-hidden='true']")?.textContent).toMatch(
        STEP_NUMBER,
      );
    }
  });
});

describe("the master page, at an address with no status page", () => {
  let answer: () => Promise<
    HTTPResponse<JSONObject> | HTTPErrorResponse
  > = async () => {
    return new HTTPErrorResponse(
      400,
      { error: "No status page found with this domain" },
      {},
    );
  };
  let lookedUp: Array<{ url: string; data: unknown }> = [];

  beforeEach(() => {
    billingEnabledForTest = false;
    hostForTest = "localhost";
    protocolForTest = "http";
    lookedUp = [];
    answer = async () => {
      return new HTTPErrorResponse(
        400,
        { error: "No status page found with this domain" },
        {},
      );
    };

    getJestSpyOn(API, "post").mockImplementation(
      async (options: {
        url: { toString: () => string };
        data?: unknown;
      }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        lookedUp.push({ url: options.url.toString(), data: options.data });
        return answer();
      },
    );
    getJestSpyOn(API, "getFriendlyMessage").mockReturnValue(
      "Something went wrong.",
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  const renderMasterPage: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      render(
        <StatusPageMasterPage
          isPreview={false}
          isPrivateStatusPage={false}
          enableEmailSubscribers={false}
          enableSMSSubscribers={false}
          onLoadComplete={() => {}}
        >
          <div>Status page content</div>
        </StatusPageMasterPage>,
      );
    });
  };

  test("asks for the status page of the address it was opened at, then explains: HOST is localhost", async () => {
    await renderMasterPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("status-page-address-not-set-up"),
      ).toBeInTheDocument();
    });

    expect(lookedUp).toHaveLength(1);
    expect(lookedUp[0]!.url).toContain("/status-page-api/");
    expect(lookedUp[0]!.url).toContain("/domain");
    expect(lookedUp[0]!.data).toEqual({ domain: "203.0.113.5" });

    expect(screen.getByTestId("address-not-set-up-host-line").textContent).toBe(
      "HOST=203.0.113.5:8080",
    );
    expect(
      screen.getByTestId("address-not-set-up-description").textContent,
    ).toBe(
      "You opened 203.0.113.5:8080, but this OneUptime is set up to open at localhost.",
    );
    expect(document.body).not.toHaveTextContent("Status Page ID not found");
    expect(document.body).not.toHaveTextContent("Status page content");
  });

  test("on OneUptime Cloud it says only that no status page is here", async () => {
    billingEnabledForTest = true;
    hostForTest = "oneuptime.com";

    await renderMasterPage();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: ENGLISH["noPageTitle"] as string,
      }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("config.env");
  });

  test("a 404 is the same answer as the API's 400: the page explains", async () => {
    answer = async () => {
      return new HTTPErrorResponse(404, { error: "Not found" }, {});
    };

    await renderMasterPage();

    expect(
      await screen.findByTestId("status-page-address-not-set-up"),
    ).toBeInTheDocument();
  });

  test("a lookup that failed, rather than answered, keeps the generic error", async () => {
    for (const failure of [
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(502, { error: "Bad Gateway" }, {});
      },
      // A firewall, an expired session or a rate limit in front of a real status page.
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(401, { error: "Unauthorized" }, {});
      },
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(403, { error: "Forbidden" }, {});
      },
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(429, { error: "Too Many Requests" }, {});
      },
      async (): Promise<HTTPErrorResponse> => {
        throw new Error("Network Error");
      },
    ]) {
      answer = failure;

      await renderMasterPage();

      expect(await screen.findByText("Something went wrong.")).toBeVisible();
      expect(
        screen.queryByTestId("status-page-address-not-set-up"),
      ).not.toBeInTheDocument();

      cleanup();
    }
  });
});

describe("the page's words in every language", () => {
  const LANGUAGES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string) => {
      return file.endsWith(".json");
    })
    .map((file: string) => {
      return file.replace(/\.json$/, "");
    })
    .sort();

  test("every status page language has them", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  test.each(LANGUAGES)(
    "%s says every sentence, with its values",
    (language: string) => {
      const strings: Record<string, string> = readLocale(
        LOCALES_DIR,
        `${language}.json`,
      )["errors"]["addressNotSetUp"] as Record<string, string>;

      expect(Object.keys(strings)).toEqual(Object.keys(ENGLISH));

      for (const [key, english] of Object.entries(ENGLISH)) {
        const value: string = strings[key] as string;

        expect({ key, empty: value.trim() === "" }).toEqual({
          key,
          empty: false,
        });

        for (const placeholder of ["{{visited}}", "{{configured}}"]) {
          expect({
            key,
            placeholder,
            kept: value.includes(placeholder),
          }).toEqual({ key, placeholder, kept: english.includes(placeholder) });
        }
      }

      // What the reader types or looks for stays as written.
      expect(strings["hostStep"]).toContain("config.env");
      expect(strings["hostStep"]).toContain("HOST");
      expect(strings["helm"]).toContain("host");
      expect(strings["helm"]).toContain("Helm");
      for (const name of ["Caddy", "Nginx", "Apache"]) {
        expect(strings["proxySteps"]).toContain(name);
      }
    },
  );

  test.each(LANGUAGES)(
    "%s keeps each address of its sentences whole, to be drawn apart from the words",
    (language: string) => {
      const strings: Record<string, string> = readLocale(
        LOCALES_DIR,
        `${language}.json`,
      )["errors"]["addressNotSetUp"] as Record<string, string>;
      const names: Array<string> = ["visited", "configured"];
      const marked: Record<string, string> = markedValues(names);
      const real: Record<string, string> = {
        visited: "203.0.113.5:8080",
        configured: "oneuptime.example.com",
      };

      for (const key of [
        "description",
        "proxyDescription",
        "noPageDescription",
      ]) {
        const template: string = strings[key] as string;
        const interpolate: (values: Record<string, string>) => string = (
          values: Record<string, string>,
        ): string => {
          let text: string = template;

          for (const name of names) {
            text = text.split(`{{${name}}}`).join(values[name] as string);
          }

          return text;
        };
        const pieces: Array<SentencePiece> = sentencePieces(
          interpolate(marked),
          names,
        );

        // Each value the sentence names comes back as itself, in its place.
        expect({
          key,
          values: pieces
            .filter((piece: SentencePiece): boolean => {
              return Boolean(piece.value);
            })
            .map((piece: SentencePiece): string => {
              return piece.value as string;
            })
            .sort(),
        }).toEqual({
          key,
          values: names
            .filter((name: string): boolean => {
              return template.includes(`{{${name}}}`);
            })
            .sort(),
        });

        // Put back together, it reads as the sentence with its values.
        expect({
          key,
          sentence: pieces
            .map((piece: SentencePiece): string => {
              return piece.value
                ? (real[piece.value] as string)
                : piece.text || "";
            })
            .join(""),
        }).toEqual({ key, sentence: interpolate(real) });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s names Custom Domains as that language's Dashboard draws it",
    (language: string) => {
      const dashboard: Record<string, string> = readLocale(
        DASHBOARD_LOCALES_DIR,
        `${language}.json`,
      ) as Record<string, string>;
      const drawn: string =
        language === "en"
          ? "Custom Domains"
          : (dashboard["Custom Domains"] as string);
      const strings: Record<string, string> = readLocale(
        LOCALES_DIR,
        `${language}.json`,
      )["errors"]["addressNotSetUp"] as Record<string, string>;

      expect(drawn.length).toBeGreaterThan(0);
      expect(strings["domainSteps"]).toContain(drawn);
    },
  );
});
