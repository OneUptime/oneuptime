/*
 * An incident or alert grouping rule's episode title and description
 * templates (episodeTitleTemplate, episodeDescriptionTemplate) and the
 * {{variables}} they hold (Common/Utils/Episode/EpisodeTemplateVariables).
 *
 * When a rule opens an episode, its grouping engine
 * (IncidentGroupingEngineService, AlertGroupingEngineService) fills in the
 * first incident's (or alert's) values and stores the result on the episode
 * (titleTemplate, descriptionTemplate) with only the count left as a
 * placeholder. The episode's title and description are that stored template
 * with the count filled in - when the episode opens, and each time
 * IncidentEpisodeService / AlertEpisodeService write them again as members
 * join or leave. So they read the same throughout, but for the count.
 */

type ReplaceAllLiterallyFunction = (
  text: string,
  placeholder: RegExp,
  value: string,
) => string;

/*
 * Puts `value` in for every match of `placeholder`, exactly as written. A
 * string replacement reads "$&", "$`", "$'" and "$1" in it as patterns, so an
 * incident or alert titled "Price $& up" - or a title typed on a form - came
 * out of an episode template mangled, or with other parts of the template
 * copied into it.
 */
export const replaceAllLiterally: ReplaceAllLiterallyFunction = (
  text: string,
  placeholder: RegExp,
  value: string,
): string => {
  return text.replace(placeholder, (): string => {
    return value;
  });
};

type ClearPlaceholdersExceptFunction = (text: string, kept: string) => string;

/*
 * Clears every {{...}} in `text` but `kept` (the count), which stays where
 * it is - matched as the title and description are cleared once the count
 * is filled in. The engines store an episode's templates this way: only the
 * count is filled in again as members join or leave, so anything else left
 * in them - "{{monitorName}}" for an incident with no monitor - came back
 * into the title as soon as another one joined.
 */
export const clearPlaceholdersExcept: ClearPlaceholdersExceptFunction = (
  text: string,
  kept: string,
): string => {
  return text
    .split(kept)
    .map((part: string): string => {
      return part.replace(/\{\{[^}]+\}\}/g, "");
    })
    .join(kept);
};
