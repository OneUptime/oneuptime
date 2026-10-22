import { SecurityEventRecord } from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import ProductBrandingText from "../../ProductBrandingText";

/*
 * The one event "Send a test event" sends: informational, about nothing,
 * saying where it came from, so a person setting a destination up sees it
 * arrive and knows it for a test.
 */
export function buildDestinationTestRecord(
  siemTitle: string,
  now: Date = new Date(),
): SecurityEventRecord {
  const productName: string = ProductBrandingText.getProductName();

  return {
    id: "",
    time: now,
    createdAt: now,
    eventUid: `oneuptime-test-${now.getTime()}`,
    categoryUid: 0,
    categoryName: "",
    classUid: 0,
    className: "Connection test",
    activityName: "",
    severityId: 1,
    severityName: "Informational",
    statusName: "",
    message: `${productName} connection test: this destination can send security events to ${siemTitle}.`,
    vendorName: productName,
    productName: `${productName} Security Events`,
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "",
    principalHost: "",
    principalIp: "",
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    observables: [],
    attributes: {},
  };
}
