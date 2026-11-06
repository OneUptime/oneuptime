import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";

/*
 * Stream metrics and logs on a connection that reads an AWS Organization:
 * More fields offers "Every account of the organization", and the command
 * becomes the organization's (CloudStreamOrganization) - for the management
 * account, a StackSet for every member account - while named log groups,
 * which are one account's, stop it and say why. A connection that reads
 * one account, or reads with an access key, is offered nothing new.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    HOST: "oneuptime.example.com",
    HTTP_PROTOCOL: "https://",
  };
});

import * as UIConfig from "../../../UI/Config";
import CloudStreamDialog, {
  CLOUD_STREAM_DIALOG_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudStreamDialog";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import Protocol from "../../../Types/API/Protocol";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CLOUD_STREAM_ORGANIZATION_LOG_GROUPS_REFUSAL,
  CLOUD_STREAM_ORGANIZATION_WHAT_IT_MAKES,
} from "../../../Types/CloudConnection/CloudStreamOrganization";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const CONNECTION_ID: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const STREAM_KEY: string = `oucs_${CONNECTION_ID}_${"ab".repeat(32)}`;
const MANAGEMENT: string = "111111111111";

const ORGANIZATION_CONFIG: JSONObject = {
  authMethod: CloudConnectionAuthMethod.AwsRole,
  roleArn: `arn:aws:iam::${MANAGEMENT}:role/OneUptimeRead`,
  readScope: "organization",
};

function connection(config: JSONObject): CloudConnection {
  const item: CloudConnection = new CloudConnection();
  item._id = CONNECTION_ID;
  item.name = "Organization";
  item.provider = CloudProvider.AWS;
  item.isEnabled = true;
  item.config = config;
  item.lastPullResult = {
    status: "success",
    regions: [
      { region: "us-east-1", count: 12 },
      { region: "eu-west-1", count: 3 },
    ],
  };
  return item;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/connect`);
  (UIConfig as unknown as { HTTP_PROTOCOL: Protocol }).HTTP_PROTOCOL =
    Protocol.HTTPS;
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(API, "post").mockResolvedValue({
    data: {
      streamKey: STREAM_KEY,
      createdAt: new Date().toISOString(),
      previousKeyWorksUntil: null,
    },
  });
  getJestSpyOn(ModelAPI, "getItem").mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function openDialog(config: JSONObject): void {
  render(
    <CloudStreamDialog
      connection={connection(config)}
      onClose={getJestMockFunction()}
      onChanged={getJestMockFunction()}
    />,
  );
}

function part(name: string): HTMLElement {
  return screen.getByTestId(`${CLOUD_STREAM_DIALOG_TEST_ID}-${name}`);
}

function queryPart(name: string): HTMLElement | null {
  return screen.queryByTestId(`${CLOUD_STREAM_DIALOG_TEST_ID}-${name}`);
}

function command(): string {
  return part("command").querySelector("pre code")?.textContent || "";
}

async function openMoreFields(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(part("more-fields")).getByTestId("folded-section-header"),
    );
  });
}

async function streamEveryAccount(): Promise<void> {
  await openMoreFields();
  await act(async () => {
    fireEvent.click(part("every-account"));
  });
}

describe("streaming every account of an organization", () => {
  test("offered under More fields, off until chosen", async () => {
    openDialog(ORGANIZATION_CONFIG);

    expect(part("more-fields")).toHaveTextContent(
      "Every account of the organization",
    );
    expect(command()).not.toContain("create-stack-set");
    // One account's note, until every account is chosen.
    expect(part("what-it-makes")).toHaveTextContent(
      "in each Region: the metric stream",
    );
    expect(part("what-it-makes")).not.toHaveTextContent(
      "of every account of the organization",
    );

    // The fold's line names its fields in the order it draws them.
    const header: string =
      within(part("more-fields")).getByTestId("folded-section-header")
        .textContent || "";

    expect(header.indexOf("Every metric")).toBeLessThan(
      header.indexOf("Every account of the organization"),
    );
    expect(header.indexOf("Every account of the organization")).toBeLessThan(
      header.indexOf("Regions"),
    );

    await openMoreFields();

    expect(part("every-account")).not.toBeChecked();
    expect(part("more-fields")).toHaveTextContent(
      `From the management account ${MANAGEMENT}, a StackSet makes the same stacks in every member account, and in accounts that join later. It streams every log group or no logs, since a named log group belongs to one account.`,
    );
    // The fold draws it where its line names it: after Every metric, before Regions.
    const fold: string = part("more-fields").textContent || "";

    expect(fold.indexOf("Every metric, not only the key ones")).toBeLessThan(
      fold.indexOf("Every account of the organization"),
    );
    expect(fold.indexOf("Every account of the organization")).toBeLessThan(
      fold.indexOf("Regions"),
    );
    // Until it is chosen, the dialog streams this account.
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "delivers this account's CloudWatch metrics and logs",
    );
  });

  test("chosen, the dialog says it streams every account of the organization", async () => {
    openDialog(ORGANIZATION_CONFIG);
    await streamEveryAccount();

    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Run one command, and Amazon Data Firehose delivers every account's CloudWatch metrics and logs to OneUptime within minutes, between reads.",
    );
  });

  test("chosen, the command is the organization's, for its management account", async () => {
    openDialog(ORGANIZATION_CONFIG);
    await streamEveryAccount();

    expect(command()).toContain(`if [ "$ACCOUNT" != '${MANAGEMENT}' ]; then`);
    expect(command()).toContain(
      "aws cloudformation create-stack-set --stack-set-name OneUptimeStream-6f1c3a2e",
    );
    expect(command()).toContain("--regions us-east-1 eu-west-1");
    expect(command()).toContain("STREAM_KEY='<YOUR_STREAM_KEY>'");
    expect(screen.getByTestId("setup-guide-step-2")).toHaveTextContent(
      `Run it in the management account ${MANAGEMENT}, as someone who may create StackSets, CloudFormation stacks and IAM roles there.`,
    );
    // What it makes is every account's, not this one's alone.
    expect(part("what-it-makes")).toHaveTextContent(
      CLOUD_STREAM_ORGANIZATION_WHAT_IT_MAKES.replace(
        "{{stack}}",
        "OneUptimeStream-6f1c3a2e",
      ),
    );

    // Its key, once made, is in the command as one account's is.
    await act(async () => {
      fireEvent.click(part("make-key"));
    });

    expect(command()).toContain(`STREAM_KEY='${STREAM_KEY}'`);
  });

  test("named log groups are one account's: the command stops and says why", async () => {
    openDialog(ORGANIZATION_CONFIG);
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("setup-guide-option-metrics-and-logs"),
      );
    });
    // Named log groups, not every one.
    if ((part("every-log-group") as HTMLInputElement).checked) {
      await act(async () => {
        fireEvent.click(part("every-log-group"));
      });
    }
    await act(async () => {
      fireEvent.change(part("log-groups"), {
        target: { value: "/aws/lambda/checkout" },
      });
    });
    await streamEveryAccount();

    expect(part("organization-problem")).toHaveTextContent(
      CLOUD_STREAM_ORGANIZATION_LOG_GROUPS_REFUSAL,
    );
    expect(queryPart("command")).toBeNull();

    // Every log group: the organization streams them.
    await act(async () => {
      fireEvent.click(part("every-log-group"));
    });

    expect(queryPart("organization-problem")).toBeNull();
    expect(command()).toContain("create-stack-set");
  });

  test.each([
    ["one account", { ...ORGANIZATION_CONFIG, readScope: "account" }],
    [
      "an access key",
      {
        ...ORGANIZATION_CONFIG,
        authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      },
    ],
    ["no settings", {}],
  ])(
    "%s: nothing new is offered",
    async (_name: string, config: JSONObject) => {
      openDialog(config);

      expect(part("more-fields")).not.toHaveTextContent(
        "Every account of the organization",
      );

      await openMoreFields();

      expect(queryPart("every-account")).toBeNull();
      expect(command()).not.toContain("create-stack-set");
    },
  );
});
