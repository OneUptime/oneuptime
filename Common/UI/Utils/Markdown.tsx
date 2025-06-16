import React, { ReactElement } from "react";
import Link from "../Components/Link/Link";
import URL from "../../Types/API/URL";

export default class MarkdownUtil {
  public static getMarkdownCheatsheet(prefix?: string): ReactElement {
    const prefixText = prefix ? `${prefix}. ` : "";
    return (
      <p>
        {prefixText}This is in Markdown.{' '}
        <Link to={URL.fromString("https://www.markdownguide.org/cheat-sheet/")} openInNewTab={true}>
          Learn more about Markdown syntax
        </Link>
        .
      </p>
    );
  }
}
