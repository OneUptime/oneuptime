/** Match every search term, allowing a title, project and reference in one query. */
export function matchesSearch(
  query: string,
  fields: Array<string | number | null | undefined>,
): boolean {
  const haystack: string = fields
    .filter((field: string | number | null | undefined) => {
      return field !== null && field !== undefined;
    })
    .join(" ")
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((term: string) => {
      return haystack.includes(term);
    });
}
