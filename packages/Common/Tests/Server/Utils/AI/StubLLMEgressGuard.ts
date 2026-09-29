import DataSourceEgressGuard from "../../../../Server/Utils/DataSource/EgressGuard";
import { jest } from "@jest/globals";

/*
 * LLMService validates and pins every provider URL through the SSRF egress
 * guard before posting, which means a real DNS lookup for whatever host the
 * test configured. The suites that are about request SHAPE rather than egress
 * policy use unresolvable placeholder hosts ("http://host:8000"), so they stub
 * the guard and stay offline.
 *
 * Call this from a beforeEach, before the API.post stub. Egress policy itself
 * is covered by LLMServiceEgressGuard.test.ts, which does NOT stub it.
 */
export default function stubLLMEgressGuard(): void {
  jest
    .spyOn(DataSourceEgressGuard, "assertUrlAllowedAndPin")
    .mockImplementation((urlString: string) => {
      return Promise.resolve({
        url: new globalThis.URL(urlString),
        addresses: [{ address: "93.184.216.34", family: 4 }],
        httpAgent: undefined as never,
        httpsAgent: undefined as never,
      });
    });
}
