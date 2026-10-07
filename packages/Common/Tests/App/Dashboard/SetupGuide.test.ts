import { describe, expect, test } from "@jest/globals";
import {
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideOptionGroup,
  codeBlock,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
  getSetupGuideOneUptimeUrl,
  groupSetupGuideOptions,
  resolveSetupGuideOption,
  shellQuote,
  systemdEnvQuote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import { parseSystemdEnvironmentFile } from "./SystemdEnvironmentFile";

/*
 * The model every in-app setup guide is built from. SetupGuideCard renders
 * it; these tests pin the pure parts the card relies on — which option a
 * guide opens on, how options are grouped, the URL the commands carry, and
 * the flattened markdown the guides' own tests read.
 */

describe("getSetupGuideOneUptimeUrl", () => {
  test("builds an https origin from the dashboard host", () => {
    expect(
      getSetupGuideOneUptimeUrl({
        host: "oneuptime.example.com",
        isHttps: true,
      }),
    ).toBe("https://oneuptime.example.com");
  });

  test("builds an http origin for a plain-http install", () => {
    expect(
      getSetupGuideOneUptimeUrl({ host: "localhost:8080", isHttps: false }),
    ).toBe("http://localhost:8080");
  });

  test("keeps the placeholder when the host is unknown", () => {
    for (const host of [undefined, null, "", "   "]) {
      expect(getSetupGuideOneUptimeUrl({ host: host, isHttps: true })).toBe(
        SETUP_GUIDE_URL_PLACEHOLDER,
      );
    }
  });

  test("trims whitespace around the host", () => {
    expect(
      getSetupGuideOneUptimeUrl({ host: "  oneuptime.com ", isHttps: true }),
    ).toBe("https://oneuptime.com");
  });
});

describe("resolveSetupGuideOption", () => {
  const options: Array<SetupGuideOption> = [
    { key: "one", label: "One" },
    { key: "two", label: "Two" },
  ];

  test("opens on the requested option when the guide offers it", () => {
    expect(resolveSetupGuideOption(options, "two")).toBe("two");
  });

  test("falls back to the first option for anything else", () => {
    for (const requested of [undefined, null, "", "three", "ONE"]) {
      expect(resolveSetupGuideOption(options, requested)).toBe("one");
    }
  });

  test("is undefined only when there are no options", () => {
    expect(resolveSetupGuideOption([], "one")).toBeUndefined();
  });
});

describe("groupSetupGuideOptions", () => {
  test("puts ungrouped options first, then groups in first-seen order", () => {
    const groups: Array<SetupGuideOptionGroup> = groupSetupGuideOptions([
      { key: "ecs", label: "ECS", group: "AWS" },
      { key: "run", label: "Cloud Run", group: "Google Cloud" },
      { key: "other", label: "Other" },
      { key: "lambda", label: "Lambda", group: "AWS" },
    ]);

    expect(
      groups.map((group: SetupGuideOptionGroup) => {
        return {
          label: group.label,
          keys: group.options.map((option: SetupGuideOption) => {
            return option.key;
          }),
        };
      }),
    ).toEqual([
      { label: undefined, keys: ["other"] },
      { label: "AWS", keys: ["ecs", "lambda"] },
      { label: "Google Cloud", keys: ["run"] },
    ]);
  });

  test("returns one unlabeled group when nothing is grouped", () => {
    const groups: Array<SetupGuideOptionGroup> = groupSetupGuideOptions([
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBeUndefined();
    expect(groups[0]!.options).toHaveLength(2);
  });

  test("returns no groups for no options", () => {
    expect(groupSetupGuideOptions([])).toEqual([]);
  });
});

describe("codeBlock", () => {
  test("fences the code with its language", () => {
    expect(codeBlock("bash", "echo hi")).toBe("```bash\necho hi\n```");
  });

  test("drops leading blank lines and trailing whitespace, keeps indentation", () => {
    expect(codeBlock("yaml", "\n\nkey:\n  value: 1\n\n  ")).toBe(
      "```yaml\nkey:\n  value: 1\n```",
    );
  });
});

describe("shellQuote", () => {
  test("leaves a word the shell reads literally unquoted", () => {
    for (const value of [
      "https://oneuptime.com",
      "tik_abc-123",
      "my-cluster",
      "a=b",
      "user@realm",
      "host:9221",
    ]) {
      expect(shellQuote(value)).toBe(value);
    }
  });

  test("single-quotes anything the shell would change", () => {
    expect(shellQuote("two words")).toBe("'two words'");
    expect(shellQuote("$HOME")).toBe("'$HOME'");
    expect(shellQuote("a;b")).toBe("'a;b'");
    expect(shellQuote("<YOUR_API_KEY>")).toBe("'<YOUR_API_KEY>'");
    expect(shellQuote("")).toBe("''");
  });

  test("escapes a single quote inside the value", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

/*
 * A value for a systemd EnvironmentFile= line (the VMware agent's .env
 * without Docker). systemd's quoting is not a shell's, so every value is
 * checked by reading it back with the port of systemd's own parser
 * (SystemdEnvironmentFile.ts, pinned to systemd 255).
 */
describe("systemdEnvQuote", () => {
  const readBack: (value: string) => string | undefined = (
    value: string,
  ): string | undefined => {
    return parseSystemdEnvironmentFile(`NAME=${systemdEnvQuote(value)}\n`).get(
      "NAME",
    );
  };

  test("leaves a value systemd reads literally unquoted", () => {
    for (const value of [
      "my-vcenter",
      "vcenter-prod",
      "https://vcsa.example.com",
      "oneuptime@vsphere.local",
      "host:443",
    ]) {
      expect(systemdEnvQuote(value)).toBe(value);
      expect(readBack(value)).toBe(value);
    }
  });

  test("single-quotes anything else, which systemd takes as written", () => {
    expect(systemdEnvQuote("prod $vc")).toBe("'prod $vc'");
    expect(systemdEnvQuote("DOMAIN\\user")).toBe("'DOMAIN\\user'");
    expect(systemdEnvQuote('lab "a" #1')).toBe("'lab \"a\" #1'");
    expect(systemdEnvQuote("")).toBe("''");
  });

  test('double-quotes a value with a single quote, escaping only \\ and "', () => {
    expect(systemdEnvQuote("O'Brien")).toBe('"O\'Brien"');
    expect(systemdEnvQuote('it\'s "lab" \\ $x')).toBe(
      '"it\'s \\"lab\\" \\\\ $x"',
    );
  });

  test("every value reads back from the file exactly as it was", () => {
    for (const value of [
      "plain",
      "two words",
      "  padded  ",
      "p@ss$word",
      "p@ss$$word",
      "${env:OTHER}",
      "a #comment",
      "#leading",
      ";leading",
      "DOMAIN\\user",
      "trailing\\",
      "\\\\double",
      "it's",
      "'",
      "''",
      "'quoted'",
      '"',
      'say "hi"',
      'O\'Brien "lab" \\ $x `cmd`',
      "tab\there",
      "ünïcødé vCenter",
      "",
    ]) {
      expect({ value, read: readBack(value) }).toEqual({ value, read: value });
    }
  });

  test("where shellQuote's form would not survive systemd", () => {
    // The shell reads 'it'\''s' as it's; systemd reads it as it''s'.
    expect(
      parseSystemdEnvironmentFile(`NAME=${shellQuote("it's")}`).get("NAME"),
    ).toBe("it''s'");
    expect(readBack("it's")).toBe("it's");
  });
});

describe("getSetupGuideMarkdown", () => {
  const content: SetupGuideContent = {
    intro: "An intro paragraph.",
    prerequisites: ["Docker 20.10+", "A `.env` file"],
    steps: [
      {
        title: "Install",
        description: "Run the installer.",
        markdown: codeBlock("bash", "bash install.sh"),
      },
      {
        title: "Configure",
        variants: [
          { label: "Script", markdown: "Use the script." },
          { label: "Compose", markdown: codeBlock("yaml", "services: {}") },
        ],
      },
    ],
    advanced: [{ title: "Tune it", summary: "Knobs.", markdown: "Tuning." }],
    troubleshooting: [{ title: "It broke", markdown: "Fix it." }],
    links: [{ title: "Docs", url: "/docs/x" }],
  };

  const markdown: string = getSetupGuideMarkdown(content);

  test("numbers the content's steps after the ingestion key step", () => {
    expect(markdown).toContain("## Step 2: Install");
    expect(markdown).toContain("## Step 3: Configure");
    expect(markdown).not.toContain("## Step 1:");
  });

  test("reads in on-screen order", () => {
    const order: Array<number> = [
      "An intro paragraph.",
      "## Before you start",
      "## Step 2: Install",
      "## Step 3: Configure",
      "## Advanced",
      "## Troubleshooting",
      "## Learn more",
    ].map((heading: string): number => {
      return markdown.indexOf(heading);
    });

    for (const index of order) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(
      [...order].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(order);
  });

  test("keeps every variant of a step, labeled", () => {
    expect(markdown).toContain("### Script\n\nUse the script.");
    expect(markdown).toContain("### Compose");
    expect(markdown).toContain("services: {}");
  });

  test("expands Advanced and Troubleshooting topics", () => {
    expect(markdown).toContain("### Tune it\n\nTuning.");
    expect(markdown).toContain("### It broke\n\nFix it.");
  });

  test("lists prerequisites and links", () => {
    expect(markdown).toContain("- Docker 20.10+");
    expect(markdown).toContain("- A `.env` file");
    expect(markdown).toContain("- [Docs](/docs/x)");
  });

  test("leaves out the sections a guide does not have", () => {
    const minimal: string = getSetupGuideMarkdown({
      steps: [{ title: "Only step", markdown: "Do it." }],
    });
    expect(minimal).toContain("## Step 2: Only step");
    for (const heading of [
      "## Before you start",
      "## Advanced",
      "## Troubleshooting",
      "## Learn more",
    ]) {
      expect(minimal).not.toContain(heading);
    }
  });

  test("getSetupGuideCodeBlocks returns every fenced block, in order", () => {
    expect(getSetupGuideCodeBlocks(content)).toEqual([
      "bash install.sh\n",
      "services: {}\n",
    ]);
  });
});
