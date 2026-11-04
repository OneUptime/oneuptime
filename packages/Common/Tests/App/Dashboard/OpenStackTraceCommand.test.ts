import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import {
  chooseOpenStackTraceFlavor,
  chooseOpenStackTraceImage,
  chooseOpenStackTraceNetwork,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackTraceCommand";

/*
 * What a signed test boot asks for, chosen from a cloud's own inventory. It should work as
 * written on most clouds, boot quickly, and never pick something an instance cannot use.
 */

const GIB: number = 1024 * 1024 * 1024;

function row(values: Partial<OpenStackResource>): OpenStackResource {
  const resource: OpenStackResource = new OpenStackResource();

  Object.assign(resource, values);

  return resource;
}

describe("the flavor", () => {
  test("the smallest there is, by what it asks for", () => {
    expect(
      chooseOpenStackTraceFlavor([
        row({
          name: "m1.large",
          memoryCapacityBytes: 8 * GIB,
          vcpuCapacity: 4,
          diskCapacityBytes: 80 * GIB,
        }),
        row({
          name: "m1.tiny",
          memoryCapacityBytes: 0.5 * GIB,
          vcpuCapacity: 1,
          diskCapacityBytes: GIB,
        }),
        row({
          name: "m1.small",
          memoryCapacityBytes: 2 * GIB,
          vcpuCapacity: 1,
          diskCapacityBytes: 20 * GIB,
        }),
      ]),
    ).toBe("m1.tiny");
  });

  test("one with no disk would ask for a boot from a volume, so it is passed over", () => {
    expect(
      chooseOpenStackTraceFlavor([
        row({ name: "m1.nano", memoryCapacityBytes: GIB / 4, vcpuCapacity: 1 }),
        row({
          name: "m1.tiny",
          memoryCapacityBytes: GIB / 2,
          vcpuCapacity: 1,
          diskCapacityBytes: GIB,
        }),
      ]),
    ).toBe("m1.tiny");
  });

  test("if every flavor has no disk, one of them is still the best answer", () => {
    expect(
      chooseOpenStackTraceFlavor([row({ name: "m1.nano" })]),
    ).toBe("m1.nano");
  });

  test("none, and a row with no name, leave it for the person", () => {
    expect(chooseOpenStackTraceFlavor([])).toBeNull();
    expect(chooseOpenStackTraceFlavor([row({ vcpuCapacity: 1 })])).toBeNull();
  });
});

describe("the image", () => {
  test("the small test image most clouds keep, if there is one", () => {
    expect(
      chooseOpenStackTraceImage([
        row({ name: "Ubuntu 24.04", status: "active" }),
        row({ name: "cirros-0.6.2-x86_64-disk", status: "active" }),
      ]),
    ).toBe("cirros-0.6.2-x86_64-disk");
  });

  test("or else whichever can boot", () => {
    expect(
      chooseOpenStackTraceImage([
        row({ name: "being-uploaded", status: "queued" }),
        row({ name: "Ubuntu 24.04", status: "ACTIVE" }),
      ]),
    ).toBe("Ubuntu 24.04");
  });

  test("a test image that cannot boot is not chosen", () => {
    expect(
      chooseOpenStackTraceImage([
        row({ name: "cirros-broken", status: "killed" }),
      ]),
    ).toBeNull();
  });
});

describe("the network", () => {
  test("not one a name says is external, while another is there", () => {
    expect(
      chooseOpenStackTraceNetwork([
        row({ name: "public", externalId: "public-id" }),
        row({ name: "private", externalId: "private-id" }),
      ]),
    ).toBe("private");
  });

  test("if there is nothing else, even that: the person can change it", () => {
    expect(
      chooseOpenStackTraceNetwork([
        row({ name: "public", externalId: "public-id" }),
      ]),
    ).toBe("public");
  });

  test("by id when another has its name, as every project's private does to an admin", () => {
    expect(
      chooseOpenStackTraceNetwork([
        row({ name: "private", externalId: "first-id" }),
        row({ name: "private", externalId: "second-id" }),
      ]),
    ).toBe("first-id");
  });

  test("none leaves it for the person", () => {
    expect(chooseOpenStackTraceNetwork([])).toBeNull();
    expect(
      chooseOpenStackTraceNetwork([row({ externalId: "no-name" })]),
    ).toBeNull();
  });
});
