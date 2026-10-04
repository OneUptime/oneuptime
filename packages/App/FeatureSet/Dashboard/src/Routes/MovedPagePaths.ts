import RouteParams from "../Utils/RouteParams";

/*
 * Where pages lived before they moved, relative to their old product's mount.
 * Nothing in the RouteMap points here any more: these exist only so an old
 * link still arrives somewhere, and the route groups forward them.
 *
 * They are kept apart from the route groups so that what reads them (Search,
 * tests) does not load every page of a group to get at a few strings.
 */

/*
 * The Runner pages moved from Project Settings into Runbooks. Relative to
 * …/settings/.
 */
export const MOVED_RUNNER_SETTINGS_PATHS: {
  runners: string;
  runnerView: string;
  runnerCredentials: string;
} = {
  runners: "runners",
  runnerView: `runners/${RouteParams.ModelID}`,
  runnerCredentials: "runner-credentials",
};

/*
 * Incident forms became Forms (Incidents > Settings > Forms). Relative to
 * …/incidents/.
 */
export const MOVED_INCIDENT_FORM_PATHS: { forms: string; formView: string } = {
  forms: "settings/forms",
  formView: `settings/forms/${RouteParams.ModelID}`,
};
