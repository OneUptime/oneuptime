/*
 * The types the Kubernetes agent's renamed collector components go by on a
 * collector image (#9930).
 *
 * opentelemetry-collector-contrib, and the collector's own OTLP HTTP
 * exporter, renamed these components to snake_case and keep each old type as
 * a deprecated alias: collector 0.165.0, the chart's pin, warns about one on
 * every start, and a later release drops it and refuses the config. A
 * collector before a rename knows only the old type and refuses a whole
 * config that names the new one ("unknown type"). So the chart writes each
 * type as the collector it renders for knows it (kubernetes-agent.componentType
 * in _helpers.tpl, from the same table), because a `helm upgrade
 * --reuse-values` keeps 0.96.0 on a release from before 0.161.0. Each version
 * was read from the component's metadata.yaml at that tag and the one before.
 *
 * The scripts and suites here write a component by its new type and ask this
 * for the type an image knows.
 *
 * Not a test file itself (jest only collects *.test.js).
 */

// Each renamed type: the alias it went by before, and the first release with it.
const RENAMED_TYPES = Object.freeze({
  otlp_http: { alias: "otlphttp", since: [0, 144, 0] },
  k8s_attributes: { alias: "k8sattributes", since: [0, 146, 0] },
  file_log: { alias: "filelog", since: [0, 149, 0] },
  host_metrics: { alias: "hostmetrics", since: [0, 151, 0] },
  k8s_objects: { alias: "k8sobjects", since: [0, 151, 0] },
  kubelet_stats: { alias: "kubeletstats", since: [0, 152, 0] },
  resource_detection: { alias: "resourcedetection", since: [0, 153, 0] },
  cumulative_to_delta: { alias: "cumulativetodelta", since: [0, 157, 0] },
});

// How a template asks for a type, written out (the helpers' own call).
const HELPER_CALL =
  /\{\{\s*include "kubernetes-agent\.componentType" \(dict "root" (?:\.|\$) "type" "([a-z0-9_]+)"\)\s*\}\}/g;
// A template's own name for one: {{- $kubeletStats := include ... }}.
const VARIABLE_DECLARATION =
  /\{\{-?\s*\$([A-Za-z0-9]+) := include "kubernetes-agent\.componentType" \(dict "root" \. "type" "([a-z0-9_]+)"\)\s*-?\}\}/g;

const VERSION = /:v?(\d+)\.(\d+)\.(\d+)/;

// The [major, minor, patch] an image's tag names, e.g. "...-contrib:0.96.0".
function collectorVersion(image) {
  const match = VERSION.exec(image);
  if (!match) {
    throw new Error(`no collector version in the image ${image}`);
  }
  return match.slice(1).map(Number);
}

function isAtLeast(version, since) {
  for (let index = 0; index < since.length; index++) {
    if (version[index] !== since[index]) {
      return version[index] > since[index];
    }
  }
  return true;
}

// The type the collector `image` knows a renamed component by.
function componentTypeFor(type, image) {
  const renamed = RENAMED_TYPES[type];
  if (!renamed) {
    throw new Error(`${type} is no renamed component type`);
  }
  return isAtLeast(collectorVersion(image), renamed.since)
    ? type
    : renamed.alias;
}

/*
 * Component ids as `image` knows them: a renamed type, with or without a name
 * after its slash (k8s_attributes, cumulative_to_delta/x), becomes its alias
 * on a collector before its rename; every other id, and every id with no
 * image given (the chart's pin, which knows every new type), stays as it is.
 */
function componentNamesFor(names, image) {
  if (!image) {
    return names;
  }
  return names.map((name) => {
    const slash = name.indexOf("/");
    const type = slash === -1 ? name : name.substring(0, slash);
    if (!RENAMED_TYPES[type]) {
      return name;
    }
    return `${componentTypeFor(type, image)}${slash === -1 ? "" : name.substring(slash)}`;
  });
}

// What a template's variables hold: {variable: type}.
function templateVariables(template) {
  const variables = {};
  for (const match of template.matchAll(VARIABLE_DECLARATION)) {
    variables[match[1]] = match[2];
  }
  return variables;
}

/*
 * A template's text as the chart renders it for the collector it pins, which
 * knows every new type: each type written out where the template asks for it,
 * by the helper or by one of its own variables.
 */
function templateForPinnedCollector(template) {
  const variables = templateVariables(template);
  let text = template.replace(HELPER_CALL, (_call, type) => {
    if (!RENAMED_TYPES[type]) {
      throw new Error(`the template asks for ${type}, no renamed type`);
    }
    return type;
  });
  for (const [variable, type] of Object.entries(variables)) {
    text = text.split(`{{ $${variable} }}`).join(type);
  }
  return text;
}

module.exports = {
  RENAMED_TYPES,
  collectorVersion,
  componentNamesFor,
  componentTypeFor,
  templateForPinnedCollector,
  templateVariables,
};
