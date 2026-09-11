import { Platform } from "react-native";

interface ToggleAccessibilityProps {
  accessibilityState: { selected: boolean };
  "aria-pressed"?: boolean;
}

/** Buttons use pressed semantics on web; native controls retain selected state. */
export default function getToggleAccessibilityProps(
  selected: boolean,
  platform: typeof Platform.OS = Platform.OS,
): ToggleAccessibilityProps {
  return {
    accessibilityState: { selected },
    ...(platform === "web" ? { "aria-pressed": selected } : {}),
  };
}
