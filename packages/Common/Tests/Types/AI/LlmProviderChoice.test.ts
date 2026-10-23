import {
  LLM_PROVIDER_ACTIVITY_TEMPLATES,
  LlmProviderActivity,
  LlmProviderCandidate,
  LlmProviderDecision,
  LlmProviderFallbackReason,
  LlmProviderRuleFacts,
  LlmProviderSource,
  decideLlmProvider,
  describeLlmProviderActivityInEnglish,
  getLlmProviderActivity,
  getLlmProviderActivityTemplate,
  getLlmProviderPickingRules,
  getRuleLlmProviderId,
  getRulesLlmProviderId,
  isLlmProviderActivityWarning,
  readLlmProviderId,
} from "../../../Types/AI/LlmProviderChoice";
import AIPostmortemRule from "../../../Models/DatabaseModels/AIPostmortemRule";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import ObjectID from "../../../Types/ObjectID";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH LLM PROVIDER THE WORK AN AI RULE STARTS USES
 * (Types/AI/LlmProviderChoice). The maintainer: "If the provider is not
 * selected, select the project LLM provider by default if one is set to
 * default, or you can select the global LLM provider as well. If one is
 * selected, use that LLM provider to do everything." So: the rule's pick,
 * else the project's default, else the global provider; a pick that cannot
 * be used falls back, and the run says so.
 */

const OPUS: LlmProviderCandidate = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  name: "Claude Opus",
  isGlobal: false,
};

const AZURE_DEFAULT: LlmProviderCandidate = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  name: "Azure GPT-4o",
  isGlobal: false,
};

const ONEUPTIME_GLOBAL: LlmProviderCandidate = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  name: "OneUptime AI",
  isGlobal: true,
};

describe("readLlmProviderId", () => {
  test("reads an id from every shape a rule's pick arrives in, lower-cased", () => {
    const id: string = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1";
    const expected: string = id.toLowerCase();

    expect(readLlmProviderId(id)).toBe(expected);
    expect(readLlmProviderId(`  ${id}  `)).toBe(expected);
    expect(readLlmProviderId(new ObjectID(id))).toBe(expected);
    expect(readLlmProviderId({ _id: id })).toBe(expected);
    expect(readLlmProviderId({ id: id })).toBe(expected);
    expect(readLlmProviderId({ value: id })).toBe(expected);
  });

  test("nothing, or something that is not an id, is no pick", () => {
    for (const value of [undefined, null, "", "   ", 42, true, [], {}]) {
      expect(readLlmProviderId(value)).toBe("");
    }
  });
});

describe("getRuleLlmProviderId", () => {
  test("a rule's pick is its llmProviderId, else its relation", () => {
    expect(getRuleLlmProviderId({ llmProviderId: OPUS.id })).toBe(OPUS.id);
    expect(getRuleLlmProviderId({ llmProvider: { _id: OPUS.id } })).toBe(
      OPUS.id,
    );
    expect(
      getRuleLlmProviderId({
        llmProviderId: OPUS.id,
        llmProvider: { _id: AZURE_DEFAULT.id },
      }),
    ).toBe(OPUS.id);
    expect(getRuleLlmProviderId({})).toBe("");
  });

  test("reads every rule kind's model row", () => {
    for (const RuleType of [AutoRemediationRule, AIPostmortemRule]) {
      const row: AutoRemediationRule | AIPostmortemRule = new RuleType();
      expect(getRuleLlmProviderId(row)).toBe("");
      row.llmProviderId = new ObjectID(OPUS.id);
      expect(getRuleLlmProviderId(row)).toBe(OPUS.id);
    }
  });
});

describe("decideLlmProvider: no rule pick", () => {
  test("the project's default provider", () => {
    expect(
      decideLlmProvider({
        projectDefault: AZURE_DEFAULT,
        globalProvider: ONEUPTIME_GLOBAL,
      }),
    ).toEqual({
      provider: AZURE_DEFAULT,
      source: LlmProviderSource.ProjectDefault,
      fallbackReason: null,
    });
  });

  test("with no project default, the global provider", () => {
    expect(
      decideLlmProvider({
        projectDefault: null,
        globalProvider: ONEUPTIME_GLOBAL,
      }),
    ).toEqual({
      provider: ONEUPTIME_GLOBAL,
      source: LlmProviderSource.Global,
      fallbackReason: null,
    });
  });

  test("with neither, no provider - and nothing fell back", () => {
    expect(
      decideLlmProvider({ projectDefault: null, globalProvider: null }),
    ).toEqual({ provider: null, source: null, fallbackReason: null });
  });

  test("an empty pick is no pick", () => {
    for (const pickedProviderId of [undefined, null, "", "  "]) {
      expect(
        decideLlmProvider({
          pickedProviderId,
          pickedProvider: OPUS,
          projectDefault: AZURE_DEFAULT,
          globalProvider: ONEUPTIME_GLOBAL,
        }).source,
      ).toBe(LlmProviderSource.ProjectDefault);
    }
  });
});

describe("decideLlmProvider: the rule's pick", () => {
  test("a pick that can be used is used, ahead of the project's default", () => {
    expect(
      decideLlmProvider({
        pickedProviderId: OPUS.id,
        pickedProvider: OPUS,
        projectDefault: AZURE_DEFAULT,
        globalProvider: ONEUPTIME_GLOBAL,
      }),
    ).toEqual({
      provider: OPUS,
      source: LlmProviderSource.RulePick,
      fallbackReason: null,
    });
  });

  test("a rule may pick the global provider while the project has a default", () => {
    expect(
      decideLlmProvider({
        pickedProviderId: ONEUPTIME_GLOBAL.id,
        pickedProvider: ONEUPTIME_GLOBAL,
        projectDefault: AZURE_DEFAULT,
        globalProvider: ONEUPTIME_GLOBAL,
      }),
    ).toEqual({
      provider: ONEUPTIME_GLOBAL,
      source: LlmProviderSource.RulePick,
      fallbackReason: null,
    });
  });

  test("the pick's id is read in any case, as the rule holds it", () => {
    expect(
      decideLlmProvider({
        pickedProviderId: OPUS.id.toUpperCase(),
        pickedProvider: { ...OPUS, id: OPUS.id.toUpperCase() },
        projectDefault: null,
        globalProvider: null,
      }).source,
    ).toBe(LlmProviderSource.RulePick);
  });
});

describe("decideLlmProvider: a pick that cannot be used falls back", () => {
  test("deleted or no longer the project's: the project's default, and the run says why", () => {
    expect(
      decideLlmProvider({
        pickedProviderId: OPUS.id,
        pickedProvider: null,
        projectDefault: AZURE_DEFAULT,
        globalProvider: ONEUPTIME_GLOBAL,
      }),
    ).toEqual({
      provider: AZURE_DEFAULT,
      source: LlmProviderSource.ProjectDefault,
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    });
  });

  test("with no project default, the global provider", () => {
    expect(
      decideLlmProvider({
        pickedProviderId: OPUS.id,
        pickedProvider: null,
        projectDefault: null,
        globalProvider: ONEUPTIME_GLOBAL,
      }),
    ).toEqual({
      provider: ONEUPTIME_GLOBAL,
      source: LlmProviderSource.Global,
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    });
  });

  test("with nothing to fall back to, no provider - and the reason", () => {
    expect(
      decideLlmProvider({
        pickedProviderId: OPUS.id,
        pickedProvider: null,
        projectDefault: null,
        globalProvider: null,
      }),
    ).toEqual({
      provider: null,
      source: null,
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    });
  });

  test("a row read for another id is not the pick", () => {
    expect(
      decideLlmProvider({
        pickedProviderId: OPUS.id,
        pickedProvider: AZURE_DEFAULT,
        projectDefault: AZURE_DEFAULT,
        globalProvider: null,
      }).fallbackReason,
    ).toBe(LlmProviderFallbackReason.Unavailable);
  });

  for (const blocker of [
    LlmProviderFallbackReason.CreditsUsedUp,
    LlmProviderFallbackReason.SpendLimitReached,
  ]) {
    test(`over budget (${blocker}): the project's own default, which AI credits never pay for`, () => {
      expect(
        decideLlmProvider({
          pickedProviderId: ONEUPTIME_GLOBAL.id,
          pickedProvider: ONEUPTIME_GLOBAL,
          pickedProviderBlocker: blocker,
          projectDefault: AZURE_DEFAULT,
          globalProvider: ONEUPTIME_GLOBAL,
        }),
      ).toEqual({
        provider: AZURE_DEFAULT,
        source: LlmProviderSource.ProjectDefault,
        fallbackReason: blocker,
      });
    });

    test(`over budget (${blocker}) with no project default: the pick stays, and is refused for what stops it`, () => {
      expect(
        decideLlmProvider({
          pickedProviderId: ONEUPTIME_GLOBAL.id,
          pickedProvider: ONEUPTIME_GLOBAL,
          pickedProviderBlocker: blocker,
          projectDefault: null,
          globalProvider: ONEUPTIME_GLOBAL,
        }),
      ).toEqual({
        provider: ONEUPTIME_GLOBAL,
        source: LlmProviderSource.RulePick,
        fallbackReason: null,
      });
    });

    test(`over budget (${blocker}): never to another global provider, which the credits pay for too`, () => {
      const otherGlobal: LlmProviderCandidate = {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
        name: "Another global",
        isGlobal: true,
      };

      expect(
        decideLlmProvider({
          pickedProviderId: ONEUPTIME_GLOBAL.id,
          pickedProvider: ONEUPTIME_GLOBAL,
          pickedProviderBlocker: blocker,
          projectDefault: otherGlobal,
          globalProvider: otherGlobal,
        }).provider,
      ).toEqual(ONEUPTIME_GLOBAL);
    });

    test(`over budget (${blocker}) when the pick is the project default itself: it stays`, () => {
      expect(
        decideLlmProvider({
          pickedProviderId: AZURE_DEFAULT.id,
          pickedProvider: AZURE_DEFAULT,
          pickedProviderBlocker: blocker,
          projectDefault: AZURE_DEFAULT,
          globalProvider: null,
        }),
      ).toEqual({
        provider: AZURE_DEFAULT,
        source: LlmProviderSource.RulePick,
        fallbackReason: null,
      });
    });
  }
});

describe("decideLlmProvider: a sweep of every case", () => {
  /*
   * The rule written out the slow way, as the module comment says it, and
   * compared with the decision for every mix of pick, blocker, default and
   * global provider the seeded sweep draws.
   */
  function expected(data: {
    pickedProviderId: string;
    pickedProvider: LlmProviderCandidate | null;
    blocker: LlmProviderFallbackReason | null;
    projectDefault: LlmProviderCandidate | null;
    globalProvider: LlmProviderCandidate | null;
  }): LlmProviderDecision {
    const order: Array<[LlmProviderCandidate | null, LlmProviderSource]> = [
      [data.projectDefault, LlmProviderSource.ProjectDefault],
      [data.globalProvider, LlmProviderSource.Global],
    ];

    const firstOf: (
      reason: LlmProviderFallbackReason | null,
    ) => LlmProviderDecision = (
      reason: LlmProviderFallbackReason | null,
    ): LlmProviderDecision => {
      for (const [candidate, source] of order) {
        if (candidate) {
          return { provider: candidate, source, fallbackReason: reason };
        }
      }

      return { provider: null, source: null, fallbackReason: reason };
    };

    if (!data.pickedProviderId) {
      return firstOf(null);
    }

    if (!data.pickedProvider) {
      return firstOf(LlmProviderFallbackReason.Unavailable);
    }

    if (!data.blocker) {
      return {
        provider: data.pickedProvider,
        source: LlmProviderSource.RulePick,
        fallbackReason: null,
      };
    }

    if (
      data.projectDefault &&
      !data.projectDefault.isGlobal &&
      data.projectDefault.id !== data.pickedProviderId
    ) {
      return {
        provider: data.projectDefault,
        source: LlmProviderSource.ProjectDefault,
        fallbackReason: data.blocker,
      };
    }

    return {
      provider: data.pickedProvider,
      source: LlmProviderSource.RulePick,
      fallbackReason: null,
    };
  }

  test("2,000 drawn cases decide as the rule says", () => {
    const random: SeededRandom = seededRandom(5_201);
    const candidates: Array<LlmProviderCandidate> = [
      OPUS,
      AZURE_DEFAULT,
      ONEUPTIME_GLOBAL,
    ];
    const blockers: Array<LlmProviderFallbackReason | null> = [
      null,
      LlmProviderFallbackReason.CreditsUsedUp,
      LlmProviderFallbackReason.SpendLimitReached,
    ];

    for (let index: number = 0; index < 2_000; index++) {
      const picked: LlmProviderCandidate | null =
        random(4) === 0 ? null : candidates[random(candidates.length)]!;
      const hasPick: boolean = random(3) !== 0;
      const pickedProviderId: string = hasPick
        ? (picked || OPUS).id
        : random(2) === 0
          ? ""
          : "   ";
      const pickedProvider: LlmProviderCandidate | null = hasPick
        ? picked
        : null;
      const blocker: LlmProviderFallbackReason | null = pickedProvider
        ? blockers[random(blockers.length)]!
        : null;
      const projectDefault: LlmProviderCandidate | null =
        random(2) === 0 ? null : candidates[random(2)]!;
      const globalProvider: LlmProviderCandidate | null =
        random(2) === 0 ? null : ONEUPTIME_GLOBAL;

      const input: {
        pickedProviderId: string;
        pickedProvider: LlmProviderCandidate | null;
        blocker: LlmProviderFallbackReason | null;
        projectDefault: LlmProviderCandidate | null;
        globalProvider: LlmProviderCandidate | null;
      } = {
        pickedProviderId: pickedProviderId.trim(),
        pickedProvider,
        blocker,
        projectDefault,
        globalProvider,
      };

      expect([
        index,
        decideLlmProvider({
          pickedProviderId,
          pickedProvider,
          pickedProviderBlocker: blocker,
          projectDefault,
          globalProvider,
        }),
      ]).toEqual([index, expected(input)]);
    }
  });
});

describe("getRulesLlmProviderId: which of several rules decides", () => {
  const rule: (
    name: string,
    llmProviderId?: string,
    id?: string,
  ) => LlmProviderRuleFacts = (
    name: string,
    llmProviderId?: string,
    id?: string,
  ): LlmProviderRuleFacts => {
    return {
      name,
      _id: id || ObjectID.generate().toString(),
      ...(llmProviderId ? { llmProviderId } : {}),
    };
  };

  test("no rule, or no rule that picks one: no pick", () => {
    expect(getRulesLlmProviderId([])).toBe("");
    expect(getRulesLlmProviderId([rule("A"), rule("B")])).toBe("");
  });

  test("the first rule by name that picks one, whatever order the rules were read in", () => {
    expect(
      getRulesLlmProviderId([
        rule("Zeta", AZURE_DEFAULT.id),
        rule("Alpha", OPUS.id),
        rule("Middle", ONEUPTIME_GLOBAL.id),
      ]),
    ).toBe(OPUS.id);
  });

  test("by name as people read it: case does not reorder the list", () => {
    expect(
      getRulesLlmProviderId([
        rule("beta", AZURE_DEFAULT.id),
        rule("Alpha", OPUS.id),
      ]),
    ).toBe(OPUS.id);
    expect(
      getRulesLlmProviderId([
        rule("Beta", AZURE_DEFAULT.id),
        rule("alpha", OPUS.id),
      ]),
    ).toBe(OPUS.id);
  });

  test("a rule that picks none never hides another's pick", () => {
    expect(
      getRulesLlmProviderId([
        rule("A catch-all"),
        rule("Critical incidents", OPUS.id),
      ]),
    ).toBe(OPUS.id);
  });

  test("two rules of the same name: the one with the lower id, every time", () => {
    const first: string = "11111111-1111-4111-8111-111111111111";
    const second: string = "22222222-2222-4222-8222-222222222222";

    expect(
      getRulesLlmProviderId([
        rule("Same", AZURE_DEFAULT.id, second),
        rule("Same", OPUS.id, first),
      ]),
    ).toBe(OPUS.id);
    expect(
      getRulesLlmProviderId([
        rule("Same", OPUS.id, first),
        rule("Same", AZURE_DEFAULT.id, second),
      ]),
    ).toBe(OPUS.id);
  });

  test("getLlmProviderPickingRules keeps only the rules that pick, in the deciding order", () => {
    const rules: Array<LlmProviderRuleFacts> = [
      rule("c", OPUS.id),
      rule("a"),
      rule("B", AZURE_DEFAULT.id),
    ];

    expect(
      getLlmProviderPickingRules(rules).map(
        (picking: LlmProviderRuleFacts): unknown => {
          return picking.name;
        },
      ),
    ).toEqual(["B", "c"]);
    // The list it was given is left as it was.
    expect(
      rules.map((each: LlmProviderRuleFacts): unknown => {
        return each.name;
      }),
    ).toEqual(["c", "a", "B"]);
  });

  test("a rule's relation counts as its pick", () => {
    expect(
      getRulesLlmProviderId([
        { name: "A", llmProvider: { _id: OPUS.id } } as LlmProviderRuleFacts,
      ]),
    ).toBe(OPUS.id);
  });

  test("the order is the same for any shuffle of the rules", () => {
    const random: SeededRandom = seededRandom(77);
    const rules: Array<LlmProviderRuleFacts> = [
      rule("delta", ONEUPTIME_GLOBAL.id),
      rule("Bravo", AZURE_DEFAULT.id),
      rule("alpha"),
      rule("Charlie", OPUS.id),
    ];

    for (let round: number = 0; round < 50; round++) {
      const shuffledRules: Array<LlmProviderRuleFacts> = shuffled(
        rules,
        random,
      );

      expect(getRulesLlmProviderId(shuffledRules)).toBe(AZURE_DEFAULT.id);
    }
  });
});

describe("what a run says about its provider", () => {
  test("a run no rule picked a provider for says nothing new", () => {
    expect(
      getLlmProviderActivity({
        pickedProviderId: "",
        decision: decideLlmProvider({
          projectDefault: AZURE_DEFAULT,
          globalProvider: null,
        }),
      }),
    ).toBeNull();
  });

  test("the rule's pick, used: its name, an Info line", () => {
    const activity: LlmProviderActivity | null = getLlmProviderActivity({
      pickedProviderId: OPUS.id,
      decision: decideLlmProvider({
        pickedProviderId: OPUS.id,
        pickedProvider: OPUS,
        projectDefault: AZURE_DEFAULT,
        globalProvider: null,
      }),
    });

    expect(activity).toEqual({
      source: LlmProviderSource.RulePick,
      providerName: "Claude Opus",
    });
    expect(isLlmProviderActivityWarning(activity!)).toBe(false);
    expect(describeLlmProviderActivityInEnglish(activity!)).toBe(
      "Using Claude Opus, the rule's LLM provider",
    );
  });

  test("a fallback: the provider used and why, a Warning", () => {
    const activity: LlmProviderActivity | null = getLlmProviderActivity({
      pickedProviderId: OPUS.id,
      decision: decideLlmProvider({
        pickedProviderId: OPUS.id,
        pickedProvider: null,
        projectDefault: AZURE_DEFAULT,
        globalProvider: null,
      }),
    });

    expect(activity).toEqual({
      source: LlmProviderSource.ProjectDefault,
      providerName: "Azure GPT-4o",
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    });
    expect(isLlmProviderActivityWarning(activity!)).toBe(true);
    expect(describeLlmProviderActivityInEnglish(activity!)).toBe(
      "Using Azure GPT-4o, the project's default LLM provider, because the rule's provider is no longer available",
    );
  });

  test("each case has its own line, and a line names the provider it used", () => {
    const cases: Array<[LlmProviderActivity, string]> = [
      [
        { source: LlmProviderSource.RulePick, providerName: "Opus" },
        LLM_PROVIDER_ACTIVITY_TEMPLATES.rulePick,
      ],
      [
        {
          source: LlmProviderSource.ProjectDefault,
          providerName: "Azure",
          fallbackReason: LlmProviderFallbackReason.Unavailable,
        },
        LLM_PROVIDER_ACTIVITY_TEMPLATES.unavailableToProjectDefault,
      ],
      [
        {
          source: LlmProviderSource.Global,
          providerName: "OneUptime AI",
          fallbackReason: LlmProviderFallbackReason.Unavailable,
        },
        LLM_PROVIDER_ACTIVITY_TEMPLATES.unavailableToGlobal,
      ],
      [
        { fallbackReason: LlmProviderFallbackReason.Unavailable },
        LLM_PROVIDER_ACTIVITY_TEMPLATES.unavailableToNone,
      ],
      [
        {
          source: LlmProviderSource.ProjectDefault,
          providerName: "Azure",
          fallbackReason: LlmProviderFallbackReason.CreditsUsedUp,
        },
        LLM_PROVIDER_ACTIVITY_TEMPLATES.creditsUsedUp,
      ],
      [
        {
          source: LlmProviderSource.ProjectDefault,
          providerName: "Azure",
          fallbackReason: LlmProviderFallbackReason.SpendLimitReached,
        },
        LLM_PROVIDER_ACTIVITY_TEMPLATES.spendLimitReached,
      ],
    ];

    for (const [activity, template] of cases) {
      expect(getLlmProviderActivityTemplate(activity)).toBe(template);

      const line: string = describeLlmProviderActivityInEnglish(activity);

      expect(line).not.toContain("{{");

      if (activity.providerName) {
        expect(line).toContain(activity.providerName);
      }
    }

    // Every template is a different line.
    expect(new Set(Object.values(LLM_PROVIDER_ACTIVITY_TEMPLATES)).size).toBe(
      Object.keys(LLM_PROVIDER_ACTIVITY_TEMPLATES).length,
    );
  });

  /*
   * A line reads as a person would say it: the provider used, then - with
   * "because" - why the rule's own was not. Not "X: Y", which read as a
   * log line among the run's steps (the UI review of #5178).
   */
  test("each line is worded in full: the provider used, then why", () => {
    expect(LLM_PROVIDER_ACTIVITY_TEMPLATES).toEqual({
      rulePick: "Using {{provider}}, the rule's LLM provider",
      unavailableToProjectDefault:
        "Using {{provider}}, the project's default LLM provider, because the rule's provider is no longer available",
      unavailableToGlobal:
        "Using {{provider}}, the global LLM provider, because the rule's provider is no longer available",
      unavailableToNone:
        "The rule's LLM provider is no longer available, and there is no other to use",
      creditsUsedUp:
        "Using {{provider}}, the project's default LLM provider, because the rule's provider runs on AI credits, which are used up",
      spendLimitReached:
        "Using {{provider}}, the project's default LLM provider, because the daily AI spend limit stops the rule's provider",
    });

    for (const template of Object.values(LLM_PROVIDER_ACTIVITY_TEMPLATES)) {
      // One clause after another, never a colon between them.
      expect(template).not.toContain(":");
      // A step of the run's activity, as the others: no full stop.
      expect(template.endsWith(".")).toBe(false);
    }
  });

  test("with no provider to use at all, a Warning", () => {
    const activity: LlmProviderActivity | null = getLlmProviderActivity({
      pickedProviderId: OPUS.id,
      decision: decideLlmProvider({
        pickedProviderId: OPUS.id,
        pickedProvider: null,
        projectDefault: null,
        globalProvider: null,
      }),
    });

    expect(activity).toEqual({
      fallbackReason: LlmProviderFallbackReason.Unavailable,
    });
    expect(isLlmProviderActivityWarning(activity!)).toBe(true);
  });
});

describe("the rule models", () => {
  test("every AI rule kind has the LLM provider it picks, kept as an id and a relation", () => {
    for (const RuleType of [AutoRemediationRule, AIPostmortemRule]) {
      const model: AutoRemediationRule | AIPostmortemRule = new RuleType();

      expect(model.getTableColumnMetadata("llmProviderId")?.title).toBe(
        "LLM Provider ID",
      );
      expect(model.getTableColumnMetadata("llmProvider")?.modelType).toBe(
        LlmProvider,
      );
      expect(
        model.getTableColumnMetadata("llmProvider")?.manyToOneRelationColumn,
      ).toBe("llmProviderId");
      // Empty is an answer of its own: the default provider.
      expect(model.getTableColumnMetadata("llmProviderId")?.required).toBe(
        false,
      );
    }
  });
});
