/*
 * Shared helpers for the Windows Services pages (list + detail view).
 *
 * The OTel `windowsservicereceiver` emits one `windows.service.status`
 * gauge per Windows service, with the service identity attached to the
 * *datapoint* (not the resource). OneUptime's metric ingest prefixes only
 * resource attributes with `resource.`, so the host identity lands as
 * `resource.host.name` (matching the Processes page) while the datapoint
 * attributes `name` and `startup_mode` are stored unprefixed.
 */
export const WINDOWS_SERVICE_METRIC_NAME: string = "windows.service.status";
export const SERVICE_NAME_ATTR: string = "name";
export const SERVICE_STARTUP_MODE_ATTR: string = "startup_mode";

export interface ServiceStatusMeta {
  label: string;
  dot: string;
  pill: string;
  // Plain CSS color for places Tailwind classes can't reach (facet dots).
  hex: string;
}

/*
 * The receiver records the raw Win32 Service Control Manager state
 * (SERVICE_STATUS.dwCurrentState, 1–7) as the gauge value. Map it to the
 * labels Windows' own Services console uses.
 */
export const statusMeta: (code: number | null) => ServiceStatusMeta = (
  code: number | null,
): ServiceStatusMeta => {
  switch (code) {
    case 4: // SERVICE_RUNNING
      return {
        label: "Running",
        dot: "bg-green-500",
        pill: "bg-green-50 text-green-700 ring-green-600/20",
        hex: "#22c55e",
      };
    case 1: // SERVICE_STOPPED
      return {
        label: "Stopped",
        dot: "bg-gray-400",
        pill: "bg-gray-50 text-gray-600 ring-gray-500/20",
        hex: "#9ca3af",
      };
    case 7: // SERVICE_PAUSED
      return {
        label: "Paused",
        dot: "bg-amber-500",
        pill: "bg-amber-50 text-amber-700 ring-amber-600/20",
        hex: "#f59e0b",
      };
    case 2: // SERVICE_START_PENDING
      return {
        label: "Start pending",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
        hex: "#3b82f6",
      };
    case 3: // SERVICE_STOP_PENDING
      return {
        label: "Stop pending",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
        hex: "#3b82f6",
      };
    case 5: // SERVICE_CONTINUE_PENDING
      return {
        label: "Continue pending",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
        hex: "#3b82f6",
      };
    case 6: // SERVICE_PAUSE_PENDING
      return {
        label: "Pause pending",
        dot: "bg-blue-500",
        pill: "bg-blue-50 text-blue-700 ring-blue-600/20",
        hex: "#3b82f6",
      };
    default:
      return {
        label: code === null ? "Unknown" : `Status ${code}`,
        dot: "bg-gray-300",
        pill: "bg-gray-50 text-gray-500 ring-gray-500/20",
        hex: "#d1d5db",
      };
  }
};

// The receiver emits the SCM startup mode; surface the Services-console wording.
export const startupModeLabel: (mode: string | null) => string = (
  mode: string | null,
): string => {
  switch (mode) {
    case "auto_start":
      return "Automatic";
    case "demand_start":
      return "Manual";
    case "disabled":
      return "Disabled";
    case "boot_start":
      return "Boot";
    case "system_start":
      return "System";
    default:
      return mode || "—";
  }
};

/*
 * Windows service names can contain characters a URL path segment (and
 * OneUptime's Route charset) rejects — spaces most commonly.
 * encodeURIComponent covers everything except `~`, which Route's
 * validation also rejects, so encode it explicitly.
 */
export const encodeServiceNameForUrl: (name: string) => string = (
  name: string,
): string => {
  return encodeURIComponent(name).replace(/~/g, "%7E");
};

export const decodeServiceNameFromUrl: (segment: string) => string = (
  segment: string,
): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Malformed escape sequence in the URL — fall back to the raw segment.
    return segment;
  }
};
