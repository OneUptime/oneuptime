import PushDeviceType from "./PushDeviceType";
import PushNotificationMessage from "./PushNotificationMessage";

interface PushNotificationRequest {
  devices: Array<{
    token: string;
    name?: string;
  }>;
  /*
   * The same shape PushNotificationUtil builds, referenced rather than
   * restated: this used to be a copy of every field in PushNotificationMessage,
   * and a copy is a place for a newly added field to go missing on the way to
   * the sender.
   */
  message: PushNotificationMessage;
  deviceType: PushDeviceType;
}

export default PushNotificationRequest;
