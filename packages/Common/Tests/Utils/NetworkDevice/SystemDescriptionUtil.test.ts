import {
  MAX_SYSTEM_DESCRIPTION_LENGTH,
  SystemDescriptionFacts,
  parseSystemDescription,
  readSystemDescription,
} from "../../../Utils/NetworkDevice/SystemDescriptionUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #4569 - a Cisco Meraki MX85's inventory record read
 * "os.description = Meraki MX85" and nothing under make or model, because a
 * Meraki implements no ENTITY-MIB and the mirror only ever read ENTITY-MIB.
 * Its sysDescr names the model, and the sysDescr of most network operating
 * systems names the OS and its release. These pin what is read from each
 * platform's description, using descriptions the devices really send, and
 * that anything else yields nothing rather than a guess.
 */

type Case = [string, string, SystemDescriptionFacts];

const PLATFORMS: Array<Case> = [
  [
    "a Meraki MX appliance (the issue's device)",
    "Meraki MX85",
    { manufacturer: "Cisco Meraki", model: "MX85" },
  ],
  [
    "a Meraki MS switch",
    "Meraki MS220-8P Cloud Managed Switch",
    { manufacturer: "Cisco Meraki", model: "MS220-8P" },
  ],
  [
    "a Meraki MR access point",
    "Meraki MR42 Cloud Managed AP",
    { manufacturer: "Cisco Meraki", model: "MR42" },
  ],
  [
    "a Meraki Z teleworker gateway",
    "Meraki Z3 Cloud Managed Teleworker Gateway",
    { manufacturer: "Cisco Meraki", model: "Z3" },
  ],
  [
    "classic Cisco IOS",
    "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11, RELEASE SOFTWARE (fc3)\r\nTechnical Support: http://www.cisco.com/techsupport\r\nCopyright (c) 1986-2017 by Cisco Systems, Inc.\r\nCompiled Sat 19-Aug-17 09:34 by prod_rel_team",
    {
      manufacturer: "Cisco",
      operatingSystem: "Cisco IOS",
      osVersion: "15.0(2)SE11",
    },
  ],
  [
    "Cisco IOS in its old wording",
    "Cisco Internetwork Operating System Software \r\nIOS (tm) C2950 Software (C2950-I6Q4L2-M), Version 12.1(22)EA14, RELEASE SOFTWARE (fc1)",
    {
      manufacturer: "Cisco",
      operatingSystem: "Cisco IOS",
      osVersion: "12.1(22)EA14",
    },
  ],
  [
    "Cisco IOS XE naming its release train",
    "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)",
    {
      manufacturer: "Cisco",
      operatingSystem: "Cisco IOS XE",
      osVersion: "16.12.4",
    },
  ],
  [
    "Cisco IOS XE saying so",
    "Cisco IOS Software, IOS-XE Software, Catalyst 4500 L3 Switch Software (cat4500e-UNIVERSALK9-M), Version 03.06.06.E RELEASE SOFTWARE (fc1)",
    {
      manufacturer: "Cisco",
      operatingSystem: "Cisco IOS XE",
      osVersion: "03.06.06.E",
    },
  ],
  [
    "Cisco IOS XR",
    "Cisco IOS XR Software (Cisco ASR9K Series),  Version 6.1.4[Default]\nCopyright (c) 2017 by Cisco Systems, Inc.",
    {
      manufacturer: "Cisco",
      operatingSystem: "Cisco IOS XR",
      osVersion: "6.1.4",
    },
  ],
  [
    "Cisco NX-OS",
    "Cisco NX-OS(tm) n9000, Software (n9000-dk9), Version 9.3(5), RELEASE SOFTWARE Copyright (c) 2002-2020 by Cisco Systems, Inc. Compiled 7/20/2020 20:00:00",
    {
      manufacturer: "Cisco",
      operatingSystem: "Cisco NX-OS",
      osVersion: "9.3(5)",
    },
  ],
  [
    "a Cisco ASA",
    "Cisco Adaptive Security Appliance Version 9.8(4)32",
    {
      manufacturer: "Cisco",
      operatingSystem: "Cisco ASA",
      osVersion: "9.8(4)32",
    },
  ],
  [
    "Cisco Firepower Threat Defense, which also names its ASA engine",
    "Cisco Firepower Threat Defense, Version 6.6.1 (Build 91), ASA Version 9.14(1)150",
    {
      manufacturer: "Cisco",
      operatingSystem: "Cisco Firepower Threat Defense",
      osVersion: "6.6.1",
    },
  ],
  [
    "a Juniper EX switch",
    "Juniper Networks, Inc. ex2200-24t-4g Ethernet Switch, kernel JUNOS 12.3R6.6, Build date: 2014-03-13 07:40:03 UTC Copyright (c) 1996-2014 Juniper Networks, Inc.",
    {
      manufacturer: "Juniper",
      model: "ex2200-24t-4g",
      operatingSystem: "Junos OS",
      osVersion: "12.3R6.6",
    },
  ],
  [
    "a Juniper SRX",
    "Juniper Networks, Inc. srx240h2 internet router, kernel JUNOS 12.1X44-D45.2 #0: 2015-01-16 05:04:20 UTC",
    {
      manufacturer: "Juniper",
      model: "srx240h2",
      operatingSystem: "Junos OS",
      osVersion: "12.1X44-D45.2",
    },
  ],
  [
    "an Arista switch",
    "Arista Networks EOS version 4.20.1F running on an Arista Networks DCS-7050SX-64",
    {
      manufacturer: "Arista",
      model: "DCS-7050SX-64",
      operatingSystem: "Arista EOS",
      osVersion: "4.20.1F",
    },
  ],
  [
    "a MikroTik router",
    "RouterOS CCR1036-12G-4S",
    {
      manufacturer: "MikroTik",
      model: "CCR1036-12G-4S",
      operatingSystem: "RouterOS",
    },
  ],
  [
    "a MikroTik model with a plus in it",
    "RouterOS RB4011iGS+",
    {
      manufacturer: "MikroTik",
      model: "RB4011iGS+",
      operatingSystem: "RouterOS",
    },
  ],
  [
    "an HP ProCurve-family switch",
    "HP J9774A 2530-8G-PoEP Switch, revision YA.16.02.0012, ROM YA.15.20 (/ws/swbuildm/rel_yakima_qaoff/code/build/lakes(swbuildm_rel_yakima_qaoff_rel_yakima))",
    {
      manufacturer: "HPE",
      model: "J9774A 2530-8G-PoEP",
      operatingSystem: "ArubaOS-Switch",
      osVersion: "YA.16.02.0012",
      firmwareVersion: "YA.15.20",
    },
  ],
  [
    "an Aruba switch",
    "Aruba JL258A 2930F-8G-PoE+-2SFP+ Switch, revision WC.16.10.0012, ROM WC.16.01.0008 (/ws/swbuildm/rel_xxx)",
    {
      manufacturer: "Aruba",
      model: "JL258A 2930F-8G-PoE+-2SFP+",
      operatingSystem: "ArubaOS-Switch",
      osVersion: "WC.16.10.0012",
      firmwareVersion: "WC.16.01.0008",
    },
  ],
  [
    "an old ProCurve, whose model puts Switch in the middle",
    "ProCurve J9086A Switch 2610-24/12PWR, revision R.11.72, ROM R.10.06 (/sw/code/build/nemo(R_ndx))",
    {
      manufacturer: "HPE",
      model: "J9086A Switch 2610-24/12PWR",
      operatingSystem: "ArubaOS-Switch",
      osVersion: "R.11.72",
      firmwareVersion: "R.10.06",
    },
  ],
  [
    "a Huawei switch naming its model on the first line",
    "S5720-28X-PWR-SI-AC\r\nHuawei Versatile Routing Platform Software VRP (R) software,Version 5.170 (S5720 V200R011C10SPC500) Copyright (C) 2000-2018 HUAWEI TECH CO., LTD",
    {
      manufacturer: "Huawei",
      model: "S5720-28X-PWR-SI-AC",
      operatingSystem: "Huawei VRP",
      osVersion: "5.170 (S5720 V200R011C10SPC500)",
    },
  ],
  [
    "a Huawei switch naming its model on a line of its own",
    "Huawei Versatile Routing Platform Software\r\nVRP (R) software, Version 8.180 (CE6810EI V200R005C10SPC800)\r\nCopyright (C) 2012-2018 Huawei Technologies Co., Ltd.\r\nHUAWEI CE6810-48S4Q-EI\r\n",
    {
      manufacturer: "Huawei",
      model: "CE6810-48S4Q-EI",
      operatingSystem: "Huawei VRP",
      osVersion: "8.180 (CE6810EI V200R005C10SPC800)",
    },
  ],
  [
    "a Palo Alto firewall",
    "Palo Alto Networks PA-220 series firewall",
    {
      manufacturer: "Palo Alto Networks",
      model: "PA-220",
      operatingSystem: "PAN-OS",
    },
  ],
  [
    "an F5 BIG-IP",
    "BIG-IP 10350v : Linux 3.10.0-862.14.4.el7.ve.x86_64 : BIG-IP software release 15.1.0.4, build 0.0.6",
    {
      manufacturer: "F5",
      model: "BIG-IP 10350v",
      operatingSystem: "BIG-IP",
      osVersion: "15.1.0.4",
    },
  ],
  [
    "an ExtremeXOS switch",
    "ExtremeXOS (X440G2-48p-10G4) version 22.6.1.4 22.6.1.4 by release-manager on Thu Mar 21 08:34:40 EDT 2019",
    {
      manufacturer: "Extreme Networks",
      model: "X440G2-48p-10G4",
      operatingSystem: "ExtremeXOS",
      osVersion: "22.6.1.4",
    },
  ],
  [
    "a Dell OS10 switch",
    "Dell EMC Networking OS10 Enterprise.\r\nCopyright (c) 1999-2020 by Dell Inc. All Rights Reserved.\r\nSystem Description: OS10 Enterprise.\r\nOS Version: 10.5.1.3.\r\nSystem Type: S4148F-ON",
    {
      manufacturer: "Dell",
      model: "S4148F-ON",
      operatingSystem: "Dell OS10",
      osVersion: "10.5.1.3",
    },
  ],
  [
    "a Ubiquiti EdgeSwitch",
    "EdgeSwitch 24-Port Lite, 1.9.3.5089037, Linux 3.6.5-f4a26ed5, 0.0.00.0000",
    {
      manufacturer: "Ubiquiti",
      model: "EdgeSwitch 24-Port Lite",
      firmwareVersion: "1.9.3.5089037",
    },
  ],
  [
    "a UniFi switch",
    "USW-24-PoE, 6.5.59.14773, Linux 3.6.5",
    {
      manufacturer: "Ubiquiti",
      model: "USW-24-PoE",
      firmwareVersion: "6.5.59.14773",
    },
  ],
  [
    "a UniFi access point",
    "U6+ 6.6.62",
    { manufacturer: "Ubiquiti", model: "U6+", firmwareVersion: "6.6.62" },
  ],
  [
    "an older UniFi access point",
    "UAP-AC-Pro-Gen2 6.5.62.14789",
    {
      manufacturer: "Ubiquiti",
      model: "UAP-AC-Pro-Gen2",
      firmwareVersion: "6.5.62.14789",
    },
  ],
  [
    "an EdgeRouter",
    "EdgeOS v2.0.9-hotfix.6.5574651.221230.1015",
    {
      manufacturer: "Ubiquiti",
      operatingSystem: "EdgeOS",
      osVersion: "2.0.9-hotfix.6.5574651.221230.1015",
    },
  ],
  [
    "a VMware ESXi host",
    "VMware ESXi 7.0.3 build-21424296 VMware, Inc. x86_64",
    {
      operatingSystem: "VMware ESXi",
      osVersion: "7.0.3 (build 21424296)",
    },
  ],
  [
    "a pfSense firewall",
    "pfSense fw.example.com 2.6.0-RELEASE FreeBSD 12.3-STABLE amd64",
    { operatingSystem: "pfSense", osVersion: "2.6.0-RELEASE" },
  ],
  [
    "an OPNsense firewall",
    "OPNsense opnsense.localdomain 23.1 FreeBSD 13.1-RELEASE-p6 amd64",
    { operatingSystem: "OPNsense", osVersion: "23.1" },
  ],
  [
    "a FreeBSD host",
    "FreeBSD host 13.2-RELEASE FreeBSD 13.2-RELEASE releng/13.2-n254617 GENERIC amd64",
    { operatingSystem: "FreeBSD", osVersion: "13.2-RELEASE" },
  ],
  [
    "a Windows host's SNMP service",
    "Hardware: Intel64 Family 6 Model 85 Stepping 7 AT/AT COMPATIBLE - Software: Windows Version 6.3 (Build 17763 Multiprocessor Free)",
    { operatingSystem: "Windows", osVersion: "6.3 (Build 17763)" },
  ],
  [
    "an old Windows naming its release",
    "Hardware: x86 Family 6 Model 8 Stepping 3 AT/AT COMPATIBLE - Software: Windows 2000 Version 5.0 (Build 2195 Uniprocessor Free)",
    { operatingSystem: "Windows", osVersion: "5.0 (Build 2195)" },
  ],
  [
    "a Linux host on Net-SNMP",
    "Linux fw01 5.10.0-21-amd64 #1 SMP Debian 5.10.162-1 (2023-01-21) x86_64",
    { operatingSystem: "Linux", osVersion: "5.10.0-21-amd64" },
  ],
  [
    "a Synology NAS (Linux under the hood)",
    "Linux DiskStation 4.4.180+ #42962 SMP Fri Apr 21 01:40:56 CST 2023 x86_64",
    { operatingSystem: "Linux", osVersion: "4.4.180+" },
  ],
  [
    "a Linux agent that names no host",
    "Linux 4.4.153 #1 SMP PREEMPT Wed Jan 4 12:00:00 UTC 2023 mips",
    { operatingSystem: "Linux", osVersion: "4.4.153" },
  ],
];

describe("parseSystemDescription reads each platform's sysDescr (issue #4569)", () => {
  test.each(PLATFORMS)(
    "%s",
    (_name: string, sysDescr: string, expected: SystemDescriptionFacts) => {
      expect(parseSystemDescription(sysDescr)).toEqual(expected);
    },
  );

  test("every fact it returns is a non-empty string with no surrounding space", () => {
    for (const [, sysDescr] of PLATFORMS) {
      const facts: SystemDescriptionFacts = parseSystemDescription(sysDescr);
      for (const value of Object.values(facts)) {
        expect(typeof value).toBe("string");
        expect(value).toBe((value as string).trim());
        expect((value as string).length).toBeGreaterThan(0);
      }
    }
  });

  /*
   * A platform it does not recognise yields nothing, not a guess: a model
   * read off the wrong token would be believed by a CMDB.
   */
  test.each([
    ["a FortiGate (whose sysDescr has no fixed shape)", "FortiGate-60F"],
    ["a Cisco wireless controller", "Cisco Controller"],
    [
      "a Cisco small-business switch",
      "SG350-28 28-Port Gigabit Managed Switch",
    ],
    ["a sentence", "Main office printer on the second floor"],
    ["Ubuntu, which only looks like a UniFi model", "Ubuntu 22.04.3"],
    ["a UniFi-looking prefix with more after it", "U6-Lite 6.6.55 beta"],
    ["a lone vendor name", "Juniper"],
  ])("%s yields no facts", (_name: string, sysDescr: string) => {
    expect(parseSystemDescription(sysDescr)).toEqual({});
  });

  test.each([undefined, null, 42, true, {}, [], "", "   ", "\r\n"])(
    "%p yields no facts and does not throw",
    (value: unknown) => {
      expect(parseSystemDescription(value)).toEqual({});
    },
  );

  test("only the first matching platform answers - two rules never mix", () => {
    // An FTD names its ASA engine; it is read as the FTD only.
    expect(
      parseSystemDescription(
        "Cisco Firepower Threat Defense, Version 6.6.1 (Build 91), ASA Version 9.14(1)150",
      ).operatingSystem,
    ).toBe("Cisco Firepower Threat Defense");
    // An F5 runs Linux; it is read as the BIG-IP.
    expect(
      parseSystemDescription(
        "BIG-IP 10350v : Linux 3.10.0 : BIG-IP software release 15.1.0.4, build 0.0.6",
      ).operatingSystem,
    ).toBe("BIG-IP");
    // A pfSense box names FreeBSD; it is read as pfSense.
    expect(
      parseSystemDescription(
        "pfSense fw 2.7.2-RELEASE FreeBSD 14.0-CURRENT amd64",
      ).operatingSystem,
    ).toBe("pfSense");
  });

  test("a recognised platform with no version leaves the version out", () => {
    expect(parseSystemDescription("Cisco IOS Software")).toEqual({
      manufacturer: "Cisco",
      operatingSystem: "Cisco IOS",
    });
    expect(
      parseSystemDescription("Juniper Networks, Inc. mx480 internet router"),
    ).toEqual({
      manufacturer: "Juniper",
      model: "mx480",
      operatingSystem: "Junos OS",
    });
    expect(
      parseSystemDescription("Arista Networks EOS version 4.28.0F"),
    ).toEqual({
      manufacturer: "Arista",
      operatingSystem: "Arista EOS",
      osVersion: "4.28.0F",
    });
  });

  test("a description with Cisco's CRLF line ends reads like one without", () => {
    const withCrlf: string =
      "Cisco IOS Software, C2960 Software, Version 15.0(2)SE11,\r\nTechnical Support";
    expect(parseSystemDescription(withCrlf)).toEqual(
      parseSystemDescription(withCrlf.split("\r").join("")),
    );
  });

  test("a recognised description still parses after leading and trailing space", () => {
    expect(parseSystemDescription("   Meraki MX85  \n")).toEqual({
      manufacturer: "Cisco Meraki",
      model: "MX85",
    });
  });
});

describe("readSystemDescription", () => {
  test("cuts a description longer than any poller writes", () => {
    const long: string = "x".repeat(MAX_SYSTEM_DESCRIPTION_LENGTH * 4);
    expect(readSystemDescription(long)).toHaveLength(
      MAX_SYSTEM_DESCRIPTION_LENGTH,
    );
  });

  test("drops carriage returns and trims", () => {
    expect(readSystemDescription("  a\r\nb\r\n  ")).toBe("a\nb");
  });

  test.each([undefined, null, 7, {}])("%p reads as empty", (value: unknown) => {
    expect(readSystemDescription(value)).toBe("");
  });
});

describe("parseSystemDescription stays fast on hostile input", () => {
  /*
   * Every pattern has bounded quantifiers and reads at most
   * MAX_SYSTEM_DESCRIPTION_LENGTH characters. These are the shapes that
   * make an unbounded pattern backtrack: long runs of the characters the
   * patterns repeat, with the one character that would end the match
   * missing.
   */
  test.each([
    ["spaces", " ".repeat(200000)],
    ["a long word", "a".repeat(200000)],
    ["Linux and a long host name", `Linux ${"h".repeat(200000)}`],
    ["an HP prefix with no revision", `HP ${"x".repeat(200000)}`],
    [
      "a Huawei banner over many lines",
      `Huawei Versatile Routing Platform${"\n".repeat(50000)}`,
    ],
    ["dots and digits", "1.".repeat(100000)],
    ["UniFi-like with no version", `UAP${"-".repeat(200000)}`],
  ])("%s", (_name: string, value: string) => {
    const started: number = Date.now();
    parseSystemDescription(value);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
