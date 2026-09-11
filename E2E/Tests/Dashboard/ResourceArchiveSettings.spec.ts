import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

interface ResourceCase {
  product: string;
  apiPath: string;
  identifierField: string;
  singularName: string;
}

const resources: Array<ResourceCase> = [
  {
    product: "rum",
    apiPath: "rum-application",
    identifierField: "appIdentifier",
    singularName: "application",
  },
  {
    product: "cloud",
    apiPath: "cloud-resource",
    identifierField: "resourceIdentifier",
    singularName: "cloud environment",
  },
  {
    product: "serverless",
    apiPath: "serverless-function",
    identifierField: "functionIdentifier",
    singularName: "function",
  },
];

const urlFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

/*
 * Real navigation, confirmation dialogs and persisted archive state. Each
 * test owns its project, which also removes its resource during cleanup.
 */
test.describe("Resource archive actions live in Settings", () => {
  for (const resource of resources) {
    test(`${resource.product}: archive and restore through Settings`, async ({
      page,
    }: {
      page: Page;
    }) => {
      const projectId: string = await registerAndCreateProject({
        page,
        projectNamePrefix: `E2E Archive Settings ${resource.product}`,
        preferredPlanName: "Growth",
        enablePaidUsage: false,
      });

      try {
        const resourceName: string = `Archive settings ${resource.product}`;
        const createResponse: APIResponse = await page.request.post(
          urlFor(`/api/${resource.apiPath}`),
          {
            headers: { tenantid: projectId },
            data: {
              data: {
                projectId,
                name: resourceName,
                [resource.identifierField]: `archive-settings-${resource.product}`,
              },
            },
          },
        );
        expect(createResponse.ok(), await createResponse.text()).toBe(true);

        interface ResourceRecord {
          _id: string;
          name: string;
          isArchived: boolean;
        }

        const readResource: () => Promise<ResourceRecord> =
          async (): Promise<ResourceRecord> => {
            const response: APIResponse = await page.request.post(
              urlFor(`/api/${resource.apiPath}/get-list`),
              {
                headers: { tenantid: projectId },
                data: {
                  query: { projectId, name: resourceName },
                  select: { _id: true, name: true, isArchived: true },
                  limit: 2,
                  skip: 0,
                  sort: {},
                },
              },
            );
            expect(response.ok(), await response.text()).toBe(true);
            const body: { data: Array<ResourceRecord> } = await response.json();
            expect(body.data).toHaveLength(1);
            return body.data[0]!;
          };

        const record: ResourceRecord = await readResource();
        expect(record.isArchived).toBe(false);
        const listPath: string = `/dashboard/${projectId}/${resource.product}`;
        const overviewUrl: string = urlFor(`${listPath}/${record._id}`);
        const settingsUrl: string = `${overviewUrl}/settings`;
        const settingsLink: Locator = page.locator(
          `a[href='${listPath}/${record._id}/settings']`,
        );

        await gotoProjectPage({
          page,
          projectId,
          url: overviewUrl,
          ready: settingsLink.first(),
        });
        await expect(
          page.getByRole("heading", { name: resourceName, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", {
            name: /^Archive(?: |$)/,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Archive", exact: true }),
        ).toHaveCount(0);

        await settingsLink.first().click();
        await expect(page).toHaveURL(settingsUrl);
        await expect(
          page.getByRole("heading", {
            name: `Archive ${resource.singularName}`,
            exact: true,
          }),
        ).toBeVisible();
        // A bookmarked Settings URL also resolves after a full reload.
        await page.reload();
        const archive: Locator = page.getByRole("button", {
          name: "Archive",
          exact: true,
        });
        await expect(archive).toBeEnabled();
        await archive.click();
        const modal: Locator = page.getByTestId("modal");
        await expect(modal).toBeVisible();
        await modal
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(modal).toBeHidden();
        expect((await readResource()).isArchived).toBe(false);

        await archive.click();
        await modal.getByTestId("modal-footer-submit-button").click();
        await expect(page).toHaveURL(urlFor(listPath));
        expect((await readResource()).isArchived).toBe(true);

        // Archived resources remain directly accessible for restoration.
        await page.goto(settingsUrl);
        await page
          .getByRole("button", { name: "Unarchive", exact: true })
          .click();
        await modal.getByTestId("modal-footer-submit-button").click();
        await expect(modal).toBeHidden();
        await expect(archive).toBeVisible();
        await expect(page).toHaveURL(settingsUrl);
        expect((await readResource()).isArchived).toBe(false);
      } finally {
        const response: APIResponse = await page.request.delete(
          urlFor(`/api/project/${projectId}`),
          { headers: { tenantid: projectId } },
        );
        expect(response.ok(), "Temporary archive project is deleted").toBe(
          true,
        );
      }
    });
  }
});
