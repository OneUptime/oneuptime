/*
 * Where a connection test a person started from the dashboard stands.
 */
enum StorageArrayConnectionTestStatus {
  // Started from the dashboard; waiting for its probe's next work request.
  Pending = "Pending",
  // The probe took it and is connecting.
  Running = "Running",
  Succeeded = "Succeeded",
  // errorCode and errorMessage say why.
  Failed = "Failed",
}

export default StorageArrayConnectionTestStatus;

// Nothing more is written to a test in one of these.
export const SETTLED_STORAGE_ARRAY_CONNECTION_TEST_STATUSES: ReadonlyArray<StorageArrayConnectionTestStatus> =
  [
    StorageArrayConnectionTestStatus.Succeeded,
    StorageArrayConnectionTestStatus.Failed,
  ];

// A test no probe picked up in this long is answered as failed.
export const STORAGE_ARRAY_CONNECTION_TEST_PICKUP_TIMEOUT_IN_SECONDS: number = 90;

// A test a probe took and never answered in this long is answered as failed.
export const STORAGE_ARRAY_CONNECTION_TEST_RUN_TIMEOUT_IN_SECONDS: number = 150;

// The most tests of one project waiting or running at once.
export const MAX_ACTIVE_STORAGE_ARRAY_CONNECTION_TESTS_PER_PROJECT: number = 5;

export function isStorageArrayConnectionTestSettled(
  status: StorageArrayConnectionTestStatus | null | undefined,
): boolean {
  return Boolean(
    status && SETTLED_STORAGE_ARRAY_CONNECTION_TEST_STATUSES.includes(status),
  );
}
