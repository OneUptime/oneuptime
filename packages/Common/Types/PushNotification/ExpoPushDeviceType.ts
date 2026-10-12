import PushDeviceType from "./PushDeviceType";

/*
 * The device types whose token is an Expo push token: the mobile app's
 * phones and tablets. A web device's token is a browser's push subscription
 * instead. The two are refused and renewed differently - Expo says a token
 * is gone with DeviceNotRegistered and the app renews it by registering
 * again, a browser's push service says so with 404/410 and the browser gets
 * a new subscription - so the server and the Dashboard both ask which kind a
 * device is.
 */
export const EXPO_PUSH_DEVICE_TYPES: ReadonlyArray<PushDeviceType> = [
  PushDeviceType.iOS,
  PushDeviceType.Android,
];

export function isExpoPushDeviceType(deviceType: unknown): boolean {
  return EXPO_PUSH_DEVICE_TYPES.includes(deviceType as PushDeviceType);
}
