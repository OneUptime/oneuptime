import { describe, expect, test } from "@jest/globals";
import {
  LlmAgentNameAttributeKeys,
  LlmAttributeNamespacePrefixes,
  LlmCompletionEventNames,
  LlmCompletionIndexedMessageConventions,
  LlmCompletionJsonAttributeKeys,
  LlmConversationIdAttributeKeys,
  LlmCostAttributeKeys,
  LlmEndUserAttributeKeys,
  LlmEndUserBaseAttributeKeys,
  LlmFinishReasonAttributeKeys,
  LlmIndexedMessageConvention,
  LlmInputTokenAttributeKeys,
  LlmMaxTokensAttributeKeys,
  LlmOperationAttributeKeys,
  LlmOutputTokenAttributeKeys,
  LlmPromptEventNames,
  LlmPromptIndexedMessageConventions,
  LlmPromptJsonAttributeKeys,
  LlmRequestModelAttributeKeys,
  LlmResponseModelAttributeKeys,
  LlmSystemAttributeKeys,
  LlmTeamAttributeKeys,
  LlmTeamBaseAttributeKeys,
  LlmTemperatureAttributeKeys,
  LlmToolNameAttributeKeys,
  LlmTopPAttributeKeys,
  LlmTotalTokenAttributeKeys,
  LlmUserEmailAttributeKeys,
  LlmUserEmailBaseAttributeKeys,
  LlmUserIdAttributeKeys,
  LlmUserIdBaseAttributeKeys,
  RESOURCE_ATTRIBUTE_KEY_PREFIX,
  withResourcePrefixedKeys,
} from "../../../Types/Telemetry/LlmConventions";

/*
 * Lists that carry a per-CALL value and must stay span-attribute only.
 * Widening them would double lookups on the hottest ingest path.
 */
const PER_CALL_LISTS: Record<string, Array<string>> = {
  LlmSystemAttributeKeys,
  LlmOperationAttributeKeys,
  LlmRequestModelAttributeKeys,
  LlmResponseModelAttributeKeys,
  LlmInputTokenAttributeKeys,
  LlmOutputTokenAttributeKeys,
  LlmTotalTokenAttributeKeys,
  LlmCostAttributeKeys,
  LlmConversationIdAttributeKeys,
  LlmAgentNameAttributeKeys,
  LlmToolNameAttributeKeys,
  LlmTemperatureAttributeKeys,
  LlmMaxTokensAttributeKeys,
  LlmTopPAttributeKeys,
  LlmFinishReasonAttributeKeys,
  LlmPromptJsonAttributeKeys,
  LlmCompletionJsonAttributeKeys,
};

interface IdentityTier {
  name: string;
  base: Array<string>;
  widened: Array<string>;
}

const IDENTITY_TIERS: Array<IdentityTier> = [
  {
    name: "user id",
    base: LlmUserIdBaseAttributeKeys,
    widened: LlmUserIdAttributeKeys,
  },
  {
    name: "user email",
    base: LlmUserEmailBaseAttributeKeys,
    widened: LlmUserEmailAttributeKeys,
  },
  {
    name: "team",
    base: LlmTeamBaseAttributeKeys,
    widened: LlmTeamAttributeKeys,
  },
  {
    name: "end user",
    base: LlmEndUserBaseAttributeKeys,
    widened: LlmEndUserAttributeKeys,
  },
];

const ALL_STRING_LISTS: Record<string, Array<string>> = {
  ...PER_CALL_LISTS,
  LlmUserIdBaseAttributeKeys,
  LlmUserIdAttributeKeys,
  LlmUserEmailBaseAttributeKeys,
  LlmUserEmailAttributeKeys,
  LlmTeamBaseAttributeKeys,
  LlmTeamAttributeKeys,
  LlmEndUserBaseAttributeKeys,
  LlmEndUserAttributeKeys,
  LlmAttributeNamespacePrefixes,
  LlmPromptEventNames,
  LlmCompletionEventNames,
};

describe("RESOURCE_ATTRIBUTE_KEY_PREFIX", () => {
  test("is the exact prefix OTLP ingest stamps on resource attributes", () => {
    expect(RESOURCE_ATTRIBUTE_KEY_PREFIX).toBe("resource.");
  });
});

describe("withResourcePrefixedKeys", () => {
  test("returns an empty list for an empty input", () => {
    expect(withResourcePrefixedKeys([])).toEqual([]);
  });

  test("puts the whole bare block first, then the whole resource block, each in input order", () => {
    expect(withResourcePrefixedKeys(["a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
      "resource.a",
      "resource.b",
      "resource.c",
    ]);
  });

  test("does not interleave: the last bare key comes before the first resource key", () => {
    const widened: Array<string> = withResourcePrefixedKeys(["x", "y"]);

    expect(widened.indexOf("y")).toBeLessThan(widened.indexOf("resource.x"));
  });

  test("does not mutate its input", () => {
    const input: Array<string> = ["user.id", "team.id"];
    const snapshot: Array<string> = [...input];

    const widened: Array<string> = withResourcePrefixedKeys(input);

    expect(input).toEqual(snapshot);
    expect(widened).not.toBe(input);
  });

  test("returns a fresh array on every call", () => {
    const input: Array<string> = ["k"];

    expect(withResourcePrefixedKeys(input)).not.toBe(
      withResourcePrefixedKeys(input),
    );
  });

  test("always doubles the length, preserving duplicates as given", () => {
    expect(withResourcePrefixedKeys(["k", "k"])).toEqual([
      "k",
      "k",
      "resource.k",
      "resource.k",
    ]);
  });

  test("prefixes blindly, even a key that is already resource-prefixed or empty", () => {
    expect(withResourcePrefixedKeys(["resource.team"])).toEqual([
      "resource.team",
      "resource.resource.team",
    ]);
    expect(withResourcePrefixedKeys([""])).toEqual(["", "resource."]);
  });
});

describe("identity lists are resource-widened", () => {
  test.each(IDENTITY_TIERS)(
    "the $name list is exactly the widened base list",
    (tier: IdentityTier) => {
      expect(tier.widened).toEqual(withResourcePrefixedKeys(tier.base));
    },
  );

  test.each(IDENTITY_TIERS)(
    "the $name base list carries only span-attribute spellings",
    (tier: IdentityTier) => {
      for (const key of tier.base) {
        expect(key.startsWith(RESOURCE_ATTRIBUTE_KEY_PREFIX)).toBe(false);
      }
    },
  );

  test.each(IDENTITY_TIERS)(
    "every $name key has a resource-prefixed twin that sorts after every bare key",
    (tier: IdentityTier) => {
      const lastBareIndex: number = tier.base.length - 1;

      for (const key of tier.base) {
        const twinIndex: number = tier.widened.indexOf(
          `${RESOURCE_ATTRIBUTE_KEY_PREFIX}${key}`,
        );

        expect(twinIndex).toBeGreaterThan(lastBareIndex);
      }
    },
  );

  test("OTEL_RESOURCE_ATTRIBUTES=team.id=... is recognised in its ingested spelling", () => {
    expect(LlmTeamAttributeKeys).toContain("resource.team.id");
    expect(LlmTeamAttributeKeys).toContain("resource.cost_center");
    expect(LlmUserIdAttributeKeys).toContain("resource.cursor.user.id");
    expect(LlmTeamAttributeKeys).toContain("resource.cursor.team.id");
  });
});

describe("per-call lists are NOT resource-widened", () => {
  test.each(Object.keys(PER_CALL_LISTS))(
    "%s has no resource.* key",
    (listName: string) => {
      for (const key of PER_CALL_LISTS[listName]!) {
        expect(key.startsWith(RESOURCE_ATTRIBUTE_KEY_PREFIX)).toBe(false);
      }
    },
  );
});

describe("list hygiene", () => {
  test.each(Object.keys(ALL_STRING_LISTS))(
    "%s is non-empty, has no duplicates and no blank or padded keys",
    (listName: string) => {
      const list: Array<string> = ALL_STRING_LISTS[listName]!;

      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list).size).toBe(list.length);

      for (const key of list) {
        expect(key.trim()).toBe(key);
        expect(key.length).toBeGreaterThan(0);
        expect(key).not.toMatch(/\s/);
      }
    },
  );

  test("namespace prefixes all end with a dot so 'llm.' cannot match 'llmops.x'", () => {
    for (const prefix of LlmAttributeNamespacePrefixes) {
      expect(prefix.endsWith(".")).toBe(true);
    }

    expect(LlmAttributeNamespacePrefixes).toEqual([
      "gen_ai.",
      "llm.",
      "traceloop.",
    ]);
  });

  test("the preferred (first) key of every core list is in an LLM namespace", () => {
    const coreLists: Array<Array<string>> = [
      LlmSystemAttributeKeys,
      LlmOperationAttributeKeys,
      LlmRequestModelAttributeKeys,
      LlmResponseModelAttributeKeys,
      LlmInputTokenAttributeKeys,
      LlmOutputTokenAttributeKeys,
      LlmTotalTokenAttributeKeys,
      LlmCostAttributeKeys,
      LlmConversationIdAttributeKeys,
      LlmAgentNameAttributeKeys,
      LlmToolNameAttributeKeys,
      LlmTemperatureAttributeKeys,
      LlmMaxTokensAttributeKeys,
      LlmTopPAttributeKeys,
      LlmFinishReasonAttributeKeys,
    ];

    for (const list of coreLists) {
      expect(list[0]!.startsWith("gen_ai.")).toBe(true);
    }
  });
});

describe("preference ordering", () => {
  test("the OTel GenAI semconv spelling comes first", () => {
    expect(LlmSystemAttributeKeys[0]).toBe("gen_ai.system");
    expect(LlmOperationAttributeKeys[0]).toBe("gen_ai.operation.name");
    expect(LlmRequestModelAttributeKeys[0]).toBe("gen_ai.request.model");
    expect(LlmResponseModelAttributeKeys[0]).toBe("gen_ai.response.model");
    expect(LlmInputTokenAttributeKeys[0]).toBe("gen_ai.usage.input_tokens");
    expect(LlmOutputTokenAttributeKeys[0]).toBe("gen_ai.usage.output_tokens");
    expect(LlmConversationIdAttributeKeys[0]).toBe("gen_ai.conversation.id");
  });

  test("current token names are preferred over their deprecated prompt/completion spellings", () => {
    expect(
      LlmInputTokenAttributeKeys.indexOf("gen_ai.usage.input_tokens"),
    ).toBeLessThan(
      LlmInputTokenAttributeKeys.indexOf("gen_ai.usage.prompt_tokens"),
    );
    expect(
      LlmOutputTokenAttributeKeys.indexOf("gen_ai.usage.output_tokens"),
    ).toBeLessThan(
      LlmOutputTokenAttributeKeys.indexOf("gen_ai.usage.completion_tokens"),
    );
  });

  test("user.id is THE canonical employee key and the opaque cursor id sorts last", () => {
    expect(LlmUserIdBaseAttributeKeys[0]).toBe("user.id");
    expect(
      LlmUserIdBaseAttributeKeys[LlmUserIdBaseAttributeKeys.length - 1],
    ).toBe("cursor.user.id");
    expect(LlmUserEmailBaseAttributeKeys[0]).toBe("user.email");
    expect(LlmTeamBaseAttributeKeys[0]).toBe("team.id");
  });

  test("the JSON message arrays prefer the current gen_ai.*.messages keys", () => {
    expect(LlmPromptJsonAttributeKeys[0]).toBe("gen_ai.input.messages");
    expect(LlmCompletionJsonAttributeKeys[0]).toBe("gen_ai.output.messages");
  });
});

describe("LiteLLM spellings", () => {
  /*
   * The v1 default otel callback emits a bare "metadata." prefix; the opt-in
   * v2 mode emits "litellm.metadata.". Recognising only one silently loses
   * attribution for every deployment on the other.
   */
  const V2_PREFIX: string = "litellm.metadata.";
  const V1_PREFIX: string = "metadata.";

  test.each([
    ["user id", LlmUserIdBaseAttributeKeys],
    ["user email", LlmUserEmailBaseAttributeKeys],
    ["team", LlmTeamBaseAttributeKeys],
    ["end user", LlmEndUserBaseAttributeKeys],
  ])(
    "every v2 litellm.metadata.* %s key has its v1 metadata.* twin, listed after it",
    (_name: string, list: Array<string>) => {
      const v2Keys: Array<string> = list.filter((key: string) => {
        return key.startsWith(V2_PREFIX);
      });

      expect(v2Keys.length).toBeGreaterThan(0);

      for (const v2Key of v2Keys) {
        const v1Key: string = `${V1_PREFIX}${v2Key.slice(V2_PREFIX.length)}`;

        expect(list).toContain(v1Key);
        expect(list.indexOf(v2Key)).toBeLessThan(list.indexOf(v1Key));
      }
    },
  );

  test("the key-OWNER id is an employee key, and the END-USER id is not", () => {
    expect(LlmUserIdAttributeKeys).toContain("metadata.user_api_key_user_id");
    expect(LlmUserIdAttributeKeys).not.toContain(
      "metadata.user_api_key_end_user_id",
    );
    expect(LlmEndUserAttributeKeys).toContain(
      "metadata.user_api_key_end_user_id",
    );
    expect(LlmEndUserAttributeKeys).toContain("litellm.end_user.id");
  });
});

describe("the downstream customer is never read as the employee", () => {
  const EMPLOYEE_LISTS: Record<string, Array<string>> = {
    LlmUserIdAttributeKeys,
    LlmUserEmailAttributeKeys,
    LlmTeamAttributeKeys,
  };

  test.each(Object.keys(EMPLOYEE_LISTS))(
    "%s is disjoint from the end-user list in both tiers",
    (listName: string) => {
      const employeeKeys: Set<string> = new Set(EMPLOYEE_LISTS[listName]!);

      for (const endUserKey of LlmEndUserAttributeKeys) {
        expect(employeeKeys.has(endUserKey)).toBe(false);
      }
    },
  );

  test("the OpenAI `user` request parameter echoes are excluded in both tiers", () => {
    for (const key of [
      "gen_ai.user",
      "llm.user",
      "resource.gen_ai.user",
      "resource.llm.user",
    ]) {
      expect(LlmEndUserAttributeKeys).toContain(key);
      expect(LlmUserIdAttributeKeys).not.toContain(key);
      expect(LlmUserEmailAttributeKeys).not.toContain(key);
    }
  });

  test("id, email and team lists do not share keys with each other", () => {
    const id: Set<string> = new Set(LlmUserIdAttributeKeys);
    const email: Set<string> = new Set(LlmUserEmailAttributeKeys);

    for (const key of LlmTeamAttributeKeys) {
      expect(id.has(key)).toBe(false);
      expect(email.has(key)).toBe(false);
    }

    for (const key of LlmUserEmailAttributeKeys) {
      expect(id.has(key)).toBe(false);
    }
  });
});

describe("indexed message conventions", () => {
  const ALL_CONVENTIONS: Array<LlmIndexedMessageConvention> = [
    ...LlmPromptIndexedMessageConventions,
    ...LlmCompletionIndexedMessageConventions,
  ];

  test("each convention has non-empty parts with no leading/trailing dots", () => {
    for (const convention of ALL_CONVENTIONS) {
      for (const part of [
        convention.prefix,
        convention.contentSuffix,
        convention.roleSuffix,
      ]) {
        expect(part.length).toBeGreaterThan(0);
        expect(part.startsWith(".")).toBe(false);
        expect(part.endsWith(".")).toBe(false);
      }

      expect(convention.contentSuffix).not.toBe(convention.roleSuffix);
    }
  });

  test("composes into the exact OpenLLMetry and OpenInference attribute keys", () => {
    const compose: (
      convention: LlmIndexedMessageConvention,
      index: number,
    ) => { content: string; role: string } = (
      convention: LlmIndexedMessageConvention,
      index: number,
    ): { content: string; role: string } => {
      return {
        content: `${convention.prefix}.${index}.${convention.contentSuffix}`,
        role: `${convention.prefix}.${index}.${convention.roleSuffix}`,
      };
    };

    expect(compose(LlmPromptIndexedMessageConventions[0]!, 0)).toEqual({
      content: "gen_ai.prompt.0.content",
      role: "gen_ai.prompt.0.role",
    });
    expect(compose(LlmPromptIndexedMessageConventions[1]!, 2)).toEqual({
      content: "llm.input_messages.2.message.content",
      role: "llm.input_messages.2.message.role",
    });
    expect(compose(LlmCompletionIndexedMessageConventions[0]!, 1)).toEqual({
      content: "gen_ai.completion.1.content",
      role: "gen_ai.completion.1.role",
    });
    expect(compose(LlmCompletionIndexedMessageConventions[1]!, 0)).toEqual({
      content: "llm.output_messages.0.message.content",
      role: "llm.output_messages.0.message.role",
    });
  });

  test("prompt and completion conventions never share a prefix", () => {
    const promptPrefixes: Set<string> = new Set(
      LlmPromptIndexedMessageConventions.map(
        (convention: LlmIndexedMessageConvention) => {
          return convention.prefix;
        },
      ),
    );

    for (const convention of LlmCompletionIndexedMessageConventions) {
      expect(promptPrefixes.has(convention.prefix)).toBe(false);
    }
  });
});

describe("prompt vs completion content sources", () => {
  test("JSON attribute keys for prompts and completions are disjoint", () => {
    for (const key of LlmPromptJsonAttributeKeys) {
      expect(LlmCompletionJsonAttributeKeys).not.toContain(key);
    }
  });

  test("span-event names for prompts and completions are disjoint and all gen_ai.*", () => {
    for (const name of LlmPromptEventNames) {
      expect(LlmCompletionEventNames).not.toContain(name);
    }

    for (const name of [...LlmPromptEventNames, ...LlmCompletionEventNames]) {
      expect(name.startsWith("gen_ai.")).toBe(true);
    }
  });

  test("the assistant's own message is a completion, never a prompt", () => {
    expect(LlmCompletionEventNames).toContain("gen_ai.assistant.message");
    expect(LlmPromptEventNames).not.toContain("gen_ai.assistant.message");
    expect(LlmPromptEventNames).toContain("gen_ai.user.message");
  });
});
