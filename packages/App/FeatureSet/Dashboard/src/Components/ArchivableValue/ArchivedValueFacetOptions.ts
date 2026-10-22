import { FilterChipDropdownOption } from "../ResourceOwners/FilterChipDropdownTypes";
import { ARCHIVED_VALUE_TAG } from "Common/UI/Components/ArchivedTag/ArchivedTagCopy";
import { isArchivedValue } from "Common/Utils/ArchivableValues";

/*
 * A list's filter (the facet bar's chips) over values that can be archived
 * (Common/Utils/ArchivableValues): a state, a severity, a monitor status, a
 * label.
 *
 * Every value is offered - old records keep an archived one and stay
 * findable by it - but the archived ones come last, under an "Archived"
 * heading (the chip's group, which it translates), so nobody wonders why a
 * value no form offers any more is listed, or mistakes it for one in use.
 * The values keep their own order within each part.
 *
 * React-free, so a test reads the same answers the chips draw.
 */

// What a facet's read selects, beside its own columns, to tell them apart.
export const ARCHIVED_FACET_SELECT: { isArchived: true } = {
  isArchived: true,
};

// The heading over the archived values: English, the chip translates it.
export const ARCHIVED_FACET_GROUP: string = ARCHIVED_VALUE_TAG;

export const getArchivableValueFacetOptions: <T>(data: {
  values: Array<T>;
  toOption: (value: T) => FilterChipDropdownOption;
}) => Array<FilterChipDropdownOption> = <T>(data: {
  values: Array<T>;
  toOption: (value: T) => FilterChipDropdownOption;
}): Array<FilterChipDropdownOption> => {
  const live: Array<FilterChipDropdownOption> = [];
  const archived: Array<FilterChipDropdownOption> = [];

  for (const value of data.values) {
    if (isArchivedValue(value)) {
      archived.push({ ...data.toOption(value), group: ARCHIVED_FACET_GROUP });
    } else {
      live.push(data.toOption(value));
    }
  }

  return [...live, ...archived];
};
