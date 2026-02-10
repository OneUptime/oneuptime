import PushDeviceType from "./PushDeviceType";

interface PushNotificationRequest {
  devices: Array<{
    token: string;
    name?: string;
  }>;
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
  deviceType: PushDeviceType;
}

export default PushNotificationRequest;
