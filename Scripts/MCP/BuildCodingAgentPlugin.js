#!/usr/bin/env node

/*
 * Builds the plugin OneUptime lists for coding agents, in Cursor's Marketplace
 * and the Claude directory: its hosted MCP server and the skills in
 * packages/App/FeatureSet/MCP/CodingAgentPlugin. Both directories read a Git
 * repository rather than an upload, so what this writes is a folder, ready to
 * be the root of one. The package's README says what else a listing needs.
 *
 * The listing is the ChatGPT plugin's. Its words, links and icon are read from
 * ChatGPTPlugin/ here, so the two listings cannot drift apart, and the only
 * thing that stands apart is plugin.json in the package: the version, and
 * anything else this plugin says differently.
 *
 * One folder serves every client, each reading its own files:
 *
 *   plugin.json, mcp.json                Agent Plugins 1.0.0
 *   .cursor-plugin/plugin.json           Cursor, for what the standard's closed
 *                                        manifest has no field for: the logo
 *   .claude-plugin/plugin.json, .mcp.json  Claude
 *
 * The ChatGPT package's mcp.json cannot be copied: it declares the sign-in
 * under extensions["com.openai"], which a client that only knows the base
 * format reads as an invalid server. These entries are a plain address, and
 * each client finds the sign-in itself, from the server's OAuth metadata.
 *
 * Usage: npm run build-coding-agent-plugin [-- <output-directory>]
 *   default output: build/coding-agent-plugin/oneuptime
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MCP_DIRECTORY = path.join(REPO_ROOT, "packages/App/FeatureSet/MCP");
const PACKAGE_DIRECTORY = path.join(MCP_DIRECTORY, "CodingAgentPlugin");
const CHATGPT_DIRECTORY = path.join(MCP_DIRECTORY, "ChatGPTPlugin");

const ICON = "assets/logo.png";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Fails the build rather than ship a listing that still says ChatGPT.
function replaceOrFail(text, from, to) {
  if (!text.includes(from)) {
    throw new Error(`The ChatGPT listing no longer says "${from}".`);
  }

  return text.replace(from, to);
}

// A section of the ChatGPT listing's long description, between two headings.
function sectionOf(longDescription, from, to) {
  const start = longDescription.indexOf(from);
  const end = longDescription.indexOf(to);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`The ChatGPT listing has no "${from}" section.`);
  }

  return longDescription.slice(start + from.length, end).trim();
}

/*
 * The manifest fields every client's manifest shares. plugin.json in the
 * package comes last, so it can replace any of them.
 */
function readSharedFields() {
  const chatGptManifest = readJson(path.join(CHATGPT_DIRECTORY, "plugin.json"));
  const ownFields = readJson(path.join(PACKAGE_DIRECTORY, "plugin.json"));

  return {
    name: chatGptManifest.name,
    version: ownFields.version,
    description: replaceOrFail(
      chatGptManifest.description,
      "from ChatGPT",
      "from your coding agent",
    ),
    author: chatGptManifest.author,
    homepage: chatGptManifest.homepage,
    repository: chatGptManifest.repository,
    license: chatGptManifest.license,
    keywords: chatGptManifest.keywords,
    ...ownFields,
  };
}

function readListing() {
  return readJson(path.join(CHATGPT_DIRECTORY, "plugin.json")).extensions[
    "com.openai"
  ].interface;
}

// The one server of the ChatGPT package, and the name it goes by.
function readServer() {
  const servers = readJson(path.join(CHATGPT_DIRECTORY, "mcp.json")).mcpServers;
  const [name, server] = Object.entries(servers)[0];

  return { name, url: server.url };
}

function agentPluginsManifest(shared) {
  return {
    $schema: readJson(path.join(CHATGPT_DIRECTORY, "plugin.json")).$schema,
    ...shared,
  };
}

function cursorManifest(shared, listing) {
  // Cursor's manifest gives an author a name and an email, and nothing more.
  const { name, email } = shared.author;

  return {
    ...shared,
    displayName: listing.displayName,
    author: { name, email },
    logo: ICON,
    // The entry Cursor Plugins read: the standard's, in mcp.json, has a $schema.
    mcpServers: "./.mcp.json",
  };
}

function claudeManifest(shared, listing) {
  return {
    ...shared,
    displayName: listing.displayName,
    icon: `./${ICON}`,
    documentationUrl: shared.homepage,
    supportUrl: listing.supportURL,
    privacyPolicyUrl: listing.privacyPolicyURL,
    termsOfServiceUrl: listing.termsOfServiceURL,
  };
}

function agentPluginsMcpConfig(server) {
  return {
    $schema: readJson(path.join(CHATGPT_DIRECTORY, "mcp.json")).$schema,
    mcpServers: {
      [server.name]: { type: "streamable-http", url: server.url },
    },
  };
}

function claudeMcpConfig(server) {
  return {
    mcpServers: { [server.name]: { type: "http", url: server.url } },
  };
}

/*
 * The README a directory shows as the listing: LISTING.md, with the ChatGPT
 * listing's words where it has a {{name}}. README.md in the package is for
 * maintainers and stays out, as the ChatGPT package's does.
 */
function renderReadme(shared, listing, server) {
  const longDescription = listing.longDescription;
  const values = {
    intro: longDescription.slice(0, longDescription.indexOf(".") + 1),
    capabilities: sectionOf(
      longDescription,
      "What you can do:",
      "Who it is for:",
    ),
    prompts: listing.defaultPrompt
      .map((prompt) => {
        return `- ${prompt}`;
      })
      .join("\n"),
    serverUrl: server.url,
    homepage: shared.homepage,
    supportURL: listing.supportURL,
    privacyPolicyURL: listing.privacyPolicyURL,
    termsOfServiceURL: listing.termsOfServiceURL,
  };

  const template = fs.readFileSync(
    path.join(PACKAGE_DIRECTORY, "LISTING.md"),
    "utf8",
  );

  return template.replace(/\{\{(\w+)\}\}/g, (placeholder, key) => {
    if (!(key in values)) {
      throw new Error(`LISTING.md names nothing called ${placeholder}.`);
    }

    return values[key];
  });
}

function isEarlierBuild(directory) {
  try {
    return (
      readJson(path.join(directory, ".claude-plugin/plugin.json")).name ===
      readSharedFields().name
    );
  } catch {
    return false;
  }
}

/*
 * Starts the output from nothing, so a file the package no longer has does
 * not stay behind. A clone of the plugin's repository keeps its .git, which is
 * how a maintainer updates it, and a folder that is neither empty nor an
 * earlier build is left alone: this deletes what it finds.
 */
function prepareOutput(output) {
  fs.mkdirSync(output, { recursive: true });

  const entries = fs.readdirSync(output).filter((entry) => {
    return entry !== ".git";
  });

  if (entries.length > 0 && !isEarlierBuild(output)) {
    throw new Error(
      `${output} is not empty and is not an earlier build of this plugin: nothing was written.`,
    );
  }

  for (const entry of entries) {
    fs.rmSync(path.join(output, entry), { recursive: true });
  }
}

function resolveOutput(argument) {
  if (!argument) {
    return path.join(REPO_ROOT, "build/coding-agent-plugin/oneuptime");
  }

  /*
   * A relative path is relative to where the command was typed. npm runs the
   * script from the repository root and keeps that place in INIT_CWD.
   */
  return path.resolve(process.env.INIT_CWD || process.cwd(), argument);
}

function build(output) {
  const shared = readSharedFields();
  const listing = readListing();
  const server = readServer();

  prepareOutput(output);

  const write = (relativePath, content) => {
    const file = path.join(output, relativePath);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const writeJson = (relativePath, value) => {
    write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  };

  writeJson("plugin.json", agentPluginsManifest(shared));
  writeJson("mcp.json", agentPluginsMcpConfig(server));
  writeJson(".cursor-plugin/plugin.json", cursorManifest(shared, listing));
  writeJson(".claude-plugin/plugin.json", claudeManifest(shared, listing));
  writeJson(".mcp.json", claudeMcpConfig(server));
  write("README.md", renderReadme(shared, listing, server));
  write("LICENSE", fs.readFileSync(path.join(REPO_ROOT, "LICENSE")));
  write("NOTICE", fs.readFileSync(path.join(REPO_ROOT, "NOTICE")));
  write(ICON, fs.readFileSync(path.join(CHATGPT_DIRECTORY, ICON)));

  // The directory blocks a plugin that holds macOS's folder settings.
  fs.cpSync(
    path.join(PACKAGE_DIRECTORY, "skills"),
    path.join(output, "skills"),
    {
      recursive: true,
      filter: (source) => {
        return path.basename(source) !== ".DS_Store";
      },
    },
  );
}

function main() {
  const output = resolveOutput(process.argv[2]);

  build(output);

  // eslint-disable-next-line no-console
  console.log(`Built ${output}`);
}

try {
  main();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
}
