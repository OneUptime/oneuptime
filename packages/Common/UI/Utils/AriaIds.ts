/*
 * An aria-describedby (or aria-labelledby) value made of the ids that are
 * there, in order, or undefined when none is: a control described by its
 * field's help and, once it fails, by its error - "Such as your company or
 * team name. Project Name is required." - reads both, the help first.
 */
const joinAriaIds: (
  ...ids: Array<string | null | undefined | false>
) => string | undefined = (
  ...ids: Array<string | null | undefined | false>
): string | undefined => {
  const present: Array<string> = [];

  for (const id of ids) {
    if (!id) {
      continue;
    }

    // An id given twice (a host that names the same help again) is read once.
    for (const part of id.split(" ")) {
      if (part && !present.includes(part)) {
        present.push(part);
      }
    }
  }

  return present.length > 0 ? present.join(" ") : undefined;
};

export default joinAriaIds;
