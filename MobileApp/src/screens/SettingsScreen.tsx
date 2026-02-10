import React from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { useTheme } from "../theme";
import { useAuth } from "../hooks/useAuth";
import { useProject } from "../hooks/useProject";

const APP_VERSION = "1.0.0";

export default function SettingsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { logout } = useAuth();
  const { selectedProject, clearProject } = useProject();

  const appVersion = APP_VERSION;

  const handleChangeProject = async (): Promise<void> => {
    await clearProject();
  };

  return (
    <ScrollView
      style={[{ backgroundColor: theme.colors.backgroundPrimary }]}
      contentContainerStyle={styles.content}
    >
      {/* Current Project */}
      {selectedProject ? (
        <View style={styles.section}>
          <Text
            style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
          >
            Current Project
          </Text>
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.backgroundSecondary,
                borderColor: theme.colors.borderSubtle,
              },
            ]}
          >
            <Text
              style={[
                theme.typography.bodyLarge,
                { color: theme.colors.textPrimary, fontWeight: "600" },
              ]}
            >
              {selectedProject.name}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.button,
              {
                backgroundColor: theme.colors.backgroundTertiary,
                marginTop: 12,
              },
            ]}
            onPress={handleChangeProject}
          >
            <Text
              style={[
                theme.typography.bodyMedium,
                { color: theme.colors.textPrimary, fontWeight: "600" },
              ]}
            >
              Change Project
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Account */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          Account
        </Text>
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: theme.colors.actionDestructive },
          ]}
          onPress={logout}
        >
          <Text
            style={[
              theme.typography.bodyMedium,
              { color: theme.colors.textInverse, fontWeight: "600" },
            ]}
          >
            Log Out
          </Text>
        </TouchableOpacity>
      </View>

      {/* App Info */}
      <View style={styles.section}>
        <Text
          style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}
        >
          About
        </Text>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              borderColor: theme.colors.borderSubtle,
            },
          ]}
        >
          <View style={styles.infoRow}>
            <Text
              style={[
                theme.typography.bodyMedium,
                { color: theme.colors.textTertiary },
              ]}
            >
              Version
            </Text>
            <Text
              style={[
                theme.typography.bodyMedium,
                { color: theme.colors.textPrimary },
              ]}
            >
              {appVersion}
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  button: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
});
