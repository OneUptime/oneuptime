import { translationKey } from "../Translator";

/*
 * Whether a managed device is there, in one word, decided the same way
 * wherever it is shown: the device's row on Inventory > Managed Devices, its
 * card on its Inventory page, and the counts on its connection's row.
 *
 * WHY THE LAST CHECK-IN DECIDES ONLINE AND OFFLINE
 *
 * Esper keeps a state per device (EsperDeviceState) whose Online (1) and
 * Offline (60) Esper itself calls not accurate enough, and recommends the
 * device's last check-in instead: its heartbeat API's `status` is "1 if last
 * seen within 30 minutes, 0 otherwise", and its docs advise using the
 * timestamp. So a device is online when it checked in within
 * MANAGED_DEVICE_ONLINE_WINDOW_MINUTES, and offline - with how long since -
 * when it did not. The state still says what the check-in cannot: that the
 * device is being set up, was disabled or is being wiped. A device that left
 * the service altogether is Removed, whatever it said before.
 */

// The window Esper's own heartbeat status uses: within 30 minutes is online.
export const MANAGED_DEVICE_ONLINE_WINDOW_MINUTES: number = 30;

export enum ManagedDeviceStatus {
  Online = "online",
  Offline = "offline",
  // Being enrolled: Esper's provisioning and onboarding steps.
  Provisioning = "provisioning",
  // Esper's onboarding of the device failed.
  OnboardingFailed = "onboarding-failed",
  // Disabled in Esper: factory reset, or removed from the Esper console.
  Disabled = "disabled",
  // A factory reset started from the Esper console is in progress.
  Wiping = "wiping",
  // The device is no longer in the service's device list.
  Removed = "removed",
}

/*
 * Esper's device states (the `state` of a device, an integer), as its API
 * reference lists them.
 */
export enum EsperDeviceState {
  Unspecified = 0,
  Online = 1,
  Disabled = 20,
  BeginningProvisioning = 30,
  ConfiguringGooglePlay = 40,
  ApplyingPoliciesAndInstallingApps = 50,
  Offline = 60,
  FactoryResetInProgress = 70,
  OnboardingInProgress = 80,
  OnboardingFailed = 90,
  Onboarded = 100,
  AndroidForWorkAccountAdded = 110,
  AppsInstalled = 120,
  BrandingProcessed = 130,
  PermissionPolicyProcessed = 140,
  DevicePolicyProcessed = 150,
  DeviceSettingsProcessed = 160,
  SecurityPolicyProcessed = 170,
  PhonePolicyProcessed = 180,
  CustomSettingsProcessed = 190,
  Registered = 200,
}

// The states that are steps of setting a device up.
export const ESPER_PROVISIONING_STATES: ReadonlySet<number> = new Set<number>([
  EsperDeviceState.BeginningProvisioning,
  EsperDeviceState.ConfiguringGooglePlay,
  EsperDeviceState.ApplyingPoliciesAndInstallingApps,
  EsperDeviceState.OnboardingInProgress,
  EsperDeviceState.Onboarded,
  EsperDeviceState.AndroidForWorkAccountAdded,
  EsperDeviceState.AppsInstalled,
  EsperDeviceState.BrandingProcessed,
  EsperDeviceState.PermissionPolicyProcessed,
  EsperDeviceState.DevicePolicyProcessed,
  EsperDeviceState.DeviceSettingsProcessed,
  EsperDeviceState.SecurityPolicyProcessed,
  EsperDeviceState.PhonePolicyProcessed,
  EsperDeviceState.CustomSettingsProcessed,
  EsperDeviceState.Registered,
]);

export interface ManagedDeviceStatusInput {
  providerState?: number | undefined | null;
  lastCheckInAt?: Date | string | undefined | null;
  removedAt?: Date | string | undefined | null;
  now: Date;
}

function toTime(value: Date | string | undefined | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const time: number =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isNaN(time) ? undefined : time;
}

export function getManagedDeviceStatus(
  input: ManagedDeviceStatusInput,
): ManagedDeviceStatus {
  if (toTime(input.removedAt) !== undefined) {
    return ManagedDeviceStatus.Removed;
  }

  const state: number | undefined =
    typeof input.providerState === "number" ? input.providerState : undefined;

  if (state === EsperDeviceState.Disabled) {
    return ManagedDeviceStatus.Disabled;
  }

  if (state === EsperDeviceState.FactoryResetInProgress) {
    return ManagedDeviceStatus.Wiping;
  }

  if (state === EsperDeviceState.OnboardingFailed) {
    return ManagedDeviceStatus.OnboardingFailed;
  }

  if (state !== undefined && ESPER_PROVISIONING_STATES.has(state)) {
    return ManagedDeviceStatus.Provisioning;
  }

  const lastCheckIn: number | undefined = toTime(input.lastCheckInAt);

  if (lastCheckIn !== undefined) {
    const minutesSince: number =
      (input.now.getTime() - lastCheckIn) / (60 * 1000);

    return minutesSince <= MANAGED_DEVICE_ONLINE_WINDOW_MINUTES
      ? ManagedDeviceStatus.Online
      : ManagedDeviceStatus.Offline;
  }

  /*
   * No check-in is known (the device has not checked in for longer than a
   * read looks back, and its own heartbeat said nothing): Esper's state is
   * all there is.
   */
  return state === EsperDeviceState.Online
    ? ManagedDeviceStatus.Online
    : ManagedDeviceStatus.Offline;
}

/*
 * The status's name, as an English key translated where it is drawn, and
 * the tone of its pill: green for online, red for what went wrong (a device
 * that stopped checking in, an onboarding that failed), blue for a device
 * being set up, and grey for what someone chose (disabled, wiped, removed) -
 * never red (Docs/ux/README.md#side-menus).
 */
export const MANAGED_DEVICE_STATUS_LABELS: Readonly<
  Record<ManagedDeviceStatus, string>
> = {
  [ManagedDeviceStatus.Online]: translationKey("Online"),
  [ManagedDeviceStatus.Offline]: translationKey("Offline"),
  [ManagedDeviceStatus.Provisioning]: translationKey("Provisioning"),
  [ManagedDeviceStatus.OnboardingFailed]: translationKey("Onboarding Failed"),
  [ManagedDeviceStatus.Disabled]: translationKey("Disabled"),
  [ManagedDeviceStatus.Wiping]: translationKey("Factory Reset"),
  [ManagedDeviceStatus.Removed]: translationKey("Removed"),
};

export type ManagedDeviceStatusTone = "success" | "danger" | "info" | "paused";

export function getManagedDeviceStatusTone(
  status: ManagedDeviceStatus,
): ManagedDeviceStatusTone {
  switch (status) {
    case ManagedDeviceStatus.Online:
      return "success";
    case ManagedDeviceStatus.Offline:
    case ManagedDeviceStatus.OnboardingFailed:
      return "danger";
    case ManagedDeviceStatus.Provisioning:
      return "info";
    default:
      return "paused";
  }
}

// Whether a status is one a person should act on.
export function isManagedDeviceStatusAProblem(
  status: ManagedDeviceStatus,
): boolean {
  return (
    status === ManagedDeviceStatus.Offline ||
    status === ManagedDeviceStatus.OnboardingFailed
  );
}
