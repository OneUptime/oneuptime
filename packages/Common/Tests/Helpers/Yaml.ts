import yaml from "js-yaml";

/*
 * YAML as data, for a test that reads a chart, a workflow or a template.
 *
 * js-yaml is Common's dependency. App installs no YAML parser of its own, so
 * an App test that imported one would fail App's compile while its suite
 * passed (App/Tests/TestImportsResolveFromApp.test.ts); through this module
 * it reads YAML the way every Common test does.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */
export type ParseYamlFunction = (text: string) => unknown;

export const parseYaml: ParseYamlFunction = (text: string): unknown => {
  return yaml.load(text);
};
