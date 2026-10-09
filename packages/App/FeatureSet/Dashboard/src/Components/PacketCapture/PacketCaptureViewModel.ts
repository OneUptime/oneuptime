import PacketCaptureCapabilityUtil, {
  ALL_INTERFACES_NAME,
  PacketCaptureCapability,
  PacketCaptureInterface,
} from "Common/Types/PacketCapture/PacketCaptureCapability";
import PacketCaptureEndReason from "Common/Types/PacketCapture/PacketCaptureEndReason";
import PacketCaptureFilterUtil, {
  PacketCaptureFilterBuild,
  PacketCaptureProtocol,
} from "Common/Types/PacketCapture/PacketCaptureFilter";
import {
  BYTES_IN_A_MEGABYTE,
  DEFAULT_PACKET_CAPTURE_LIMITS,
  PACKET_CAPTURE_DURATION_CHOICES_IN_SECONDS,
  PACKET_CAPTURE_RETENTION_IN_DAYS,
  PacketCaptureLimits,
  PacketCaptureLimitsUtil,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import PacketCaptureStatus, {
  PacketCaptureStatusUtil,
} from "Common/Types/PacketCapture/PacketCaptureStatus";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure half of packet captures in the dashboard: what a probe can do,
 * how a capture's status, result and limits read, and what the Start form
 * builds. Imports only Common/Types and the translation helpers, so the App
 * suite tests it in plain Node; anything that reads `window` (routes, the
 * API, the permission snapshot) lives in the components next door.
 */

// How often the list re-reads while a capture is waiting or running.
export const PACKET_CAPTURE_POLL_INTERVAL_IN_MS: number = 5000;

// The docs page, and its section on turning captures on.
export const PACKET_CAPTURE_DOCS_PATH: string = "/probe/packet-capture";
export const PACKET_CAPTURE_TURN_ON_ANCHOR: string = "turn-on-packet-capture";

/*
 * What a probe can do about captures, from what it last reported, in the
 * order someone would fix it.
 */
export enum PacketCaptureReadiness {
  // A global probe: it carries other projects' traffic and never captures.
  GlobalProbe = "GlobalProbe",
  // Older than packet capture: it has never said.
  NotReported = "NotReported",
  // Its operator has not turned captures on.
  TurnedOff = "TurnedOff",
  // tcpdump is missing.
  NoTool = "NoTool",
  NoInterfaces = "NoInterfaces",
  Ready = "Ready",
}

export function getPacketCaptureReadiness(probe: {
  isGlobalProbe?: boolean | undefined;
  projectId?: unknown;
  packetCaptureCapability?: unknown;
}): PacketCaptureReadiness {
  if (probe.isGlobalProbe) {
    return PacketCaptureReadiness.GlobalProbe;
  }

  const capability: PacketCaptureCapability | null =
    PacketCaptureCapabilityUtil.parse(probe.packetCaptureCapability);

  if (!capability) {
    return PacketCaptureReadiness.NotReported;
  }

  if (!capability.isEnabled) {
    return PacketCaptureReadiness.TurnedOff;
  }

  if (!capability.isToolAvailable) {
    return PacketCaptureReadiness.NoTool;
  }

  if (capability.interfaces.length === 0) {
    return PacketCaptureReadiness.NoInterfaces;
  }

  return PacketCaptureReadiness.Ready;
}

export interface ReadinessCopy {
  title: string;
  body: string;
  // Whether the "how to turn it on" settings are shown under the body.
  showsTurnOnSettings: boolean;
}

export const PacketCaptureReadinessCopy: Record<
  Exclude<PacketCaptureReadiness, PacketCaptureReadiness.Ready>,
  ReadinessCopy
> = {
  [PacketCaptureReadiness.GlobalProbe]: {
    title: translationKey("Global probes never capture packets"),
    body: translationKey(
      "A global probe carries other projects' traffic, so captures run only on your project's own probes. Pick one of your probes to capture on.",
    ),
    showsTurnOnSettings: false,
  },
  [PacketCaptureReadiness.NotReported]: {
    title: translationKey("This probe has not reported packet capture"),
    body: translationKey(
      "Update the probe to the latest version, then turn packet capture on where it runs.",
    ),
    showsTurnOnSettings: true,
  },
  [PacketCaptureReadiness.TurnedOff]: {
    title: translationKey("Packet capture is off on this probe"),
    body: translationKey(
      "Captures are off on every probe until whoever runs it turns them on. Restart the probe with these settings:",
    ),
    showsTurnOnSettings: true,
  },
  [PacketCaptureReadiness.NoTool]: {
    title: translationKey("tcpdump is not installed on this probe"),
    body: translationKey(
      "Run the official probe image, which includes it, or install tcpdump where the probe runs.",
    ),
    showsTurnOnSettings: false,
  },
  [PacketCaptureReadiness.NoInterfaces]: {
    title: translationKey("This probe reported no network interfaces"),
    body: translationKey(
      "Captures need an interface to listen on. Run the probe with host networking to capture on the host's interfaces.",
    ),
    showsTurnOnSettings: true,
  },
};

/*
 * The three settings a probe needs to capture real traffic, as the card
 * lists them. The values are code and stay as written.
 */
export const TURN_ON_SETTINGS: ReadonlyArray<{
  code: string;
  description: string;
}> = [
  {
    code: "PROBE_PACKET_CAPTURE_ENABLED=true",
    description: translationKey("turns captures on"),
  },
  {
    code: "--network host",
    description: translationKey(
      "lets the probe see the host's interfaces and mirrored ports",
    ),
  },
  {
    code: "--cap-add NET_RAW",
    description: translationKey(
      "lets it capture on them (Docker allows it by default)",
    ),
  },
];

export interface InterfaceOption {
  value: string;
  label: string;
}

/*
 * The interfaces the Start form offers, as the probe listed them: "All
 * interfaces" for "any", then each one with its addresses, and "(down)" on
 * one that is down.
 */
export function getInterfaceOptions(
  capability: PacketCaptureCapability | null | undefined,
  translator: Translator,
): Array<InterfaceOption> {
  if (!capability) {
    return [];
  }

  return capability.interfaces.map(
    (networkInterface: PacketCaptureInterface): InterfaceOption => {
      if (networkInterface.name === ALL_INTERFACES_NAME) {
        return {
          value: networkInterface.name,
          label: translator.translateText("All interfaces (any)") || "",
        };
      }

      const addresses: string = networkInterface.addresses.join(", ");

      let label: string = addresses
        ? `${networkInterface.name} · ${addresses}`
        : networkInterface.name;

      if (networkInterface.isUp === false) {
        label = translator.translateTemplate("{{interfaceName}} (down)", {
          interfaceName: label,
        });
      }

      return { value: networkInterface.name, label: label };
    },
  );
}

// The durations the form offers on a probe: the usual ones, up to its maximum.
export function getDurationChoices(maxDurationInSeconds: number): Array<number> {
  const choices: Array<number> = PACKET_CAPTURE_DURATION_CHOICES_IN_SECONDS.filter(
    (seconds: number): boolean => {
      return seconds <= maxDurationInSeconds;
    },
  );

  if (!choices.includes(maxDurationInSeconds)) {
    choices.push(maxDurationInSeconds);
  }

  return choices.sort((a: number, b: number): number => {
    return a - b;
  });
}

const SECONDS: PluralTemplate = {
  one: "{{count}} second",
  other: "{{count}} seconds",
};

const MINUTES: PluralTemplate = {
  one: "{{count}} minute",
  other: "{{count}} minutes",
};

// A duration in words: "30 seconds", "1 minute", "90 seconds".
export function describeDuration(
  seconds: number,
  translator: Translator,
): string {
  const whole: number = Math.max(0, Math.round(seconds));

  if (whole >= 60 && whole % 60 === 0) {
    return translator.translatePlural(MINUTES, whole / 60);
  }

  return translator.translatePlural(SECONDS, whole);
}

// A size in the units people read: "300 B", "12.5 KB", "2.1 MB".
export function formatBytes(bytes: number, translator: Translator): string {
  const value: number = Math.max(0, bytes || 0);

  if (value < 1024) {
    return translator.translateTemplate("{{count}} B", {
      count: translator.formatNumber(value),
    });
  }

  if (value < BYTES_IN_A_MEGABYTE) {
    return translator.translateTemplate("{{count}} KB", {
      count: translator.formatNumber(Math.round((value / 1024) * 10) / 10),
    });
  }

  return translator.translateTemplate("{{count}} MB", {
    count: translator.formatNumber(
      Math.round((value / BYTES_IN_A_MEGABYTE) * 10) / 10,
    ),
  });
}

const LIMITS_SUMMARY: PluralTemplate = {
  one: "Stops after {{duration}}, {{count}} packet or {{size}}, whichever comes first.",
  other: "Stops after {{duration}}, {{count}} packets or {{size}}, whichever comes first.",
};

// What the folded Limits section says while it is folded.
export function describeLimits(
  limits: PacketCaptureLimits,
  translator: Translator,
): string {
  return translator.translatePlural(LIMITS_SUMMARY, limits.maxPackets, {
    duration: describeDuration(limits.maxDurationInSeconds, translator),
    size: translator.translateTemplate("{{count}} MB", {
      count: translator.formatNumber(limits.maxFileSizeInMB),
    }),
  });
}

export const PACKET_CAPTURE_SENSITIVE_DATA_TITLE: string = translationKey(
  "A capture holds the traffic itself.",
);

/*
 * What the Start form says before anything is captured: the file can hold
 * secrets, and what OneUptime does about it.
 */
export function getSensitiveDataNotice(translator: Translator): string {
  return translator.translatePlural(
    {
      one: "Passwords, tokens and personal data that cross the wire end up in the file. Filter to what you need. Captures are deleted after {{count}} day, and every start and download is recorded in the audit log.",
      other: "Passwords, tokens and personal data that cross the wire end up in the file. Filter to what you need. Captures are deleted after {{count}} days, and every start and download is recorded in the audit log.",
    },
    PACKET_CAPTURE_RETENTION_IN_DAYS,
  );
}

// The filter as the Start form edits it.
export enum PacketCaptureFilterMode {
  Simple = "Simple",
  Expression = "Expression",
}

export interface PacketCaptureFilterValue {
  mode: PacketCaptureFilterMode;
  host: string;
  port: string;
  protocol: PacketCaptureProtocol;
  expression: string;
}

/*
 * The filter a new capture starts with: the device's address when it was
 * started from a device's page, otherwise nothing.
 */
export function getDefaultFilterValue(
  defaultHost?: string | undefined,
): PacketCaptureFilterValue {
  return {
    mode: PacketCaptureFilterMode.Simple,
    host: (defaultHost || "").trim(),
    port: "",
    protocol: PacketCaptureProtocol.Any,
    expression: "",
  };
}

/*
 * The BPF expression a form value stands for, or what is wrong with it.
 * Both halves of the form end at the same check the server makes.
 */
export function buildFilter(
  value: PacketCaptureFilterValue | null | undefined,
): PacketCaptureFilterBuild {
  const filter: PacketCaptureFilterValue = value || getDefaultFilterValue();

  if (filter.mode === PacketCaptureFilterMode.Expression) {
    const expression: string = PacketCaptureFilterUtil.normalize(
      filter.expression,
    );

    return {
      expression: expression,
      error: PacketCaptureFilterUtil.validate(expression),
    };
  }

  return PacketCaptureFilterUtil.buildFromSimple({
    host: filter.host,
    port: filter.port,
    protocol: filter.protocol,
  });
}

// What the form shows under the filter: the expression it will run.
export function describeFilterPreview(data: {
  build: PacketCaptureFilterBuild;
  interfaceLabel: string;
  translator: Translator;
}): string {
  if (data.build.error) {
    return data.build.error;
  }

  if (!data.build.expression) {
    return data.translator.translateTemplate(
      "No filter: every packet on {{interfaceName}} is kept.",
      { interfaceName: data.interfaceLabel },
    );
  }

  return data.translator.translateTemplate("Filter: {{expression}}", {
    expression: data.build.expression,
  });
}

export const PacketCaptureStatusCopy: Record<PacketCaptureStatus, string> = {
  [PacketCaptureStatus.Pending]: translationKey("Pending"),
  [PacketCaptureStatus.Running]: translationKey("Running"),
  [PacketCaptureStatus.Completed]: translationKey("Completed"),
  [PacketCaptureStatus.Failed]: translationKey("Failed"),
};

export type PacketCaptureTone = "neutral" | "active" | "success" | "danger";

export interface CaptureView {
  status: PacketCaptureStatus;
  maxDurationInSeconds: number;
  maxPackets: number;
  maxFileSizeInMB: number;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;
  stopRequestedAt?: Date | undefined;
  packetCount?: number | undefined;
  fileSizeInBytes?: number | undefined;
  endReason?: string | undefined;
  statusMessage?: string | undefined;
}

export interface CaptureStatusDisplay {
  label: string;
  tone: PacketCaptureTone;
  // One line under the label: the progress, the result or the reason.
  detail: string;
  // A second line where there is more to say: why it stopped.
  note?: string | undefined;
}

// "0:42" - elapsed time on the clock a running capture shows.
export function formatClock(seconds: number): string {
  const whole: number = Math.max(0, Math.floor(seconds));
  const minutes: number = Math.floor(whole / 60);
  const remainder: number = whole % 60;

  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

// Why a completed capture stopped, in a sentence.
export function describeEndReason(
  capture: CaptureView,
  translator: Translator,
): string | undefined {
  switch (capture.endReason) {
    case PacketCaptureEndReason.DurationReached:
      return translator.translateTemplate("Stopped after {{duration}}.", {
        duration: describeDuration(capture.maxDurationInSeconds, translator),
      });
    case PacketCaptureEndReason.PacketLimitReached:
      return translator.translatePlural(
        {
          one: "Stopped at its limit of {{count}} packet.",
          other: "Stopped at its limit of {{count}} packets.",
        },
        capture.maxPackets,
      );
    case PacketCaptureEndReason.FileSizeLimitReached:
      return translator.translateTemplate(
        "Stopped at its file size limit of {{size}}.",
        {
          size: translator.translateTemplate("{{count}} MB", {
            count: translator.formatNumber(capture.maxFileSizeInMB),
          }),
        },
      );
    case PacketCaptureEndReason.StoppedFromDashboard:
      return translator.translateText("Stopped from the dashboard.");
    case PacketCaptureEndReason.CaptureToolStopped:
      return translator.translateText("tcpdump stopped by itself.");
    default:
      return undefined;
  }
}

/*
 * How a capture's status reads in the list: the label on its pill, its
 * tone, and the line under it - how far a running one has got, what a
 * finished one holds, why a failed one failed.
 */
export function getCaptureStatusDisplay(
  capture: CaptureView,
  translator: Translator,
  now: Date,
): CaptureStatusDisplay {
  const status: PacketCaptureStatus =
    PacketCaptureStatusUtil.parse(capture.status) ||
    PacketCaptureStatus.Pending;

  const label: string =
    translator.translateText(PacketCaptureStatusCopy[status]) ||
    PacketCaptureStatusCopy[status];

  if (status === PacketCaptureStatus.Pending) {
    return {
      label: label,
      tone: "neutral",
      detail:
        translator.translateText("Waiting for the probe to pick it up.") || "",
    };
  }

  if (status === PacketCaptureStatus.Running) {
    if (capture.stopRequestedAt) {
      return {
        label: label,
        tone: "active",
        detail:
          translator.translateText("Stopping and uploading the file…") || "",
      };
    }

    const startedAt: Date | undefined = capture.startedAt
      ? new Date(capture.startedAt)
      : undefined;

    const elapsed: number = startedAt
      ? Math.min(
          capture.maxDurationInSeconds,
          (now.getTime() - startedAt.getTime()) / 1000,
        )
      : 0;

    return {
      label: label,
      tone: "active",
      detail: translator.translateTemplate("Capturing · {{elapsed}} of {{total}}", {
        elapsed: formatClock(elapsed),
        total: formatClock(capture.maxDurationInSeconds),
      }),
    };
  }

  if (status === PacketCaptureStatus.Failed) {
    return {
      label: label,
      tone: "danger",
      detail:
        capture.statusMessage ||
        translator.translateText("The probe could not run this capture.") ||
        "",
    };
  }

  const packetCount: number = capture.packetCount || 0;
  const endReason: string | undefined = describeEndReason(capture, translator);
  const toolNote: string | undefined =
    capture.endReason === PacketCaptureEndReason.CaptureToolStopped &&
    capture.statusMessage
      ? capture.statusMessage
      : undefined;

  if (packetCount === 0) {
    return {
      label: label,
      tone: "success",
      detail:
        translator.translateText("No packets matched the filter.") || "",
      note: [endReason, toolNote]
        .filter((part: string | undefined): boolean => {
          return Boolean(part);
        })
        .join(" "),
    };
  }

  return {
    label: label,
    tone: "success",
    detail: translator.translatePlural(
      {
        one: "{{count}} packet · {{size}}",
        other: "{{count}} packets · {{size}}",
      },
      packetCount,
      {
        size: formatBytes(capture.fileSizeInBytes || 0, translator),
      },
    ),
    note: [endReason, toolNote]
      .filter((part: string | undefined): boolean => {
        return Boolean(part);
      })
      .join(" "),
  };
}

// Whether a capture can be downloaded: it finished with packets in its file.
export function canDownloadCapture(capture: CaptureView): boolean {
  return (
    capture.status === PacketCaptureStatus.Completed &&
    (capture.packetCount || 0) > 0
  );
}

// Whether a capture can be stopped: it is running and nobody asked yet.
export function canStopCapture(capture: CaptureView): boolean {
  return (
    capture.status === PacketCaptureStatus.Running && !capture.stopRequestedAt
  );
}

// Whether the list should keep re-reading: something is still in progress.
export function hasActiveCapture(captures: Array<CaptureView>): boolean {
  return captures.some((capture: CaptureView): boolean => {
    return PacketCaptureStatusUtil.isActive(capture.status);
  });
}

/*
 * The limits the Start form opens with on a probe: the defaults, lowered to
 * what the probe allows.
 */
export function getDefaultLimits(
  capability: PacketCaptureCapability | null | undefined,
): PacketCaptureLimits {
  const maximums: PacketCaptureLimits = PacketCaptureLimitsUtil.getMaximums(
    capability?.limits,
  );

  return {
    maxDurationInSeconds: Math.min(
      DEFAULT_PACKET_CAPTURE_LIMITS.maxDurationInSeconds,
      maximums.maxDurationInSeconds,
    ),
    maxPackets: Math.min(
      DEFAULT_PACKET_CAPTURE_LIMITS.maxPackets,
      maximums.maxPackets,
    ),
    maxFileSizeInMB: Math.min(
      DEFAULT_PACKET_CAPTURE_LIMITS.maxFileSizeInMB,
      maximums.maxFileSizeInMB,
    ),
  };
}

/*
 * Turns a download's base64 back into bytes for the browser to save,
 * without a regular expression or a string per byte: the file is up to 25 MB.
 */
export function decodeDownload(base64: string): Uint8Array {
  const binary: string = atob(base64);
  const bytes: Uint8Array = new Uint8Array(binary.length);

  for (let index: number = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
