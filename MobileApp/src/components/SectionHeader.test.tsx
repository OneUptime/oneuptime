import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import { Ionicons } from "@expo/vector-icons";
import SectionHeader from "./SectionHeader";
import { darkColors } from "../theme";

/*
 * The little icon-and-caption line that divides a detail screen into
 * Description, Details, Status History and so on. It is pure decoration until
 * you stop looking at the screen: then it is the only thing telling a
 * screen-reader user which part of a long scrolling page they have reached.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

/**
 * The character the icon font actually draws for an icon name.
 *
 * Taken from the font's own map rather than written out as a literal, because
 * the literal would be an unreadable private-use codepoint that nobody could
 * check, and one that moves whenever the icon set is upgraded.
 */
function glyphFor(name: keyof typeof Ionicons.glyphMap): string {
  const glyph: string | number = Ionicons.glyphMap[name];

  /*
   * The map is typed as holding either a codepoint or the character itself,
   * and the icon component renders whichever it finds. Ionicons ships
   * codepoints, but converting only when there is one to convert keeps this
   * helper true for any set the app is later pointed at.
   */
  if (typeof glyph === "string") {
    return glyph;
  }

  return String.fromCodePoint(glyph);
}

function styleOf(element: RenderedElement): Record<string, unknown> {
  return element.props.style as Record<string, unknown>;
}

describe("What the header shows", () => {
  test("the title it was given", async () => {
    await render(
      <SectionHeader title="Status History" iconName="time-outline" />,
    );

    expect(screen.getByText("Status History")).toBeTruthy();
  });

  test("the title is upper-cased by the style, not by rewriting the words", async () => {
    /*
     * This matters for more than tidiness. textTransform is a display
     * instruction, so the text a screen reader announces is still "Status
     * History" - upper-casing the string itself would have VoiceOver spell it
     * out letter by letter, or read it in the flat shout it reserves for
     * acronyms.
     */
    await render(
      <SectionHeader title="Status History" iconName="time-outline" />,
    );

    const title: RenderedElement = screen.getByText("Status History");
    expect(styleOf(title).textTransform).toBe("uppercase");
    expect(screen.queryByText("STATUS HISTORY")).toBeNull();
  });

  test("the icon it was asked for, and not some default", async () => {
    await render(
      <SectionHeader title="Status History" iconName="time-outline" />,
    );

    expect(screen.getByText(glyphFor("time-outline"))).toBeTruthy();
  });

  test("a different section gets a different icon", async () => {
    /*
     * Two headers drawing the same glyph would be the failure mode of a header
     * that quietly ignored its prop, and nothing about the rendered caption
     * would give it away.
     */
    await render(
      <SectionHeader title="Activity Feed" iconName="list-outline" />,
    );

    expect(screen.getByText(glyphFor("list-outline"))).toBeTruthy();
    expect(screen.queryByText(glyphFor("time-outline"))).toBeNull();
  });

  test("the icon is drawn in the accent colour, so the row reads as a heading", async () => {
    await render(<SectionHeader title="Details" iconName="time-outline" />);

    const icon: RenderedElement = screen.getByText(glyphFor("time-outline"));
    const iconStyles: Array<Record<string, unknown>> = icon.props
      .style as Array<Record<string, unknown>>;

    expect(iconStyles[0].color).toBe(darkColors.actionPrimary);
  });

  test("a title of one word, or of many, is rendered whole", async () => {
    await render(
      <SectionHeader
        title="Everything else worth knowing"
        iconName="information-circle-outline"
      />,
    );

    expect(screen.getByText("Everything else worth knowing")).toBeTruthy();
  });
});
