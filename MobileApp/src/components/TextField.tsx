import React from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";

interface TextFieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string;
  style?: TextInputProps["style"];
}

export const TextField = React.forwardRef<TextInput, TextFieldProps>(
  (props: TextFieldProps, ref: React.Ref<TextInput>) => {
    const { label, error, style, ...rest } = props;

    return (
      <View style={styles.container}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          ref={ref}
          style={[styles.input, style]}
          placeholderTextColor="#9BA4B4"
          {...rest}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  },
);

TextField.displayName = "TextField";

const styles = StyleSheet.create({
  container: {
    width: "100%",
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#1F2937",
  },
  input: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
  },
  error: {
    color: "#DC2626",
    fontSize: 12,
    marginTop: 4,
  },
});
