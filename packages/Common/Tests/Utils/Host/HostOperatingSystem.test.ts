import HostOperatingSystem, {
  ANDROID_HOST_OS_TYPE,
} from "../../../Utils/Host/HostOperatingSystem";
import IconProp from "../../../Types/Icon/IconProp";
import { describe, expect, test } from "@jest/globals";

describe("HostOperatingSystem (issue #9804)", () => {
  test("an Android device's OS type is android, whatever its os.type says", () => {
    expect(
      HostOperatingSystem.getOsType({ osType: "linux", osName: "Android" }),
    ).toBe(ANDROID_HOST_OS_TYPE);
    expect(
      HostOperatingSystem.getOsType({ osType: "linux", osName: "ANDROID" }),
    ).toBe("android");
    expect(HostOperatingSystem.getOsType({ osName: "Android" })).toBe(
      "android",
    );
  });

  test("any other machine keeps its os.type", () => {
    expect(
      HostOperatingSystem.getOsType({ osType: "linux", osName: "Ubuntu" }),
    ).toBe("linux");
    expect(HostOperatingSystem.getOsType({ osType: "windows" })).toBe(
      "windows",
    );
    expect(
      HostOperatingSystem.getOsType({ osType: "  ", osName: "" }),
    ).toBeUndefined();
    expect(HostOperatingSystem.getOsType({})).toBeUndefined();
  });

  test("the OS as people write it", () => {
    expect(HostOperatingSystem.getLabel("android")).toBe("Android");
    expect(HostOperatingSystem.getLabel("linux")).toBe("Linux");
    expect(HostOperatingSystem.getLabel("darwin")).toBe("macOS");
    expect(HostOperatingSystem.getLabel("windows")).toBe("Windows");
    expect(HostOperatingSystem.getLabel("plan9")).toBe("plan9");
    expect(HostOperatingSystem.getLabel(undefined)).toBeUndefined();
    expect(HostOperatingSystem.getLabel("")).toBeUndefined();
  });

  test("Android is drawn with its mark; other systems with none", () => {
    expect(HostOperatingSystem.getIcon("android")).toBe(IconProp.Android);
    expect(HostOperatingSystem.getIcon("Android")).toBe(IconProp.Android);
    expect(HostOperatingSystem.getIcon("linux")).toBeUndefined();
    expect(HostOperatingSystem.getIcon(null)).toBeUndefined();
    expect(HostOperatingSystem.isAndroid("android")).toBe(true);
    expect(HostOperatingSystem.isAndroid("linux")).toBe(false);
  });

  test("the OS and its version in one line, never naming the OS twice", () => {
    expect(
      HostOperatingSystem.describe({
        osType: "android",
        osVersion: "Android Version 14 (Build UP1A.231005.007 API level 34)",
      }),
    ).toBe("Android Version 14 (Build UP1A.231005.007 API level 34)");
    expect(
      HostOperatingSystem.describe({
        osType: "linux",
        osVersion: "Ubuntu 22.04",
      }),
    ).toBe("Linux Ubuntu 22.04");
    expect(HostOperatingSystem.describe({ osType: "windows" })).toBe("Windows");
    expect(HostOperatingSystem.describe({ osVersion: "14.4" })).toBe("14.4");
    expect(HostOperatingSystem.describe({})).toBeUndefined();
  });
});
