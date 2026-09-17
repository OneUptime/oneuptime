import PlatformUtil, { PlatformType } from "../../../UI/Utils/Platform";

interface NavigatorOverrides {
  platform?: string;
  userAgent?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform: string };
}

describe("PlatformUtil", () => {
  const originalDescriptors: Record<string, PropertyDescriptor | undefined> = {
    platform: Object.getOwnPropertyDescriptor(
      window.navigator,
      "platform",
    ) as PropertyDescriptor,
    userAgent: Object.getOwnPropertyDescriptor(
      window.navigator,
      "userAgent",
    ) as PropertyDescriptor,
    maxTouchPoints: Object.getOwnPropertyDescriptor(
      window.navigator,
      "maxTouchPoints",
    ) as PropertyDescriptor,
  };

  type MockNavigatorFunction = (overrides: NavigatorOverrides) => void;

  const mockNavigator: MockNavigatorFunction = (
    overrides: NavigatorOverrides,
  ): void => {
    Object.defineProperty(window.navigator, "platform", {
      value: overrides.platform ?? "",
      configurable: true,
    });
    Object.defineProperty(window.navigator, "userAgent", {
      value: overrides.userAgent ?? "",
      configurable: true,
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      value: overrides.maxTouchPoints ?? 0,
      configurable: true,
    });
    Object.defineProperty(window.navigator, "userAgentData", {
      value: overrides.userAgentData,
      configurable: true,
    });
  };

  afterEach(() => {
    for (const key of Object.keys(originalDescriptors)) {
      const descriptor: PropertyDescriptor | undefined =
        originalDescriptors[key];
      if (descriptor) {
        Object.defineProperty(window.navigator, key, descriptor);
      }
    }
    Object.defineProperty(window.navigator, "userAgentData", {
      value: undefined,
      configurable: true,
    });
  });

  it("detects macOS from navigator.platform", () => {
    mockNavigator({ platform: "MacIntel" });

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.Mac);
    expect(PlatformUtil.isMac()).toBe(true);
    expect(PlatformUtil.isApplePlatform()).toBe(true);
    expect(PlatformUtil.getPlatformName()).toBe("macOS");
  });

  it("prefers user agent client hints when available", () => {
    mockNavigator({
      userAgentData: { platform: "Windows" },
      platform: "MacIntel",
    });

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.Windows);
  });

  it("detects Windows", () => {
    mockNavigator({
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.Windows);
    expect(PlatformUtil.isWindows()).toBe(true);
    expect(PlatformUtil.isApplePlatform()).toBe(false);
  });

  it("detects Linux", () => {
    mockNavigator({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.Linux);
    expect(PlatformUtil.isLinux()).toBe(true);
  });

  it("detects iPhone as an Apple platform", () => {
    mockNavigator({
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      maxTouchPoints: 5,
    });

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.IOS);
    expect(PlatformUtil.isApplePlatform()).toBe(true);
    expect(PlatformUtil.isMac()).toBe(false);
  });

  it("treats an iPad reporting MacIntel as iOS, not macOS", () => {
    // iPadOS 13+ reports MacIntel; the touch points give it away.
    mockNavigator({ platform: "MacIntel", maxTouchPoints: 5 });

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.IOS);
    expect(PlatformUtil.isApplePlatform()).toBe(true);
  });

  it("detects Android before Linux even though the UA mentions both", () => {
    mockNavigator({
      platform: "Linux armv8l",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
    });

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.Android);
  });

  it("detects ChromeOS", () => {
    mockNavigator({
      platform: "Linux x86_64",
      userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)",
    });

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.ChromeOS);
  });

  it("falls back to unknown when nothing identifies the machine", () => {
    mockNavigator({});

    expect(PlatformUtil.getPlatform()).toBe(PlatformType.Unknown);
    expect(PlatformUtil.isApplePlatform()).toBe(false);
    expect(PlatformUtil.getPlatformName()).toBe("Unknown");
  });
});
