import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, type Theme } from "../theme";
import { elevation, radius, spacing } from "../theme/tokens";
import getToggleAccessibilityProps from "../utils/getToggleAccessibilityProps";
import AppText from "./AppText";
import EmptyState from "./EmptyState";
import IconBadge from "./IconBadge";
import type { ProbeMonitorResponse, MonitorProbeItem } from "../api/monitors";

/** Safely convert any value to a displayable string */
function toDisplayString(val: unknown): string {
  if (val === null || val === undefined) {
    return "--";
  }
  if (typeof val === "string") {
    return val;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (typeof val === "object") {
    // Handle OneUptime typed objects like URL { _type, value }
    const obj: Record<string, unknown> = val as Record<string, unknown>;
    if (typeof obj.value === "string") {
      return obj.value;
    }
    if (
      typeof obj.toString === "function" &&
      obj.toString !== Object.prototype.toString
    ) {
      return obj.toString();
    }
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

interface InfoRowProps {
  label: string;
  value: unknown;
  iconName: keyof typeof Ionicons.glyphMap;
  /** A failure reason reads in the error colour. */
  tone?: "default" | "danger";
}

/*
 * A labelled fact under the metrics. Rows are separated by a hairline above
 * each one, which also draws the line between the metric grid and the first
 * row, and each row is read out as a single "label: value" element.
 */
function InfoRow({
  label,
  value,
  iconName,
  tone = "default",
}: InfoRowProps): React.JSX.Element {
  const { theme } = useTheme();
  const displayValue: string = toDisplayString(value);
  const danger: boolean = tone === "danger";
  return (
    <View
      testID="monitor-summary-info-row"
      accessible
      accessibilityLabel={`${label}: ${displayValue}`}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        borderTopWidth: 1,
        borderTopColor: theme.colors.borderSubtle,
      }}
    >
      <Ionicons
        name={iconName}
        size={16}
        color={danger ? theme.colors.statusError : theme.colors.textTertiary}
        style={{ width: 18, textAlign: "center", marginTop: 2 }}
      />
      <AppText
        variant="subhead"
        tone="secondary"
        style={{ width: 96, flexShrink: 0 }}
      >
        {label}
      </AppText>
      <AppText
        variant="subhead"
        weight={danger ? "600" : "500"}
        color={danger ? theme.colors.statusError : theme.colors.textPrimary}
        style={{ flex: 1 }}
        numberOfLines={danger ? 4 : 2}
      >
        {displayValue}
      </AppText>
    </View>
  );
}

interface MetricTileProps {
  label: string;
  value: string;
  unit?: string;
  iconName: keyof typeof Ionicons.glyphMap;
  accentColor: string;
  /** Colour for the figure itself; the icon always takes the accent. */
  valueColor?: string;
  /** A 0-100 reading drawn as a usage bar under the figure. */
  percent?: number;
}

function spokenMetric(label: string, value: string, unit?: string): string {
  if (value === "--") {
    return `${label}: not reported`;
  }
  if (!unit) {
    return `${label}: ${value}`;
  }
  return unit === "%" ? `${label}: ${value}%` : `${label}: ${value} ${unit}`;
}

/** One measurement: an icon, the figure with its unit, and what it measures. */
function MetricTile({
  label,
  value,
  unit,
  iconName,
  accentColor,
  valueColor,
  percent,
}: MetricTileProps): React.JSX.Element {
  const { theme } = useTheme();
  const barPercent: number | undefined =
    percent === undefined || Number.isNaN(percent)
      ? undefined
      : Math.max(0, Math.min(100, percent));

  return (
    <View
      testID="monitor-metric-tile"
      accessible
      accessibilityLabel={spokenMetric(label, value, unit)}
      style={{
        flexGrow: 1,
        gap: spacing.xxs,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: theme.colors.backgroundPrimary,
      }}
    >
      <View style={{ marginBottom: spacing.sm }}>
        <IconBadge name={iconName} color={accentColor} size="sm" />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          flexWrap: "wrap",
          columnGap: spacing.xxs,
        }}
      >
        <AppText
          variant="title3"
          weight="700"
          color={valueColor ?? theme.colors.textPrimary}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {value}
        </AppText>
        {unit ? (
          <AppText variant="caption" tone="secondary">
            {unit}
          </AppText>
        ) : null}
      </View>
      <AppText variant="caption" tone="secondary" numberOfLines={2}>
        {label}
      </AppText>
      {barPercent !== undefined ? (
        <View
          testID="monitor-metric-bar"
          style={{
            height: 4,
            marginTop: spacing.sm,
            borderRadius: radius.pill,
            overflow: "hidden",
            backgroundColor: theme.colors.borderSubtle,
          }}
        >
          <View
            testID="monitor-metric-bar-fill"
            style={{
              width: `${barPercent}%`,
              height: "100%",
              borderRadius: radius.pill,
              backgroundColor: accentColor,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/*
 * Metrics flow in a wrapping grid rather than one squeezed row, so a server
 * with several volumes gets readable tiles instead of slivers. Four tiles sit
 * two by two; anything else fills up to three to a row.
 */
function MetricGrid({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const items: React.ReactNode[] =
    React.Children.toArray(children).filter(Boolean);
  const columns: number =
    items.length === 4 ? 2 : Math.max(1, Math.min(items.length, 3));
  const basis: ViewStyle["flexBasis"] =
    columns === 1 ? "100%" : columns === 2 ? "45%" : "30%";

  return (
    <View
      testID="monitor-metric-grid"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: spacing.sm,
        padding: spacing.lg,
      }}
    >
      {items.map((item: React.ReactNode, index: number) => {
        const key: React.Key =
          React.isValidElement(item) && item.key !== null ? item.key : index;
        return (
          <View
            key={key}
            testID="monitor-metric-cell"
            style={{ flexGrow: 1, flexBasis: basis, minWidth: 96 }}
          >
            {item}
          </View>
        );
      })}
    </View>
  );
}

function getStatusCodeColor(code: number, theme: Theme): string {
  if (code >= 200 && code < 300) {
    return theme.colors.statusSuccess;
  }
  if (code >= 300 && code < 400) {
    return theme.colors.statusWarning;
  }
  return theme.colors.statusError;
}

/** High usage is the reading a responder is looking for, so it turns red. */
function getUsageColor(
  used: number | undefined,
  theme: Theme,
  normal: string,
): string {
  return used !== undefined && used > 80 ? theme.colors.statusError : normal;
}

function formatMs(ms: number): string {
  if (ms < 1000) {
    return Math.round(ms).toString();
  }
  return (ms / 1000).toFixed(2);
}

function formatMsUnit(ms: number): string {
  return ms < 1000 ? "ms" : "s";
}

function formatDate(dateVal?: unknown): string {
  if (!dateVal) {
    return "--";
  }
  const str: string = toDisplayString(dateVal);
  if (str === "--") {
    return "--";
  }
  try {
    const d: Date = new Date(str);
    if (isNaN(d.getTime())) {
      return str;
    }
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return str;
  }
}

function StatusTile({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element {
  const { theme } = useTheme();
  const color: string = response.isOnline
    ? theme.colors.statusSuccess
    : theme.colors.statusError;
  return (
    <MetricTile
      label="Status"
      value={response.isOnline ? "Online" : "Offline"}
      iconName={response.isOnline ? "checkmark-circle" : "close-circle"}
      accentColor={color}
      valueColor={color}
    />
  );
}

function ResponseTimeTile({ ms }: { ms: number }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <MetricTile
      label="Response Time"
      value={formatMs(ms)}
      unit={formatMsUnit(ms)}
      iconName="speedometer-outline"
      accentColor={theme.colors.actionPrimary}
    />
  );
}

function MonitoredAtRow({
  response,
  label = "Monitored At",
}: {
  response: ProbeMonitorResponse;
  label?: string;
}): React.JSX.Element | null {
  if (!response.monitoredAt) {
    return null;
  }
  return (
    <InfoRow
      label={label}
      value={formatDate(response.monitoredAt)}
      iconName="time-outline"
    />
  );
}

function FailureRow({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element | null {
  if (!response.failureCause) {
    return null;
  }
  return (
    <InfoRow
      label="Error"
      value={response.failureCause}
      iconName="alert-circle-outline"
      tone="danger"
    />
  );
}

function WebsiteApiSummary({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View>
      <MetricGrid>
        <StatusTile key="status" response={response} />
        {response.responseCode !== undefined ? (
          <MetricTile
            key="status-code"
            label="Status Code"
            value={response.responseCode.toString()}
            iconName="code-slash-outline"
            accentColor={getStatusCodeColor(response.responseCode, theme)}
          />
        ) : null}
        {response.responseTimeInMs !== undefined ? (
          <ResponseTimeTile
            key="response-time"
            ms={response.responseTimeInMs}
          />
        ) : null}
      </MetricGrid>

      {response.monitorDestination ? (
        <InfoRow
          label="URL"
          value={response.monitorDestination}
          iconName="globe-outline"
        />
      ) : null}
      <MonitoredAtRow response={response} />
      <FailureRow response={response} />
    </View>
  );
}

function PingSummary({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element {
  return (
    <View>
      <MetricGrid>
        <StatusTile key="status" response={response} />
        {response.responseTimeInMs !== undefined ? (
          <ResponseTimeTile
            key="response-time"
            ms={response.responseTimeInMs}
          />
        ) : null}
      </MetricGrid>

      {response.monitorDestination ? (
        <InfoRow
          label="Host"
          value={
            toDisplayString(response.monitorDestination) +
            (response.monitorDestinationPort
              ? `:${response.monitorDestinationPort}`
              : "")
          }
          iconName="server-outline"
        />
      ) : null}
      <MonitoredAtRow response={response} />
      <FailureRow response={response} />
    </View>
  );
}

type DiskMetric = NonNullable<
  NonNullable<ProbeMonitorResponse["basicInfrastructureMetrics"]>["diskMetrics"]
>[number];

/**
 * What to call a volume on its metric card.
 *
 * The mount point is what a responder needs - "/var is full" is actionable,
 * "Disk 2 is full" sends them looking. Only when the probe did not report one
 * do we fall back to a position, and only when there is more than one volume,
 * so the single-disk server that has always just said "Disk" still does.
 */
function getDiskLabel(
  diskMetric: DiskMetric,
  index: number,
  total: number,
): string {
  if (diskMetric.diskPath) {
    return diskMetric.diskPath;
  }
  if (total > 1) {
    return `Disk ${index + 1}`;
  }
  return "Disk";
}

function ServerSummary({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element {
  const { theme } = useTheme();
  const cpu: number | undefined =
    response.basicInfrastructureMetrics?.cpuMetrics?.percentUsed;
  const mem: number | undefined =
    response.basicInfrastructureMetrics?.memoryMetrics?.percentUsed;
  /*
   * A server agent reports one entry per mounted volume, and this used to read
   * `diskMetrics[0]` and nothing else. A box whose root volume is quiet and
   * whose /var is at 99% therefore summarised as healthy - which is exactly
   * the box a responder had just been paged about, so the one screen they
   * opened to confirm the page contradicted it. Every volume gets its own
   * card, in the order the probe reported them.
   */
  const disks: DiskMetric[] =
    response.basicInfrastructureMetrics?.diskMetrics ?? [];

  const cpuColor: string = getUsageColor(
    cpu,
    theme,
    theme.colors.actionPrimary,
  );
  const memColor: string = getUsageColor(mem, theme, theme.colors.accentCyan);

  return (
    <View>
      <MetricGrid>
        <MetricTile
          key="cpu"
          label="CPU"
          value={cpu !== undefined ? Math.round(cpu).toString() : "--"}
          unit="%"
          iconName="hardware-chip-outline"
          accentColor={cpuColor}
          valueColor={cpu !== undefined && cpu > 80 ? cpuColor : undefined}
          percent={cpu}
        />
        <MetricTile
          key="memory"
          label="Memory"
          value={mem !== undefined ? Math.round(mem).toString() : "--"}
          unit="%"
          iconName="bar-chart-outline"
          accentColor={memColor}
          valueColor={mem !== undefined && mem > 80 ? memColor : undefined}
          percent={mem}
        />
        {disks.length === 0 ? (
          <MetricTile
            key="disk"
            label="Disk"
            value="--"
            unit="%"
            iconName="disc-outline"
            accentColor={theme.colors.statusSuccess}
          />
        ) : (
          disks.map((diskMetric: DiskMetric, index: number) => {
            const used: number | undefined = diskMetric.percentUsed;
            const diskColor: string = getUsageColor(
              used,
              theme,
              theme.colors.statusSuccess,
            );
            return (
              <MetricTile
                key={diskMetric.diskPath ?? `disk-${index}`}
                label={getDiskLabel(diskMetric, index, disks.length)}
                value={used !== undefined ? Math.round(used).toString() : "--"}
                unit="%"
                iconName="disc-outline"
                accentColor={diskColor}
                valueColor={
                  used !== undefined && used > 80 ? diskColor : undefined
                }
                percent={used}
              />
            );
          })
        )}
      </MetricGrid>

      {response.hostname ? (
        <InfoRow
          label="Hostname"
          value={response.hostname}
          iconName="server-outline"
        />
      ) : null}
      <MonitoredAtRow response={response} label="Last Ping" />
      <FailureRow response={response} />
    </View>
  );
}

function GenericSummary({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element {
  return (
    <View>
      <MetricGrid>
        <StatusTile key="status" response={response} />
        {response.responseTimeInMs !== undefined ? (
          <ResponseTimeTile
            key="response-time"
            ms={response.responseTimeInMs}
          />
        ) : null}
      </MetricGrid>
      <MonitoredAtRow response={response} />
      <FailureRow response={response} />
    </View>
  );
}

function getProbeResponse(
  probe: MonitorProbeItem,
): ProbeMonitorResponse | null {
  const log: Record<string, ProbeMonitorResponse> | undefined =
    probe.lastMonitoringLog;
  if (!log) {
    return null;
  }
  const keys: string[] = Object.keys(log);
  if (keys.length > 0 && keys[0]) {
    return log[keys[0]] ?? null;
  }
  return null;
}

function getProbeName(probe: MonitorProbeItem, index: number): string {
  if (probe.probe?.name) {
    return probe.probe.name;
  }
  return `Probe ${index + 1}`;
}

function ProbePicker({
  probeItems,
  selectedIndex,
  onSelect,
}: {
  probeItems: MonitorProbeItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}): React.JSX.Element | null {
  const { theme } = useTheme();

  if (probeItems.length <= 1) {
    return null;
  }

  return (
    <View
      testID="monitor-probe-picker"
      style={{
        paddingTop: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <AppText
        variant="overline"
        tone="secondary"
        style={{ paddingHorizontal: spacing.lg }}
      >
        Probe location
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
        }}
      >
        {probeItems.map((probe: MonitorProbeItem, index: number) => {
          const isSelected: boolean = index === selectedIndex;
          const name: string = getProbeName(probe, index);
          return (
            <Pressable
              key={probe._id}
              testID={`monitor-probe-${index}`}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityHint="Shows the latest result from this probe"
              {...getToggleAccessibilityProps(isSelected)}
              hitSlop={4}
              onPress={() => {
                onSelect(index);
              }}
              style={({ pressed }: { pressed: boolean }): ViewStyle => {
                return {
                  minHeight: 40,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs + 2,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: isSelected
                    ? theme.colors.actionPrimary
                    : theme.colors.borderDefault,
                  backgroundColor: isSelected
                    ? theme.colors.cardAccent
                    : pressed
                      ? theme.colors.backgroundTertiary
                      : theme.colors.backgroundElevated,
                };
              }}
            >
              <Ionicons
                name={isSelected ? "radio-button-on" : "radio-button-off"}
                size={14}
                color={
                  isSelected
                    ? theme.colors.actionPrimary
                    : theme.colors.textTertiary
                }
              />
              <AppText
                variant="subhead"
                weight={isSelected ? "700" : "500"}
                color={
                  isSelected
                    ? theme.colors.actionPrimary
                    : theme.colors.textPrimary
                }
              >
                {name}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

interface MonitorSummaryViewProps {
  monitorType?: string;
  probeItems: MonitorProbeItem[];
}

export default function MonitorSummaryView({
  monitorType,
  probeItems,
}: MonitorSummaryViewProps): React.JSX.Element | null {
  const { theme } = useTheme();
  const [selectedProbeIndex, setSelectedProbeIndex] = useState(0);

  const hasMultipleProbes: boolean = probeItems.length > 1;

  const latestResponse: ProbeMonitorResponse | null = useMemo(() => {
    const safeIndex: number = Math.min(
      selectedProbeIndex,
      probeItems.length - 1,
    );
    const probe: MonitorProbeItem | undefined = probeItems[safeIndex];
    if (!probe) {
      return null;
    }
    return getProbeResponse(probe);
  }, [probeItems, selectedProbeIndex]);

  const renderContent: () => React.JSX.Element = (): React.JSX.Element => {
    if (!latestResponse) {
      return (
        <EmptyState
          compact
          icon="monitors"
          title="No monitoring data available yet."
          subtitle="Measurements appear here after a probe checks this monitor."
        />
      );
    }

    switch (monitorType) {
      case "Website":
      case "API":
      case "SSLCertificate":
        return <WebsiteApiSummary response={latestResponse} />;
      case "Ping":
      case "IP":
      case "Port":
      case "DNS":
      case "Domain":
        return <PingSummary response={latestResponse} />;
      case "Server":
        return <ServerSummary response={latestResponse} />;
      default:
        return <GenericSummary response={latestResponse} />;
    }
  };

  return (
    <View
      testID="monitor-summary-card"
      style={{
        borderRadius: radius.lg,
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderSubtle,
        ...elevation("card", theme.dark),
      }}
    >
      {hasMultipleProbes ? (
        <ProbePicker
          probeItems={probeItems}
          selectedIndex={selectedProbeIndex}
          onSelect={setSelectedProbeIndex}
        />
      ) : null}
      {renderContent()}
    </View>
  );
}
