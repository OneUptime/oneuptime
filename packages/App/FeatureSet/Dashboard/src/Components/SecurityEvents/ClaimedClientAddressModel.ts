/*
 * AN ADDRESS A CASE'S REQUESTS ONLY CLAIMED, AS THE DASHBOARD READS IT
 * (#10416). Security Events never blames an address the sender could have
 * written, so such an address is never an entity of the case and never a
 * step to block. Read in Common, so a case's Response Plan - built in Common
 * for the server and the browser (#10340) - holds to it wherever it is
 * built, and a plain test reads it as the Response Plan does.
 */
export type { CaseClaimedClientAddress } from "Common/Utils/SecurityCase/CaseClaimedClientAddress";
export {
  getCaseClaimedClientAddress,
  getCaseClaimedOnlyAddresses,
} from "Common/Utils/SecurityCase/CaseClaimedClientAddress";
