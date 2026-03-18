import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../theme";
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
  valueColor?: string;
}

function InfoRow({
  label,
  value,
  iconName,
  valueColor,
}: InfoRowProps): React.JSX.Element {
  const { theme } = useTheme();
  const displayValue: string = toDisplayString(value);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        paddingHorizontal: 14,
      }}
    >
      <Ionicons
        name={iconName}
        size={15}
        color={theme.colors.textTertiary}
        style={{ marginRight: 10, width: 18, textAlign: "center" }}
      />
      <Text
        style={{
          fontSize: 12,
          fontWeight: "600",
          color: theme.colors.textTertiary,
          width: 100,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: 13,
          fontWeight: "500",
          color: valueColor ?? theme.colors.textPrimary,
          flex: 1,
        }}
        numberOfLines={2}
      >
        {displayValue}
      </Text>
    </View>
  );
}

function MetricCard({
  label,
  value,
  unit,
  iconName,
  accentColor,
}: {
  label: string;
  value: string;
  unit?: string;
  iconName: keyof typeof Ionicons.glyphMap;
  accentColor: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        paddingVertical: 12,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: accentColor + "14",
          marginBottom: 6,
        }}
      >
        <Ionicons name={iconName} size={14} color={accentColor} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <Text
          style={{
            fontSize: 18,
            fontWeight: "bold",
            color: theme.colors.textPrimary,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
        {unit ? (
          <Text
            style={{
              fontSize: 10,
              fontWeight: "600",
              color: theme.colors.textTertiary,
              marginLeft: 2,
            }}
          >
            {unit}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontSize: 10,
          fontWeight: "600",
          color: theme.colors.textTertiary,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function Divider(): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: theme.colors.borderSubtle,
        marginHorizontal: 14,
      }}
    />
  );
}

function VerticalDivider(): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width: 1,
        marginVertical: 10,
        backgroundColor: theme.colors.borderSubtle,
      }}
    />
  );
}

function getStatusCodeColor(
  code: number,
  theme: ReturnType<typeof useTheme>["theme"],
): string {
  if (code >= 200 && code < 300) {
    return theme.colors.oncallActive;
  }
  if (code >= 300 && code < 400) {
    return theme.colors.severityWarning;
  }
  return theme.colors.severityCritical;
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

function WebsiteApiSummary({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element {
  const { theme } = useTheme();
  const statusColor: string = response.responseCode
    ? getStatusCodeColor(response.responseCode, theme)
    : theme.colors.textTertiary;

  return (
    <View>
      {/* Metrics row */}
      <View style={{ flexDirection: "row" }}>
        {response.responseCode !== undefined ? (
          <MetricCard
            label="Status Code"
            value={response.responseCode.toString()}
            iconName="code-outline"
            accentColor={statusColor}
          />
        ) : null}
        {response.responseTimeInMs !== undefined ? (
          <>
            <VerticalDivider />
            <MetricCard
              label="Response Time"
              value={formatMs(response.responseTimeInMs)}
              unit={formatMsUnit(response.responseTimeInMs)}
              iconName="speedometer-outline"
              accentColor={theme.colors.actionPrimary}
            />
          </>
        ) : null}
        <VerticalDivider />
        <MetricCard
          label="Status"
          value={response.isOnline ? "Online" : "Offline"}
          iconName={
            response.isOnline
              ? "checkmark-circle-outline"
              : "close-circle-outline"
          }
          accentColor={
            response.isOnline
              ? theme.colors.oncallActive
              : theme.colors.severityCritical
          }
        />
      </View>

      {/* Detail rows */}
      {response.monitorDestination ? (
        <>
          <Divider />
          <InfoRow
            label="URL"
            value={response.monitorDestination}
            iconName="globe-outline"
          />
        </>
      ) : null}
      {response.monitoredAt ? (
        <>
          <Divider />
          <InfoRow
            label="Monitored At"
            value={formatDate(response.monitoredAt)}
            iconName="time-outline"
          />
        </>
      ) : null}
      {response.failureCause ? (
        <>
          <Divider />
          <InfoRow
            label="Error"
            value={response.failureCause}
            iconName="alert-circle-outline"
            valueColor={theme.colors.severityCritical}
          />
        </>
      ) : null}
    </View>
  );
}

function PingSummary({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        <MetricCard
          label="Status"
          value={response.isOnline ? "Online" : "Offline"}
          iconName={
            response.isOnline
              ? "checkmark-circle-outline"
              : "close-circle-outline"
          }
          accentColor={
            response.isOnline
              ? theme.colors.oncallActive
              : theme.colors.severityCritical
          }
        />
        {response.responseTimeInMs !== undefined ? (
          <>
            <VerticalDivider />
            <MetricCard
              label="Response Time"
              value={formatMs(response.responseTimeInMs)}
              unit={formatMsUnit(response.responseTimeInMs)}
              iconName="speedometer-outline"
              accentColor={theme.colors.actionPrimary}
            />
          </>
        ) : null}
      </View>

      {response.monitorDestination ? (
        <>
          <Divider />
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
        </>
      ) : null}
      {response.monitoredAt ? (
        <>
          <Divider />
          <InfoRow
            label="Monitored At"
            value={formatDate(response.monitoredAt)}
            iconName="time-outline"
          />
        </>
      ) : null}
      {response.failureCause ? (
        <>
          <Divider />
          <InfoRow
            label="Error"
            value={response.failureCause}
            iconName="alert-circle-outline"
            valueColor={theme.colors.severityCritical}
          />
        </>
      ) : null}
    </View>
  );
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
  const disk: number | undefined =
    response.basicInfrastructureMetrics?.diskMetrics?.[0]?.percentUsed;

  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        <MetricCard
          label="CPU"
          value={cpu !== undefined ? Math.round(cpu).toString() : "--"}
          unit="%"
          iconName="hardware-chip-outline"
          accentColor={
            cpu !== undefined && cpu > 80
              ? theme.colors.severityCritical
              : theme.colors.actionPrimary
          }
        />
        <VerticalDivider />
        <MetricCard
          label="Memory"
          value={mem !== undefined ? Math.round(mem).toString() : "--"}
          unit="%"
          iconName="bar-chart-outline"
          accentColor={
            mem !== undefined && mem > 80
              ? theme.colors.severityCritical
              : theme.colors.severityWarning
          }
        />
        <VerticalDivider />
        <MetricCard
          label="Disk"
          value={disk !== undefined ? Math.round(disk).toString() : "--"}
          unit="%"
          iconName="disc-outline"
          accentColor={
            disk !== undefined && disk > 80
              ? theme.colors.severityCritical
              : theme.colors.oncallActive
          }
        />
      </View>

      {response.hostname ? (
        <>
          <Divider />
          <InfoRow
            label="Hostname"
            value={response.hostname}
            iconName="server-outline"
          />
        </>
      ) : null}
      {response.monitoredAt ? (
        <>
          <Divider />
          <InfoRow
            label="Last Ping"
            value={formatDate(response.monitoredAt)}
            iconName="time-outline"
          />
        </>
      ) : null}
      {response.failureCause ? (
        <>
          <Divider />
          <InfoRow
            label="Error"
            value={response.failureCause}
            iconName="alert-circle-outline"
            valueColor={theme.colors.severityCritical}
          />
        </>
      ) : null}
    </View>
  );
}

function GenericSummary({
  response,
}: {
  response: ProbeMonitorResponse;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        <MetricCard
          label="Status"
          value={response.isOnline ? "Online" : "Offline"}
          iconName={
            response.isOnline
              ? "checkmark-circle-outline"
              : "close-circle-outline"
          }
          accentColor={
            response.isOnline
              ? theme.colors.oncallActive
              : theme.colors.severityCritical
          }
        />
        {response.responseTimeInMs !== undefined ? (
          <>
            <VerticalDivider />
            <MetricCard
              label="Response Time"
              value={formatMs(response.responseTimeInMs)}
              unit={formatMsUnit(response.responseTimeInMs)}
              iconName="speedometer-outline"
              accentColor={theme.colors.actionPrimary}
            />
          </>
        ) : null}
      </View>
      {response.monitoredAt ? (
        <>
          <Divider />
          <InfoRow
            label="Monitored At"
            value={formatDate(response.monitoredAt)}
            iconName="time-outline"
          />
        </>
      ) : null}
      {response.failureCause ? (
        <>
          <Divider />
          <InfoRow
            label="Error"
            value={response.failureCause}
            iconName="alert-circle-outline"
            valueColor={theme.colors.severityCritical}
          />
        </>
      ) : null}
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
    <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {probeItems.map((probe: MonitorProbeItem, index: number) => {
          const isSelected: boolean = index === selectedIndex;
          return (
            <TouchableOpacity
              key={probe._id}
              activeOpacity={0.7}
              onPress={() => {
                onSelect(index);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 20,
                backgroundColor: isSelected
                  ? theme.colors.actionPrimary + "1A"
                  : theme.colors.backgroundTertiary,
                borderWidth: 1,
                borderColor: isSelected
                  ? theme.colors.actionPrimary + "44"
                  : theme.colors.borderSubtle,
              }}
            >
              <Ionicons
                name="radio-outline"
                size={12}
                color={
                  isSelected
                    ? theme.colors.actionPrimary
                    : theme.colors.textTertiary
                }
                style={{ marginRight: 5 }}
              />
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: isSelected ? "700" : "500",
                  color: isSelected
                    ? theme.colors.actionPrimary
                    : theme.colors.textSecondary,
                }}
              >
                {getProbeName(probe, index)}
              </Text>
            </TouchableOpacity>
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
        <View style={{ padding: 20, alignItems: "center" }}>
          <Ionicons
            name="analytics-outline"
            size={24}
            color={theme.colors.textTertiary}
            style={{ marginBottom: 8 }}
          />
          <Text
            style={{
              fontSize: 13,
              color: theme.colors.textSecondary,
              textAlign: "center",
            }}
          >
            No monitoring data available yet.
          </Text>
        </View>
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
      style={{
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: theme.colors.backgroundElevated,
        borderWidth: 1,
        borderColor: theme.colors.borderGlass,
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
