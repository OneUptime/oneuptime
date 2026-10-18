import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The Services list's words for a project without services, and the
 * question its Create form asks first. Kept apart from the page so App's
 * tests read them without React.
 *
 * Services are found, not made: ingest creates one for every new
 * service.name it sees. An empty list said "No services yet" over a
 * Create Service button, as if a service had to be made by hand first; it
 * says now where services come from, with the setup guide beside Create.
 */

export const SERVICES_EMPTY_DESCRIPTION: string = translationKey(
  "Services appear here once your apps send telemetry, one for each service.name.",
);

export const SET_UP_TELEMETRY_ACTION: string =
  translationKey("Set up telemetry");

export const SERVICE_NAME_HELP: string = translationKey(
  "Use the service.name your apps send, so their telemetry shows up under this service.",
);
