import IconProp from "../../Types/Icon/IconProp";

/*
 * OpenTelemetry's `os.type` values, as people write them, and `android`,
 * which is no os.type value but what a Host keeps for an Android device. A
 * value outside the list is shown as it came.
 */
const OPERATING_SYSTEM_NAMES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["windows", "Windows"],
  ["linux", "Linux"],
  ["darwin", "macOS"],
  ["android", "Android"],
  ["freebsd", "FreeBSD"],
  ["netbsd", "NetBSD"],
  ["openbsd", "OpenBSD"],
  ["dragonflybsd", "DragonFly BSD"],
  ["hpux", "HP-UX"],
  ["aix", "AIX"],
  ["solaris", "Solaris"],
  ["z_os", "z/OS"],
  ["zos", "z/OS"],
]);

/** `os.type` as people write it: "windows" is "Windows", "darwin" "macOS". */
export function getOperatingSystemName(
  osType: string | undefined,
): string | undefined {
  if (!osType) {
    return undefined;
  }

  return OPERATING_SYSTEM_NAMES.get(osType.toLowerCase()) || osType;
}

/*
 * A host's operating system, as the Host record keeps it (`osType`) and the
 * Hosts pages show and filter it (#9804).
 *
 * OpenTelemetry's `os.type` names the kernel, so an Android device sends
 * `linux`, as OpenTelemetry Android and the OneUptime Android agent do, and
 * says Android in `os.name`. A kiosk is not a Linux server, though: it runs no
 * collector OneUptime manages, has no systemd units, and whoever looks after
 * it looks for it among Android devices. So a Host keeps `android` as its OS
 * type when `os.name` says Android, and the Hosts list, its OS filter, a
 * host's Overview and a dashboard's host list show Android, with its mark.
 */
export const ANDROID_HOST_OS_TYPE: string = "android";

export default class HostOperatingSystem {
  /**
   * The OS type a Host keeps: `android` for an Android device, otherwise
   * `os.type` as it came. Undefined when the resource says neither.
   */
  public static getOsType(data: {
    osType?: string | null | undefined;
    osName?: string | null | undefined;
  }): string | undefined {
    const osName: string = (data.osName || "").trim().toLowerCase();

    if (osName === ANDROID_HOST_OS_TYPE) {
      return ANDROID_HOST_OS_TYPE;
    }

    const osType: string = (data.osType || "").trim();
    return osType ? osType : undefined;
  }

  public static isAndroid(osType: string | null | undefined): boolean {
    return (osType || "").trim().toLowerCase() === ANDROID_HOST_OS_TYPE;
  }

  /** The OS as people write it: "Android", "Linux", "macOS", "Windows". */
  public static getLabel(
    osType: string | null | undefined,
  ): string | undefined {
    const trimmed: string = (osType || "").trim();
    return trimmed ? getOperatingSystemName(trimmed) : undefined;
  }

  /** The mark drawn beside the OS's name, for the systems that have one. */
  public static getIcon(
    osType: string | null | undefined,
  ): IconProp | undefined {
    return HostOperatingSystem.isAndroid(osType) ? IconProp.Android : undefined;
  }

  /**
   * The OS and its version in one line: "Ubuntu 22.04" under "Linux"
   * becomes "Linux Ubuntu 22.04", while a version that already names the
   * OS ("Android Version 14 (Build UP1A.231005.007 API level 34)") is shown
   * as it is, rather than "Android Android Version 14 ...".
   */
  public static describe(data: {
    osType?: string | null | undefined;
    osVersion?: string | null | undefined;
  }): string | undefined {
    const label: string | undefined = HostOperatingSystem.getLabel(data.osType);
    const version: string = (data.osVersion || "").trim();

    if (!label) {
      return version || undefined;
    }

    if (!version) {
      return label;
    }

    if (version.toLowerCase().startsWith(label.toLowerCase())) {
      return version;
    }

    return `${label} ${version}`;
  }
}
