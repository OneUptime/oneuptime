import { NetworkControllerFailureKind } from "./NetworkControllerReadSummary";

/*
 * What "Test" answers for a network controller connection, before or after
 * it is saved. A test makes a few read-only calls - the organizations the
 * key can read, and for the organization picked its networks and its
 * appliances - and says in one sentence whether the connection works and
 * what a read would cover; when it does not work, what to do about it.
 *
 * Nothing is stored, and the answer never carries the API key.
 */

export type NetworkControllerTestStatus = "pass" | "warn" | "fail";

export interface NetworkControllerOrganization {
  id: string;
  name: string;
}

export interface NetworkControllerTestResult {
  provider: string;
  status: NetworkControllerTestStatus;
  // One or two sentences for the person reading it. Never a credential.
  message: string;
  // What to do when it did not pass.
  remediation?: string | undefined;
  failureKind?: NetworkControllerFailureKind | undefined;
  // The organizations the key can read, in Meraki's order.
  organizations: Array<NetworkControllerOrganization>;
  // The organization the counts are of, when one was picked (or the key reads one).
  organizationId?: string | undefined;
  networkCount?: number | undefined;
  applianceCount?: number | undefined;
  durationMs: number;
}

// Organizations a test lists at most.
export const MAX_TEST_ORGANIZATIONS: number = 100;

export { NetworkControllerFailureKind };
