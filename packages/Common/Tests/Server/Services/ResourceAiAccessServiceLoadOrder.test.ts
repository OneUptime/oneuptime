/*
 * Loaded before ResourceAiAccessService on purpose: a model service reaches
 * it back (through the AI settings rules and the agent service), so a
 * process whose first import is a model service - a cloud sync worker - must
 * still find every model's service when it reads AI access.
 */
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { afterEach, expect, jest, test } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

afterEach(() => {
  jest.restoreAllMocks();
});

test("a model service loaded before the access service is the one it reads", async () => {
  const accounts: jest.SpiedFunction<typeof CloudAccountService.findBy> = jest
    .spyOn(CloudAccountService, "findBy")
    .mockResolvedValue([]);
  const hosts: jest.SpiedFunction<typeof DockerHostService.findBy> = jest
    .spyOn(DockerHostService, "findBy")
    .mockResolvedValue([]);

  await ResourceAiAccessService.loadResources({
    projectId: PROJECT_ID,
    resources: [
      {
        resourceType: AiResourceType.AwsAccount,
        resourceId: "22222222-2222-4222-8222-222222222222",
      },
      {
        resourceType: AiResourceType.DockerHost,
        resourceId: "33333333-3333-4333-8333-333333333333",
      },
    ],
    excludeArchived: true,
  });

  expect(accounts).toHaveBeenCalledTimes(1);
  expect(hosts).toHaveBeenCalledTimes(1);
});
