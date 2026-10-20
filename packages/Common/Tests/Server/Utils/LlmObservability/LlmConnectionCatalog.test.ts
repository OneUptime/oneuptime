import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import LlmConnectorRegistry from "../../../../Server/Utils/LlmObservability/LlmConnectorRegistry";
import { LlmConnector } from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import {
  LlmConnectionCatalog,
  LlmConnectionDefinition,
  LlmConnectionField,
  LlmConnectionKind,
  getLlmConnectionDefinition,
  getLlmConnectionDefinitionsOfKind,
  getLlmConnectionTitle,
  isCompanyToolProvider,
} from "../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider, {
  AllLlmConnectionProviders,
  isLlmConnectionProvider,
} from "../../../../Types/LlmObservability/LlmConnectionProvider";
import LlmConversationReaders, {
  isLlmConversationReaders,
} from "../../../../Types/LlmObservability/LlmConversationReaders";

/*
 * The catalog, the registry and the connectors describe one set of
 * connections: every provider has one definition and one connector of the
 * same kind, every setting a connector reads is a field its form asks for,
 * a secret is never a plain text field, and a folded field never blocks a
 * save.
 */

const CONNECTORS_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Utils/LlmObservability/Connectors",
);

// Each provider's connector folder.
const CONNECTOR_FOLDERS: Record<LlmConnectionProvider, Array<string>> = {
  [LlmConnectionProvider.OpenAI]: ["OpenAI"],
  [LlmConnectionProvider.Anthropic]: ["Anthropic"],
  [LlmConnectionProvider.AzureOpenAI]: ["AzureOpenAI", "Microsoft"],
  [LlmConnectionProvider.AwsBedrock]: ["AwsBedrock"],
  [LlmConnectionProvider.GoogleVertexAI]: ["GoogleVertexAI"],
  [LlmConnectionProvider.ClaudeEnterprise]: ["ClaudeEnterprise"],
  [LlmConnectionProvider.Microsoft365Copilot]: [
    "Microsoft365Copilot",
    "Microsoft",
  ],
};

// The settings a connector's code reads, by the keys it reads them with.
function settingsReadIn(folders: Array<string>): {
  config: Set<string>;
  secrets: Set<string>;
} {
  const read: { config: Set<string>; secrets: Set<string> } = {
    config: new Set<string>(),
    secrets: new Set<string>(),
  };
  const pattern: RegExp =
    /readSetting\(\s*settings\.(config|secrets),\s*"([A-Za-z]{1,64})"/g;

  for (const folder of folders) {
    for (const file of fs.readdirSync(
      path.join(CONNECTORS_DIRECTORY, folder),
    )) {
      const source: string = fs.readFileSync(
        path.join(CONNECTORS_DIRECTORY, folder, file),
        "utf8",
      );

      for (const match of source.matchAll(pattern)) {
        read[match[1] as "config" | "secrets"].add(match[2]!);
      }
    }
  }

  return read;
}

function keysOf(fields: Array<LlmConnectionField>): Array<string> {
  return fields.map((field: LlmConnectionField) => {
    return field.key;
  });
}

describe("LlmConnectionCatalog", () => {
  test("every provider has exactly one definition, in the order the Connect page offers them", () => {
    expect(
      LlmConnectionCatalog.map((definition: LlmConnectionDefinition) => {
        return definition.provider;
      }),
    ).toEqual(AllLlmConnectionProviders);
  });

  test("provider accounts and company AI tools", () => {
    expect(
      getLlmConnectionDefinitionsOfKind(LlmConnectionKind.CompanyTool).map(
        (definition: LlmConnectionDefinition) => {
          return definition.provider;
        },
      ),
    ).toEqual([
      LlmConnectionProvider.ClaudeEnterprise,
      LlmConnectionProvider.Microsoft365Copilot,
    ]);
    expect(isCompanyToolProvider(LlmConnectionProvider.ClaudeEnterprise)).toBe(
      true,
    );
    expect(isCompanyToolProvider(LlmConnectionProvider.OpenAI)).toBe(false);
    expect(isCompanyToolProvider("not-a-provider")).toBe(false);
    expect(isCompanyToolProvider(null)).toBe(false);
  });

  test.each(
    LlmConnectionCatalog.map(
      (
        definition: LlmConnectionDefinition,
      ): [string, LlmConnectionDefinition] => {
        return [definition.provider, definition];
      },
    ),
  )(
    "%s is complete",
    (_provider: string, definition: LlmConnectionDefinition) => {
      for (const words of [
        definition.title,
        definition.description,
        definition.summary,
        definition.hint,
      ]) {
        expect(words.trim().length).toBeGreaterThan(3);
        // The words are translated; a product name a licence replaces is never in them.
        expect(words).not.toContain("OneUptime");
      }

      expect(definition.docsPath).toMatch(
        definition.kind === LlmConnectionKind.CompanyTool
          ? /^\/docs\/telemetry\/ai-company-tools#[a-z0-9-]+$/
          : /^\/docs\/telemetry\/ai-provider-accounts#[a-z0-9-]+$/,
      );
      expect(definition.genAiProviderName).toMatch(/^[a-z0-9._]+$/);
      expect(definition.defaultServiceName.length).toBeGreaterThan(0);
      expect(definition.pullIntervalInMinutes).toBeGreaterThanOrEqual(5);
      expect(definition.backfillDays).toBe(
        definition.kind === LlmConnectionKind.CompanyTool ? 7 : 30,
      );
      // Only the providers that report no money are estimated.
      expect(definition.costIsEstimated).toBe(
        [
          LlmConnectionProvider.AzureOpenAI,
          LlmConnectionProvider.AwsBedrock,
          LlmConnectionProvider.GoogleVertexAI,
        ].includes(definition.provider),
      );
      // A company tool's chats carry no tokens to price.
      if (definition.kind === LlmConnectionKind.CompanyTool) {
        expect(definition.costIsEstimated).toBe(false);
      }

      const keys: Array<string> = [
        ...keysOf(definition.configFields),
        ...keysOf(definition.secretFields),
      ];
      expect(new Set(keys).size).toBe(keys.length);
      expect(definition.secretFields.length).toBeGreaterThan(0);

      for (const field of definition.secretFields) {
        // A secret is typed into a password box or pasted as a key file.
        expect(["password", "json"]).toContain(field.type);
        expect(field.description).toContain("never shown again");
      }

      for (const field of definition.configFields) {
        expect(field.type).not.toBe("password");

        if (field.type === "dropdown") {
          expect((field.options || []).length).toBeGreaterThan(0);
          if (field.defaultValue !== undefined) {
            expect(
              (field.options || []).map((option: { value: string }) => {
                return option.value;
              }),
            ).toContain(field.defaultValue);
          }
        }

        // A field folded under "More options" never blocks a save.
        if (field.isAdvanced) {
          expect(!field.required || field.defaultValue !== undefined).toBe(
            true,
          );
        }
      }
    },
  );

  test("lookups", () => {
    expect(getLlmConnectionDefinition("openai")?.title).toBe("OpenAI");
    expect(getLlmConnectionDefinition("nope")).toBeUndefined();
    expect(getLlmConnectionTitle(LlmConnectionProvider.AwsBedrock)).toBe(
      "Amazon Bedrock",
    );
    expect(getLlmConnectionTitle("unknown-thing")).toBe("unknown-thing");
    expect(getLlmConnectionTitle(undefined)).toBe("");
    expect(isLlmConnectionProvider("openai")).toBe(true);
    expect(isLlmConnectionProvider("OpenAI")).toBe(false);
    expect(isLlmConnectionProvider(7)).toBe(false);
    expect(isLlmConversationReaders(LlmConversationReaders.Admins)).toBe(true);
    expect(isLlmConversationReaders("members")).toBe(false);
  });
});

describe("LlmConnectorRegistry", () => {
  test("every provider has a connector of its definition's kind", () => {
    const connectors: Array<LlmConnector> =
      LlmConnectorRegistry.getAllConnectors();

    expect(connectors).toHaveLength(AllLlmConnectionProviders.length);

    for (const connector of connectors) {
      const definition: LlmConnectionDefinition = getLlmConnectionDefinition(
        connector.provider,
      )!;
      expect(definition).toBeDefined();
      expect(connector.kind).toBe(definition.kind);
      expect(LlmConnectorRegistry.getConnector(definition.provider)).toBe(
        connector,
      );
    }

    expect(() => {
      return LlmConnectorRegistry.getConnector("nope" as LlmConnectionProvider);
    }).toThrow('No connector for provider "nope".');
  });

  test.each(AllLlmConnectionProviders)(
    "every setting the %s connector reads is a field its form asks for",
    (provider: LlmConnectionProvider) => {
      const definition: LlmConnectionDefinition =
        getLlmConnectionDefinition(provider)!;
      const read: { config: Set<string>; secrets: Set<string> } =
        settingsReadIn(CONNECTOR_FOLDERS[provider]);

      expect(read.secrets.size).toBeGreaterThan(0);

      const configKeys: Array<string> = keysOf(definition.configFields);
      const secretKeys: Array<string> = keysOf(definition.secretFields);

      for (const key of read.secrets) {
        // The Microsoft folder serves two providers: only this one's keys count.
        if (
          CONNECTOR_FOLDERS[provider].length > 1 &&
          !secretKeys.includes(key)
        ) {
          continue;
        }
        expect(secretKeys).toContain(key);
      }

      for (const key of secretKeys) {
        expect(read.secrets.has(key)).toBe(true);
      }

      for (const key of configKeys) {
        expect(read.config.has(key)).toBe(true);
      }

      for (const key of read.config) {
        if (
          CONNECTOR_FOLDERS[provider].length > 1 &&
          !configKeys.includes(key)
        ) {
          continue;
        }
        expect(configKeys).toContain(key);
      }
    },
  );
});
