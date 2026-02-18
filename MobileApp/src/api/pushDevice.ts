import { Platform } from "react-native";
import * as Device from "expo-device";
import apiClient from "./client";
import logger from "../utils/logger";

export async function registerPushDevice(params: {
  deviceToken: string;
  projectId: string;
}): Promise<void> {
  const deviceType: string =
    Platform.OS === "ios"
      ? "ios"
      : Platform.OS === "android"
        ? "android"
        : "web";

  try {
    await apiClient.post("/api/user-push/register", {
      deviceToken: params.deviceToken,
      deviceType: deviceType,
      deviceName: Device.modelName || "Unknown Device",
      projectId: params.projectId,
    });
    logger.info(
      `[PushNotifications] Device registered successfully for project ${params.projectId}`,
    );
  } catch (error: unknown) {
    const status: number | undefined = (
      error as { response?: { status?: number } }
    )?.response?.status;
    const message: string =
      (error as { response?: { data?: { message?: string } } })?.response?.data
        ?.message || String(error);

    // Treat "already registered" as success
    if (status === 400 && message.includes("already registered")) {
      logger.info(
        `[PushNotifications] Device already registered for project ${params.projectId}`,
      );
      return;
    }

    // Log and re-throw other errors
    logger.error(
      `[PushNotifications] Registration failed (status=${status}): ${message}`,
    );
    throw error;
  }
}

export async function unregisterPushDevice(deviceToken: string): Promise<void> {
  try {
    await apiClient.post("/api/user-push/unregister", {
      deviceToken: deviceToken,
    });
  } catch {
    // Best-effort: don't block logout on failure
  }
}
