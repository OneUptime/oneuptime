import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Link from "../../../Types/Link";
import { getNumberedRecordName } from "../../../Utils/Project/RecordNumber";

/*
 * A record's pages said "Project > Monitors > View Monitor" above the page
 * and in the browser tab, whichever monitor it was: with three monitors open
 * in three tabs, nothing told them apart. The record's own page (ModelPage)
 * knows the record's name, so it hands the trail that name for the crumb that
 * stands for the record: "Project > Monitors > Website: acme.com > Criteria".
 *
 * A record its project numbers - an incident, an alert, a scheduled
 * maintenance event, an episode - is known by its number before its name,
 * since two of them can share a title: "Project > Incidents > INC-18
 * Manually declared > Owners" (Utils/Project/RecordNumber).
 *
 * The crumb that stands for the record is the one whose address ends at the
 * record's id - the record's own page, from any page below it. A trail with
 * no such crumb is left as it is, and so is a trail when neither the name
 * nor the number is known (still loading, or not readable).
 */
export function nameRecordInTrail(data: {
  links: Array<Link> | undefined;
  recordId: string;
  recordName: string | null | undefined;
  recordNumber?: string | null | undefined;
}): Array<Link> | undefined {
  const recordName: string =
    typeof data.recordName === "string" ? data.recordName : "";
  const recordNumber: string =
    typeof data.recordNumber === "string" ? data.recordNumber.trim() : "";

  if (
    !data.links ||
    data.links.length === 0 ||
    !data.recordId ||
    (recordName.trim().length === 0 && recordNumber.length === 0)
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
    if (index !== recordCrumbIndex) {
      return link;
    }

    const named: Link = { ...link };

    if (recordName.trim().length > 0) {
      named.recordName = recordName;
    }

    if (recordNumber.length > 0) {
      named.recordNumber = recordNumber;
    }

    return named;
  });
}

/*
 * What a crumb that stands for a record calls it in a line of text - the
 * browser tab, the phone's menu button: "INC-18 Manually declared", or the
 * name or the number alone. Undefined for a crumb that names no record.
 */
export function getRecordCrumbName(link: Link): string | undefined {
  const name: string = getNumberedRecordName({
    number: link.recordNumber,
    name: link.recordName,
  });

  return name || undefined;
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
