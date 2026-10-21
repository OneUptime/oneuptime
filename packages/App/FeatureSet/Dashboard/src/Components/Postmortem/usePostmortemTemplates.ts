import { useEffect, useState } from "react";
import {
  loadPostmortemTemplates,
  PostmortemTemplateOption,
} from "./PostmortemTemplates";

export interface PostmortemTemplatesState {
  templates: Array<PostmortemTemplateOption>;
  // Whether the request has answered, with templates, none or an error.
  hasLoaded: boolean;
}

/*
 * The project's postmortem templates, loaded once when a Postmortem page
 * opens. Best effort: a page whose templates cannot be read (a role without
 * access to them, a failed request) simply has none to offer, so Apply
 * Template is not shown, and nothing pops up over the page about it.
 */
export default function usePostmortemTemplates(): PostmortemTemplatesState {
  const [state, setState] = useState<PostmortemTemplatesState>({
    templates: [],
    hasLoaded: false,
  });

  useEffect(() => {
    let isCancelled: boolean = false;

    loadPostmortemTemplates()
      .then((templates: Array<PostmortemTemplateOption>) => {
        if (!isCancelled) {
          setState({ templates: templates, hasLoaded: true });
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setState({ templates: [], hasLoaded: true });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return state;
}
