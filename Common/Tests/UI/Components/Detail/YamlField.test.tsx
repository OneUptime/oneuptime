import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import Detail from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * The read-only half of the YAML field type. A YAML value must render as a
 * highlighted code block - never as prose, and never re-emitted through a
 * parser: dumping YAML back out drops the comments, anchors and key ordering
 * a hand-written document (a Sigma rule, a collector config) is written with.
 */

interface TestItem {
  sigmaRuleYaml: string;
  description: string;
}

const SIGMA_RULE_WITH_COMMENT: string = `# catches password spraying
title: Failed logon burst
logsource:
  category: authentication
detection:
  selection:
    className: Authentication
  condition: selection
`;

type RenderDetailFunction = (fieldType: FieldType, value: string) => void;

const renderDetail: RenderDetailFunction = (
  fieldType: FieldType,
  value: string,
): void => {
  const fields: Array<Field<TestItem>> = [
    {
      key: "sigmaRuleYaml",
      title: "Sigma Rule (YAML)",
      fieldType,
    },
  ];

  render(
    <Detail<TestItem>
      item={{ sigmaRuleYaml: value, description: "unused" }}
      fields={fields}
    />,
  );
};

afterEach(() => {
  cleanup();
});

describe("Detail — a YAML field renders as highlighted YAML", () => {
  test("the value reaches the page", () => {
    renderDetail(FieldType.YAML, SIGMA_RULE_WITH_COMMENT);

    expect(document.body.textContent).toContain("title: Failed logon burst");
  });

  test("it renders inside a code block, not as prose", () => {
    renderDetail(FieldType.YAML, SIGMA_RULE_WITH_COMMENT);

    expect(document.querySelector("pre code")).not.toBeNull();
  });

  test("it is tagged as the yaml language for the highlighter", () => {
    renderDetail(FieldType.YAML, SIGMA_RULE_WITH_COMMENT);

    expect(document.querySelector("code.language-yaml")).not.toBeNull();
  });

  /*
   * The JSON arm of the same branch pretty-prints by round-tripping through
   * JSON.parse/stringify. Doing that to YAML would silently rewrite the user's
   * document; comments are the most visible casualty.
   */
  test("comments survive - the document is rendered verbatim", () => {
    renderDetail(FieldType.YAML, SIGMA_RULE_WITH_COMMENT);

    expect(document.body.textContent).toContain("# catches password spraying");
  });

  test("indentation survives verbatim", () => {
    renderDetail(FieldType.YAML, SIGMA_RULE_WITH_COMMENT);

    expect(document.body.textContent).toContain("  condition: selection");
  });

  test("the field title is still rendered", () => {
    renderDetail(FieldType.YAML, SIGMA_RULE_WITH_COMMENT);

    expect(screen.getByText("Sigma Rule (YAML)")).toBeInTheDocument();
  });

  test("a syntactically broken document is still displayed, not swallowed", () => {
    renderDetail(FieldType.YAML, "title: [unclosed");

    expect(document.body.textContent).toContain("title: [unclosed");
  });
});
