/*
 * THE DEVICE AND BROWSER A REQUEST CAME FROM, IN WORDS ITS OWNER KNOWS.
 *
 * A security email - a password reset, a changed password, wrong two factor
 * codes - tells the account's owner which device asked: "Chrome 130 on
 * macOS", "Safari 18 on iPhone". It is read off the request's User-Agent
 * header, and off the client hints Chromium browsers send with every request
 * (Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform), which name the brands a
 * User-Agent leaves out: Brave says it is Chrome there, and Brave here.
 *
 * NOTHING THE HEADERS SAY IS REPEATED. Whoever makes the request writes the
 * headers, and the request may not be the owner's: anybody who knows an
 * address can ask for that account's password reset, and the email goes to
 * the owner. A User-Agent of "Your account is locked. Call +1 ..." would land,
 * word for word, in an email the owner trusts. So a description is built
 * only of words this file spells out - a browser's name, a version made of
 * digits, an operating system, a kind of device, a kind of program - and
 * headers it cannot place describe nothing: the email says "Unknown device".
 *
 * Written here rather than taken from a library: the libraries that know
 * every User-Agent ever sent are large, some have had regular expressions
 * that ran for seconds on a crafted header, and they hand back the header's
 * own words for a device model or a browser they do not know. This reads the
 * first MAX_USER_AGENT_LENGTH characters with indexOf, in time linear in
 * them, and knows the browsers and programs people sign in with.
 *
 * What a User-Agent no longer says, this does not claim. Windows 11 sends
 * Windows 10's token, every Mac says it runs macOS 10.15, Chrome on Android
 * says Android 10 whatever it runs, and Safari on an iPad asks for the
 * desktop site as a Mac. So operating systems are named without a version,
 * and an iPad's Safari is described as Safari on macOS.
 */

export enum DeviceKind {
  Desktop = "Desktop",
  Phone = "Phone",
  Tablet = "Tablet",
}

export enum OperatingSystem {
  Windows = "Windows",
  MacOS = "macOS",
  IOS = "iOS",
  IPadOS = "iPadOS",
  Android = "Android",
  ChromeOS = "ChromeOS",
  Linux = "Linux",
}

export interface DeviceDetails {
  // A web browser, by its maker's name for it: "Chrome", "Samsung Internet".
  browser?: string | undefined;
  // The browser's major version, digits only: "130".
  browserVersion?: string | undefined;
  operatingSystem?: OperatingSystem | undefined;
  deviceKind?: DeviceKind | undefined;
  // A program that is not a web browser: "curl", "A Python script".
  program?: string | undefined;
}

// The low-entropy client hints a Chromium browser sends with every request.
export interface UserAgentClientHints {
  // Sec-CH-UA: "Chromium";v="130", "Brave";v="130", "Not?A_Brand";v="99"
  brands?: string | undefined;
  // Sec-CH-UA-Mobile: ?1 on a phone, ?0 anywhere else.
  mobile?: string | undefined;
  // Sec-CH-UA-Platform: "macOS"
  platform?: string | undefined;
}

export type UserAgentRequestHeaders = Record<
  string,
  string | Array<string> | undefined
>;

/*
 * Only the start of a header is read. A real User-Agent is one to three
 * hundred characters; whatever a longer one says after this is not read.
 */
export const MAX_USER_AGENT_LENGTH: number = 512;

// A major version longer than this is not a version: "Chrome/1234567".
const MAX_VERSION_DIGITS: number = 5;

interface NamedTokens {
  // The words a description uses for it.
  name: string;
  /*
   * Any one of these, as a word of its own in the header, names it. For a
   * browser, the digits after the token are its version.
   */
  tokens: Array<string>;
}

/*
 * Programs that are not web browsers, tried before the browsers. None of
 * these tokens appears in a browser's User-Agent.
 *
 * A program's own name is used for the tools people know by name. The rest
 * are described by what they are - "A Python script" - and an app's own HTTP
 * client by the platform it runs on: an app on a phone sends the name the
 * app gives itself, which is its developer's writing and is never repeated.
 */
const PROGRAMS: Array<NamedTokens> = [
  { name: "curl", tokens: ["curl/"] },
  { name: "Wget", tokens: ["Wget/"] },
  { name: "Postman", tokens: ["PostmanRuntime/"] },
  { name: "Insomnia", tokens: ["insomnia/"] },
  { name: "HTTPie", tokens: ["HTTPie/"] },
  { name: "PowerShell", tokens: ["PowerShell/", "WindowsPowerShell/"] },
  {
    name: "A Python script",
    tokens: [
      "python-requests/",
      "python-urllib3/",
      "Python-urllib/",
      "python-httpx/",
      "aiohttp/",
    ],
  },
  { name: "A Go program", tokens: ["Go-http-client/"] },
  { name: "A Node.js script", tokens: ["node-fetch/", "axios/", "undici/"] },
  { name: "A Java program", tokens: ["Java/", "Apache-HttpClient/"] },
  { name: "An app on Android", tokens: ["okhttp/", "Dalvik/"] },
  { name: "An app on an Apple device", tokens: ["CFNetwork/"] },
];

/*
 * Node's own fetch sends nothing but a word: the whole header is one of
 * these, lowercased.
 */
const NODE_FETCH_USER_AGENTS: Array<string> = ["node", "undici"];

/*
 * Web browsers, in the order they are tried: the first that matches wins.
 * Every browser built on Chromium also says "Chrome/" and "Safari/", and
 * every browser on an iPhone says "Safari/", so a browser comes before the
 * browser whose engine it is built on, and Safari - read separately below -
 * comes after all of them.
 */
const BROWSERS: Array<NamedTokens> = [
  { name: "Microsoft Edge", tokens: ["Edg/", "EdgA/", "EdgiOS/", "Edge/"] },
  { name: "Opera Mini", tokens: ["Opera Mini/"] },
  { name: "Opera", tokens: ["OPR/", "OPT/", "OPiOS/"] },
  { name: "Samsung Internet", tokens: ["SamsungBrowser/"] },
  { name: "Yandex Browser", tokens: ["YaBrowser/"] },
  { name: "UC Browser", tokens: ["UCBrowser/"] },
  { name: "Vivaldi", tokens: ["Vivaldi/"] },
  { name: "DuckDuckGo", tokens: ["DuckDuckGo/", "Ddg/"] },
  { name: "Firefox", tokens: ["Firefox/", "FxiOS/"] },
  { name: "Headless Chrome", tokens: ["HeadlessChrome/"] },
  { name: "Chromium", tokens: ["Chromium/"] },
  { name: "Chrome", tokens: ["Chrome/", "CriOS/"] },
];

/*
 * The brands a Chromium browser names in Sec-CH-UA, most particular first:
 * Brave lists "Chromium" and "Brave", Chrome lists "Chromium" and "Google
 * Chrome". Read only when the User-Agent says no more than Chrome or
 * Chromium - a browser that says its own name there keeps it.
 */
const CLIENT_HINT_BRANDS: Array<NamedTokens> = [
  { name: "Brave", tokens: ["Brave"] },
  { name: "Microsoft Edge", tokens: ["Microsoft Edge"] },
  { name: "Opera", tokens: ["Opera", "Opera GX"] },
  { name: "Samsung Internet", tokens: ["Samsung Internet"] },
  { name: "Yandex Browser", tokens: ["YaBrowser", "Yandex"] },
  { name: "Vivaldi", tokens: ["Vivaldi"] },
  { name: "DuckDuckGo", tokens: ["DuckDuckGo"] },
  { name: "Chrome", tokens: ["Google Chrome"] },
  { name: "Headless Chrome", tokens: ["HeadlessChrome"] },
  { name: "Chromium", tokens: ["Chromium"] },
];

interface PlatformHint {
  // Sec-CH-UA-Platform's value, lowercased and without its quotes.
  platform: string;
  operatingSystem: OperatingSystem;
  deviceKind?: DeviceKind | undefined;
}

const PLATFORM_HINTS: Array<PlatformHint> = [
  {
    platform: "windows",
    operatingSystem: OperatingSystem.Windows,
    deviceKind: DeviceKind.Desktop,
  },
  {
    platform: "macos",
    operatingSystem: OperatingSystem.MacOS,
    deviceKind: DeviceKind.Desktop,
  },
  {
    platform: "linux",
    operatingSystem: OperatingSystem.Linux,
    deviceKind: DeviceKind.Desktop,
  },
  {
    platform: "chrome os",
    operatingSystem: OperatingSystem.ChromeOS,
    deviceKind: DeviceKind.Desktop,
  },
  {
    platform: "chromeos",
    operatingSystem: OperatingSystem.ChromeOS,
    deviceKind: DeviceKind.Desktop,
  },
  {
    platform: "chromium os",
    operatingSystem: OperatingSystem.ChromeOS,
    deviceKind: DeviceKind.Desktop,
  },
  { platform: "android", operatingSystem: OperatingSystem.Android },
  { platform: "ios", operatingSystem: OperatingSystem.IOS },
];

interface ClientHintBrand {
  brand: string;
  version?: string | undefined;
}

type CharacterTestFunction = (code: number) => boolean;

const isDigit: CharacterTestFunction = (code: number): boolean => {
  return code >= 48 && code <= 57;
};

// A letter or digit of the ASCII a User-Agent is written in.
const isWordCharacter: CharacterTestFunction = (code: number): boolean => {
  return (
    isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
  );
};

/*
 * Where `token` starts in `text` as a word of its own - "Chrome/" in
 * "Chrome/130", but not in "HeadlessChrome/130" - or -1.
 */
type FindTokenFunction = (text: string, token: string) => number;

const findToken: FindTokenFunction = (text: string, token: string): number => {
  let index: number = text.indexOf(token);

  while (index !== -1) {
    if (index === 0 || !isWordCharacter(text.charCodeAt(index - 1))) {
      return index;
    }

    index = text.indexOf(token, index + 1);
  }

  return -1;
};

type HasTokenFunction = (text: string, token: string) => boolean;

const hasToken: HasTokenFunction = (text: string, token: string): boolean => {
  return findToken(text, token) !== -1;
};

/*
 * The digits that start at `start` - "130" of "130.0.0.0" - as a number
 * writes them, or undefined when there are none or too many to be a version.
 */
type ReadVersionFunction = (text: string, start: number) => string | undefined;

const readVersionAt: ReadVersionFunction = (
  text: string,
  start: number,
): string | undefined => {
  let end: number = start;

  while (
    end < text.length &&
    end - start <= MAX_VERSION_DIGITS &&
    isDigit(text.charCodeAt(end))
  ) {
    end++;
  }

  const length: number = end - start;

  if (length === 0 || length > MAX_VERSION_DIGITS) {
    return undefined;
  }

  return String(parseInt(text.slice(start, end), 10));
};

/*
 * The version written right after the first of `tokens` that is in `text`:
 * found tells whether one was, version whether digits followed it.
 */
type ReadTokenVersionFunction = (
  text: string,
  tokens: Array<string>,
) => { found: boolean; version?: string | undefined };

const readTokenVersion: ReadTokenVersionFunction = (
  text: string,
  tokens: Array<string>,
): { found: boolean; version?: string | undefined } => {
  for (const token of tokens) {
    const index: number = findToken(text, token);

    if (index !== -1) {
      return {
        found: true,
        version: readVersionAt(text, index + token.length),
      };
    }
  }

  return { found: false };
};

// A header's value as one string: the first of a header sent more than once.
type FirstHeaderValueFunction = (
  value: string | Array<string> | undefined,
) => string | undefined;

const firstHeaderValue: FirstHeaderValueFunction = (
  value: string | Array<string> | undefined,
): string | undefined => {
  const first: string | undefined = Array.isArray(value) ? value[0] : value;

  if (typeof first !== "string") {
    return undefined;
  }

  return first.slice(0, MAX_USER_AGENT_LENGTH);
};

/*
 * Sec-CH-UA's brands and their major versions. Its grammar is a list of
 * quoted strings with a v parameter; anything that does not read as one is
 * skipped, and nothing it says is used unless CLIENT_HINT_BRANDS names it.
 */
type ReadClientHintBrandsFunction = (
  header: string | undefined,
) => Array<ClientHintBrand>;

const readClientHintBrands: ReadClientHintBrandsFunction = (
  header: string | undefined,
): Array<ClientHintBrand> => {
  const brands: Array<ClientHintBrand> = [];

  if (!header) {
    return brands;
  }

  for (const entry of header.slice(0, MAX_USER_AGENT_LENGTH).split(",")) {
    const open: number = entry.indexOf('"');
    const close: number = open === -1 ? -1 : entry.indexOf('"', open + 1);

    if (close === -1) {
      continue;
    }

    const versionStart: number = entry.indexOf('v="', close);

    brands.push({
      brand: entry.slice(open + 1, close).trim(),
      version:
        versionStart === -1
          ? undefined
          : readVersionAt(entry, versionStart + 'v="'.length),
    });
  }

  return brands;
};

export default class UserAgentDevice {
  /*
   * What the headers say about the device, as far as this file knows the
   * words they use. Every field is absent that they do not say.
   */
  public static read(data: {
    userAgent?: string | undefined;
    clientHints?: UserAgentClientHints | undefined;
  }): DeviceDetails {
    const userAgent: string = (data.userAgent || "")
      .slice(0, MAX_USER_AGENT_LENGTH)
      .trim();

    const device: DeviceDetails = {};

    const program: string | undefined = UserAgentDevice.readProgram(userAgent);

    if (program) {
      device.program = program;
      return device;
    }

    UserAgentDevice.readBrowser(userAgent, device);
    UserAgentDevice.readOperatingSystem(userAgent, device);
    UserAgentDevice.readClientHints(data.clientHints, device);

    return device;
  }

  /*
   * The device in a few words: "Chrome 130 on macOS", "Safari 18 on
   * iPhone", "curl" - or undefined when nothing about it is known.
   */
  public static describe(device: DeviceDetails): string | undefined {
    if (device.program) {
      return device.program;
    }

    const place: string | undefined = UserAgentDevice.describePlace(device);

    if (device.browser) {
      const browser: string = device.browserVersion
        ? `${device.browser} ${device.browserVersion}`
        : device.browser;

      return place ? `${browser} on ${place}` : browser;
    }

    return place ? `Unknown browser on ${place}` : undefined;
  }

  // describe() of what a request's headers say.
  public static describeRequest(
    headers: UserAgentRequestHeaders | undefined,
  ): string | undefined {
    if (!headers) {
      return undefined;
    }

    return UserAgentDevice.describe(
      UserAgentDevice.read({
        userAgent: firstHeaderValue(headers["user-agent"]),
        clientHints: {
          brands: firstHeaderValue(headers["sec-ch-ua"]),
          mobile: firstHeaderValue(headers["sec-ch-ua-mobile"]),
          platform: firstHeaderValue(headers["sec-ch-ua-platform"]),
        },
      }),
    );
  }

  private static readProgram(userAgent: string): string | undefined {
    if (NODE_FETCH_USER_AGENTS.includes(userAgent.toLowerCase())) {
      return "A Node.js script";
    }

    for (const program of PROGRAMS) {
      for (const token of program.tokens) {
        if (hasToken(userAgent, token)) {
          return program.name;
        }
      }
    }

    return undefined;
  }

  private static readBrowser(userAgent: string, device: DeviceDetails): void {
    for (const browser of BROWSERS) {
      const match: { found: boolean; version?: string | undefined } =
        readTokenVersion(userAgent, browser.tokens);

      if (match.found) {
        device.browser = browser.name;
        device.browserVersion = match.version;
        return;
      }
    }

    // Safari's major version is in "Version/18.1", not in "Safari/605.1.15".
    if (hasToken(userAgent, "Safari/")) {
      const version: { found: boolean; version?: string | undefined } =
        readTokenVersion(userAgent, ["Version/"]);

      if (version.found) {
        device.browser = "Safari";
        device.browserVersion = version.version;
        return;
      }
    }

    // "MSIE 10.0" up to Internet Explorer 10, "Trident/7.0; rv:11.0" for 11.
    const msie: { found: boolean; version?: string | undefined } =
      readTokenVersion(userAgent, ["MSIE "]);

    if (msie.found) {
      device.browser = "Internet Explorer";
      device.browserVersion = msie.version;
      return;
    }

    if (hasToken(userAgent, "Trident/")) {
      device.browser = "Internet Explorer";
      device.browserVersion = readTokenVersion(userAgent, ["rv:"]).version;
    }
  }

  private static readOperatingSystem(
    userAgent: string,
    device: DeviceDetails,
  ): void {
    // Every iPhone's User-Agent says "like Mac OS X", so Apple's phones first.
    if (hasToken(userAgent, "iPad")) {
      device.operatingSystem = OperatingSystem.IPadOS;
      device.deviceKind = DeviceKind.Tablet;
      return;
    }

    if (hasToken(userAgent, "iPhone") || hasToken(userAgent, "iPod")) {
      device.operatingSystem = OperatingSystem.IOS;
      device.deviceKind = DeviceKind.Phone;
      return;
    }

    /*
     * A phone's browser says "Mobile"; a tablet's leaves it out (Chrome) or
     * says "Tablet" (Firefox). Android says "Linux" too, so it comes first.
     */
    if (hasToken(userAgent, "Android")) {
      device.operatingSystem = OperatingSystem.Android;
      device.deviceKind = hasToken(userAgent, "Mobile")
        ? DeviceKind.Phone
        : DeviceKind.Tablet;
      return;
    }

    if (hasToken(userAgent, "CrOS")) {
      device.operatingSystem = OperatingSystem.ChromeOS;
      device.deviceKind = DeviceKind.Desktop;
      return;
    }

    if (hasToken(userAgent, "Macintosh") || hasToken(userAgent, "Mac OS X")) {
      device.operatingSystem = OperatingSystem.MacOS;
      device.deviceKind = DeviceKind.Desktop;
      return;
    }

    if (hasToken(userAgent, "Windows")) {
      device.operatingSystem = OperatingSystem.Windows;
      device.deviceKind = DeviceKind.Desktop;
      return;
    }

    if (hasToken(userAgent, "Linux") || hasToken(userAgent, "X11")) {
      device.operatingSystem = OperatingSystem.Linux;
      device.deviceKind = DeviceKind.Desktop;
    }
  }

  private static readClientHints(
    clientHints: UserAgentClientHints | undefined,
    device: DeviceDetails,
  ): void {
    if (!clientHints) {
      return;
    }

    if (
      device.browser === undefined ||
      device.browser === "Chrome" ||
      device.browser === "Chromium"
    ) {
      const brands: Array<ClientHintBrand> = readClientHintBrands(
        clientHints.brands,
      );

      for (const known of CLIENT_HINT_BRANDS) {
        const brand: ClientHintBrand | undefined = brands.find(
          (candidate: ClientHintBrand): boolean => {
            return known.tokens.includes(candidate.brand);
          },
        );

        if (brand) {
          device.browser = known.name;
          device.browserVersion = brand.version || device.browserVersion;
          break;
        }
      }
    }

    const platform: string = (clientHints.platform || "")
      .replace(/"/g, "")
      .trim()
      .toLowerCase();

    const platformHint: PlatformHint | undefined = PLATFORM_HINTS.find(
      (hint: PlatformHint): boolean => {
        return hint.platform === platform;
      },
    );

    if (!device.operatingSystem && platformHint) {
      device.operatingSystem = platformHint.operatingSystem;
      device.deviceKind = platformHint.deviceKind;
    }

    const mobile: string = (clientHints.mobile || "").trim();

    if (!device.deviceKind && (mobile === "?1" || mobile === "?0")) {
      device.deviceKind =
        mobile === "?1"
          ? DeviceKind.Phone
          : device.operatingSystem === OperatingSystem.Android
            ? DeviceKind.Tablet
            : DeviceKind.Desktop;
    }
  }

  // Where the browser runs, as a person would say it: "iPhone", "macOS".
  private static describePlace(device: DeviceDetails): string | undefined {
    switch (device.operatingSystem) {
      case OperatingSystem.IOS:
        return "iPhone";
      case OperatingSystem.IPadOS:
        return "iPad";
      case OperatingSystem.Android:
        return device.deviceKind === DeviceKind.Tablet
          ? "Android tablet"
          : "Android";
      case undefined:
        return undefined;
      default:
        return device.operatingSystem;
    }
  }
}
