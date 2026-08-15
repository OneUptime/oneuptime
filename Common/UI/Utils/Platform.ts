export enum PlatformType {
  Mac = "Mac",
  Windows = "Windows",
  Linux = "Linux",
  IOS = "iOS",
  Android = "Android",
  ChromeOS = "ChromeOS",
  Unknown = "Unknown",
}

interface UserAgentDataLike {
  platform?: string;
}

/**
 * Detects the machine the browser is running on so the UI can speak the
 * platform's own language — ⌘ on a Mac, Ctrl on Windows and Linux.
 *
 * Detection is deliberately not cached: it is a handful of string comparisons,
 * and keeping it pure means callers (and tests) always read the current
 * navigator rather than whatever it looked like when the module first loaded.
 */
export default class PlatformUtil {
  public static getPlatform(): PlatformType {
    if (typeof navigator === "undefined") {
      return PlatformType.Unknown;
    }

    /*
     * navigator.platform is deprecated, so the User-Agent Client Hints value
     * wins outright where the browser exposes it — it is the only source that
     * names the OS directly.
     */
    const userAgentData: UserAgentDataLike | undefined = (
      navigator as Navigator & { userAgentData?: UserAgentDataLike }
    ).userAgentData;

    const fromClientHints: PlatformType = this.classify(
      userAgentData?.platform || "",
    );

    if (fromClientHints !== PlatformType.Unknown) {
      return fromClientHints;
    }

    /*
     * The two legacy surfaces are classified together: they describe the same
     * machine, and each fills the other's gaps — an Android phone reports
     * platform "Linux armv8l" and only the user agent says "Android".
     */
    return this.classify(
      `${navigator.platform || ""} ${navigator.userAgent || ""}`,
    );
  }

  private static classify(source: string): PlatformType {
    const hint: string = (source || "").toLowerCase().trim();

    if (!hint) {
      return PlatformType.Unknown;
    }

    if (
      hint.includes("iphone") ||
      hint.includes("ipad") ||
      hint.includes("ipod") ||
      hint.includes("ios")
    ) {
      return PlatformType.IOS;
    }

    // Android must be checked before Linux: Android user agents contain both.
    if (hint.includes("android")) {
      return PlatformType.Android;
    }

    // Likewise ChromeOS, whose user agent is "X11; CrOS …".
    if (hint.includes("cros") || hint.includes("chrome os")) {
      return PlatformType.ChromeOS;
    }

    if (hint.includes("mac")) {
      /*
       * iPadOS 13+ reports itself as "MacIntel" — a real Mac reports at most
       * one touch point, an iPad reports five.
       */
      if (
        typeof navigator !== "undefined" &&
        (navigator.maxTouchPoints || 0) > 1
      ) {
        return PlatformType.IOS;
      }
      return PlatformType.Mac;
    }

    if (hint.includes("win")) {
      return PlatformType.Windows;
    }

    if (hint.includes("linux") || hint.includes("x11")) {
      return PlatformType.Linux;
    }

    return PlatformType.Unknown;
  }

  public static isMac(): boolean {
    return this.getPlatform() === PlatformType.Mac;
  }

  public static isWindows(): boolean {
    return this.getPlatform() === PlatformType.Windows;
  }

  public static isLinux(): boolean {
    return this.getPlatform() === PlatformType.Linux;
  }

  /**
   * True for every device that uses ⌘ as the primary shortcut modifier — Macs,
   * iPhones and iPads with a hardware keyboard attached.
   */
  public static isApplePlatform(): boolean {
    const platform: PlatformType = this.getPlatform();
    return platform === PlatformType.Mac || platform === PlatformType.IOS;
  }

  /**
   * Human readable name, e.g. for support bundles and diagnostics.
   */
  public static getPlatformName(): string {
    switch (this.getPlatform()) {
      case PlatformType.Mac:
        return "macOS";
      case PlatformType.Windows:
        return "Windows";
      case PlatformType.Linux:
        return "Linux";
      case PlatformType.IOS:
        return "iOS";
      case PlatformType.Android:
        return "Android";
      case PlatformType.ChromeOS:
        return "ChromeOS";
      default:
        return "Unknown";
    }
  }
}
