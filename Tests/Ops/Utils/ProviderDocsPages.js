"use strict";

/**
 * Pages of the Terraform provider's documentation, as its generator writes
 * them (Scripts/TerraformProvider/Core/DocumentationGenerator.ts): front
 * matter, the title, an example, the Schema with its Required, Optional and
 * Read-Only lists and a section for each nested attribute, and Import. The
 * provider's release notes read what changed from them
 * (Scripts/TerraformProvider/GenerateReleaseNotes.js), so the tests of the
 * notes and of the publish script write theirs with these.
 *
 * Scripts/TerraformProvider/Tests/ReleaseNotesReadTheDocs.test.ts holds the
 * notes to pages the generator itself wrote.
 */

/**
 * One attribute's line, as renderAttributeLine writes it.
 * @param {string} name
 * @param {Object} [attribute]
 * @returns {string}
 */
function attributeLine(name, attribute = {}) {
  const tags = [attribute.type || "String"];
  if (attribute.sensitive) {
    tags.push("Sensitive");
  }
  if (attribute.deprecated) {
    tags.push("Deprecated");
  }

  const parts = [];
  if (attribute.description) {
    parts.push(attribute.description);
  }
  if (attribute.deprecated) {
    parts.push(`**Deprecated:** ${attribute.deprecated}`);
  }
  if (attribute.allowed) {
    parts.push(
      `Allowed values: ${attribute.allowed
        .map((value) => {
          return `\`${value}\``;
        })
        .join(", ")}.`,
    );
  }
  if (attribute.defaultValue !== undefined) {
    parts.push(`Defaults to \`${attribute.defaultValue}\`.`);
  }
  if (attribute.nested) {
    parts.push(
      `(see [below for nested schema](#nestedatt--${name.replace(/\./g, "--")}))`,
    );
  }

  return `- \`${name.split(".").pop()}\` (${tags.join(", ")})${parts.length > 0 ? ` ${parts.join(" ")}` : ""}`;
}

const GROUPS = [
  ["required", "Required"],
  ["optional", "Optional"],
  ["readOnly", "Read-Only"],
];

function groupsOf(attributes, heading) {
  return GROUPS.filter(([key]) => {
    return attributes[key] && Object.keys(attributes[key]).length > 0;
  }).map(([key, title]) => {
    const lines = Object.entries(attributes[key])
      .sort(([left], [right]) => {
        return left.localeCompare(right);
      })
      .map(([name, attribute]) => {
        return attributeLine(name, attribute);
      });
    return `${heading(title)}\n\n${lines.join("\n")}`;
  });
}

/**
 * A resource's or data source's page.
 * @param {Object} page
 * @param {string} page.name - oneuptime_monitor
 * @param {"Resource"|"Data Source"} [page.kind]
 * @param {string} [page.subcategory]
 * @param {string} [page.description]
 * @param {{required?: Object, optional?: Object, readOnly?: Object}} [page.attributes]
 * @param {Object<string, {required?: Object, optional?: Object, readOnly?: Object}>} [page.nested]
 *        nested attributes by their path: { "monitor_steps": {...} }
 * @param {{from: string, stillWorks?: boolean}} [page.renamedFrom]
 * @returns {string}
 */
function providerPage({
  name,
  kind = "Resource",
  subcategory = "Monitors",
  description = `What ${name} is. It does more, said here.`,
  attributes = {},
  nested = {},
  renamedFrom = null,
}) {
  const noun = kind === "Resource" ? "resource" : "data source";
  let renamed = "";
  if (renamedFrom) {
    renamed =
      renamedFrom.stillWorks === false
        ? `~> **Renamed:** this ${noun} was called \`${renamedFrom.from}\` before, a name [another ${noun}](./${renamedFrom.from.replace(/^oneuptime_/, "")}) has now. Rename the ${noun} in your configuration and add a \`moved\` block, so Terraform keeps the existing one:\n\n`
        : `~> **Renamed:** this ${noun} was called \`${renamedFrom.from}\` before. The old name still works, but is deprecated. To switch, rename the ${noun} in your configuration and add a \`moved\` block, so Terraform keeps the existing one:\n\n`;
  }

  const nestedSections = Object.entries(nested).map(([path, groups]) => {
    return `<a id="nestedatt--${path.replace(/\./g, "--")}"></a>\n### Nested Schema for \`${path}\`\n\n${groupsOf(
      groups,
      (title) => {
        return `${title}:`;
      },
    ).join("\n\n")}`;
  });

  return [
    "---",
    `page_title: "${name} ${kind} - oneuptime"`,
    `subcategory: "${subcategory}"`,
    "description: |-",
    `  ${description}`,
    "---",
    "",
    `# ${name} (${kind})`,
    "",
    description,
    "",
    `${renamed}## Example Usage`,
    "",
    "```terraform",
    "# A comment in an example is not a heading.",
    "### Required",
    `- \`not_an_attribute\` (String) An example's line.`,
    `${kind === "Resource" ? "resource" : "data"} "${name}" "example" {}`,
    "```",
    "",
    "## Schema",
    "",
    ...groupsOf(attributes, (title) => {
      return `### ${title}`;
    }).map((group) => {
      return `${group}\n`;
    }),
    ...nestedSections.map((section) => {
      return `${section}\n`;
    }),
    "## Import",
    "",
    "```shell",
    `terraform import ${name}.example <id>`,
    "```",
    "",
  ].join("\n");
}

/**
 * Where the page of a resource or data source is in the provider's
 * repository: docs/resources/monitor.md.
 * @param {string} name - oneuptime_monitor
 * @param {"Resource"|"Data Source"} [kind]
 * @returns {string}
 */
function pagePath(name, kind = "Resource") {
  const directory = kind === "Resource" ? "resources" : "data-sources";
  return `docs/${directory}/${name.replace(/^oneuptime_/, "")}.md`;
}

module.exports = { attributeLine, pagePath, providerPage };
