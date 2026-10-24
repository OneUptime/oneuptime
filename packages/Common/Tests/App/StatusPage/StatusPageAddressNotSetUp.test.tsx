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
  PASS_HOST_HEADER_LINES,
  getAddressNotSetUpFacts,
  hostnameOf,
  isIpAddressHost,
  isLoopbackHost,
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
    expect(
      screen.getByTestId("address-not-set-up-host-line").closest("[dir]"),
    ).toHaveAttribute("dir", "ltr");
    expect(screen.getByTestId("address-not-set-up-restart")).toHaveAttribute(
      "dir",
      "ltr",
    );
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
      screen.getByText(
        "You opened 203.0.113.5:8080, but this OneUptime is set up to open at localhost.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("address-not-set-up-host-line")).toHaveValue(
      "HOST=203.0.113.5:8080",
    );
    expect(screen.getByTestId("address-not-set-up-restart")).toHaveTextContent(
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
    expect(screen.getByTestId("address-not-set-up-host-line")).toHaveValue(
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
      screen.getByText(
        "status.example.com is not the address of a status page.",
      ),
    ).toBeInTheDocument();
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
      fireEvent.click(screen.getByTestId("address-not-set-up-copy"));
    });

    expect(copied).toEqual(["HOST=203.0.113.5:8080"]);
    expect(screen.getByTestId("address-not-set-up-copy")).toHaveTextContent(
      ENGLISH["copied"] as string,
    );
    expect(
      screen.queryByTestId("address-not-set-up-copy-failed"),
    ).not.toBeInTheDocument();
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
      fireEvent.click(screen.getByTestId("address-not-set-up-copy"));
    });

    expect(
      screen.getByTestId("address-not-set-up-copy-failed"),
    ).toHaveTextContent(ENGLISH["copyFailed"] as string);
    expect(screen.getByTestId("address-not-set-up-copy")).toHaveTextContent(
      ENGLISH["copy"] as string,
    );
    expect(selected).toEqual([
      screen.getByTestId("address-not-set-up-host-line"),
    ]);
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

    expect(screen.getByTestId("address-not-set-up-host-line")).toHaveValue(
      "HOST=203.0.113.5:8080",
    );
    expect(
      screen.getByText(
        "You opened 203.0.113.5:8080, but this OneUptime is set up to open at localhost.",
      ),
    ).toBeInTheDocument();
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

  test("a lookup that failed, rather than answered, keeps the generic error", async () => {
    for (const failure of [
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(502, { error: "Bad Gateway" }, {});
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
