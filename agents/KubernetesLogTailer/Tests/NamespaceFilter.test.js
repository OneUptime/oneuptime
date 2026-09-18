const assert = require("node:assert/strict");
const test = require("node:test");
const NamespaceFilterModule = require("../build/dist/NamespaceFilter");

const NamespaceFilter = NamespaceFilterModule.default;
const compileNamespacePattern = NamespaceFilterModule.compileNamespacePattern;

test("namespace patterns match full exact names", () => {
  const pattern = compileNamespacePattern("team-a");

  assert.equal(pattern.test("team-a"), true);
  assert.equal(pattern.test("team-a-dev"), false);
  assert.equal(pattern.test("my-team-a"), false);
});

test("namespace patterns support a star wildcard", () => {
  const pattern = compileNamespacePattern("team-*");

  assert.equal(pattern.test("team-a"), true);
  assert.equal(pattern.test("team-production"), true);
  assert.equal(pattern.test("my-team-a"), false);
});

test("namespace patterns escape regular-expression characters", () => {
  const pattern = compileNamespacePattern("team.*");

  assert.equal(pattern.test("team.production"), true);
  assert.equal(pattern.test("team-production"), false);
});

test("an empty namespace filter allows every namespace", () => {
  const filter = new NamespaceFilter([], []);

  assert.equal(filter.isAllowed("default"), true);
});

test("include patterns form an allowlist", () => {
  const filter = new NamespaceFilter(["team-*", "shared"], []);

  assert.equal(filter.isAllowed("team-a"), true);
  assert.equal(filter.isAllowed("shared"), true);
  assert.equal(filter.isAllowed("default"), false);
});

test("exclude patterns always win", () => {
  const filter = new NamespaceFilter(["team-*"], ["team-internal"]);

  assert.equal(filter.isAllowed("team-public"), true);
  assert.equal(filter.isAllowed("team-internal"), false);
});
