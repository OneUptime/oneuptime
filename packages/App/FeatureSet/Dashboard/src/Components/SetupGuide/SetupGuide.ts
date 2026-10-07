/*
 * The shape every in-app setup guide is built from — Kubernetes, Docker,
 * Podman, Docker Swarm, Ceph, Proxmox, VMware, hosts, IoT, databases, cloud
 * environments, serverless functions, RUM applications and message queues.
 *
 * A guide used to be one long markdown document: every platform's commands
 * one after another, then every configuration option, upgrade note and
 * troubleshooting entry. The reader had to find their own path through it.
 * Now a guide is data, and SetupGuideCard lays it out the same way for every
 * resource:
 *
 *   1. an option picker at the top ("Where is your cluster running?"), so
 *      only the chosen platform's instructions are on screen;
 *   2. a few numbered steps — the key, then the commands to run, then how to
 *      check it worked;
 *   3. everything else (tuning, upgrades, reference tables) folded away under
 *      Advanced, and known problems under Troubleshooting.
 *
 * Pure on purpose: plain strings in, plain objects out, no React and no API,
 * so each guide's content can be tested without rendering anything.
 */

// One choice in the picker at the top of a guide.
export interface SetupGuideOption<TKey extends string = string> {
  key: TKey;
  label: string;
  description?: string | undefined;
  // A short tag next to the label, e.g. "Recommended".
  badge?: string | undefined;
  /*
   * Options with the same group are shown together under that heading (cloud
   * platforms by provider). Options without one are shown first.
   */
  group?: string | undefined;
}

/*
 * An alternative way of doing one step, shown as a tab inside it — the
 * install script or Docker Compose, the vSphere Client or govc.
 */
export interface SetupGuideStepVariant {
  label: string;
  markdown: string;
}

export interface SetupGuideStep {
  title: string;
  // One or two plain sentences under the title.
  description?: string | undefined;
  markdown?: string | undefined;
  // When set, the step shows these as tabs, after `markdown`.
  variants?: Array<SetupGuideStepVariant> | undefined;
}

// A folded topic under Advanced or Troubleshooting.
export interface SetupGuideTopic {
  title: string;
  // One line shown next to the title while the topic is folded.
  summary?: string | undefined;
  markdown: string;
}

export interface SetupGuideLink {
  title: string;
  url: string;
}

/*
 * What step 1 (the ingestion key) says for this guide. By default it shows
 * the OneUptime URL next to the key, which is what agents that take a base
 * URL need; a guide whose snippets point at an endpoint of their own (OTLP,
 * MQTT) shows that one instead.
 */
export interface SetupGuideKeyStep {
  description?: string | undefined;
  endpointLabel?: string | undefined;
  endpointValue?: string | undefined;
  endpointHint?: string | undefined;
}

export interface SetupGuideContent {
  keyStep?: SetupGuideKeyStep | undefined;
  // A short paragraph of markdown above the steps.
  intro?: string | undefined;
  // "Before you start" — one line of inline markdown each.
  prerequisites?: Array<string> | undefined;
  /*
   * The steps after "Choose an ingestion key", which SetupGuideCard always
   * renders as step 1 because every guide needs a key before anything else.
   */
  steps: Array<SetupGuideStep>;
  advanced?: Array<SetupGuideTopic> | undefined;
  troubleshooting?: Array<SetupGuideTopic> | undefined;
  // Links to the full documentation, shown at the bottom of the guide.
  links?: Array<SetupGuideLink> | undefined;
}

// What every guide is filled in with: where to send data, and with which key.
export interface SetupGuideVariables {
  oneuptimeUrl: string;
  apiKey: string;
}

// The values a guide shows until the reader has picked a key.
export const SETUP_GUIDE_URL_PLACEHOLDER: string = "<YOUR_ONEUPTIME_URL>";
export const SETUP_GUIDE_API_KEY_PLACEHOLDER: string = "<YOUR_API_KEY>";

const FENCE: string = "```";

/**
 * A fenced code block. Guides are written in template literals, where every
 * literal backtick needs escaping; building fences here keeps the commands
 * readable in the source.
 */
export function codeBlock(language: string, code: string): string {
  return `${FENCE}${language}\n${code.replace(/^\n+|\s+$/g, "")}\n${FENCE}`;
}

// Characters a POSIX shell leaves alone in an unquoted word.
const SHELL_SAFE_WORD: RegExp = /^[A-Za-z0-9._:@%+,/=-]+$/;

/**
 * One shell word whose value reaches the command exactly as written: bare
 * when made only of characters the shell leaves alone, otherwise
 * single-quoted (a `'` inside closes the quote, escapes itself and reopens).
 */
export function shellQuote(value: string): string {
  return SHELL_SAFE_WORD.test(value)
    ? value
    : `'${value.split("'").join("'\\''")}'`;
}

/**
 * A value for a line of a systemd EnvironmentFile=, which systemd reads
 * with rules of its own rather than a shell's — and not the same rules in
 * every version. Outside quotes it drops a backslash (`DOMAIN\user` reads
 * as `DOMAINuser`); inside single quotes, systemd 239 (RHEL 8) drops it too
 * while later versions keep it; and a quote after a closing quote is an
 * ordinary character, so shellQuote's `'\''` does not work there. Double
 * quotes with `\` and `"` escaped read the same in every version (and `$`,
 * `#`, `'` and spaces stand as they are there), so a value that is not
 * bare is written that way.
 */
export function systemdEnvQuote(value: string): string {
  if (SHELL_SAFE_WORD.test(value)) {
    return value;
  }
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

/**
 * The OneUptime origin for the snippets: `https://host` (or `http://`), or
 * the placeholder when the dashboard does not know its own host.
 */
export function getSetupGuideOneUptimeUrl(data: {
  host: string | null | undefined;
  isHttps: boolean;
}): string {
  const host: string = (data.host || "").toString().trim();
  if (!host) {
    return SETUP_GUIDE_URL_PLACEHOLDER;
  }
  return `${data.isHttps ? "https" : "http"}://${host}`;
}

/**
 * The option a guide opens on: the requested one when the guide offers it,
 * otherwise the first option. Undefined only when there are no options.
 */
export function resolveSetupGuideOption<TKey extends string>(
  options: ReadonlyArray<SetupGuideOption<TKey>>,
  requested?: string | null | undefined,
): TKey | undefined {
  const match: SetupGuideOption<TKey> | undefined = options.find(
    (option: SetupGuideOption<TKey>): boolean => {
      return option.key === requested;
    },
  );
  return (match || options[0])?.key;
}

/*
 * The picker's options in display order: ungrouped first, then each group in
 * the order its first option appears.
 */
export interface SetupGuideOptionGroup<TKey extends string = string> {
  label: string | undefined;
  options: Array<SetupGuideOption<TKey>>;
}

export function groupSetupGuideOptions<TKey extends string>(
  options: ReadonlyArray<SetupGuideOption<TKey>>,
): Array<SetupGuideOptionGroup<TKey>> {
  const groups: Array<SetupGuideOptionGroup<TKey>> = [];
  const ungrouped: Array<SetupGuideOption<TKey>> = [];

  for (const option of options) {
    if (!option.group) {
      ungrouped.push(option);
      continue;
    }

    let group: SetupGuideOptionGroup<TKey> | undefined = groups.find(
      (candidate: SetupGuideOptionGroup<TKey>): boolean => {
        return candidate.label === option.group;
      },
    );

    if (!group) {
      group = { label: option.group, options: [] };
      groups.push(group);
    }

    group.options.push(option);
  }

  if (ungrouped.length > 0) {
    groups.unshift({ label: undefined, options: ungrouped });
  }

  return groups;
}

/**
 * The whole guide as one markdown document, in the order it is read on
 * screen, with Advanced and Troubleshooting expanded. Used to assert on a
 * guide's full text, and to search it.
 */
export function getSetupGuideMarkdown(content: SetupGuideContent): string {
  const parts: Array<string> = [];

  if (content.intro) {
    parts.push(content.intro.trim());
  }

  if (content.prerequisites && content.prerequisites.length > 0) {
    parts.push(
      [
        "## Before you start",
        "",
        ...content.prerequisites.map((line: string): string => {
          return `- ${line}`;
        }),
      ].join("\n"),
    );
  }

  content.steps.forEach((step: SetupGuideStep, index: number): void => {
    /*
     * Step 1 on screen is the ingestion key, which is not part of the
     * content, so the content's first step is numbered 2.
     */
    const lines: Array<string> = [`## Step ${index + 2}: ${step.title}`];
    if (step.description) {
      lines.push("", step.description.trim());
    }
    if (step.markdown) {
      lines.push("", step.markdown.trim());
    }
    for (const variant of step.variants || []) {
      lines.push("", `### ${variant.label}`, "", variant.markdown.trim());
    }
    parts.push(lines.join("\n"));
  });

  const topicSection: (
    heading: string,
    topics: Array<SetupGuideTopic> | undefined,
  ) => void = (
    heading: string,
    topics: Array<SetupGuideTopic> | undefined,
  ): void => {
    if (!topics || topics.length === 0) {
      return;
    }
    parts.push(
      [
        `## ${heading}`,
        ...topics.map((topic: SetupGuideTopic): string => {
          return `\n### ${topic.title}\n\n${topic.markdown.trim()}`;
        }),
      ].join("\n"),
    );
  };

  topicSection("Advanced", content.advanced);
  topicSection("Troubleshooting", content.troubleshooting);

  if (content.links && content.links.length > 0) {
    parts.push(
      [
        "## Learn more",
        "",
        ...content.links.map((link: SetupGuideLink): string => {
          return `- [${link.title}](${link.url})`;
        }),
      ].join("\n"),
    );
  }

  return `${parts.join("\n\n")}\n`;
}

/**
 * Every fenced code block in a guide, in reading order — what a reader can
 * copy. Used to check commands, not prose.
 */
export function getSetupGuideCodeBlocks(
  content: SetupGuideContent,
): Array<string> {
  return Array.from(
    getSetupGuideMarkdown(content).matchAll(/```[^\n]*\n([\s\S]*?)```/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1] || "";
  });
}
