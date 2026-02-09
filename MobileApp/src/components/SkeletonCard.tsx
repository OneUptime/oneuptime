import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, DimensionValue } from "react-native";
import { useTheme } from "../theme";

interface SkeletonCardProps {
  lines?: number;
}

export default function SkeletonCard({
  lines = 3,
}: SkeletonCardProps): React.JSX.Element {
  const { theme } = useTheme();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [opacity]);

  const lineWidths: DimensionValue[] = ["60%", "80%", "45%", "70%"];

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.backgroundSecondary,
          borderColor: theme.colors.borderSubtle,
          opacity,
        },
      ]}
    >
      <View
        style={[
          styles.titleLine,
          { backgroundColor: theme.colors.backgroundTertiary },
        ]}
      />
      {Array.from({ length: lines }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.line,
            {
              backgroundColor: theme.colors.backgroundTertiary,
              width: lineWidths[index % lineWidths.length],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  titleLine: {
    height: 16,
    borderRadius: 4,
    width: "40%",
    marginBottom: 16,
  },
  line: {
    height: 12,
    borderRadius: 4,
    marginBottom: 8,
  },
});
