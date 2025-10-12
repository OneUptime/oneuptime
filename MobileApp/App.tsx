import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import Styles from "./Styles";
import ObjectID from "@oneuptime/common/Types/ObjectID";

export default function App(): React.ReactElement {
  const [objectId, setObjectId] = useState<ObjectID | null>(null);

  useEffect(() => {
    const newObjectId: ObjectID = ObjectID.generate();
    setObjectId(newObjectId);
  }, []);

  return (
    <View style={Styles.container}>
      <Text style={Styles.title}>Welcome to OneUptime Mobile</Text>
      <Text style={Styles.subtitle}>Your monitoring app on the go</Text>
      {objectId && (
        <Text style={Styles.subtitle}>Generated Object ID: {objectId.toString()}</Text>
      )}
      <StatusBar style="auto" />
    </View>
  );
}
