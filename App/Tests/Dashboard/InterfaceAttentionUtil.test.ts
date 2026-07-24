import { describe, expect, test } from "@jest/globals";
import {
  RankableInterface,
  isProblemInterface,
  rankInterfacesForAttention,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/InterfaceAttentionUtil";

/*
 * The device Overview shows only a handful of interfaces out of possibly
 * hundreds. These pin the triage order: down ports (admin-up, oper-down)
 * always beat hot ports, hot ports beat idle ones, errored ports outrank
 * merely-busy ones, and deliberately disabled ports sink to the bottom.
 */

describe("isProblemInterface", () => {
  test("admin-up but operationally down is a problem", () => {
    expect(
      isProblemInterface({
        isAdministrativelyUp: true,
        isOperationallyUp: false,
      }),
    ).toBe(true);
  });

  test("administratively disabled is not a problem — someone chose that", () => {
    expect(
      isProblemInterface({
        isAdministrativelyUp: false,
        isOperationallyUp: false,
      }),
    ).toBe(false);
  });

  test("up and running is not a problem", () => {
    expect(
      isProblemInterface({
        isAdministrativelyUp: true,
        isOperationallyUp: true,
      }),
    ).toBe(false);
  });
});

describe("rankInterfacesForAttention", () => {
  const downPort: RankableInterface = {
    interfaceIndex: 10,
    isAdministrativelyUp: true,
    isOperationallyUp: false,
  };
  const hotPort: RankableInterface = {
    interfaceIndex: 2,
    isAdministrativelyUp: true,
    isOperationallyUp: true,
    utilizationPercent: 95,
  };
  const erroredPort: RankableInterface = {
    interfaceIndex: 7,
    isAdministrativelyUp: true,
    isOperationallyUp: true,
    utilizationPercent: 5,
    errorsPerSecond: 2,
  };
  const idlePort: RankableInterface = {
    interfaceIndex: 1,
    isAdministrativelyUp: true,
    isOperationallyUp: true,
    utilizationPercent: 0,
  };
  const disabledPort: RankableInterface = {
    interfaceIndex: 3,
    isAdministrativelyUp: false,
    isOperationallyUp: false,
  };

  test("down beats errored beats hot beats idle beats disabled", () => {
    const ranked: Array<RankableInterface> = rankInterfacesForAttention(
      [idlePort, disabledPort, hotPort, erroredPort, downPort],
      5,
    );

    expect(ranked).toEqual([
      downPort,
      erroredPort,
      hotPort,
      idlePort,
      disabledPort,
    ]);
  });

  test("a saturated healthy port can never outrank a down port", () => {
    const saturated: RankableInterface = {
      interfaceIndex: 1,
      isAdministrativelyUp: true,
      isOperationallyUp: true,
      utilizationPercent: 100,
      errorsPerSecond: 999999,
    };

    const ranked: Array<RankableInterface> = rankInterfacesForAttention(
      [saturated, downPort],
      2,
    );

    expect(ranked[0]).toBe(downPort);
  });

  test("ties break by ifIndex so the preview is stable across refreshes", () => {
    const portA: RankableInterface = {
      interfaceIndex: 5,
      isAdministrativelyUp: true,
      isOperationallyUp: true,
      utilizationPercent: 10,
    };
    const portB: RankableInterface = {
      interfaceIndex: 2,
      isAdministrativelyUp: true,
      isOperationallyUp: true,
      utilizationPercent: 10,
    };

    const ranked: Array<RankableInterface> = rankInterfacesForAttention(
      [portA, portB],
      2,
    );

    expect(
      ranked.map((row: RankableInterface) => {
        return row.interfaceIndex;
      }),
    ).toEqual([2, 5]);
  });

  test("respects the limit and tolerates zero", () => {
    expect(
      rankInterfacesForAttention([downPort, hotPort, idlePort], 2),
    ).toHaveLength(2);
    expect(rankInterfacesForAttention([downPort], 0)).toHaveLength(0);
  });

  test("does not mutate the input array", () => {
    const input: Array<RankableInterface> = [idlePort, downPort];
    rankInterfacesForAttention(input, 2);
    expect(input).toEqual([idlePort, downPort]);
  });
});
