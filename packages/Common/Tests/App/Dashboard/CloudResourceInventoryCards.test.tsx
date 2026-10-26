import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CloudRelationshipKind } from "../../../Types/Cloud/CloudInventory";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudResourceInventoryCards from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceInventoryCards";

/*
 * What a resource's inventory says on its Overview: what it is connected
 * to both ways - a link to each resource the account holds, the cloud's
 * own id for one it does not - its endpoints, tags and settings; nothing
 * for a resource no connection lists.
 */

const ACCOUNT: string = "123456789012";
const INSTANCE_ID: string = "0193c0de-6666-4aaa-8bbb-000000000006";
const SUBNET_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const ALB_ID: string = "0193c0de-8888-4aaa-8bbb-000000000008";

function row(data: Partial<CloudResource> & { _id: string }): CloudResource {
  const resource: CloudResource = new CloudResource();
  Object.assign(resource, data);
  return resource;
}

function instance(overrides: Partial<CloudResource> = {}): CloudResource {
  return row({
    _id: INSTANCE_ID,
    name: "web-1",
    cloudProvider: "aws",
    cloudAccountId: ACCOUNT,
    cloudResourceType: "AWS::EC2::Instance",
    providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:instance/i-0web`,
    inventoriedAt: new Date(),
    cloudRelationships: [
      {
        kind: CloudRelationshipKind.RunsIn,
        target: "subnet-0abc",
        targetType: "AWS::EC2::Subnet",
      },
      {
        kind: CloudRelationshipKind.ProtectedBy,
        target: "sg-0gone",
        targetType: "AWS::EC2::SecurityGroup",
      },
    ],
    cloudEndpoints: ["ec2-203-0-113-10.compute-1.amazonaws.com"],
    cloudTags: { team: "payments", env: "production" },
    cloudProperties: {
      InstanceType: "m5.large",
      Placement: { AvailabilityZone: "eu-west-1a" },
    },
    ...overrides,
  });
}

const NEIGHBOURS: Array<CloudResource> = [
  row({
    _id: SUBNET_ID,
    name: "private-a",
    cloudResourceType: "AWS::EC2::Subnet",
    providerResourceId: `arn:aws:ec2:eu-west-1:${ACCOUNT}:subnet/subnet-0abc`,
  }),
  row({
    _id: ALB_ID,
    name: "web-alb",
    cloudResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
    providerResourceId: `arn:aws:elasticloadbalancing:eu-west-1:${ACCOUNT}:loadbalancer/app/web-alb/1`,
    cloudRelationships: [
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: "i-0web",
        targetType: "AWS::EC2::Instance",
      },
    ],
  }),
];

let listSpy: jest.SpyInstance<any, any>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/${INSTANCE_ID}`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  listSpy = getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
    data: NEIGHBOURS,
    count: NEIGHBOURS.length,
    skip: 0,
    limit: 2000,
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCards(resource: CloudResource): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CloudResourceInventoryCards resource={resource} />
      </MemoryRouter>,
    );
  });
}

function card(title: string): HTMLElement {
  const heading: HTMLElement = screen.getByText(title, {
    selector: "h2, h3, h4, p, span, div",
  });
  return (heading.closest("[data-testid='card']") ||
    heading.closest("section") ||
    heading.parentElement!.parentElement!.parentElement!) as HTMLElement;
}

describe("a listed resource's inventory", () => {
  test("its connections both ways, named after the resources the account holds", async () => {
    await renderCards(instance());

    expect(await screen.findByText("Connected Resources")).toBeInTheDocument();
    expect(screen.getByText("Runs in")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "private-a" })).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/${SUBNET_ID}`),
    );
    // Not held: the cloud's own id, as written.
    expect(screen.getByText("Protected by")).toBeInTheDocument();
    expect(screen.getByText("sg-0gone")).toBeInTheDocument();
    // What names it: the load balancer.
    expect(screen.getByText("Gets traffic from")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "web-alb" })).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/${ALB_ID}`),
    );
  });

  test("reads its neighbours from its own account, live ones only", async () => {
    await renderCards(instance());
    await screen.findByText("Connected Resources");

    const request: { query: Record<string, unknown>; limit: number } =
      listSpy.mock.calls[0]![0];

    expect(request.query["cloudProvider"]).toBe("aws");
    expect(request.query["isArchived"]).toBe(false);
    expect((request.query["cloudAccountId"] as Includes).values).toContain(
      ACCOUNT,
    );
    expect(request.limit).toBe(2000);
  });

  test("its endpoints, tags and settings, as its cloud lists them", async () => {
    await renderCards(instance());

    expect(
      await screen.findByText("ec2-203-0-113-10.compute-1.amazonaws.com"),
    ).toBeInTheDocument();
    expect(screen.getByText("team")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
    expect(screen.getByText("Placement.AvailabilityZone")).toBeInTheDocument();
    expect(screen.getByText("eu-west-1a")).toBeInTheDocument();
  });

  test("says when the account holds more than were read", async () => {
    listSpy.mockResolvedValue({
      data: NEIGHBOURS,
      count: 4500,
      skip: 0,
      limit: 2000,
    });

    await renderCards(instance());

    expect(
      await screen.findByText(
        /The account has 4,500 resources: the first 2 were read/,
      ),
    ).toBeInTheDocument();
  });

  test("neighbours that cannot be read: what it names itself, said so", async () => {
    listSpy.mockRejectedValue(new Error("Request failed"));

    await renderCards(instance());

    expect(
      await screen.findByText(
        "The account's other resources could not be read, so only what this resource names is shown.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("subnet-0abc")).toBeInTheDocument();
  });

  test("a listed resource with no tags says so; one connected to nothing too", async () => {
    listSpy.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 2000 });

    await renderCards(
      instance({
        cloudTags: {},
        cloudRelationships: [],
        cloudEndpoints: [],
        cloudProperties: {},
      }),
    );

    expect(await screen.findByText("It has no tags.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Its cloud's inventory lists nothing it is connected to.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Endpoints")).not.toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });
});

describe("a resource no connection lists", () => {
  test("draws none of it, and reads nothing it does not need", async () => {
    const unlisted: CloudResource = instance();

    // What a listing writes, never written for this one.
    Object.assign(unlisted, {
      inventoriedAt: undefined,
      cloudTags: undefined,
      cloudRelationships: undefined,
      cloudEndpoints: undefined,
      cloudProperties: undefined,
      cloudAccountId: undefined,
    });

    await renderCards(unlisted);

    expect(screen.queryByText("Connected Resources")).not.toBeInTheDocument();
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
    expect(listSpy).not.toHaveBeenCalled();
  });
});

describe("the cards", () => {
  test("each says what it is in a line under its title", async () => {
    await renderCards(instance());
    await screen.findByText("Connected Resources");

    for (const title of [
      "Connected Resources",
      "Endpoints",
      "Tags",
      "Configuration",
    ]) {
      expect(within(card(title)).getByText(title)).toBeInTheDocument();
    }
  });
});
