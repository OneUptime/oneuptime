import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AuditLogExportDestinationCatalog,
  AuditLogExportDestinationDefinition,
} from "../../../Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import AuditLogExportDestinationType from "../../../Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  BackupProvider,
  BackupProviderCatalog,
  BackupProviderDefinition,
} from "../../../Types/Backup/BackupDestinationCatalog";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionCatalog,
  CloudConnectionDefinition,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import LlmType from "../../../Types/LLM/LlmType";
import {
  LlmConnectionCatalog,
  LlmConnectionDefinition,
} from "../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../Types/LlmObservability/LlmConnectionProvider";
import ProviderLogo, {
  isProviderLogo,
} from "../../../Types/ProviderLogo/ProviderLogo";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventDestinationCatalog,
  SecurityEventDestinationDefinition,
} from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationProvider from "../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import ComponentMetadata, {
  ComponentCategory,
} from "../../../Types/Workflow/Component";
import Components, { Categories } from "../../../Types/Workflow/Components";
import {
  LLM_PROVIDER_TYPES,
  LLM_PROVIDER_TYPE_COPY,
} from "../../../UI/Components/AI/LlmProviderFormCopy";
import {
  PROVIDER_LOGO_FILE_LOADERS,
  getProviderLogoFileName,
} from "../../../UI/Components/ProviderLogo/ProviderLogoAssets";

/*
 * Official logos audit: every catalog entry that names another company's
 * product carries that product's logo - registered, with its file in the
 * installation - and an entry that names a generic thing (any S3-compatible
 * storage, a webhook, syslog, a server that speaks OpenAI's API) carries
 * none, so it keeps its icon. The expected logo of every entry is written
 * out here: a new entry, or a changed one, has to say which it is.
 */

const LOGOS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "UI",
  "Images",
  "ProviderLogos",
);

// The logo has a loader and its file is on disk.
function expectLogoShipped(logo: ProviderLogo): void {
  const fileName: string = getProviderLogoFileName(logo, false);

  expect({ logo, isLogo: isProviderLogo(logo) }).toEqual({
    logo,
    isLogo: true,
  });
  expect({
    logo,
    hasLoader: Boolean(PROVIDER_LOGO_FILE_LOADERS[fileName]),
  }).toEqual({
    logo,
    hasLoader: true,
  });
  expect({
    logo,
    onDisk: fs.existsSync(path.join(LOGOS_DIRECTORY, fileName)),
  }).toEqual({ logo, onDisk: true });
}

interface Entry {
  name: string;
  logo: ProviderLogo | undefined;
}

// Every entry has the logo written for it, and every logo it has is shipped.
function expectCatalog(
  entries: Array<Entry>,
  expected: Record<string, ProviderLogo | undefined>,
): void {
  expect(
    entries
      .map((entry: Entry): string => {
        return entry.name;
      })
      .sort(),
  ).toEqual(Object.keys(expected).sort());

  for (const entry of entries) {
    expect({ entry: entry.name, logo: entry.logo }).toEqual({
      entry: entry.name,
      logo: expected[entry.name],
    });

    if (entry.logo) {
      expectLogoShipped(entry.logo);
    }
  }
}

describe("audit log export destinations", () => {
  test("the services are drawn by their logos; webhook, syslog and any S3-compatible storage keep their icons", () => {
    expectCatalog(
      AuditLogExportDestinationCatalog.map(
        (definition: AuditLogExportDestinationDefinition): Entry => {
          return { name: definition.type, logo: definition.logo };
        },
      ),
      {
        [AuditLogExportDestinationType.AmazonS3]: ProviderLogo.AmazonS3,
        [AuditLogExportDestinationType.S3Compatible]: undefined,
        [AuditLogExportDestinationType.GoogleCloudStorage]:
          ProviderLogo.GoogleCloudStorage,
        [AuditLogExportDestinationType.AzureBlobStorage]:
          ProviderLogo.AzureBlobStorage,
        [AuditLogExportDestinationType.Webhook]: undefined,
        [AuditLogExportDestinationType.Syslog]: undefined,
      },
    );
  });

  // The maintainer's screenshot: six cards with six grey outline icons.
  test("the destination step shows three logos and three icons", () => {
    const withLogo: Array<string> = AuditLogExportDestinationCatalog.filter(
      (definition: AuditLogExportDestinationDefinition): boolean => {
        return Boolean(definition.logo);
      },
    ).map((definition: AuditLogExportDestinationDefinition): string => {
      return definition.title;
    });

    expect(withLogo).toEqual([
      "Amazon S3",
      "Google Cloud Storage",
      "Azure Blob Storage",
    ]);
  });
});

describe("backup destinations", () => {
  test("each storage provider is drawn by its logo; other S3-compatible storage keeps its icon", () => {
    expectCatalog(
      BackupProviderCatalog.map(
        (definition: BackupProviderDefinition): Entry => {
          return { name: definition.provider, logo: definition.logo };
        },
      ),
      {
        [BackupProvider.AmazonS3]: ProviderLogo.AmazonS3,
        [BackupProvider.CloudflareR2]: ProviderLogo.Cloudflare,
        [BackupProvider.BackblazeB2]: ProviderLogo.Backblaze,
        [BackupProvider.Wasabi]: ProviderLogo.Wasabi,
        [BackupProvider.MinIO]: ProviderLogo.MinIO,
        [BackupProvider.GoogleCloudStorage]: ProviderLogo.GoogleCloudStorage,
        [BackupProvider.AzureBlobStorage]: ProviderLogo.AzureBlobStorage,
        [BackupProvider.OtherS3Compatible]: undefined,
      },
    );
  });

  test("a backup to a service shows the same logo as an audit log export to it", () => {
    const byTitle: Map<string, ProviderLogo | undefined> = new Map(
      AuditLogExportDestinationCatalog.map(
        (
          definition: AuditLogExportDestinationDefinition,
        ): [string, ProviderLogo | undefined] => {
          return [definition.title, definition.logo];
        },
      ),
    );

    for (const definition of BackupProviderCatalog) {
      if (byTitle.has(definition.title)) {
        expect({ title: definition.title, logo: definition.logo }).toEqual({
          title: definition.title,
          logo: byTitle.get(definition.title),
        });
      }
    }
  });
});

describe("cloud connections", () => {
  test("each cloud is drawn by its own logo", () => {
    expectCatalog(
      CloudConnectionCatalog.map(
        (definition: CloudConnectionDefinition): Entry => {
          return { name: definition.provider, logo: definition.logo };
        },
      ),
      {
        [CloudProvider.AWS]: ProviderLogo.Aws,
        [CloudProvider.Azure]: ProviderLogo.Azure,
        [CloudProvider.GCP]: ProviderLogo.GoogleCloud,
      },
    );
  });
});

describe("AI / LLM connections", () => {
  test("each provider account and company tool is drawn by its product's logo", () => {
    expectCatalog(
      LlmConnectionCatalog.map((definition: LlmConnectionDefinition): Entry => {
        return { name: definition.provider, logo: definition.logo };
      }),
      {
        [LlmConnectionProvider.OpenAI]: ProviderLogo.OpenAI,
        [LlmConnectionProvider.Anthropic]: ProviderLogo.Anthropic,
        [LlmConnectionProvider.AzureOpenAI]: ProviderLogo.AzureOpenAI,
        [LlmConnectionProvider.AwsBedrock]: ProviderLogo.AmazonBedrock,
        [LlmConnectionProvider.GoogleVertexAI]: ProviderLogo.GoogleVertexAI,
        [LlmConnectionProvider.ClaudeEnterprise]: ProviderLogo.Claude,
        [LlmConnectionProvider.Microsoft365Copilot]:
          ProviderLogo.MicrosoftCopilot,
      },
    );
  });
});

describe("LLM providers (Settings > AI and the Admin Dashboard)", () => {
  test("each provider type is drawn by its logo; an OpenAI-compatible server keeps its icon", () => {
    expectCatalog(
      LLM_PROVIDER_TYPES.map((type: LlmType): Entry => {
        return { name: type, logo: LLM_PROVIDER_TYPE_COPY[type].logo };
      }),
      {
        [LlmType.OpenAI]: ProviderLogo.OpenAI,
        [LlmType.Anthropic]: ProviderLogo.Anthropic,
        [LlmType.AzureOpenAI]: ProviderLogo.AzureOpenAI,
        [LlmType.Groq]: ProviderLogo.Groq,
        [LlmType.Mistral]: ProviderLogo.MistralAI,
        [LlmType.Ollama]: ProviderLogo.Ollama,
        [LlmType.OpenAICompatible]: undefined,
      },
    );
  });
});

describe("Security Events", () => {
  test("each connector is drawn by its product's logo", () => {
    expectCatalog(
      SecurityEventConnectorCatalog.map(
        (definition: SecurityEventConnectorDefinition): Entry => {
          return { name: definition.provider, logo: definition.logo };
        },
      ),
      {
        [SecurityEventConnectorProvider.MicrosoftSentinel]:
          ProviderLogo.MicrosoftSentinel,
        [SecurityEventConnectorProvider.MicrosoftDefenderXdr]:
          ProviderLogo.MicrosoftDefender,
        [SecurityEventConnectorProvider.CrowdStrikeFalcon]:
          ProviderLogo.CrowdStrike,
        [SecurityEventConnectorProvider.SplunkEnterpriseSecurity]:
          ProviderLogo.Splunk,
        [SecurityEventConnectorProvider.ElasticSecurity]: ProviderLogo.Elastic,
        [SecurityEventConnectorProvider.AwsSecurityHub]:
          ProviderLogo.AwsSecurityHub,
        [SecurityEventConnectorProvider.OktaSystemLog]: ProviderLogo.Okta,
        [SecurityEventConnectorProvider.GoogleSecOps]:
          ProviderLogo.GoogleSecurityOperations,
      },
    );
  });

  test("each SIEM destination is drawn by its product's logo, the same as the connector from it", () => {
    expectCatalog(
      SecurityEventDestinationCatalog.map(
        (definition: SecurityEventDestinationDefinition): Entry => {
          return { name: definition.provider, logo: definition.logo };
        },
      ),
      {
        [SecurityEventDestinationProvider.GoogleSecOps]:
          ProviderLogo.GoogleSecurityOperations,
        [SecurityEventDestinationProvider.Splunk]: ProviderLogo.Splunk,
        [SecurityEventDestinationProvider.MicrosoftSentinel]:
          ProviderLogo.MicrosoftSentinel,
        [SecurityEventDestinationProvider.ElasticSecurity]:
          ProviderLogo.Elastic,
      },
    );
  });

  test("no two connectors share a logo, so the empty state's tiles tell apart", () => {
    const logos: Array<ProviderLogo> = SecurityEventConnectorCatalog.map(
      (definition: SecurityEventConnectorDefinition): ProviderLogo => {
        return definition.logo;
      },
    );

    expect(new Set(logos).size).toBe(logos.length);
  });
});

describe("workflow steps that talk to a chat product", () => {
  const CHAT_LOGOS: Record<string, ProviderLogo> = {
    Slack: ProviderLogo.Slack,
    Discord: ProviderLogo.Discord,
    "Microsoft Teams": ProviderLogo.MicrosoftTeams,
    Telegram: ProviderLogo.Telegram,
    Mattermost: ProviderLogo.Mattermost,
  };

  test("each chat product's category and steps carry its logo", () => {
    for (const [category, logo] of Object.entries(CHAT_LOGOS)) {
      const info: ComponentCategory | undefined = Categories.find(
        (candidate: ComponentCategory): boolean => {
          return candidate.name === category;
        },
      );

      expect({ category, logo: info?.logo }).toEqual({ category, logo });
      expectLogoShipped(logo);

      const steps: Array<ComponentMetadata> = Components.filter(
        (component: ComponentMetadata): boolean => {
          return component.category === category;
        },
      );

      expect(steps.length).toBeGreaterThan(0);

      for (const step of steps) {
        expect({ step: step.id, logo: step.logo }).toEqual({
          step: step.id,
          logo,
        });
      }
    }
  });

  test("every other step and category keeps its icon: only a product's own steps carry a logo", () => {
    for (const component of Components) {
      if (CHAT_LOGOS[component.category]) {
        continue;
      }

      expect({ step: component.id, logo: component.logo }).toEqual({
        step: component.id,
        logo: undefined,
      });
    }

    for (const category of Categories) {
      if (CHAT_LOGOS[category.name]) {
        continue;
      }

      expect({ category: category.name, logo: category.logo }).toEqual({
        category: category.name,
        logo: undefined,
      });
    }
  });

  test("IRC is a protocol, not a product: its category has no logo", () => {
    const irc: ComponentCategory | undefined = Categories.find(
      (candidate: ComponentCategory): boolean => {
        return candidate.name === "IRC";
      },
    );

    expect(irc).toBeDefined();
    expect(irc?.logo).toBeUndefined();
  });
});
