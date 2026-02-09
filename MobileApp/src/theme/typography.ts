import { Platform, TextStyle } from "react-native";

const fontFamily: string = Platform.OS === "ios" ? "System" : "Roboto";
const monoFontFamily: string = Platform.OS === "ios" ? "Menlo" : "monospace";

interface TypographyStyles {
  titleLarge: TextStyle;
  titleMedium: TextStyle;
  titleSmall: TextStyle;
  bodyLarge: TextStyle;
  bodyMedium: TextStyle;
  bodySmall: TextStyle;
  monoLarge: TextStyle;
  monoMedium: TextStyle;
  monoSmall: TextStyle;
  label: TextStyle;
  caption: TextStyle;
}

export const typography: TypographyStyles = {
  titleLarge: {
    fontFamily,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  titleMedium: {
    fontFamily,
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 28,
  },
  titleSmall: {
    fontFamily,
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
  },
  bodyLarge: {
    fontFamily,
    fontSize: 17,
    fontWeight: "400",
    lineHeight: 24,
  },
  bodyMedium: {
    fontFamily,
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 20,
  },
  bodySmall: {
    fontFamily,
    fontSize: 13,
    fontWeight: "400",
    lineHeight: 18,
  },
  monoLarge: {
    fontFamily: monoFontFamily,
    fontSize: 17,
    fontWeight: "400",
    lineHeight: 24,
  },
  monoMedium: {
    fontFamily: monoFontFamily,
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 20,
  },
  monoSmall: {
    fontFamily: monoFontFamily,
    fontSize: 13,
    fontWeight: "400",
    lineHeight: 18,
  },
  label: {
    fontFamily,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  caption: {
    fontFamily,
    fontSize: 12,
    fontWeight: "400",
    lineHeight: 16,
  },
};

export default typography;
