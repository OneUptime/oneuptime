# API Reference

OneUptime provides a comprehensive REST API that allows you to integrate monitoring, incident management, and status page functionality into your applications and workflows. **Anything you an do on the OneUptime dashboard can also be done through the API, enabling automation and custom integrations.**

### Getting Started

Our API is organized around REST principles and uses standard HTTP response codes, authentication, and verbs. All API endpoints return JSON responses.

### Authentication

All API requests require authentication using API keys. You can generate API keys from your OneUptime dashboard under Settings > API Keys.

### Examples for each resource

Every resource in the OneUptime dashboard has a **Developer** section in its side menu, collapsed until you open it. Its **API** page has ready-to-run `curl` commands for that resource, pointed at your OneUptime: read, change and delete it from the resource's own page, or list, count and create from a list page (for example **Monitors**). The commands read your API key from the `ONEUPTIME_API_KEY` environment variable.

### API Reference

Please click here to check out OneUptime's API reference ➡️ [OneUptime API Reference](/reference). The API reference is available in multiple languages — your preferred language is auto-detected from your browser, and you can switch languages at any time using the selector in the top navigation.
