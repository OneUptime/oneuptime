import { JSONObject } from "../../Types/JSON";

/*
 * STATUS PAGES AS THEIR PROVIDERS ANSWER THEM, FOR THE SUITES OF THE
 * EXTERNAL STATUS PAGE MONITOR.
 *
 * A page is described in a few lines - its groups, its components with the
 * status each has now, its active incidents with the components each names
 * - and turned into the JSON its provider serves:
 *
 *   - Atlassian Statuspage: /api/v2/status.json, /api/v2/components.json
 *     (a group is a component of its own, marked group, that lists its
 *     members; a member names its group by group_id) and
 *     /api/v2/incidents/unresolved.json (each incident with the components
 *     it affects, by id and name), in the shapes statuspage.io documents;
 *   - incident.io: the proxy its pages read, /proxy/<host>, with the
 *     summary's flat component list, its structure of groups, the components
 *     affected now and the ongoing incidents.
 *
 * The pages are the ones the issue behind the monitor's component choice
 * (#5156) names, with their real component names: GitHub's (an Atlassian
 * Statuspage of twelve components and no groups, where "Copilot" is inside
 * "Copilot AI Model Providers"), OpenAI's (incident.io, in groups) and
 * Cloudflare's shape (an Atlassian Statuspage in groups, "Workers" beside
 * "Workers KV", and one name in two groups).
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface FixtureGroup {
  id: string;
  name: string;
}

export interface FixtureComponent {
  id: string;
  name: string;
  // Operational unless said.
  status?: string | undefined;
  groupId?: string | undefined;
  description?: string | undefined;
}

export interface FixtureIncident {
  id: string;
  name: string;
  componentIds: Array<string>;
}

export interface FixturePage {
  pageName: string;
  groups: Array<FixtureGroup>;
  components: Array<FixtureComponent>;
}

export const OPERATIONAL: string = "operational";

// Atlassian Statuspage's /api/v2/status.json.
export function atlassianStatusJSON(
  page: FixturePage,
  status: { indicator: string; description: string } = {
    indicator: "none",
    description: "All Systems Operational",
  },
): JSONObject {
  return {
    page: {
      id: "kctbh9vrtdwd",
      name: page.pageName,
      url: "https://status.example.com",
      time_zone: "Etc/UTC",
      updated_at: "2026-10-27T02:59:09.086Z",
    },
    status: { indicator: status.indicator, description: status.description },
  };
}

// Atlassian Statuspage's /api/v2/components.json: groups first, as it lists them.
export function atlassianComponentsJSON(page: FixturePage): JSONObject {
  const groups: Array<JSONObject> = page.groups.map(
    (group: FixtureGroup, index: number): JSONObject => {
      return {
        id: group.id,
        name: group.name,
        status: OPERATIONAL,
        created_at: "2014-05-03T01:22:07.274Z",
        updated_at: "2026-10-27T02:59:09.086Z",
        position: index + 1,
        description: null,
        showcase: false,
        start_date: null,
        group_id: null,
        page_id: "kctbh9vrtdwd",
        group: true,
        only_show_if_degraded: false,
        components: page.components
          .filter((component: FixtureComponent): boolean => {
            return component.groupId === group.id;
          })
          .map((component: FixtureComponent): string => {
            return component.id;
          }),
      };
    },
  );

  const components: Array<JSONObject> = page.components.map(
    (component: FixtureComponent, index: number): JSONObject => {
      return {
        id: component.id,
        name: component.name,
        status: component.status || OPERATIONAL,
        created_at: "2017-01-31T20:05:05.370Z",
        updated_at: "2026-10-27T02:59:09.086Z",
        position: index + 1,
        description: component.description || null,
        showcase: true,
        start_date: null,
        group_id: component.groupId || null,
        page_id: "kctbh9vrtdwd",
        group: false,
        only_show_if_degraded: false,
      };
    },
  );

  return {
    page: atlassianStatusJSON(page)["page"] as JSONObject,
    components: [...groups, ...components],
  };
}

// Atlassian Statuspage's /api/v2/incidents/unresolved.json.
export function atlassianUnresolvedJSON(
  page: FixturePage,
  incidents: Array<FixtureIncident>,
): JSONObject {
  return {
    page: atlassianStatusJSON(page)["page"] as JSONObject,
    incidents: incidents.map((incident: FixtureIncident): JSONObject => {
      return {
        id: incident.id,
        name: incident.name,
        status: "investigating",
        impact: "minor",
        shortlink: "https://stspg.io/x",
        created_at: "2026-10-27T01:00:00.000Z",
        incident_updates: [],
        components: incident.componentIds.map(
          (componentId: string): JSONObject => {
            const component: FixtureComponent | undefined =
              page.components.find((candidate: FixtureComponent): boolean => {
                return candidate.id === componentId;
              });

            return {
              id: componentId,
              name: component?.name || componentId,
              status: component?.status || OPERATIONAL,
              group_id: component?.groupId || null,
              group: false,
            };
          },
        ),
      };
    }),
  };
}

// incident.io's /proxy/<host> answer: everything under summary.
export function incidentIoProxyJSON(
  page: FixturePage,
  incidents: Array<FixtureIncident>,
): JSONObject {
  const grouped: Array<JSONObject> = page.groups.map(
    (group: FixtureGroup): JSONObject => {
      return {
        group: {
          id: group.id,
          name: group.name,
          description: "",
          display_aggregated_uptime: true,
          hidden: false,
          components: page.components
            .filter((component: FixtureComponent): boolean => {
              return component.groupId === group.id;
            })
            .map((component: FixtureComponent): JSONObject => {
              return {
                component_id: component.id,
                name: component.name,
                hidden: false,
                display_uptime: true,
              };
            }),
        },
      };
    },
  );

  const ungrouped: Array<JSONObject> = page.components
    .filter((component: FixtureComponent): boolean => {
      return !component.groupId;
    })
    .map((component: FixtureComponent): JSONObject => {
      return {
        component: {
          component_id: component.id,
          name: component.name,
          hidden: false,
        },
      };
    });

  return {
    summary: {
      id: "01JMDK9XYNY6RXSED6SDWW50WY",
      name: page.pageName,
      subpath: "",
      public_url: "https://status.example.com",
      components: page.components.map(
        (component: FixtureComponent): JSONObject => {
          return {
            id: component.id,
            name: component.name,
            status_page_id: "01JMDK9XYNY6RXSED6SDWW50WY",
          };
        },
      ),
      affected_components: page.components
        .filter((component: FixtureComponent): boolean => {
          return Boolean(component.status) && component.status !== OPERATIONAL;
        })
        .map((component: FixtureComponent): JSONObject => {
          return {
            component_id: component.id,
            status: component.status as string,
          };
        }),
      ongoing_incidents: incidents.map(
        (incident: FixtureIncident): JSONObject => {
          return {
            id: incident.id,
            name: incident.name,
            status: "investigating",
            affected_components: incident.componentIds.map(
              (componentId: string): JSONObject => {
                const component: FixtureComponent | undefined =
                  page.components.find(
                    (candidate: FixtureComponent): boolean => {
                      return candidate.id === componentId;
                    },
                  );

                return {
                  component_id: componentId,
                  status: component?.status || "degraded_performance",
                };
              },
            ),
          };
        },
      ),
      scheduled_maintenances: [],
      structure: {
        id: "01JMDKA0000000000000000000",
        items: [...ungrouped, ...grouped],
      },
    },
  };
}

// The page of a provider, with some components' statuses changed.
export function withStatuses(
  page: FixturePage,
  statuses: Record<string, string>,
): FixturePage {
  return {
    ...page,
    components: page.components.map(
      (component: FixtureComponent): FixtureComponent => {
        const status: string | undefined = statuses[component.name];

        return status ? { ...component, status: status } : component;
      },
    ),
  };
}

// The id of a page's component by its name (the first of that name).
export function componentId(page: FixturePage, name: string): string {
  const component: FixtureComponent | undefined = page.components.find(
    (candidate: FixtureComponent): boolean => {
      return candidate.name === name;
    },
  );

  if (!component) {
    throw new Error(`The fixture page has no component named ${name}.`);
  }

  return component.id;
}

/*
 * GitHub's status page (an Atlassian Statuspage): twelve components, no
 * groups, as it lists them - its placeholder component that points to the
 * page among them.
 */
export const GITHUB_PAGE: FixturePage = {
  pageName: "GitHub",
  groups: [],
  components: [
    { id: "8l4ygp009s5s", name: "Git Operations" },
    { id: "4230lsnqdsld", name: "Webhooks" },
    {
      id: "0l2p9nhqnxpd",
      name: "Visit www.githubstatus.com for more information",
    },
    { id: "brv1bkgrwx7q", name: "API Requests" },
    { id: "kr09ddfgbfsf", name: "Issues" },
    { id: "hhtssxt0f5v2", name: "Pull Requests" },
    { id: "br0l2tvcx85d", name: "Actions" },
    { id: "st3j38cctv9l", name: "Packages" },
    { id: "vg70hn9s2tyj", name: "Pages" },
    { id: "pjmpxvq2cmr2", name: "Copilot" },
    { id: "h2ftsgbw7kmk", name: "Codespaces" },
    { id: "f6w8k3dq0x7r", name: "Copilot AI Model Providers" },
  ],
};

// GitHub's incidents, as its page has had them.
export const GITHUB_INCIDENTS: {
  copilot: FixtureIncident;
  modelProviders: FixtureIncident;
  gitAndPullRequests: FixtureIncident;
  actionsIssuesAndApi: FixtureIncident;
  unattributed: FixtureIncident;
} = {
  copilot: {
    id: "inc-copilot",
    name: "Incident with Copilot",
    componentIds: ["pjmpxvq2cmr2"],
  },
  modelProviders: {
    id: "inc-model-providers",
    name: "Grok 4.6 and Grok 4.7 Service Issues",
    componentIds: ["f6w8k3dq0x7r"],
  },
  gitAndPullRequests: {
    id: "inc-git-prs",
    name: "Incident with Git Operations and Pull Requests",
    componentIds: ["8l4ygp009s5s", "hhtssxt0f5v2"],
  },
  actionsIssuesAndApi: {
    id: "inc-actions",
    name: "Incident with Actions, Issues and API Requests",
    componentIds: ["br0l2tvcx85d", "kr09ddfgbfsf", "brv1bkgrwx7q"],
  },
  // Posted before the page named what it affects.
  unattributed: {
    id: "inc-unattributed",
    name: "Disruption with some GitHub services",
    componentIds: [],
  },
};

// The four GitHub components the customer behind #5156 depends on.
export const GITHUB_CHOSEN_COMPONENTS: Array<string> = [
  "Git Operations",
  "Pull Requests",
  "Actions",
  "Webhooks",
];

// OpenAI's status page (incident.io), in its groups.
export const OPENAI_PAGE: FixturePage = {
  pageName: "OpenAI",
  groups: [
    { id: "01JMXBRMFDGROUPAPIS000000", name: "APIs" },
    { id: "01JMXBRMFDGROUPCHATGPT000", name: "ChatGPT" },
    { id: "01JMXBRMFDGROUPCODEX00000", name: "Codex" },
  ],
  components: [
    {
      id: "01JMXBRMFE6N2NNT7DG6XZQ6PW",
      name: "Chat Completions",
      groupId: "01JMXBRMFDGROUPAPIS000000",
    },
    {
      id: "01JP8CD9JR3HR6Y7G4Q75N4DVW",
      name: "Responses",
      groupId: "01JMXBRMFDGROUPAPIS000000",
    },
    {
      id: "01M3Q6W0264T1RJS1YEM47CAQJ",
      name: "Embeddings",
      groupId: "01JMXBRMFDGROUPAPIS000000",
    },
    {
      id: "01JMXBRMFE6N2NNT7DG6XZQ6PA",
      name: "Fine-tuning",
      groupId: "01JMXBRMFDGROUPAPIS000000",
    },
    {
      id: "01JMXBRMFE6N2NNT7DG6XZQ6PB",
      name: "Login",
      groupId: "01JMXBRMFDGROUPCHATGPT000",
    },
    {
      id: "01JMXBRMFE6N2NNT7DG6XZQ6PC",
      name: "Conversations",
      groupId: "01JMXBRMFDGROUPCHATGPT000",
    },
    {
      id: "01JMXBRMFE6N2NNT7DG6XZQ6PD",
      name: "File uploads",
      groupId: "01JMXBRMFDGROUPCHATGPT000",
    },
    {
      id: "01JMXBRMFE6N2NNT7DG6XZQ6PE",
      name: "Codex Web",
      groupId: "01JMXBRMFDGROUPCODEX00000",
    },
    {
      id: "01JMXBRMFE6N2NNT7DG6XZQ6PF",
      name: "Codex API",
      groupId: "01JMXBRMFDGROUPCODEX00000",
    },
    // A component the page lists outside any group.
    { id: "01JMXBRMFE6N2NNT7DG6XZQ6PG", name: "Sora" },
  ],
};

export const OPENAI_INCIDENTS: {
  conversations: FixtureIncident;
  embeddings: FixtureIncident;
  unattributed: FixtureIncident;
} = {
  conversations: {
    id: "01K00000000000000000000001",
    name: "Elevated errors in ChatGPT conversations",
    componentIds: ["01JMXBRMFE6N2NNT7DG6XZQ6PC"],
  },
  embeddings: {
    id: "01K00000000000000000000002",
    name: "Increased latency for Embeddings",
    componentIds: ["01M3Q6W0264T1RJS1YEM47CAQJ"],
  },
  unattributed: {
    id: "01K00000000000000000000003",
    name: "We are investigating reports of issues",
    componentIds: [],
  },
};

/*
 * Cloudflare's shape (an Atlassian Statuspage in groups): services that
 * start with the same word, data centers by region, and one name - "API" -
 * in two groups.
 */
export const CLOUDFLARE_PAGE: FixturePage = {
  pageName: "Cloudflare",
  groups: [
    { id: "1km35smx8p41", name: "Cloudflare Sites and Services" },
    { id: "b5xk1d3j1w2v", name: "Europe" },
    { id: "kw3n2pqr7c9z", name: "Developer Platform" },
  ],
  components: [
    { id: "yh6f0r4529hb", name: "API", groupId: "1km35smx8p41" },
    { id: "9cj2h1nk0cxq", name: "Dashboard", groupId: "1km35smx8p41" },
    { id: "57srcl8zcn7c", name: "Workers", groupId: "1km35smx8p41" },
    { id: "tmh50tx2nprs", name: "Workers KV", groupId: "1km35smx8p41" },
    { id: "w2p8v1x4ycq0", name: "Workers AI", groupId: "1km35smx8p41" },
    {
      id: "0zjbbwp08d1h",
      name: "Amsterdam, Netherlands - (AMS)",
      groupId: "b5xk1d3j1w2v",
    },
    {
      id: "k4hl3vpk1yvp",
      name: "Frankfurt, Germany - (FRA)",
      groupId: "b5xk1d3j1w2v",
    },
    { id: "c8ksm3wq5t2n", name: "API", groupId: "kw3n2pqr7c9z" },
  ],
};
