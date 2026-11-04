import UserAgentDevice, {
  DeviceDetails,
  DeviceKind,
  MAX_USER_AGENT_LENGTH,
  OperatingSystem,
  UserAgentClientHints,
} from "../../../../Server/Utils/RequestOrigin/UserAgentDevice";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { describe, expect, it, test } from "@jest/globals";

/*
 * The device and browser a security email says a request came from
 * (UserAgentDevice): what real browsers and programs are called, and that
 * nothing a caller writes in their headers reaches the email but the words
 * this file spells out.
 */

type DescribeFunction = (
  userAgent: string | undefined,
  clientHints?: UserAgentClientHints,
) => string | undefined;

const describeUserAgent: DescribeFunction = (
  userAgent: string | undefined,
  clientHints?: UserAgentClientHints,
): string | undefined => {
  return UserAgentDevice.describe(
    UserAgentDevice.read({ userAgent: userAgent, clientHints: clientHints }),
  );
};

const CHROME_MAC: string =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("desktop browsers", () => {
  test.each([
    [CHROME_MAC, "Chrome 130 on macOS"],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Chrome 131 on Windows",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Chrome 130 on Linux",
    ],
    [
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Chrome 130 on ChromeOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68",
      "Microsoft Edge 130 on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 Edge/18.19041",
      "Microsoft Edge 18 on Windows",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
      "Firefox 132 on macOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
      "Firefox 132 on Windows",
    ],
    [
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
      "Firefox 132 on Linux",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      "Safari 18 on macOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/115.0.0.0",
      "Opera 115 on Windows",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/7.0.3495.6",
      "Vivaldi 7 on Linux",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 YaBrowser/24.6.0.0 Safari/537.36",
      "Yandex Browser 24 on Windows",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/120.0.0.0 Chrome/120.0.0.0 Safari/537.36",
      "Chromium 120 on Linux",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36",
      "Headless Chrome 130 on Linux",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko",
      "Internet Explorer 11 on Windows",
    ],
    [
      "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.2; Trident/6.0)",
      "Internet Explorer 10 on Windows",
    ],
  ])("%s is %s", (userAgent: string, expected: string) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });

  it("names a desktop's kind and operating system, never their versions", () => {
    const device: DeviceDetails = UserAgentDevice.read({
      userAgent: CHROME_MAC,
    });

    expect(device).toEqual({
      browser: "Chrome",
      browserVersion: "130",
      operatingSystem: OperatingSystem.MacOS,
      deviceKind: DeviceKind.Desktop,
    });

    // Every Mac says it runs macOS 10.15; the email does not repeat it.
    expect(describeUserAgent(CHROME_MAC)).not.toContain("10");
  });
});

describe("phones and tablets", () => {
  test.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      "Safari 18 on iPhone",
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
      "Safari 17 on iPad",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
      "Chrome 130 on iPhone",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
      "Firefox 132 on iPhone",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15",
      "Microsoft Edge 130 on iPhone",
    ],
    [
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Chrome 130 on Android",
    ],
    [
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Chrome 130 on Android tablet",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      "Samsung Internet 26 on Android",
    ],
    [
      "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0",
      "Firefox 132 on Android",
    ],
    [
      "Mozilla/5.0 (Android 14; Tablet; rv:132.0) Gecko/132.0 Firefox/132.0",
      "Firefox 132 on Android tablet",
    ],
    [
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0",
      "Microsoft Edge 130 on Android",
    ],
    [
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 OPR/85.0.0.0",
      "Opera 85 on Android",
    ],
    [
      "Mozilla/5.0 (Linux; U; Android 10; en-US; RMX2020 Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 UCBrowser/13.4.0.1306 Mobile Safari/537.36",
      "UC Browser 13 on Android",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile DuckDuckGo/5 Safari/537.36",
      "DuckDuckGo 5 on Android",
    ],
  ])("%s is %s", (userAgent: string, expected: string) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });

  it("an app's own web view on an iPhone names the phone, not a browser", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      ),
    ).toBe("Unknown browser on iPhone");
  });

  it("an iPad asking for the desktop site reads as the Mac it says it is", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      ),
    ).toBe("Safari 18 on macOS");
  });

  it("the device model an Android browser sends is never repeated", () => {
    const description: string | undefined = describeUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    );

    expect(description).toBe("Chrome 130 on Android");
    expect(description).not.toContain("Pixel");
  });
});

describe("programs that are not web browsers", () => {
  test.each([
    ["curl/8.4.0", "curl"],
    ["Wget/1.21.4", "Wget"],
    ["PostmanRuntime/7.42.0", "Postman"],
    ["insomnia/10.1.1", "Insomnia"],
    ["HTTPie/3.2.4", "HTTPie"],
    [
      "Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.22631; en-US) PowerShell/7.4.6",
      "PowerShell",
    ],
    [
      "Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.22621.4391",
      "PowerShell",
    ],
    ["python-requests/2.32.3", "A Python script"],
    ["Python-urllib/3.12", "A Python script"],
    ["python-httpx/0.27.2", "A Python script"],
    ["Python/3.12 aiohttp/3.10.10", "A Python script"],
    ["Go-http-client/2.0", "A Go program"],
    ["axios/1.7.7", "A Node.js script"],
    [
      "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
      "A Node.js script",
    ],
    ["node", "A Node.js script"],
    ["undici", "A Node.js script"],
    ["Java/21.0.1", "A Java program"],
    ["Apache-HttpClient/4.5.14 (Java/17.0.9)", "A Java program"],
    ["okhttp/4.12.0", "An app on Android"],
    [
      "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A.240905.003)",
      "An app on Android",
    ],
    [
      "OneUptime/45 CFNetwork/1568.100.1 Darwin/24.0.0",
      "An app on an Apple device",
    ],
  ])("%s is %s", (userAgent: string, expected: string) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });

  it("an app's own name for itself is never repeated", () => {
    expect(
      describeUserAgent(
        "Call Support Now/1 CFNetwork/1568.100.1 Darwin/24.0.0",
      ),
    ).toBe("An app on an Apple device");
  });

  it("an app's built-in Safari is the app, not Safari", () => {
    expect(
      describeUserAgent(
        "MobileSafari/604.1 CFNetwork/1568.100.1 Darwin/24.0.0",
      ),
    ).toBe("An app on an Apple device");
  });
});

describe("client hints", () => {
  const BRAVE_HINTS: UserAgentClientHints = {
    brands: '"Chromium";v="130", "Brave";v="130", "Not?A_Brand";v="99"',
    mobile: "?0",
    platform: '"macOS"',
  };

  it("Brave says it is Chrome in its User-Agent, and Brave in Sec-CH-UA", () => {
    expect(describeUserAgent(CHROME_MAC, BRAVE_HINTS)).toBe(
      "Brave 130 on macOS",
    );
  });

  it("Chrome's own hints keep it Chrome", () => {
    expect(
      describeUserAgent(CHROME_MAC, {
        brands:
          '"Google Chrome";v="130", "Chromium";v="130", "Not?A_Brand";v="99"',
      }),
    ).toBe("Chrome 130 on macOS");
  });

  it("a browser that names itself in its User-Agent keeps that name", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/115.0.0.0",
        { brands: '"Brave";v="130"' },
      ),
    ).toBe("Opera 115 on Windows");
  });

  it("a brand nobody makes is not repeated", () => {
    expect(
      describeUserAgent(CHROME_MAC, {
        brands: '"Your account is locked";v="1", "Chromium";v="130"',
      }),
    ).toBe("Chromium 130 on macOS");
  });

  it("a version that is not digits is not a version", () => {
    expect(
      describeUserAgent(CHROME_MAC, { brands: '"Brave";v="1234567"' }),
    ).toBe("Brave 130 on macOS");
  });

  it("the platform hint names an operating system the User-Agent leaves out", () => {
    expect(
      describeUserAgent("Chrome/130.0.0.0", {
        platform: '"Windows"',
        mobile: "?0",
      }),
    ).toBe("Chrome 130 on Windows");
  });

  it("an Android platform hint with ?1 is a phone, with ?0 a tablet", () => {
    expect(
      describeUserAgent("Chrome/130.0.0.0", {
        platform: '"Android"',
        mobile: "?1",
      }),
    ).toBe("Chrome 130 on Android");
    expect(
      describeUserAgent("Chrome/130.0.0.0", {
        platform: '"Android"',
        mobile: "?0",
      }),
    ).toBe("Chrome 130 on Android tablet");
  });

  it("a platform hint does not overrule the User-Agent's own", () => {
    expect(
      describeUserAgent(CHROME_MAC, { platform: '"Windows"', mobile: "?1" }),
    ).toBe("Chrome 130 on macOS");
  });

  it("an unknown platform hint names nothing", () => {
    expect(
      describeUserAgent("Chrome/130.0.0.0", { platform: '"Nowhere OS"' }),
    ).toBe("Chrome 130");
  });
});

describe("headers it cannot place describe nothing", () => {
  test.each([
    [undefined],
    [""],
    ["   "],
    [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    ],
    ["Your account is locked. Call +1 800 555 0100 now."],
    ["<a href='https://evil.example'>Verify your account</a>"],
  ])("%s", (userAgent: string | undefined) => {
    expect(describeUserAgent(userAgent)).toBeUndefined();
  });

  it("markup around a browser's token leaves only the browser's name", () => {
    const description: string | undefined = describeUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) <img src=x onerror=alert(1)> Chrome/130.0 Visit evil.example",
    );

    expect(description).toBe("Chrome 130 on Linux");
  });

  it("a version too long to be one is left out", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/1234567.0 Safari/537.36",
      ),
    ).toBe("Chrome on Windows");
  });

  it("a token inside a longer word is not that token", () => {
    expect(
      describeUserAgent("Mozilla/5.0 (X11; Linux x86_64) NotChrome/130.0"),
    ).toBe("Unknown browser on Linux");
  });

  it("reads only the start of a long header, and quickly", () => {
    const longTail: string = "A".repeat(2 * 1024 * 1024);
    const startedAt: number = Date.now();

    expect(describeUserAgent(CHROME_MAC + longTail)).toBe(
      "Chrome 130 on macOS",
    );
    // A token past the part that is read is not read.
    expect(
      describeUserAgent("A".repeat(MAX_USER_AGENT_LENGTH) + " curl/8.4.0"),
    ).toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe("a request's headers", () => {
  it("reads the User-Agent and the client hints", () => {
    expect(
      UserAgentDevice.describeRequest({
        "user-agent": CHROME_MAC,
        "sec-ch-ua": '"Chromium";v="130", "Brave";v="130"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
      }),
    ).toBe("Brave 130 on macOS");
  });

  it("reads the first of a header sent twice", () => {
    expect(
      UserAgentDevice.describeRequest({
        "user-agent": ["curl/8.4.0", CHROME_MAC],
      }),
    ).toBe("curl");
  });

  it("no headers, or no User-Agent, describe nothing", () => {
    expect(UserAgentDevice.describeRequest(undefined)).toBeUndefined();
    expect(UserAgentDevice.describeRequest({})).toBeUndefined();
  });
});

/*
 * Whatever a caller writes, the description is made of this file's words:
 * a browser's name and digits, or a program's name, and where it runs.
 */
const BROWSER_NAMES: Array<string> = [
  "Microsoft Edge",
  "Opera Mini",
  "Opera",
  "Samsung Internet",
  "Yandex Browser",
  "UC Browser",
  "Vivaldi",
  "DuckDuckGo",
  "Firefox",
  "Headless Chrome",
  "Chromium",
  "Chrome",
  "Brave",
  "Safari",
  "Internet Explorer",
  "Unknown browser",
];

const PROGRAM_NAMES: Array<string> = [
  "curl",
  "Wget",
  "Postman",
  "Insomnia",
  "HTTPie",
  "PowerShell",
  "A Python script",
  "A Go program",
  "A Node.js script",
  "A Java program",
  "An app on Android",
  "An app on an Apple device",
];

const PLACES: Array<string> = [
  "iPhone",
  "iPad",
  "Android",
  "Android tablet",
  "macOS",
  "Windows",
  "Linux",
  "ChromeOS",
];

const isOwnVocabulary: (description: string) => boolean = (
  description: string,
): boolean => {
  if (PROGRAM_NAMES.includes(description)) {
    return true;
  }

  for (const browser of BROWSER_NAMES) {
    if (!description.startsWith(browser)) {
      continue;
    }

    let rest: string = description.slice(browser.length);
    const version: RegExpMatchArray | null = rest.match(/^ \d{1,5}/);

    if (version) {
      rest = rest.slice(version[0].length);
    }

    if (rest === "") {
      return true;
    }

    if (rest.startsWith(" on ") && PLACES.includes(rest.slice(" on ".length))) {
      return true;
    }
  }

  return false;
};

describe("only its own words ever come out", () => {
  const PIECES: ReadonlyArray<string> = [
    "Mozilla/5.0 ",
    "(Macintosh; Intel Mac OS X 10_15_7) ",
    "(Windows NT 10.0; Win64; x64) ",
    "(iPhone; CPU iPhone OS 18_1 like Mac OS X) ",
    "(Linux; Android 14; Pixel 8) ",
    "Mobile ",
    "Chrome/130.0.0.0 ",
    "Safari/537.36 ",
    "Version/18.1 ",
    "Firefox/132.0 ",
    "Edg/130.0 ",
    "OPR/115 ",
    "SamsungBrowser/26.0 ",
    "curl/8.4.0 ",
    "CFNetwork/1568 ",
    "Trident/7.0; rv:11.0 ",
    "MSIE 10.0 ",
    "<script>alert(1)</script>",
    "Call +1 800 555 0100 ",
    "https://evil.example/verify ",
    "Brave/1 ",
    "Chrome/99999999 ",
    "/",
    " ",
    ";",
    "(",
    ")",
    "1",
  ];

  const HINTS: ReadonlyArray<string> = [
    '"Brave";v="130"',
    '"Google Chrome";v="130"',
    '"Evil";v="1"',
    '"Microsoft Edge";v="x"',
    ", ",
    '"',
    'v="',
  ];

  test("on 5,000 generated headers", () => {
    const userAgents: Array<string> = generatedTexts(5000, 5599, PIECES);
    const brands: Array<string> = generatedTexts(5000, 9955, HINTS, 6);

    userAgents.forEach((userAgent: string, index: number) => {
      const description: string | undefined = describeUserAgent(userAgent, {
        brands: brands[index],
        platform: index % 2 === 0 ? '"Linux"' : '"<b>"',
        mobile: index % 3 === 0 ? "?1" : "?0",
      });

      if (description !== undefined && !isOwnVocabulary(description)) {
        throw new Error(
          `"${userAgent}" was described as "${description}", which is not made of UserAgentDevice's own words`,
        );
      }
    });
  });
});
