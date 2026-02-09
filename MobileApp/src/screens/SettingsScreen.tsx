import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTheme } from "../theme";
import { useAuth } from "../hooks/useAuth";

export default function SettingsScreen(): React.JSX.Element {
  const { theme } = useTheme();
  const { logout } = useAuth();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.backgroundPrimary },
      ]}
    >
      <Text style={[theme.typography.titleMedium, { color: theme.colors.textPrimary }]}>
        Settings
      </Text>
      <TouchableOpacity
        style={[
          styles.logoutButton,
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutButton: {
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
});
