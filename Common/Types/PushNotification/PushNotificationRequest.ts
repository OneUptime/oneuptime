interface PushNotificationRequest {
  deviceTokens: string[];
  message: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    data?: { [key: string]: any };
    tag?: string;
    requireInteraction?: boolean;
    actions?: Array<{
      action: string;
      title: string;
      icon?: string;
    }>;
    clickAction?: string;
    url?: string;
  };
  deviceType: "web" | "android" | "ios";
}

export default PushNotificationRequest;
