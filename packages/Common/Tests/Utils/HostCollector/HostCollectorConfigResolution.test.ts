import {
  HostCollectorConfigCandidate,
  HostCollectorConfigChoice,
  HostCollectorConfigChoiceReason,
  HostCollectorConfigTarget,
  chooseHostCollectorConfig,
  doesHostCollectorConfigApply,
  sortHostCollectorConfigCandidates,
} from "../../../Utils/HostCollector/HostCollectorConfigResolution";
import { HostCollectorOsType } from "../../../Types/HostCollector/HostCollector";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * Which config a host runs - the one rule the server answers hosts by and
 * the Dashboard explains with: a config picked for the host wins; else the
 * first Collector Config in the list that is for the host's system and, when
 * it names labels, for a host with one of them; else OneUptime's default.
 */

const PRODUCTION: string = "label-production";
const STAGING: string = "label-staging";
const WEB: string = "label-web";

function config(
  id: string,
  osType: HostCollectorOsType,
  order: number,
  labelIds: Array<string> = [],
): HostCollectorConfigCandidate {
  return { id, osType, order, labelIds };
}

function host(
  osType: HostCollectorOsType | null,
  labelIds: Array<string> = [],
  pinnedConfigId?: string | null,
): HostCollectorConfigTarget {
  return { osType, labelIds, pinnedConfigId };
}

describe("whether a config is for a host", () => {
  test("a config for a system is for that system's hosts only", () => {
    const linux: HostCollectorConfigCandidate = config(
      "linux",
      HostCollectorOsType.Linux,
      0,
    );

    expect(
      doesHostCollectorConfigApply(linux, host(HostCollectorOsType.Linux)),
    ).toBe(true);
    expect(
      doesHostCollectorConfigApply(linux, host(HostCollectorOsType.Windows)),
    ).toBe(false);
    expect(
      doesHostCollectorConfigApply(linux, host(HostCollectorOsType.MacOS)),
    ).toBe(false);
  });

  test("a config for any system is for every host, one whose system is not known yet too", () => {
    const any: HostCollectorConfigCandidate = config(
      "any",
      HostCollectorOsType.Any,
      0,
    );

    for (const osType of [
      HostCollectorOsType.Linux,
      HostCollectorOsType.Windows,
      HostCollectorOsType.MacOS,
      null,
    ]) {
      expect(doesHostCollectorConfigApply(any, host(osType))).toBe(true);
    }
  });

  test("a host whose system is not known yet gets no config for one system", () => {
    for (const osType of [
      HostCollectorOsType.Linux,
      HostCollectorOsType.Windows,
      HostCollectorOsType.MacOS,
    ]) {
      expect(
        doesHostCollectorConfigApply(config("c", osType, 0), host(null)),
      ).toBe(false);
    }
  });

  test("a config that names labels is for a host with any one of them", () => {
    const productionOrStaging: HostCollectorConfigCandidate = config(
      "c",
      HostCollectorOsType.Linux,
      0,
      [PRODUCTION, STAGING],
    );

    expect(
      doesHostCollectorConfigApply(
        productionOrStaging,
        host(HostCollectorOsType.Linux, [STAGING]),
      ),
    ).toBe(true);
    expect(
      doesHostCollectorConfigApply(
        productionOrStaging,
        host(HostCollectorOsType.Linux, [WEB, PRODUCTION]),
      ),
    ).toBe(true);
    expect(
      doesHostCollectorConfigApply(
        productionOrStaging,
        host(HostCollectorOsType.Linux, [WEB]),
      ),
    ).toBe(false);
    expect(
      doesHostCollectorConfigApply(
        productionOrStaging,
        host(HostCollectorOsType.Linux),
      ),
    ).toBe(false);
  });

  test("labels never widen a config to another system", () => {
    expect(
      doesHostCollectorConfigApply(
        config("c", HostCollectorOsType.Windows, 0, [PRODUCTION]),
        host(HostCollectorOsType.Linux, [PRODUCTION]),
      ),
    ).toBe(false);
  });
});

describe("the config a host runs", () => {
  const configs: Array<HostCollectorConfigCandidate> = [
    config("every-linux-host", HostCollectorOsType.Linux, 2),
    config("production-web", HostCollectorOsType.Linux, 0, [PRODUCTION]),
    config("windows", HostCollectorOsType.Windows, 1),
    config("everything", HostCollectorOsType.Any, 3),
  ];

  test("the first config in the list that applies, by list order and not the order rows came in", () => {
    expect(
      chooseHostCollectorConfig(
        configs,
        host(HostCollectorOsType.Linux, [PRODUCTION]),
      ),
    ).toEqual({
      configId: "production-web",
      reason: HostCollectorConfigChoiceReason.Matched,
    });
    expect(
      chooseHostCollectorConfig(configs, host(HostCollectorOsType.Linux)),
    ).toEqual({
      configId: "every-linux-host",
      reason: HostCollectorConfigChoiceReason.Matched,
    });
    expect(
      chooseHostCollectorConfig(configs, host(HostCollectorOsType.MacOS)),
    ).toEqual({
      configId: "everything",
      reason: HostCollectorConfigChoiceReason.Matched,
    });
  });

  test("a host no config applies to runs OneUptime's default", () => {
    expect(
      chooseHostCollectorConfig(
        [config("windows", HostCollectorOsType.Windows, 0)],
        host(HostCollectorOsType.Linux),
      ),
    ).toEqual({
      configId: null,
      reason: HostCollectorConfigChoiceReason.Default,
    });
    expect(chooseHostCollectorConfig([], host(null))).toEqual({
      configId: null,
      reason: HostCollectorConfigChoiceReason.Default,
    });
  });

  test("a config picked for the host wins, even one that is not for its system", () => {
    expect(
      chooseHostCollectorConfig(
        configs,
        host(HostCollectorOsType.Linux, [PRODUCTION], "windows"),
      ),
    ).toEqual({
      configId: "windows",
      reason: HostCollectorConfigChoiceReason.Pinned,
    });
  });

  test("a picked config that is gone gives the host back to the list", () => {
    expect(
      chooseHostCollectorConfig(
        configs,
        host(HostCollectorOsType.Linux, [PRODUCTION], "deleted-config"),
      ),
    ).toEqual({
      configId: "production-web",
      reason: HostCollectorConfigChoiceReason.Matched,
    });
    expect(
      chooseHostCollectorConfig(
        [],
        host(HostCollectorOsType.Linux, [], "deleted-config"),
      ),
    ).toEqual({
      configId: null,
      reason: HostCollectorConfigChoiceReason.Default,
    });
  });

  test("an empty pick is no pick", () => {
    for (const pinned of [null, undefined, ""]) {
      expect(
        chooseHostCollectorConfig(
          configs,
          host(HostCollectorOsType.Windows, [], pinned),
        ).reason,
      ).toBe(HostCollectorConfigChoiceReason.Matched);
    }
  });

  test("two configs in the same place keep the order they came in", () => {
    const tied: Array<HostCollectorConfigCandidate> = [
      config("first", HostCollectorOsType.Linux, 5),
      config("second", HostCollectorOsType.Linux, 5),
    ];

    expect(
      chooseHostCollectorConfig(tied, host(HostCollectorOsType.Linux)).configId,
    ).toBe("first");
    expect(
      sortHostCollectorConfigCandidates(tied).map(
        (candidate: HostCollectorConfigCandidate): string => {
          return candidate.id;
        },
      ),
    ).toEqual(["first", "second"]);
  });

  test("sorting leaves the list it was given as it was", () => {
    const given: Array<HostCollectorConfigCandidate> = [
      config("b", HostCollectorOsType.Linux, 2),
      config("a", HostCollectorOsType.Linux, 1),
    ];

    sortHostCollectorConfigCandidates(given);

    expect(
      given.map((candidate: HostCollectorConfigCandidate): string => {
        return candidate.id;
      }),
    ).toEqual(["b", "a"]);
  });

  test("whatever order the rows arrive in, the host gets the first config of the list that applies", () => {
    const random: SeededRandom = seededRandom(5051);
    const systems: Array<HostCollectorOsType> =
      Object.values(HostCollectorOsType);
    const labels: Array<string> = [PRODUCTION, STAGING, WEB];

    for (let attempt: number = 0; attempt < 300; attempt++) {
      const count: number = random(8);
      const candidates: Array<HostCollectorConfigCandidate> = [];

      for (let index: number = 0; index < count; index++) {
        candidates.push(
          config(
            `config-${index}`,
            systems[random(systems.length)] as HostCollectorOsType,
            // Distinct places: the list order is total.
            index * 10 + random(10),
            labels.filter((): boolean => {
              return random(3) === 0;
            }),
          ),
        );
      }

      const target: HostCollectorConfigTarget = host(
        random(5) === 0
          ? null
          : (systems[random(systems.length)] as HostCollectorOsType),
        labels.filter((): boolean => {
          return random(2) === 0;
        }),
      );

      // The list as people see it, read top to bottom.
      const expected: HostCollectorConfigCandidate | undefined = [...candidates]
        .sort(
          (
            a: HostCollectorConfigCandidate,
            b: HostCollectorConfigCandidate,
          ): number => {
            return a.order - b.order;
          },
        )
        .find((candidate: HostCollectorConfigCandidate): boolean => {
          return doesHostCollectorConfigApply(candidate, target);
        });

      const shuffled: Array<HostCollectorConfigCandidate> = [...candidates];
      for (let index: number = shuffled.length - 1; index > 0; index--) {
        const other: number = random(index + 1);
        const item: HostCollectorConfigCandidate = shuffled[index]!;
        shuffled[index] = shuffled[other]!;
        shuffled[other] = item;
      }

      const choice: HostCollectorConfigChoice = chooseHostCollectorConfig(
        shuffled,
        target,
      );

      expect(choice.configId).toBe(expected ? expected.id : null);
      expect(choice.reason).toBe(
        expected
          ? HostCollectorConfigChoiceReason.Matched
          : HostCollectorConfigChoiceReason.Default,
      );
    }
  });
});
