/*
 * The Huntress template's workflow on the real canvas, and its trigger's
 * panel in the real step settings dialog.
 *
 * ?scenario=huntress   the graph "Open an incident for each Huntress
 *                      incident report" creates, with the on-call policy
 *                      Critical picked on its Page step
 *   &facts=new         what the workflow keeps of Huntress's last request:
 *         =waiting     new (no signing secret, nothing received), waiting
 *         =receiving   (a secret, nothing yet), receiving (a request let in
 *         =failing     five minutes ago), failing (a request refused since
 *         =refused     the last one let in) or refused (Huntress's test,
 *                      refused a minute ago because no secret was saved yet)
 *   &secret=fail       saving the signing secret is refused, as the server
 *                      refuses one Huntress could not have issued
 *   &url=hidden        someone who may not see the workflow's webhook
 *                      secret key, so not the URL either
 *   &off=1             the workflow is turned off
 *
 * The panel reads and writes the workflow through the API, which is not
 * here: installHuntressWorkflow stands in for it, and for the project's
 * incident severities and on-call policies the settings pick from. What it
 * was asked to write is kept in window.__huntressSecretWrites, how often it
 * was read in window.__huntressReads, and window.huntressArrives() makes
 * the next read say Huntress's test arrived.
 */
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import {
  HUNTRESS_TEMPLATE_OPTIONS,
  buildHuntressIncidentWorkflowGraph,
} from "Common/Types/Workflow/Templates";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import { POLICIES, installPageProject } from "./PageScenarios";

// The workflow's webhook secret key: the last part of its Huntress URL.
export const HUNTRESS_WEBHOOK_KEY = "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b";

// As WorkflowService refuses a secret Huntress could not have issued.
export const HUNTRESS_SECRET_REFUSAL =
  "The signing secret is not one Huntress issues. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret and copy all of it. It starts with whsec_.";

const INCIDENT_SEVERITIES = [
  { id: "1e5e0000-0000-4000-8000-000000000001", name: "SEV 1", order: 1 },
  { id: "1e5e0000-0000-4000-8000-000000000002", name: "SEV 2", order: 2 },
  { id: "1e5e0000-0000-4000-8000-000000000003", name: "SEV 3", order: 3 },
];

const MINUTE = 60 * 1000;

/*
 * The nodes and edges of the Huntress scenario, or null for any other.
 * Each step carries its metadata, as the Builder loads a saved graph.
 */
export function getHuntressScenario(scenario, metadataOf) {
  if (scenario !== "huntress") {
    return null;
  }

  let counter = 0;

  const graph = buildHuntressIncidentWorkflowGraph(
    { ...HUNTRESS_TEMPLATE_OPTIONS, onCallPolicyIds: [POLICIES[0].id] },
    () => {
      counter++;
      return `huntress-graph-${counter}`;
    },
  );

  return {
    nodes: graph.nodes.map((node) => {
      return {
        ...node,
        data: {
          ...node.data,
          metadata: { ...metadataOf(node.data.metadataId) },
        },
      };
    }),
    edges: graph.edges,
  };
}

function factsFor(name) {
  const now = Date.now();

  if (name === "waiting") {
    return { isWebhookSigningSecretSet: true };
  }

  if (name === "receiving") {
    return {
      isWebhookSigningSecretSet: true,
      lastWebhookRequestAt: new Date(now - 5 * MINUTE),
    };
  }

  // What most people meet first: Huntress sent its test before the secret.
  if (name === "refused") {
    return {
      isWebhookSigningSecretSet: false,
      // As HuntressWebhookHandler words it (HUNTRESS_NO_SIGNING_SECRET_MESSAGE).
      lastWebhookError:
        "A request arrived but was refused, because no signing secret is saved for this workflow yet. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret, and save it in the workflow's Huntress trigger. Huntress sends the refused request again.",
      lastWebhookErrorAt: new Date(now - MINUTE),
    };
  }

  if (name === "failing") {
    return {
      isWebhookSigningSecretSet: true,
      lastWebhookRequestAt: new Date(now - 60 * MINUTE),
      // As StandardWebhookSignature words a request signed with another secret.
      lastWebhookError:
        "The request's signature does not match the signing secret. Copy the endpoint's signing secret from Huntress again.",
      lastWebhookErrorAt: new Date(now - 2 * MINUTE),
    };
  }

  return { isWebhookSigningSecretSet: false };
}

export function installHuntressWorkflow(params) {
  // The project's on-call policies, for the Page step's settings.
  installPageProject(params);

  const listProject = ModelAPI.getList;

  // And its incident severities, for the trigger's settings.
  ModelAPI.getList = async (data) => {
    if (data.modelType === IncidentSeverity) {
      const rows = INCIDENT_SEVERITIES.map((row) => {
        const severity = new IncidentSeverity();
        severity._id = row.id;
        severity.name = row.name;
        severity.order = row.order;
        return severity;
      });

      return { data: rows, count: rows.length, skip: 0, limit: rows.length };
    }

    return listProject(data);
  };

  ModelAPI.getCommonHeaders = () => {
    return {};
  };

  // Someone who may edit the workflow.
  PermissionGate.check = () => {
    return { isAllowed: true };
  };

  window.__huntressFacts = factsFor(params.get("facts") || "new");
  window.__huntressReads = 0;
  window.__huntressSecretWrites = [];

  window.huntressArrives = () => {
    window.__huntressFacts = {
      ...window.__huntressFacts,
      lastWebhookRequestAt: new Date(),
    };
  };

  ModelAPI.getItem = async (data) => {
    window.__huntressReads++;

    const workflow = new WorkflowModel();
    workflow._id = data.id.toString();
    Object.assign(workflow, window.__huntressFacts);

    return workflow;
  };

  ModelAPI.updateById = async (data) => {
    if (params.get("secret") === "fail") {
      throw new Error(HUNTRESS_SECRET_REFUSAL);
    }

    window.__huntressSecretWrites.push(JSON.parse(JSON.stringify(data.data)));

    // A new secret clears the refusal the old one left, as the server does.
    window.__huntressFacts = {
      ...window.__huntressFacts,
      isWebhookSigningSecretSet: true,
      lastWebhookError: undefined,
      lastWebhookErrorAt: undefined,
    };
  };
}
