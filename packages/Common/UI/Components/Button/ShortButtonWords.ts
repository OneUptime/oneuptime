/*
 * A button that says shorter words than its title - a table row's "View"
 * for "View Incident" (ActionButtonSchema's rowButtonTitle), a table
 * header's "Create" on a phone for "Create Scheduled Maintenance Event"
 * (CardButtonSchema's phoneTitle) - is named by that whole title. It shows
 * the short words only while the title holds them, as the language at
 * hand writes both: a speech control user says the word they see, and a
 * screen reader reads the name (WCAG 2.5.3, Label in Name). German's
 * "Anzeigen" is in "Vorfall anzeigen"; where a translation takes another
 * word for the title than for the short words ("Ansehen" beside "Vorfall
 * anzeigen"), the button says the whole title.
 *
 * Both are compared as they are shown: translated, and in any case.
 */
export const isShortTitleInName: (data: {
  title: string | undefined;
  shortTitle: string | undefined;
}) => boolean = (data: {
  title: string | undefined;
  shortTitle: string | undefined;
}): boolean => {
  const title: string = (data.title || "").trim().toLowerCase();
  const shortTitle: string = (data.shortTitle || "").trim().toLowerCase();

  if (!title || !shortTitle) {
    return false;
  }

  return title.includes(shortTitle);
};
