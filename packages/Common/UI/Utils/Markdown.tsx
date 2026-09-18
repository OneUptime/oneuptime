import React, { ReactElement } from "react";

export default class MarkdownUtil {
  public static getMarkdownCheatsheet(prefix?: string): ReactElement {
    const prefixText: string = prefix ? `${prefix}. ` : "";
    return <p>{prefixText}</p>;
  }
}
