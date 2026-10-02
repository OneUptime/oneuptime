# API Reference

OneUptime provides a comprehensive REST API that allows you to integrate monitoring, incident management, and status page functionality into your applications and workflows. **Anything you an do on the OneUptime dashboard can also be done through the API, enabling automation and custom integrations.**

### Getting Started

Our API is organized around REST principles and uses standard HTTP response codes, authentication, and verbs. All API endpoints return JSON responses.

### Authentication

All API requests require authentication using API keys. You can generate API keys from your OneUptime dashboard under Settings > API Keys.

### Examples for each resource

Every resource in the OneUptime dashboard has a **Developer** section in its side menu, collapsed until you open it. Its **API** page has ready-to-run `curl` commands for that resource, pointed at your OneUptime and filled in from your own project: read, change and delete it from the resource's own page, or list, count and create from a list page (for example **Monitors**). The commands read your API key from the `ONEUPTIME_API_KEY` environment variable.

The examples are written for the resource. On the **Incidents** list, for example, the list request shows its answer with your first incident, the filters find incidents that are not resolved, of one severity, about one monitor or from the last seven days, using your own states, severities and monitors, and the create request declares an incident with one of your severities, with a line on what each field is for. An incident's own page reads it with its real answer, moves it to another of your severities, and has its common tasks: acknowledge and resolve it (with your project's own states), and add internal or public notes. Every API page ends with the resource's endpoints.

### API Reference

Please click here to check out OneUptime's API reference ➡️ [OneUptime API Reference](/reference). The API reference is available in multiple languages — your preferred language is auto-detected from your browser, and you can switch languages at any time using the selector in the top navigation.
