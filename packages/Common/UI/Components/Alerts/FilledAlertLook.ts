import Color, { RGB } from "../../../Types/Color";
import {
  getReadableTextOnFill,
  parseColor,
} from "../../../Utils/ColorContrast";

/*
 * How an Alert filled with a colour of its own is drawn: the status page's
 * overall status banner ("All Resources are Operational", "Some Resources
 * are Degraded"), filled with the colour the page's owner gave that status.
 *
 * Its words used to be white whatever the fill: 2.6:1 on the default
 * Operational green, 1.6:1 on Degraded's yellow - the one sentence every
 * visitor reads first was the hardest to read. They now take the colour
 * that reads on the fill (getReadableTextOnFill): white on a deep colour, a
 * deep shade of the fill itself on a light one, at 4.5:1 either way.
 *
 * The fill is the owner's colour in the light theme and the dark one alike,
 * so the words are too: both are inline colours, which no theme re-colours,
 * never a text class a theme would turn pale.
 *
 * React-free, so the banner and its tests read the same answer.
 */
export interface FilledAlertLook {
  backgroundColor: string;
  // The words' colour, as a hex a style takes.
  textColor: string;
  // White words, on a deep fill (its icon and hover tint in white too).
  isLightText: boolean;
}

const toHex: (rgb: RGB) => string = (rgb: RGB): string => {
  return Color.rgbToColor(rgb).toString().toLowerCase();
};

export const getFilledAlertLook: (color: Color | string) => FilledAlertLook = (
  color: Color | string,
): FilledAlertLook => {
  const backgroundColor: string = color.toString();
  const fill: RGB | null = parseColor(color);

  // A colour that cannot be read is drawn as it was: white words.
  if (!fill) {
    return {
      backgroundColor: backgroundColor,
      textColor: "#ffffff",
      isLightText: true,
    };
  }

  const text: RGB = getReadableTextOnFill(fill);

  return {
    backgroundColor: backgroundColor,
    textColor: toHex(text),
    isLightText: text.red === 255 && text.green === 255 && text.blue === 255,
  };
};
