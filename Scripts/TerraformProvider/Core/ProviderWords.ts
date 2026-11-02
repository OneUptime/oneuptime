/*
 * WHAT THE PROVIDER SAYS ABOUT ITSELF.
 *
 * Its name as the product writes it, what it does, and its two settings:
 * on the registry's provider page (docs/index.md), in the README, and in
 * the provider's own schema (terraform providers schema, editors' hovers).
 *
 * The provider page used to open with the API spec's own description,
 * "OpenAPI specification for OneUptime. This document describes the API
 * endpoints...", which is about the API document, under the title
 * "Oneuptime Provider".
 */

export const PROVIDER_DISPLAY_NAME: string = "OneUptime";

export const PROVIDER_DESCRIPTION: string =
  "Manage a OneUptime project as code, with Terraform or OpenTofu: monitors, status pages, incidents, on-call policies, teams and everything else the OneUptime API manages.";

export const URL_ATTRIBUTE_DESCRIPTION: string =
  "The address of your OneUptime: https://oneuptime.com, or your own installation's. Leave out /api: the provider adds it. Falls back to the `ONEUPTIME_URL` environment variable, then to https://oneuptime.com.";

export const API_KEY_ATTRIBUTE_DESCRIPTION: string =
  "An API key of the project to manage, from its **Settings** > **API Keys**. Falls back to the `ONEUPTIME_API_KEY` environment variable; the provider stops before any plan when neither is set.";
