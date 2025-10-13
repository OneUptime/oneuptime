import { StyleSheet, ViewStyle, TextStyle } from "react-native";

type StylesType = {
  container: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
};

const Styles: StylesType = StyleSheet.create<StylesType>({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
});

export default Styles;