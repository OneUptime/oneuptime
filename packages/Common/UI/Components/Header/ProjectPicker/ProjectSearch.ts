import Project from "../../../../Models/DatabaseModels/Project";
import {
  filterPaletteCommands,
  getPaletteQueryWords,
  PaletteCommandMatch,
} from "../../CommandPalette/PaletteFilter";
import { PaletteCommand } from "../../CommandPalette/Types";

/*
 * THE PROJECT LIST'S SEARCH.
 *
 * The search box over the project list kept a project only when its name
 * started with what was typed, so someone with many projects had to
 * remember how each name began: "kube" did not find "OneUptime Kubernetes",
 * "acme" did not find "Sample: Acme Shop", "cafe" did not find "Café", and
 * the projects it did find kept the list's order, whichever matched best.
 *
 * A name is now matched the way Search (Cmd/Ctrl+K) matches a page's name
 * (PaletteFilter), so the header's two search boxes answer alike:
 *
 *  - each word typed, at the start of any word of the name, in any order:
 *    "kube" finds "OneUptime Kubernetes", "shop acme" "Sample: Acme Shop";
 *  - case, accents, punctuation and spacing aside: "cafe" finds "Café",
 *    "oneuptime-kubernetes" and "one uptime kubernetes" find "OneUptime
 *    Kubernetes";
 *  - inside a word ("ernet"), and - only when nothing matches better - by
 *    the name's initials ("ouk"), with a typo ("kubernetse"), or by its
 *    letters in order ("knts");
 *  - best match first: the whole name, then a name that starts with the
 *    search, then one that holds each word of it, then the rest. Matches
 *    that are as good as each other keep the list's order, so two projects
 *    that share a name stay as they were listed.
 *
 * A search of symbols alone - an emoji, a "#" - has no word in it to match,
 * so a name that holds it as typed is listed, as the old search listed one
 * that started with it.
 */

export type ProjectSearch = (search: string) => Array<Project>;

/*
 * A search of symbols alone (an emoji, "#", "&"): the names that hold it as
 * typed, case aside, in the list's order.
 */
const findBySymbols: (
  projects: Array<Project>,
  search: string,
) => Array<Project> = (
  projects: Array<Project>,
  search: string,
): Array<Project> => {
  const symbols: string = search.trim().toLowerCase();

  return projects.filter((project: Project): boolean => {
    return (project.name || "").toLowerCase().includes(symbols);
  });
};

/*
 * The search over one list of projects. Each project is put in Search's
 * terms once, when the list is, and the filter keeps what it read of each
 * name (PaletteFilter's prepared commands): a keystroke reads none of them
 * again, however many projects there are.
 */
export const createProjectSearch: (
  projects: Array<Project>,
) => ProjectSearch = (projects: Array<Project>): ProjectSearch => {
  const projectOf: Map<PaletteCommand, Project> = new Map();

  const entries: Array<PaletteCommand> = projects.map(
    (project: Project, index: number): PaletteCommand => {
      const entry: PaletteCommand = {
        // The list's place: unique, where two projects can share a name.
        id: `${index}`,
        title: project.name || "",
        // Found by its name alone: there is no group it is listed under.
        category: "",
        onSelect: (): void => {},
      };

      projectOf.set(entry, project);

      return entry;
    },
  );

  return (search: string): Array<Project> => {
    if (search.trim().length === 0) {
      return projects;
    }

    if (getPaletteQueryWords(search).length === 0) {
      return findBySymbols(projects, search);
    }

    return filterPaletteCommands(entries, search).map(
      (match: PaletteCommandMatch): Project => {
        return projectOf.get(match.command)!;
      },
    );
  };
};

// The projects a search finds in a list, best match first.
export const searchProjects: (
  projects: Array<Project>,
  search: string,
) => Array<Project> = (
  projects: Array<Project>,
  search: string,
): Array<Project> => {
  return createProjectSearch(projects)(search);
};
