import "react-native-get-random-values";
import React from "react";
import { Text, View } from "react-native";
import "./global.css";

export default function App(): React.ReactElement {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Text className="text-xl font-bold text-blue-500">
        Welcome to Nativewind!
      </Text>
    </View>
  );
}
