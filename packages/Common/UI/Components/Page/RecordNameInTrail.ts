import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Link from "../../../Types/Link";

/*
 * A record's pages said "Project > Monitors > View Monitor" above the page
 * and in the browser tab, whichever monitor it was: with three monitors open
 * in three tabs, nothing told them apart. The record's own page (ModelPage)
 * knows the record's name, so it hands the trail that name for the crumb that
 * stands for the record: "Project > Monitors > Website: acme.com > Criteria".
 *
 * The crumb that stands for the record is the one whose address ends at the
 * record's id - the record's own page, from any page below it. A trail with
 * no such crumb is left as it is, and so is a trail when the name is not
 * known (still loading, or not readable).
 */
export function nameRecordInTrail(data: {
  links: Array<Link> | undefined;
  recordId: string;
  recordName: string | null | undefined;
}): Array<Link> | undefined {
  const recordName: string | null | undefined = data.recordName;

  if (
    !data.links ||
    data.links.length === 0 ||
    !data.recordId ||
    typeof recordName !== "string" ||
    recordName.trim().length === 0
  ) {
    return data.links;
  }

  const recordId: string = data.recordId.toLowerCase();

  let recordCrumbIndex: number = -1;

  data.links.forEach((link: Link, index: number): void => {
    if (getLastPathSegment(link.to) === recordId) {
      recordCrumbIndex = index;
    }
  });

  if (recordCrumbIndex === -1) {
    return data.links;
  }

  return data.links.map((link: Link, index: number): Link => {
    return index === recordCrumbIndex
      ? { ...link, recordName: recordName }
      : link;
  });
}

// The last segment of the path an address names, lower-cased.
function getLastPathSegment(to: Route | URL): string {
  let address: string = to.toString();

  for (const delimiter of ["?", "#"]) {
    const at: number = address.indexOf(delimiter);

    if (at !== -1) {
      address = address.slice(0, at);
    }
  }

  const segments: Array<string> = address
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  return (segments[segments.length - 1] || "").toLowerCase();
}
