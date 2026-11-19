import { IS_BILLING_ENABLED } from "../../Config";
import {
  createItem,
  JSONish,
  listItems,
  toId,
} from "./Helpers/MonitorAlerting";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { SERVER, deleteProject, urlFor } from "./Helpers/ProjectResources";
import { Locator, Page, expect, test } from "@playwright/test";

/*
 * Add Custom Domain on a status page's Custom Domains page, against the real
 * stack (#9997).
 *
 * Typing status.customer.com on a project that did not have customer.com
 * yet answered "Domain must be a string or an instance of Domain.": the
 * dialog adds the missing domain to the project as the Dashboard sends
 * every Domain - its JSON - and the server's create hook took only text or
 * the server's own subclass of Domain, which the API never reads JSON back
 * as. Every suite that covered the dialog stood in for the server (the
 * offline PublicAddresses fixture, the jsdom suites), so none saw it.
 *
 * Here the dialog talks to the real App and Postgres. The address is on a
 * reserved test domain (.example.com, RFC 2606): nobody can add DNS
 * records to it, so the server verifies its TXT record without a lookup,
 * as it does for the e2e suites, and Check now can go on to add the custom
 * domain. Its CNAME cannot be found, for the same reason, so it is not
 * waited for. Every step is read back through the API.
 *
 * cd packages/E2E && HOST=localhost HTTP_PROTOCOL=http \
 *   npx playwright test Tests/Dashboard/StatusPageAddCustomDomain.spec.ts \
 *   --project=chromium --retries=0
 */

// Status pages are on every paid plan when billing is on.
const PLAN_NAME: string = "Growth";

// A domain's name as the API answers it: text, or the JSON of a Domain.
const nameOf: (value: unknown) => string = (value: unknown): string => {
  if (value && typeof value === "object") {
    return String((value as JSONish)["value"] || "");
  }

  return String(value || "");
};

test.describe("Status page Custom Domains: Add Custom Domain", () => {
  test("an address on a domain the project does not have adds the domain, shows its records, and Check now adds the custom domain", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(300000);

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Add Custom Domain",
      preferredPlanName: IS_BILLING_ENABLED ? PLAN_NAME : undefined,
    });

    try {
      // Run-unique, so the domain is this run's.
      const label: string = `e2e-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const domainName: string = `${label}.example.com`;
      const address: string = `status.${domainName}`;

      const statusPage: JSONish = await createItem({
        page,
        projectId,
        path: "/api/status-page",
        item: {
          name: `E2E Custom Domain ${label}`,
          description: "Created by StatusPageAddCustomDomain.spec.ts",
          projectId,
          pageTitle: `E2E Custom Domain ${label}`,
        },
      });
      const statusPageId: string = toId(statusPage["_id"]);
      expect(statusPageId).not.toBe("");

      const addButton: Locator = page
        .getByRole("button", { name: "Add Custom Domain" })
        .first();

      await gotoProjectPage({
        page,
        projectId,
        url: urlFor(
          `/dashboard/${projectId}/status-pages/${statusPageId}/domains`,
        ),
        ready: addButton,
      });

      // ---- The address, typed as people type it ----
      await addButton.click();

      const dialog: Locator = page.getByTestId("modal");
      await expect(dialog).toContainText("Add Custom Domain");
      await dialog
        .getByPlaceholder("status.example.com")
        .fill(address.toUpperCase());
      await dialog.getByRole("button", { name: "Continue" }).click();

      // ---- The domain is added, and DNS Setup shows both records ----
      await expect(dialog.getByTestId("dns-setup-txt-record")).toBeVisible(
        SERVER,
      );
      await expect(dialog).not.toContainText("instance of Domain");
      await expect(dialog.getByTestId("dns-setup-txt-record-type")).toHaveText(
        "TXT",
      );
      await expect(dialog.getByTestId("dns-setup-txt-record-name")).toHaveText(
        domainName,
      );
      await expect(dialog.getByTestId("dns-setup-record-type")).toHaveText(
        "CNAME",
      );
      await expect(dialog.getByTestId("dns-setup-record-name")).toHaveText(
        address,
      );

      // As the server keeps it: lower-cased, not verified, with the text shown.
      const domains: Array<JSONish> = (
        await listItems({
          page,
          projectId,
          path: "/api/domain",
          select: {
            _id: true,
            domain: true,
            isVerified: true,
            domainVerificationText: true,
          },
        })
      ).filter((domain: JSONish): boolean => {
        return nameOf(domain["domain"]) === domainName;
      });

      expect(domains).toHaveLength(1);
      expect(domains[0]!["isVerified"]).toBeFalsy();
      await expect(dialog.getByTestId("dns-setup-txt-record-value")).toHaveText(
        String(domains[0]!["domainVerificationText"]),
      );

      // ---- Check now: the TXT is found, and the custom domain is added ----
      await dialog.getByRole("button", { name: "Check now" }).click();

      await expect(dialog.getByTestId("dns-setup-txt-status")).toHaveText(
        "Found",
        SERVER,
      );

      await expect
        .poll(async (): Promise<Array<string>> => {
          return (
            await listItems({
              page,
              projectId,
              path: "/api/status-page-domain",
              select: { fullDomain: true, statusPageId: true },
            })
          )
            .filter((customDomain: JSONish): boolean => {
              return toId(customDomain["statusPageId"]) === statusPageId;
            })
            .map((customDomain: JSONish): string => {
              return String(customDomain["fullDomain"]);
            });
        }, SERVER)
        .toEqual([address]);

      const verified: Array<JSONish> = (
        await listItems({
          page,
          projectId,
          path: "/api/domain",
          select: { _id: true, domain: true, isVerified: true },
        })
      ).filter((domain: JSONish): boolean => {
        return nameOf(domain["domain"]) === domainName;
      });

      expect(verified).toHaveLength(1);
      expect(verified[0]!["isVerified"]).toBe(true);
    } finally {
      await deleteProject(page, projectId);
    }
  });
});
