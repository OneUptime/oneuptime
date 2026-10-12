import { describe, expect, test } from "@jest/globals";
import {
  buildFilter,
  canDownloadCapture,
  canStopCapture,
  CaptureStatusDisplay,
  CaptureView,
  decodeDownload,
  describeDuration,
  describeEndReason,
  describeFilterPreview,
  describeLimits,
  formatBytes,
  formatClock,
  getCaptureStatusDisplay,
  getDefaultFilterValue,
  getDefaultLimits,
  getDurationChoices,
  getInterfaceOptions,
  getPacketCaptureReadiness,
  getSensitiveDataNotice,
  hasActiveCapture,
  InterfaceOption,
  PACKET_CAPTURE_DOCS_PATH,
  PACKET_CAPTURE_POLL_INTERVAL_IN_MS,
  PACKET_CAPTURE_TURN_ON_ANCHOR,
  PacketCaptureFilterMode,
  PacketCaptureReadiness,
  PacketCaptureReadinessCopy,
  PacketCaptureStatusCopy,
  TURN_ON_SETTINGS,
} from "../../FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureViewModel";
import PacketCaptureCapabilityUtil, {
  PacketCaptureCapability,
} from "Common/Types/PacketCapture/PacketCaptureCapability";
import PacketCaptureEndReason from "Common/Types/PacketCapture/PacketCaptureEndReason";
import { PacketCaptureProtocol } from "Common/Types/PacketCapture/PacketCaptureFilter";
import {
  DEFAULT_PACKET_CAPTURE_LIMITS,
  PACKET_CAPTURE_DURATION_CHOICES_IN_SECONDS,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import PacketCaptureStatus from "Common/Types/PacketCapture/PacketCaptureStatus";
import { JSONObject } from "Common/Types/JSON";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import fs from "fs";
import path from "path";

/*
 * The pure half of packet captures in the dashboard: whether a probe can
 * capture and what to tell someone when it cannot, what the Start form
 * offers and builds, and how a capture's status, result and limits read in
 * the list. The components only lay these out; every sentence a person
 * reads about a capture is decided here, so each is pinned.
 */

const english: Translator = createTranslator(undefined, "en");

function capability(overrides: JSONObject = {}): PacketCaptureCapability {
  return PacketCaptureCapabilityUtil.sanitize({
    isEnabled: true,
    isToolAvailable: true,
    interfaces: [
      { name: "any", addresses: [], isUp: true },
      { name: "eth0", addresses: ["10.0.0.2/24", "fe80::1/64"], isUp: true },
      { name: "eth1", addresses: [], isUp: true },
      { name: "eth2", addresses: ["192.168.1.2/24"], isUp: false },
    ],
    limits: {
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInMB: 25,
    },
    ...overrides,
  }) as PacketCaptureCapability;
}

function capture(overrides: Partial<CaptureView> = {}): CaptureView {
  return {
    status: PacketCaptureStatus.Completed,
    maxDurationInSeconds: 60,
    maxPackets: 100000,
    maxFileSizeInMB: 10,
    ...overrides,
  };
}

const NOW: Date = new Date("2026-10-09T08:30:00Z");

function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

function display(overrides: Partial<CaptureView>): CaptureStatusDisplay {
  return getCaptureStatusDisplay(capture(overrides), english, NOW);
}

describe("whether a probe can capture", () => {
  test("a global probe never does, whatever it reported", () => {
    expect(
      getPacketCaptureReadiness({
        isGlobalProbe: true,
        packetCaptureCapability: capability(),
      }),
    ).toBe(PacketCaptureReadiness.GlobalProbe);
  });

  test("in the order someone would fix it: update, turn on, install, network", () => {
    expect(getPacketCaptureReadiness({})).toBe(
      PacketCaptureReadiness.NotReported,
    );
    expect(
      getPacketCaptureReadiness({ packetCaptureCapability: "garbage" }),
    ).toBe(PacketCaptureReadiness.NotReported);
    expect(
      getPacketCaptureReadiness({
        packetCaptureCapability: capability({ isEnabled: false }),
      }),
    ).toBe(PacketCaptureReadiness.TurnedOff);
    expect(
      getPacketCaptureReadiness({
        packetCaptureCapability: capability({ isToolAvailable: false }),
      }),
    ).toBe(PacketCaptureReadiness.NoTool);
    expect(
      getPacketCaptureReadiness({
        packetCaptureCapability: capability({ interfaces: [] }),
      }),
    ).toBe(PacketCaptureReadiness.NoInterfaces);
    expect(
      getPacketCaptureReadiness({ packetCaptureCapability: capability() }),
    ).toBe(PacketCaptureReadiness.Ready);
  });

  test("every state that is not ready says what it is and what to do", () => {
    for (const readiness of Object.values(PacketCaptureReadiness)) {
      if (readiness === PacketCaptureReadiness.Ready) {
        continue;
      }

      const copy: { title: string; body: string } =
        PacketCaptureReadinessCopy[readiness];

      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }

    expect(
      PacketCaptureReadinessCopy[PacketCaptureReadiness.TurnedOff].title,
    ).toBe("Packet capture is off on this probe");
  });

  test("the settings to turn captures on are shown where they are what is missing", () => {
    expect(
      PacketCaptureReadinessCopy[PacketCaptureReadiness.TurnedOff]
        .showsTurnOnSettings,
    ).toBe(true);
    expect(
      PacketCaptureReadinessCopy[PacketCaptureReadiness.NotReported]
        .showsTurnOnSettings,
    ).toBe(true);
    expect(
      PacketCaptureReadinessCopy[PacketCaptureReadiness.NoInterfaces]
        .showsTurnOnSettings,
    ).toBe(true);
    expect(
      PacketCaptureReadinessCopy[PacketCaptureReadiness.GlobalProbe]
        .showsTurnOnSettings,
    ).toBe(false);
    expect(
      PacketCaptureReadinessCopy[PacketCaptureReadiness.NoTool]
        .showsTurnOnSettings,
    ).toBe(false);
  });

  test("the settings are the three the probe needs: the switch, host networking and NET_RAW only", () => {
    expect(
      TURN_ON_SETTINGS.map((setting: { code: string }): string => {
        return setting.code;
      }),
    ).toEqual([
      "PROBE_PACKET_CAPTURE_ENABLED=true",
      "--network host",
      "--cap-add NET_RAW",
    ]);

    // tcpdump needs NET_RAW and nothing more; NET_ADMIN is never asked for.
    expect(JSON.stringify(TURN_ON_SETTINGS)).not.toContain("NET_ADMIN");
  });

  test("the switch is the one the probe reads", () => {
    const settings: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../Probe/Utils/PacketCapture/PacketCaptureSettings.ts",
      ),
      "utf8",
    );

    expect(settings).toContain('"PROBE_PACKET_CAPTURE_ENABLED"');
  });

  test("the help link opens the docs section that shows the settings", () => {
    const page: string = fs.readFileSync(
      path.resolve(
        __dirname,
        `../../FeatureSet/Docs/Content/en${PACKET_CAPTURE_DOCS_PATH}.md`,
      ),
      "utf8",
    );

    expect(PACKET_CAPTURE_TURN_ON_ANCHOR).toBe("turn-on-packet-capture");
    expect(page).toContain("\n## Turn on packet capture\n");
  });
});

describe("what the Start form offers", () => {
  test("every interface the probe listed, named as people read them", () => {
    const options: Array<InterfaceOption> = getInterfaceOptions(
      capability(),
      english,
    );

    expect(options).toEqual([
      { value: "any", label: "All interfaces (any)" },
      { value: "eth0", label: "eth0 · 10.0.0.2/24, fe80::1/64" },
      { value: "eth1", label: "eth1" },
      { value: "eth2", label: "eth2 · 192.168.1.2/24 (down)" },
    ]);
  });

  test("no report, no interfaces", () => {
    expect(getInterfaceOptions(null, english)).toEqual([]);
    expect(getInterfaceOptions(undefined, english)).toEqual([]);
  });

  test("the usual durations, up to the probe's longest, which is always offered", () => {
    expect(getDurationChoices(1800)).toEqual([
      ...PACKET_CAPTURE_DURATION_CHOICES_IN_SECONDS,
    ]);
    expect(getDurationChoices(600)).toEqual([30, 60, 120, 300, 600]);
    expect(getDurationChoices(90)).toEqual([30, 60, 90]);
    expect(getDurationChoices(45)).toEqual([30, 45]);
    expect(getDurationChoices(5)).toEqual([5]);
  });

  test("the limits it opens with are the defaults, lowered to what the probe allows", () => {
    expect(getDefaultLimits(null)).toEqual(DEFAULT_PACKET_CAPTURE_LIMITS);
    expect(getDefaultLimits(capability())).toEqual(
      DEFAULT_PACKET_CAPTURE_LIMITS,
    );
    expect(
      getDefaultLimits(
        capability({
          limits: {
            maxDurationInSeconds: 30,
            maxPackets: 500,
            maxFileSizeInMB: 2,
          },
        }),
      ),
    ).toEqual({
      maxDurationInSeconds: 30,
      maxPackets: 500,
      maxFileSizeInMB: 2,
    });
  });

  test("the folded limits say when the capture stops", () => {
    expect(describeLimits(DEFAULT_PACKET_CAPTURE_LIMITS, english)).toBe(
      "Stops after 1 minute, 100,000 packets or 10 MB, whichever comes first.",
    );
    expect(
      describeLimits(
        { maxDurationInSeconds: 90, maxPackets: 1, maxFileSizeInMB: 25 },
        english,
      ),
    ).toBe("Stops after 90 seconds, 1 packet or 25 MB, whichever comes first.");
  });

  test("before anything is captured, the form says what a capture holds and what OneUptime does about it", () => {
    const notice: string = getSensitiveDataNotice(english);

    expect(notice).toContain(
      "Passwords, tokens and personal data that cross the wire end up in the file.",
    );
    expect(notice).toContain("Captures are deleted after 7 days");
    expect(notice).toContain(
      "every start and download is recorded in the audit log",
    );
  });
});

describe("the filter the form builds", () => {
  test("starts from the device's address on a device's page, and from nothing elsewhere", () => {
    expect(getDefaultFilterValue(" 10.0.0.5 ")).toEqual({
      mode: PacketCaptureFilterMode.Simple,
      host: "10.0.0.5",
      port: "",
      protocol: PacketCaptureProtocol.Any,
      expression: "",
    });
    expect(getDefaultFilterValue().host).toBe("");
  });

  test("host, port and protocol become the expression the server checks", () => {
    expect(
      buildFilter({
        ...getDefaultFilterValue("10.0.0.5"),
        port: "443",
        protocol: PacketCaptureProtocol.TCP,
      }),
    ).toEqual({ expression: "host 10.0.0.5 and tcp port 443", error: null });
  });

  test("a written expression is tidied and checked", () => {
    expect(
      buildFilter({
        ...getDefaultFilterValue(),
        mode: PacketCaptureFilterMode.Expression,
        expression: "  udp   port 53 ",
      }),
    ).toEqual({ expression: "udp port 53", error: null });
    expect(
      buildFilter({
        ...getDefaultFilterValue(),
        mode: PacketCaptureFilterMode.Expression,
        expression: "port 53; reboot",
      }).error,
    ).toContain('The filter can\'t contain ";"');
  });

  test("the boxes are read in simple mode even when an expression was written before", () => {
    expect(
      buildFilter({
        mode: PacketCaptureFilterMode.Simple,
        host: "",
        port: "53",
        protocol: PacketCaptureProtocol.UDP,
        expression: "this is ignored",
      }).expression,
    ).toBe("udp port 53");
  });

  test("no value is every packet", () => {
    expect(buildFilter(null)).toEqual({ expression: "", error: null });
  });

  test("the preview says what will run, or what is wrong", () => {
    expect(
      describeFilterPreview({
        build: { expression: "", error: null },
        interfaceLabel: "eth0",
        translator: english,
      }),
    ).toBe("No filter: every packet on eth0 is kept.");
    expect(
      describeFilterPreview({
        build: { expression: "port 53", error: null },
        interfaceLabel: "eth0",
        translator: english,
      }),
    ).toBe("Filter: port 53");
    expect(
      describeFilterPreview({
        build: { expression: "", error: "Pick a protocol." },
        interfaceLabel: "eth0",
        translator: english,
      }),
    ).toBe("Pick a protocol.");
  });
});

describe("how a capture reads in the list", () => {
  test("Pending waits for the probe", () => {
    expect(display({ status: PacketCaptureStatus.Pending })).toEqual({
      label: "Pending",
      tone: "neutral",
      detail: "Waiting for the probe to pick it up.",
    });
  });

  test("Running shows how far it has got against its duration", () => {
    expect(
      display({
        status: PacketCaptureStatus.Running,
        startedAt: secondsAgo(42),
        maxDurationInSeconds: 300,
      }),
    ).toEqual({
      label: "Running",
      tone: "active",
      detail: "Capturing · 0:42 of 5:00",
    });
  });

  test("a running clock never passes the duration, and starts at zero", () => {
    expect(
      display({
        status: PacketCaptureStatus.Running,
        startedAt: secondsAgo(400),
        maxDurationInSeconds: 60,
      }).detail,
    ).toBe("Capturing · 1:00 of 1:00");
    expect(
      display({ status: PacketCaptureStatus.Running, maxDurationInSeconds: 60 })
        .detail,
    ).toBe("Capturing · 0:00 of 1:00");
  });

  test("a capture someone stopped says it is stopping and uploading", () => {
    expect(
      display({
        status: PacketCaptureStatus.Running,
        startedAt: secondsAgo(10),
        stopRequestedAt: secondsAgo(1),
      }),
    ).toEqual({
      label: "Running",
      tone: "active",
      detail: "Stopping and uploading the file…",
    });
  });

  test("Failed says why, in the probe's or the server's words", () => {
    expect(
      display({
        status: PacketCaptureStatus.Failed,
        statusMessage: "tcpdump could not use the filter.",
      }),
    ).toEqual({
      label: "Failed",
      tone: "danger",
      detail: "tcpdump could not use the filter.",
    });
    expect(display({ status: PacketCaptureStatus.Failed }).detail).toBe(
      "The probe could not run this capture.",
    );
  });

  test("Completed says what the file holds, and why the capture stopped", () => {
    expect(
      display({
        packetCount: 3,
        fileSizeInBytes: 1536,
        endReason: PacketCaptureEndReason.DurationReached,
      }),
    ).toEqual({
      label: "Completed",
      tone: "success",
      detail: "3 packets · 1.5 KB",
      note: "Stopped after 1 minute.",
    });
    expect(
      display({
        packetCount: 1,
        fileSizeInBytes: 100,
        endReason: PacketCaptureEndReason.StoppedFromDashboard,
      }),
    ).toMatchObject({
      detail: "1 packet · 100 B",
      note: "Stopped from the dashboard.",
    });
  });

  test("a capture that matched nothing says so", () => {
    expect(
      display({
        packetCount: 0,
        endReason: PacketCaptureEndReason.DurationReached,
      }),
    ).toEqual({
      label: "Completed",
      tone: "success",
      detail: "No packets matched the filter.",
      note: "Stopped after 1 minute.",
    });
  });

  test("tcpdump's own words are shown when it stopped by itself, once", () => {
    expect(
      display({
        packetCount: 5,
        fileSizeInBytes: 2048,
        endReason: PacketCaptureEndReason.CaptureToolStopped,
        statusMessage: "tcpdump stopped by itself: eth0: interface went down",
      }).note,
    ).toBe("tcpdump stopped by itself: eth0: interface went down");
    expect(
      display({
        packetCount: 0,
        endReason: PacketCaptureEndReason.CaptureToolStopped,
      }).note,
    ).toBe("tcpdump stopped by itself.");
  });

  test("the probe's words never stand in for another end reason", () => {
    expect(
      display({
        packetCount: 5,
        fileSizeInBytes: 2048,
        endReason: PacketCaptureEndReason.PacketLimitReached,
        maxPackets: 5,
        statusMessage: "unexpected words",
      }).note,
    ).toBe("Stopped at its limit of 5 packets.");
  });

  test("a status it does not know reads as Pending", () => {
    expect(
      display({ status: "Unknown" as unknown as PacketCaptureStatus }).label,
    ).toBe("Pending");
  });

  test("every status has its label", () => {
    expect(PacketCaptureStatusCopy).toEqual({
      Pending: "Pending",
      Running: "Running",
      Completed: "Completed",
      Failed: "Failed",
    });
  });

  test("each way a capture can stop, in a sentence", () => {
    const sentence: (reason: string) => string | undefined = (
      reason: string,
    ): string | undefined => {
      return describeEndReason(
        capture({
          endReason: reason,
          maxDurationInSeconds: 120,
          maxPackets: 5000,
          maxFileSizeInMB: 25,
        }),
        english,
      );
    };

    expect(sentence(PacketCaptureEndReason.DurationReached)).toBe(
      "Stopped after 2 minutes.",
    );
    expect(sentence(PacketCaptureEndReason.PacketLimitReached)).toBe(
      "Stopped at its limit of 5,000 packets.",
    );
    expect(sentence(PacketCaptureEndReason.FileSizeLimitReached)).toBe(
      "Stopped at its file size limit of 25 MB.",
    );
    expect(sentence(PacketCaptureEndReason.StoppedFromDashboard)).toBe(
      "Stopped from the dashboard.",
    );
    expect(sentence(PacketCaptureEndReason.CaptureToolStopped)).toBe(
      "tcpdump stopped by itself.",
    );
    expect(sentence("Whatever")).toBeUndefined();
  });

  test("a capture is downloaded once it finished with packets, and stopped while it runs", () => {
    expect(canDownloadCapture(capture({ packetCount: 3 }))).toBe(true);
    expect(canDownloadCapture(capture({ packetCount: 0 }))).toBe(false);
    expect(
      canDownloadCapture(
        capture({ status: PacketCaptureStatus.Failed, packetCount: 3 }),
      ),
    ).toBe(false);

    expect(
      canStopCapture(capture({ status: PacketCaptureStatus.Running })),
    ).toBe(true);
    expect(
      canStopCapture(
        capture({
          status: PacketCaptureStatus.Running,
          stopRequestedAt: NOW,
        }),
      ),
    ).toBe(false);
    expect(
      canStopCapture(capture({ status: PacketCaptureStatus.Pending })),
    ).toBe(false);
    expect(canStopCapture(capture())).toBe(false);
  });

  test("the list keeps re-reading while anything is waiting or running", () => {
    expect(PACKET_CAPTURE_POLL_INTERVAL_IN_MS).toBe(5000);
    expect(
      hasActiveCapture([
        capture(),
        capture({ status: PacketCaptureStatus.Pending }),
      ]),
    ).toBe(true);
    expect(
      hasActiveCapture([capture({ status: PacketCaptureStatus.Running })]),
    ).toBe(true);
    expect(
      hasActiveCapture([
        capture(),
        capture({ status: PacketCaptureStatus.Failed }),
      ]),
    ).toBe(false);
    expect(hasActiveCapture([])).toBe(false);
  });
});

describe("numbers in words", () => {
  test("durations", () => {
    expect(describeDuration(1, english)).toBe("1 second");
    expect(describeDuration(30, english)).toBe("30 seconds");
    expect(describeDuration(60, english)).toBe("1 minute");
    expect(describeDuration(90, english)).toBe("90 seconds");
    expect(describeDuration(1800, english)).toBe("30 minutes");
    expect(describeDuration(-3, english)).toBe("0 seconds");
  });

  test("sizes", () => {
    expect(formatBytes(0, english)).toBe("0 B");
    expect(formatBytes(-5, english)).toBe("0 B");
    expect(formatBytes(1023, english)).toBe("1,023 B");
    expect(formatBytes(1536, english)).toBe("1.5 KB");
    expect(formatBytes(2.2 * 1024 * 1024, english)).toBe("2.2 MB");
    expect(formatBytes(25 * 1024 * 1024, english)).toBe("25 MB");
  });

  test("the running clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(59.9)).toBe("0:59");
    expect(formatClock(61)).toBe("1:01");
    expect(formatClock(1800)).toBe("30:00");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("the downloaded file", () => {
  test("the base64 the server sends comes back byte for byte", () => {
    const bytes: Buffer = Buffer.from([0xd4, 0xc3, 0xb2, 0xa1, 0, 255, 128, 7]);

    expect(Buffer.from(decodeDownload(bytes.toString("base64")))).toEqual(
      bytes,
    );
  });

  test("a large file is decoded in good time", () => {
    const bytes: Buffer = Buffer.alloc(5 * 1024 * 1024, 0xab);
    const started: number = Date.now();

    expect(decodeDownload(bytes.toString("base64"))).toHaveLength(bytes.length);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
