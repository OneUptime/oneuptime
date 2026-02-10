import { Platform } from "react-native";
import * as Device from "expo-device";
import apiClient from "./client";

export async function registerPushDevice(params: {
  deviceToken: string;
  projectId: string;
}): Promise<void> {
  const deviceType =
    Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web";

  try {
    await apiClient.post("/api/user-push/register", {
      deviceToken: params.deviceToken,
      deviceType: deviceType,
      deviceName: Device.modelName || "Unknown Device",
      projectId: params.projectId,
    });
  } catch (error: any) {
    // Treat "already registered" as success
    if (error?.response?.status === 400) {
      return;
    }
    throw error;
  }
}

export async function unregisterPushDevice(
  deviceToken: string,
): Promise<void> {
  try {
    await apiClient.post("/api/user-push/unregister", {
      deviceToken: deviceToken,
    });
  } catch {
    // Best-effort: don't block logout on failure
  }
}
