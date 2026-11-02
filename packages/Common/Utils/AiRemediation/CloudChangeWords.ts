import {
  createTranslator,
  DEFAULT_LANGUAGE,
  PluralTemplate,
  TranslatableTerm,
  translatableTerm,
  translationKey,
  Translator,
} from "../../UI/Utils/TranslateTemplate";
import {
  CLOUD_RESOURCE_KINDS,
  CloudCatalogProvider,
  CloudCommandParse,
  CloudResourceKindSpec,
  getCloudCatalogProvider,
  ParsedCloudCommand,
  ParsedCloudResource,
  parseCloudCommand,
} from "./Resource/CloudOperationCatalog";
import {
  ResourceTokenizeResult,
  tokenizeResourceCommand,
} from "./Resource/ResourceCommandPolicyCore";

/*
 * A CLOUD CHANGE IN PLAIN WORDS.
 *
 * `cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/checkout-api
 * --count 8` is exact - it is what runs and what a person approves - but it
 * reads like a command, and the resource it changes hides at the end of an
 * ARN. So the Remediation step, the Slack and Microsoft Teams message and
 * the approval dialog put one sentence above it: "Scale the ECS service
 * checkout-api out to 8 tasks". The sentence is read from the command by the
 * catalog's own grammar (CloudOperationCatalog), never from the model's
 * words, so it can only ever say what the command does; the command stays
 * right under it, and is still what runs.
 *
 * Every sentence and kind of resource is a translationKey: the Dashboard
 * words it in the reader's language, the server and the chat messages in
 * English. Null for a command the catalog does not read as a change.
 */

export interface CloudChangeWords {
  // The catalog's operation: "scale-out".
  operation: string;
  // The kind of resource, as the catalog names it: "ECS service".
  kindName: string;
  // The resource, by the short name its id carries: "checkout-api".
  resourceName: string;
  // The sentence, in the translator's language.
  sentence: string;
}

/*
 * The catalog's kinds of resource, as the sentences name them - the
 * catalog's own display names (CLOUD_RESOURCE_KINDS), here as translation
 * keys, since the catalog itself is the agent's import-closed copy.
 * CloudChangeWords.test holds the two lists to the same words, but for a
 * kind whose display name does not say whose it is: "virtual machine" is
 * an "Azure virtual machine" here, as "EC2 instance" and "Compute Engine
 * VM" say theirs.
 */
export const CLOUD_KIND_WORDS: Readonly<Record<string, string>> = {
  "aws:ecs-service": translationKey("ECS service"),
  "aws:ec2-instance": translationKey("EC2 instance"),
  "aws:rds-instance": translationKey("RDS instance"),
  "aws:rds-cluster": translationKey("Aurora cluster"),
  "aws:autoscaling-group": translationKey("Auto Scaling group"),
  "aws:lambda-function": translationKey("Lambda function"),
  "aws:lambda-alias": translationKey("Lambda alias"),
  "aws:sqs-queue": translationKey("SQS queue"),
  "aws:elb-target-group": translationKey("target group"),
  "aws:elb-load-balancer": translationKey("load balancer"),
  "azure:app-service": translationKey("App Service or Function App"),
  "azure:app-service-plan": translationKey("App Service plan"),
  "azure:container-app": translationKey("Container App"),
  "azure:virtual-machine": translationKey("Azure virtual machine"),
  "azure:vm-scale-set": translationKey("VM scale set"),
  "azure:postgresql-flexible-server": translationKey(
    "PostgreSQL flexible server",
  ),
  "azure:mysql-flexible-server": translationKey("MySQL flexible server"),
  "azure:sql-failover-group": translationKey("SQL failover group"),
  "gcp:compute-instance": translationKey("Compute Engine VM"),
  "gcp:cloud-run-service": translationKey("Cloud Run service"),
  "gcp:managed-instance-group": translationKey("managed instance group"),
  "gcp:cloud-sql-instance": translationKey("Cloud SQL instance"),
};

// What a scale counts, by kind: tasks, instances, or the instances kept warm.
type ScaleUnit = "tasks" | "instances" | "minimumInstances";

const SCALE_UNITS: Readonly<Record<string, ScaleUnit>> = {
  "aws:ecs-service": "tasks",
  "aws:autoscaling-group": "instances",
  "azure:app-service-plan": "instances",
  "azure:vm-scale-set": "instances",
  "gcp:cloud-run-service": "minimumInstances",
  "gcp:managed-instance-group": "instances",
};

export const CLOUD_CHANGE_SENTENCES: {
  restartService: string;
  startInstance: string;
  rebootInstance: string;
  rollBackToPrevious: string;
  rollBackToVersion: string;
  swapSlot: string;
  removeConcurrencyLimit: string;
  failOverDatabase: string;
  stopInstance: string;
  redriveQueue: string;
} = {
  restartService: translationKey("Restart the {{kind}} {{name}}"),
  startInstance: translationKey("Start the {{kind}} {{name}}"),
  rebootInstance: translationKey("Reboot the {{kind}} {{name}}"),
  rollBackToPrevious: translationKey(
    "Roll the {{kind}} {{name}} back to the version before",
  ),
  rollBackToVersion: translationKey(
    "Roll the {{kind}} {{name}} back to {{version}}",
  ),
  swapSlot: translationKey(
    "Swap the {{kind}} {{name}} with its {{slot}} slot, back to the version before",
  ),
  removeConcurrencyLimit: translationKey(
    "Remove the limit on how many copies of the {{kind}} {{name}} run at once",
  ),
  failOverDatabase: translationKey(
    "Fail the {{kind}} {{name}} over to its standby",
  ),
  stopInstance: translationKey("Stop the {{kind}} {{name}}"),
  redriveQueue: translationKey(
    "Move the messages of the {{kind}} {{name}} back to the queue they came from",
  ),
};

export const CLOUD_SCALE_SENTENCES: Readonly<
  Record<"out" | "in", Record<ScaleUnit, PluralTemplate>>
> = {
  out: {
    tasks: {
      one: "Scale the {{kind}} {{name}} out to {{count}} task",
      other: "Scale the {{kind}} {{name}} out to {{count}} tasks",
    },
    instances: {
      one: "Scale the {{kind}} {{name}} out to {{count}} instance",
      other: "Scale the {{kind}} {{name}} out to {{count}} instances",
    },
    minimumInstances: {
      one: "Raise the minimum of the {{kind}} {{name}} to {{count}} instance",
      other:
        "Raise the minimum of the {{kind}} {{name}} to {{count}} instances",
    },
  },
  in: {
    tasks: {
      one: "Scale the {{kind}} {{name}} in to {{count}} task",
      other: "Scale the {{kind}} {{name}} in to {{count}} tasks",
    },
    instances: {
      one: "Scale the {{kind}} {{name}} in to {{count}} instance",
      other: "Scale the {{kind}} {{name}} in to {{count}} instances",
    },
    minimumInstances: {
      one: "Lower the minimum of the {{kind}} {{name}} to {{count}} instance",
      other:
        "Lower the minimum of the {{kind}} {{name}} to {{count}} instances",
    },
  },
};

export const CLOUD_CONCURRENCY_SENTENCE: PluralTemplate = {
  one: "Let at most {{count}} copy of the {{kind}} {{name}} run at once",
  other: "Let at most {{count}} copies of the {{kind}} {{name}} run at once",
};

// The longest name a sentence shows; the command under it is whole.
const MAX_SHOWN_NAME_LENGTH: number = 96;

// Where an id the catalog has no kind for breaks into words.
const ID_WORD_SEPARATOR: RegExp = /[/:]/;

function shown(text: string): string {
  return text.length > MAX_SHOWN_NAME_LENGTH
    ? `${text.slice(0, MAX_SHOWN_NAME_LENGTH)}...`
    : text;
}

/*
 * The short name a resource's id carries: an ECS service's or a database's
 * name, an EC2 instance's id, a Lambda function (and its alias), a queue.
 */
export function getCloudResourceShortName(
  resource: ParsedCloudResource,
): string {
  const parts: Record<string, string> = resource.parts || {};

  if (parts["functionName"]) {
    return shown(
      parts["alias"]
        ? `${parts["functionName"]}:${parts["alias"]}`
        : parts["functionName"],
    );
  }

  const name: string =
    parts["name"] || parts["instanceId"] || parts["queueName"] || "";

  if (name) {
    return shown(name);
  }

  // The id's last word: what is left of an id the catalog has no kind for.
  const words: Array<string> = resource.id.split(ID_WORD_SEPARATOR);

  return shown(words[words.length - 1] || resource.id);
}

function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function describeParsedChange(
  command: ParsedCloudCommand,
  translator: Translator,
): CloudChangeWords | null {
  const resource: ParsedCloudResource | null = command.resource;

  if (!resource || !resource.kind) {
    return null;
  }

  const kindKey: string = `${resource.provider}:${resource.kind}`;
  const kindName: string | undefined = CLOUD_KIND_WORDS[kindKey];

  if (!kindName) {
    return null;
  }

  const name: string = getCloudResourceShortName(resource);
  const values: { kind: TranslatableTerm; name: string } = {
    kind: translatableTerm(kindName),
    name,
  };
  const flags: Record<string, unknown> = command.flags || {};
  const operation: string = command.operation.name;
  let sentence: string | null = null;

  switch (operation) {
    case "restart-service":
      sentence = translator.translateTemplate(
        CLOUD_CHANGE_SENTENCES.restartService,
        values,
      );
      break;
    case "start-instance":
      sentence = translator.translateTemplate(
        CLOUD_CHANGE_SENTENCES.startInstance,
        values,
      );
      break;
    case "reboot-instance":
      sentence = translator.translateTemplate(
        CLOUD_CHANGE_SENTENCES.rebootInstance,
        values,
      );
      break;
    case "stop-instance":
      sentence = translator.translateTemplate(
        CLOUD_CHANGE_SENTENCES.stopInstance,
        values,
      );
      break;
    case "fail-over-database":
      sentence = translator.translateTemplate(
        CLOUD_CHANGE_SENTENCES.failOverDatabase,
        values,
      );
      break;
    case "redrive-queue":
      sentence = translator.translateTemplate(
        CLOUD_CHANGE_SENTENCES.redriveQueue,
        values,
      );
      break;
    case "scale-out":
    case "scale-in": {
      const count: number | null = readCount(flags["count"]);
      const unit: ScaleUnit | undefined = SCALE_UNITS[kindKey];

      if (count === null || !unit) {
        return null;
      }

      sentence = translator.translatePlural(
        CLOUD_SCALE_SENTENCES[operation === "scale-out" ? "out" : "in"][unit],
        count,
        values,
      );
      break;
    }
    case "roll-back-service": {
      const slot: unknown = flags["slot"];
      const to: unknown = flags["to"];

      if (typeof slot === "string" && slot) {
        sentence = translator.translateTemplate(
          CLOUD_CHANGE_SENTENCES.swapSlot,
          { ...values, slot: shown(slot) },
        );
      } else if (typeof to === "string" && to) {
        sentence = translator.translateTemplate(
          CLOUD_CHANGE_SENTENCES.rollBackToVersion,
          { ...values, version: shown(to) },
        );
      } else {
        sentence = translator.translateTemplate(
          CLOUD_CHANGE_SENTENCES.rollBackToPrevious,
          values,
        );
      }
      break;
    }
    case "set-concurrency": {
      const value: unknown = flags["value"];
      const count: number | null = readCount(value);

      if (count !== null) {
        sentence = translator.translatePlural(
          CLOUD_CONCURRENCY_SENTENCE,
          count,
          values,
        );
      } else if (value === "none" || value === null) {
        sentence = translator.translateTemplate(
          CLOUD_CHANGE_SENTENCES.removeConcurrencyLimit,
          values,
        );
      }
      break;
    }
    default:
      return null;
  }

  if (!sentence) {
    return null;
  }

  return { operation, kindName, resourceName: name, sentence };
}

/*
 * A cloud change in plain words, in the translator's language (English when
 * none is given). `resourceType` is the agent's (AwsAccount,
 * AzureSubscription, GoogleCloudProject). Null for anything that is not a
 * change of the catalog: a read, a dry run, another resource's command, a
 * command that does not parse. Never throws.
 */
export function describeCloudChange(data: {
  resourceType: unknown;
  command: string;
  translator?: Translator | undefined;
}): CloudChangeWords | null {
  try {
    const provider: CloudCatalogProvider | null = getCloudCatalogProvider(
      data.resourceType,
    );

    if (!provider || typeof data.command !== "string") {
      return null;
    }

    const tokens: ResourceTokenizeResult = tokenizeResourceCommand(
      data.command,
    );

    if (!tokens.argv) {
      return null;
    }

    const parse: CloudCommandParse = parseCloudCommand(provider, tokens.argv);

    if (!parse.ok) {
      return null;
    }

    return describeParsedChange(
      parse.command,
      data.translator || createTranslator(undefined, DEFAULT_LANGUAGE),
    );
  } catch {
    return null;
  }
}

// Every kind the catalog knows, with its words (for the suites).
export function getCloudKindWordsKeys(): Array<string> {
  return CLOUD_RESOURCE_KINDS.map((spec: CloudResourceKindSpec): string => {
    return `${spec.provider}:${spec.kind}`;
  });
}
