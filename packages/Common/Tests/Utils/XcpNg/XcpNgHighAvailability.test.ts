import {
  XcpNgHaVerdict,
  XcpNgHaVerdictSource,
  getXcpNgHaVerdict,
} from "../../../Utils/XcpNg/XcpNgHighAvailability";
import { describe, expect, test } from "@jest/globals";

/*
 * Whether a pool's HA can still tolerate a host failure
 * (XcpNgHighAvailability): XAPI's plan when the pool is read straight from
 * XAPI, the hosts up and enabled through Xen Orchestra, whose REST pool
 * object says only whether HA is on.
 */

describe("HA off, or not read", () => {
  test("there is nothing to tolerate with", () => {
    for (const haEnabled of [false, null]) {
      const verdict: XcpNgHaVerdict = getXcpNgHaVerdict({
        haEnabled: haEnabled,
        hostsUpAndEnabled: 1,
      });
      expect(verdict.canTolerateHostFailure).toBeNull();
      expect(verdict.source).toBeNull();
    }
  });
});

describe("straight from XAPI: the plan", () => {
  test("a plan that covers what HA is set to tolerate", () => {
    expect(
      getXcpNgHaVerdict({
        haEnabled: true,
        hostFailuresToTolerate: 1,
        planExistsFor: 1,
        overcommitted: false,
        hostsUpAndEnabled: 2,
      }),
    ).toEqual({
      canTolerateHostFailure: true,
      source: XcpNgHaVerdictSource.Plan,
      hostFailuresToTolerate: 1,
      planExistsFor: 1,
    });
  });

  test("disabling a host of an HA pool of two drops the plan to 0", () => {
    const verdict: XcpNgHaVerdict = getXcpNgHaVerdict({
      haEnabled: true,
      hostFailuresToTolerate: 1,
      planExistsFor: 0,
      overcommitted: true,
      hostsUpAndEnabled: 1,
    });
    expect(verdict.canTolerateHostFailure).toBe(false);
    expect(verdict.source).toBe(XcpNgHaVerdictSource.Plan);
  });

  test("overcommitted alone is enough; so is a plan short of the setting", () => {
    expect(
      getXcpNgHaVerdict({
        haEnabled: true,
        hostFailuresToTolerate: 2,
        planExistsFor: 2,
        overcommitted: true,
        hostsUpAndEnabled: 5,
      }).canTolerateHostFailure,
    ).toBe(false);
    expect(
      getXcpNgHaVerdict({
        haEnabled: true,
        hostFailuresToTolerate: 2,
        planExistsFor: 1,
        overcommitted: false,
        hostsUpAndEnabled: 5,
      }).canTolerateHostFailure,
    ).toBe(false);
  });

  test("set to tolerate none: nothing to fall short of", () => {
    expect(
      getXcpNgHaVerdict({
        haEnabled: true,
        hostFailuresToTolerate: 0,
        planExistsFor: 0,
        hostsUpAndEnabled: 1,
      }).canTolerateHostFailure,
    ).toBe(true);
  });

  test("counts are read whole and never below zero", () => {
    const verdict: XcpNgHaVerdict = getXcpNgHaVerdict({
      haEnabled: true,
      hostFailuresToTolerate: 1.9,
      planExistsFor: -3,
      hostsUpAndEnabled: 3,
    });
    expect(verdict.hostFailuresToTolerate).toBe(1);
    expect(verdict.planExistsFor).toBe(0);
    expect(verdict.canTolerateHostFailure).toBe(false);
  });
});

describe("through Xen Orchestra: the hosts", () => {
  test("a host up and enabled beyond the one that fails", () => {
    const verdict: XcpNgHaVerdict = getXcpNgHaVerdict({
      haEnabled: true,
      hostsUpAndEnabled: 2,
    });
    expect(verdict).toEqual({
      canTolerateHostFailure: true,
      source: XcpNgHaVerdictSource.Hosts,
      hostFailuresToTolerate: null,
      planExistsFor: null,
    });
  });

  test("disabling a host of an HA pool of two leaves one: it cannot", () => {
    expect(
      getXcpNgHaVerdict({ haEnabled: true, hostsUpAndEnabled: 1 })
        .canTolerateHostFailure,
    ).toBe(false);
    expect(
      getXcpNgHaVerdict({ haEnabled: true, hostsUpAndEnabled: 0 })
        .canTolerateHostFailure,
    ).toBe(false);
  });

  test("an overcommitted plan a probe somehow read still counts", () => {
    expect(
      getXcpNgHaVerdict({
        haEnabled: true,
        overcommitted: true,
        hostsUpAndEnabled: 4,
      }).canTolerateHostFailure,
    ).toBe(false);
  });

  test("only half a plan is not a plan", () => {
    expect(
      getXcpNgHaVerdict({
        haEnabled: true,
        hostFailuresToTolerate: 1,
        planExistsFor: null,
        hostsUpAndEnabled: 2,
      }).source,
    ).toBe(XcpNgHaVerdictSource.Hosts);
  });
});
