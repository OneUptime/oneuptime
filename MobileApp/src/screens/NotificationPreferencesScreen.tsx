import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Switch,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from "react-native";
import { useTheme } from "../theme";
import { useHaptics } from "../hooks/useHaptics";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreferences,
} from "../storage/preferences";

interface PrefRowProps {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

function PrefRow({
  label,
  description,
  value,
  onValueChange,
}: PrefRowProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.backgroundSecondary,
          borderColor: theme.colors.borderSubtle,
        },
      ]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={`${label}. ${description}`}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: theme.colors.textPrimary }]}>
          {label}
        </Text>
        <Text
          style={[styles.rowDescription, { color: theme.colors.textTertiary }]}
        >
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: theme.colors.backgroundTertiary,
          true: theme.colors.actionPrimary,
        }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export default function NotificationPreferencesScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { selectionFeedback } = useHaptics();
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    incidents: true,
    alerts: true,
    incidentEpisodes: true,
    alertEpisodes: true,
    criticalOnly: false,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getNotificationPreferences().then((p: NotificationPreferences) => {
      setPrefs(p);
      setLoaded(true);
    });
  }, []);

  const updatePref: (
    key: keyof NotificationPreferences,
    value: boolean,
  ) => void = useCallback(
    (key: keyof NotificationPreferences, value: boolean) => {
      selectionFeedback();
      const updated: NotificationPreferences = { ...prefs, [key]: value };
      setPrefs(updated);
      setNotificationPreferences(updated);
    },
    [prefs, selectionFeedback],
  );

  if (!loaded) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.backgroundPrimary },
        ]}
      />
    );
  }

  return (
    <ScrollView
      style={[{ backgroundColor: theme.colors.backgroundPrimary }]}
      contentContainerStyle={styles.content}
    >
      {/* Event Types */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          Event Types
        </Text>
        <Text
          style={[styles.sectionHint, { color: theme.colors.textTertiary }]}
        >
          Choose which event types send push notifications
        </Text>

        <View style={styles.rowGroup}>
          <PrefRow
            label="Incidents"
            description="New incidents and state changes"
            value={prefs.incidents}
            onValueChange={(v: boolean) => {
              return updatePref("incidents", v);
            }}
          />
          <PrefRow
            label="Alerts"
            description="New alerts and state changes"
            value={prefs.alerts}
            onValueChange={(v: boolean) => {
              return updatePref("alerts", v);
            }}
          />
          <PrefRow
            label="Incident Episodes"
            description="Grouped incident notifications"
            value={prefs.incidentEpisodes}
            onValueChange={(v: boolean) => {
              return updatePref("incidentEpisodes", v);
            }}
          />
          <PrefRow
            label="Alert Episodes"
            description="Grouped alert notifications"
            value={prefs.alertEpisodes}
            onValueChange={(v: boolean) => {
              return updatePref("alertEpisodes", v);
            }}
          />
        </View>
      </View>

      {/* Priority Filter */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          Priority
        </Text>

        <View style={styles.rowGroup}>
          <PrefRow
            label="Critical Only"
            description="Only receive notifications for critical and high severity events"
            value={prefs.criticalOnly}
            onValueChange={(v: boolean) => {
              return updatePref("criticalOnly", v);
            }}
          />
        </View>
      </View>

      {/* Info */}
      <View style={styles.infoSection}>
        <Text style={[styles.infoText, { color: theme.colors.textTertiary }]}>
          Notification preferences are stored locally on this device.
          Server-side notification rules configured in your project settings
          take precedence.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles: {
  container: ViewStyle;
  content: ViewStyle;
  section: ViewStyle;
  sectionTitle: TextStyle;
  sectionHint: TextStyle;
  rowGroup: ViewStyle;
  row: ViewStyle;
  rowText: ViewStyle;
  rowLabel: TextStyle;
  rowDescription: TextStyle;
  infoSection: ViewStyle;
  infoText: TextStyle;
} = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
    marginLeft: 4,
  },
  sectionHint: {
    fontSize: 12,
    marginBottom: 12,
    marginLeft: 4,
    lineHeight: 16,
  },
  rowGroup: {
    gap: 1,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  rowText: {
    flex: 1,
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  rowDescription: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  infoSection: {
    marginTop: 4,
    paddingHorizontal: 4,
  },
  infoText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
