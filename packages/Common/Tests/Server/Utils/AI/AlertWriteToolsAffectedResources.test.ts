import { AddAlertAffectedResourcesTool } from "../../../../Server/Utils/AI/Toolbox/AlertWriteTools";
import {
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../Server/Services/AlertService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import HostService from "../../../../Server/Services/HostService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import Host from "../../../../Models/DatabaseModels/Host";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * add_alert_affected_resources, the alert twin of
 * add_incident_affected_resources (#5293): an alert OneUptime AI finds is
 * about a host or cluster it is not linked to is linked to it - added to
 * what it lists already, as the person, as the alert's Affected Resources
 * Edit does - so its investigation reaches it and auto-remediation can fix
 * it there.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const ALERT_ID: string = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HELD_HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const DOCKER_HOST_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ALERT_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Alert,
  entityId: ALERT_ID,
};

const DOCKER_HOST_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Resource,
  resourceType: AIResourceType.DockerHost,
  entityId: DOCKER_HOST_ID,
};

function context(pageContext?: AIChatPageContext): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
    ...(pageContext ? { pageContext } : {}),
  };
}

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T {
  const record: T = new modelType();
  record._id = id;
  (record as unknown as { name: string }).name = name;
  (record as unknown as { isArchived: boolean }).isArchived = false;
  return record;
}

function idsOf(list: Array<BaseModel> | undefined): Array<string> {
  return (list || []).map((record: BaseModel): string => {
    return record.id!.toString();
  });
}

function mockAlert(data?: {
  readable?: boolean;
  heldHostIds?: Array<string>;
}): jest.SpyInstance {
  return jest
    .spyOn(AlertService, "findOneById")
    .mockImplementation((async (args: {
      props: { isRoot?: boolean };
    }): Promise<Alert | null> => {
      if (!args.props.isRoot) {
        if (data?.readable === false) {
          return null;
        }

        const alert: Alert = new Alert();
        alert._id = ALERT_ID;
        alert.alertNumber = 7;
        alert.title = "CPU above 90%";
        return alert;
      }

      const held: Alert = new Alert();
      held._id = ALERT_ID;
      held.hosts = (data?.heldHostIds || []).map((id: string): Host => {
        const host: Host = new Host();
        host.id = new ObjectID(id);
        return host;
      });
      return held;
    }) as never);
}

describe("add_alert_affected_resources", () => {
  test("adds the host to what the alert lists already, as the person", async () => {
    mockAlert({ heldHostIds: [HELD_HOST_ID] });
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const update: jest.SpyInstance = jest
      .spyOn(AlertService, "updateOneById")
      .mockResolvedValue(1 as never);
    const ctx: ToolContext = context();

    const result: ToolExecutionResult =
      await AddAlertAffectedResourcesTool.execute(
        {
          alertId: ALERT_ID,
          affectedResources: [{ resourceType: "host", resourceId: HOST_ID }],
        },
        ctx,
      );

    const write: { id: ObjectID; data: JSONObject; props: unknown } = update
      .mock.calls[0]![0] as { id: ObjectID; data: JSONObject; props: unknown };
    expect(write.id.toString()).toBe(ALERT_ID);
    expect(write.props).toBe(ctx.props);
    expect(Object.keys(write.data)).toEqual(["hosts"]);
    expect(idsOf(write.data["hosts"] as unknown as Array<BaseModel>)).toEqual([
      HELD_HOST_ID,
      HOST_ID,
    ]);

    expect(result.dataForLlm).toContain(
      'Linked alert #7 ("CPU above 90%") to host "test01".',
    );
    expect(result.dataForLlm).toContain(
      "If OneUptime AI found nothing to fix on this alert because it was linked to nothing, it tries again now",
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ALERT_ID },
    });
  });

  test("on an alert's page while about a Docker host's page: the defaults are the page's", async () => {
    mockAlert();
    jest
      .spyOn(DockerHostService, "findBy")
      .mockResolvedValue([named(DockerHost, DOCKER_HOST_ID, "web-1")] as never);
    const update: jest.SpyInstance = jest
      .spyOn(AlertService, "updateOneById")
      .mockResolvedValue(1 as never);

    // The alert from its page, the Docker host from the call.
    await AddAlertAffectedResourcesTool.execute(
      {
        affectedResources: [
          { resourceType: "DockerHost", resourceId: DOCKER_HOST_ID },
        ],
      },
      context(ALERT_PAGE),
    );

    expect((update.mock.calls[0]![0] as { id: ObjectID }).id.toString()).toBe(
      ALERT_ID,
    );

    // On the Docker host's page, the Docker host is the default.
    const prepared: PreparedMutation =
      await AddAlertAffectedResourcesTool.prepareMutation!(
        { alertId: ALERT_ID },
        context(DOCKER_HOST_PAGE),
      );

    expect(prepared.arguments).toEqual({
      alertId: ALERT_ID,
      affectedResources: [
        { resourceType: "DockerHost", resourceId: DOCKER_HOST_ID },
      ],
    });
    expect(prepared.description).toBe('Adds Docker host "web-1".');
  });

  test("one linked already is not written again", async () => {
    mockAlert({ heldHostIds: [HOST_ID] });
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const update: jest.SpyInstance = jest.spyOn(AlertService, "updateOneById");

    const result: ToolExecutionResult =
      await AddAlertAffectedResourcesTool.execute(
        {
          alertId: ALERT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        context(),
      );

    expect(update).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain("nothing changed");
  });

  test("an alert the person cannot read is refused, reading nothing else", async () => {
    mockAlert({ readable: false });
    const hosts: jest.SpyInstance = jest.spyOn(HostService, "findBy");

    await expect(
      AddAlertAffectedResourcesTool.execute(
        {
          alertId: ALERT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        context(),
      ),
    ).rejects.toThrow("Alert not found");
    expect(hosts).not.toHaveBeenCalled();
  });

  test("an alert the person may not change is refused with its own reason", async () => {
    mockAlert();
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    jest.spyOn(AlertService, "updateOneById").mockResolvedValue(0 as never);
    jest
      .spyOn(AlertService, "getUnwrittenByIdError")
      .mockResolvedValue(
        new NotAuthorizedException(
          "You do not have permission to edit this alert.",
        ) as never,
      );

    await expect(
      AddAlertAffectedResourcesTool.execute(
        {
          alertId: ALERT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        context(),
      ),
    ).rejects.toThrow("You do not have permission to edit this alert.");
  });

  test("no alert named and none on the page is refused", async () => {
    await expect(
      AddAlertAffectedResourcesTool.execute(
        { affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }] },
        context(),
      ),
    ).rejects.toThrow("alertId is required");
  });

  test("nothing it may link is refused with the reasons, and nothing is written", async () => {
    mockAlert();
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);
    const update: jest.SpyInstance = jest.spyOn(AlertService, "updateOneById");

    await expect(
      AddAlertAffectedResourcesTool.execute(
        {
          alertId: ALERT_ID,
          affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
        },
        context(),
      ),
    ).rejects.toThrow("Nothing was linked.");
    expect(update).not.toHaveBeenCalled();
  });

  test("is a mutation that needs what the alert's Affected Resources Edit needs", () => {
    expect(AddAlertAffectedResourcesTool.isMutation).toBe(true);
    expect(AddAlertAffectedResourcesTool.requiredPermissions).toEqual(
      new Alert().getUpdatePermissions(),
    );
    expect(AddAlertAffectedResourcesTool.buildActionTitle!({})).toBe(
      "Link this alert to affected resources",
    );
    expect(
      AddAlertAffectedResourcesTool.buildActionTitle!({ alertId: ALERT_ID }),
    ).toBe(`Link alert ${ALERT_ID} to affected resources`);
  });
});
