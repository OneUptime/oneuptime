import React, { useContext } from "react";

/*
 * Whether what is being drawn is the value of a detail card's field - under
 * its name, in a card about one record - rather than a table's cell.
 *
 * Some elements a page hands a detail field are shared with tables, where a
 * row has to stay short: a record's labels as one pill per line, the first
 * three and "N more"; an empty list as a plain line of text. Under a field's
 * name those read wrong. Labels stacked one per line made a row of a detail
 * card as tall as its labels while the field beside it held one line, and a
 * list's "No labels attached." was drawn as dark as a value, beside empty
 * fields that say so in quiet grey. Detail tells those elements where they
 * are, and they draw themselves as the values around them are drawn.
 */
export const DetailValueContext: React.Context<boolean> =
  React.createContext<boolean>(false);

// Whether an element is drawn as a detail card's value.
export const useIsDetailValue: () => boolean = (): boolean => {
  return useContext(DetailValueContext);
};
