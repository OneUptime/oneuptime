import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * Subdomain validation is only a control if it is actually wired into BOTH
 * hooks. subdomain is ProjectMember-updatable, so create-time validation on
 * its own leaves the value editable straight afterwards. These tests call the
 * hooks directly — no database is touched, because the update hook only
 * inspects the payload.
 */

interface SubdomainUpdate {
  data: { subdomain?: string | undefined };
}

type CallOnBeforeUpdate = (
  service: unknown,
  update: SubdomainUpdate,
) => Promise<SubdomainUpdate>;

const callOnBeforeUpdate: CallOnBeforeUpdate = async (
  service: unknown,
  update: SubdomainUpdate,
): Promise<SubdomainUpdate> => {
  const result: { updateBy: SubdomainUpdate } = await (
    service as {
      onBeforeUpdate: (u: SubdomainUpdate) => Promise<{
        updateBy: SubdomainUpdate;
      }>;
    }
  ).onBeforeUpdate(update);

  return result.updateBy;
};

const services: Array<[string, unknown]> = [
  ["StatusPageDomainService", StatusPageDomainService],
  ["DashboardDomainService", DashboardDomainService],
];

describe.each(services)(
  "%s.onBeforeUpdate",
  (_name: string, service: unknown) => {
    test("rejects a subdomain carrying a path and a fragment", async () => {
      await expect(
        callOnBeforeUpdate(service, {
          data: { subdomain: "169.254.169.254/latest/meta-data/#" },
        }),
      ).rejects.toThrow(BadDataException);
    });

    test("rejects a subdomain carrying a scheme", async () => {
      await expect(
        callOnBeforeUpdate(service, {
          data: { subdomain: "http://169.254.169.254" },
        }),
      ).rejects.toThrow(BadDataException);
    });

    test("rejects a subdomain carrying a port", async () => {
      await expect(
        callOnBeforeUpdate(service, {
          data: { subdomain: "169.254.169.254:80" },
        }),
      ).rejects.toThrow(BadDataException);
    });

    test("accepts and normalizes an ordinary subdomain", async () => {
      const updated: SubdomainUpdate = await callOnBeforeUpdate(service, {
        data: { subdomain: "  STATUS  " },
      });

      expect(updated.data.subdomain).toBe("status");
    });

    test("treats @ as the apex", async () => {
      const updated: SubdomainUpdate = await callOnBeforeUpdate(service, {
        data: { subdomain: "@" },
      });

      expect(updated.data.subdomain).toBe("");
    });

    test("leaves an update that does not touch the subdomain alone", async () => {
      const updated: SubdomainUpdate = await callOnBeforeUpdate(service, {
        data: {},
      });

      expect(updated.data.subdomain).toBeUndefined();
    });
  },
);
