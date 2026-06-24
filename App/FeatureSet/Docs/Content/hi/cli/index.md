# OneUptime CLI

OneUptime CLI एक command-line interface है जो आपको terminal से सीधे अपने OneUptime resources प्रबंधित करने की अनुमति देती है। यह monitors, incidents, alerts, status pages और अधिक पर पूर्ण CRUD operations का समर्थन करती है।

## विशेषताएं

- production, staging और development के लिए named contexts के साथ **Multi-environment support**
- आपके OneUptime instance से उपलब्ध resources की **Auto-discovery**
- CLI flags, environment variables या saved contexts के माध्यम से **Flexible authentication**
- JSON, table और wide display modes के साथ **Smart output formatting**
- CI/CD pipelines और automation workflows के लिए **Scriptable**

## Installation

```bash
npm install -g @oneuptime/cli
```

## Quick Start

```bash
# अपने OneUptime instance के साथ authenticate करें
oneuptime login <your-api-key> https://oneuptime.com

# अपने monitors सूचीबद्ध करें
oneuptime monitor list

# एक specific incident देखें
oneuptime incident get <incident-id>

# सभी उपलब्ध resources देखें
oneuptime resources
```

## Documentation

| गाइड                                            | विवरण                                                  |
| ----------------------------------------------- | ------------------------------------------------------ |
| [Authentication](./authentication.md)           | Login, contexts और credential management               |
| [Resource Operations](./resource-operations.md) | monitors, incidents, alerts और अधिक पर CRUD operations |
| [Output Formats](./output-formats.md)           | JSON, table और wide output modes                       |
| [Scripting और CI/CD](./scripting.md)            | Automation, environment variables और pipeline उपयोग    |
| [Command Reference](./command-reference.md)     | सभी commands और options का पूर्ण संदर्भ                |

## Global Options

इन flags का उपयोग किसी भी command के साथ किया जा सकता है:

| Flag                    | विवरण                                        |
| ----------------------- | -------------------------------------------- |
| `--api-key <key>`       | इस command के लिए API key override करें      |
| `--url <url>`           | इस command के लिए instance URL override करें |
| `--context <name>`      | एक specific named context उपयोग करें         |
| `-o, --output <format>` | Output format: `json`, `table`, `wide`       |
| `--no-color`            | colored output अक्षम करें                    |
| `--help`                | command help दिखाएं                          |
| `--version`             | CLI version दिखाएं                           |

## सहायता प्राप्त करना

```bash
# सामान्य help
oneuptime --help

# एक specific command के लिए help
oneuptime monitor --help
oneuptime monitor list --help
```
