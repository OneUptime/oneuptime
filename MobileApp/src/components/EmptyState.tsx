import React from "react";
import { View, Text } from "react-native";
import { useTheme } from "../theme";

type EmptyIcon = "incidents" | "alerts" | "episodes" | "notes" | "default";

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  icon?: EmptyIcon;
}

function EmptyIconView({
  icon,
  color,
}: {
  icon: EmptyIcon;
  color: string;
}): React.JSX.Element {
  if (icon === "incidents") {
    return (
      <View className="w-16 h-16 items-center justify-center">
        <View
          className="w-[44px] h-[52px] rounded-md items-center justify-center"
          style={{
            borderWidth: 1.5,
            borderColor: color,
            borderBottomLeftRadius: 22,
            borderBottomRightRadius: 22,
          }}
        >
          <View
            className="w-4 h-[3px] rounded-sm"
            style={{
              backgroundColor: color,
              transform: [{ rotate: "-45deg" }],
            }}
          />
        </View>
      </View>
    );
  }

  if (icon === "alerts") {
    return (
      <View className="w-16 h-16 items-center justify-center">
        <View
          className="w-9 h-9 items-center justify-end pb-1"
          style={{
            borderWidth: 1.5,
            borderColor: color,
            borderRadius: 18,
            borderBottomLeftRadius: 4,
            borderBottomRightRadius: 4,
          }}
        >
          <View
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        </View>
      </View>
    );
  }

  if (icon === "episodes") {
    return (
      <View className="w-16 h-16 items-center justify-center">
        <View
          className="w-10 h-8 rounded-lg absolute top-3"
          style={{ borderWidth: 1.5, borderColor: color }}
        />
        <View
          className="w-8 h-7 rounded-md absolute top-1.5"
          style={{ borderWidth: 1.5, borderColor: color, opacity: 0.4 }}
        />
      </View>
    );
  }

  return (
    <View className="w-16 h-16 items-center justify-center">
      <View
        className="w-12 h-12 rounded-full items-center justify-center"
        style={{ borderWidth: 1.5, borderColor: color }}
      >
        <View
          className="w-5 h-0.5 rounded-sm"
          style={{ backgroundColor: color }}
        />
      </View>
    </View>
  );
}

export default function EmptyState({
  title,
  subtitle,
  icon = "default",
}: EmptyStateProps): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <View className="flex-1 items-center justify-center px-10 py-20">
      <EmptyIconView icon={icon} color={theme.colors.textTertiary} />
      <Text className="text-title-sm text-text-primary text-center mt-5">
        {title}
      </Text>
      {subtitle ? (
        <Text className="text-body-md text-text-secondary text-center mt-2 leading-5">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
