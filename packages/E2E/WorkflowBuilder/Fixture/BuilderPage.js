/*
 * The Dashboard's real Workflow Builder page: its toolbar - the save pill,
 * the Enabled switch, the add button and Run Workflow - the notice shown
 * while the workflow is off, and the real canvas under them. For the specs
 * about the page around the canvas (WorkflowBuilderPageToolbar.spec.ts).
 *
 * ?page=builder-page      a workflow from scratch that is off, as a new
 *                         workflow is: nothing on the canvas but the dashed
 *                         "Choose what starts this workflow" card
 *   &graph=trigger        a Manual trigger connected to a Log step
 *   &graph=deleted        a Log step whose trigger was deleted
 *   &template=<id>        the graph a workflow template builds, as Create
 *                         Workflow saves it: the Builder opens on it right
 *                         after the dialog closes
 *     &picked=1           with someone picked for each of its Page steps, as
 *                         the dialog's who-to-page question fills them in
 *     &picked=none        with nobody picked: a Page step that may page
 *                         nobody is left out, with the steps only it needs
 *                         Without &picked, the template's own graph: its Page
 *                         steps wait for who to page.
 *   &enabled=1            a workflow that is on
 *   &column=430           the width, in pixels, of the column the page is
 *                         drawn in: 430 is the Builder's column on a tablet,
 *                         beside the side menu. Without it the page is as
 *                         wide as the window, inside the page's gutters.
 *
 * Nothing of the page is faked. Only the API is stood in for
 * (installBuilderPage): the workflow is read from the graph above, every
 * save is noted in window.__builderSaves, and the list of runs is empty.
 */
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { ComponentType, NodeType } from "Common/Types/Workflow/Component";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import {
  buildGraphForTemplate,
  getWorkflowTemplate,
} from "Common/Types/Workflow/Templates";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import React from "react";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import Builder from "../../../App/FeatureSet/Dashboard/src/Pages/Workflow/View/Builder";

export const BUILDER_PROJECT_ID = "22222222-2222-4222-8222-222222222222";
export const BUILDER_WORKFLOW_ID = "55555555-5555-4555-8555-555555555555";
const BUILDER_USER_ID = "66666666-6666-4666-8666-666666666666";

const params = new URLSearchParams(window.location.search);

// Whoever the create dialog's who-to-page question picked: one on-call policy, team or person.
export const PICKED_TO_PAGE_ID = "77777777-7777-4777-8777-777777777777";

/*
 * Who was picked for each of a template's Page steps (&picked), as the
 * create dialog hands them to buildGraphForTemplate.
 */
function whoToPagePicks(templateId) {
  const picked = params.get("picked");

  if (picked === "none") {
    return {};
  }

  if (picked !== "1") {
    return undefined;
  }

  const picks = {};

  for (const ask of getWorkflowTemplate(templateId)?.whoToPage || []) {
    picks[ask.componentId] = [PICKED_TO_PAGE_ID];
  }

  return picks;
}

// A step as a saved graph stores it: the Builder fills in its metadata.
function savedStep(metadataId, componentType, y, args) {
  return {
    id: `canvas-${metadataId}-1`,
    type: "node",
    position: { x: 160, y: y },
    data: {
      id: `${metadataId}-1`,
      internalId: `runner-${metadataId}-1`,
      nodeType: NodeType.Node,
      componentType: componentType,
      metadataId: metadataId,
      error: "",
      arguments: args || {},
      returnValues: {},
    },
  };
}

function savedGraph() {
  const graph = params.get("graph");
  const templateId = params.get("template");

  if (templateId) {
    let counter = 0;

    const built = buildGraphForTemplate(
      templateId,
      () => {
        counter++;
        return `template-${counter}`;
      },
      whoToPagePicks(templateId),
    );

    if (!built) {
      throw new Error(`No workflow template ${templateId}`);
    }

    return built;
  }
  const log = savedStep("log", ComponentType.Component, 320, {
    value: "Deployment finished",
  });

  if (graph === "trigger") {
    return {
      nodes: [savedStep("manual", ComponentType.Trigger, 64), log],
      edges: [
        {
          id: "manual-to-log",
          source: "canvas-manual-1",
          sourceHandle: "success",
          target: "canvas-log-1",
          targetHandle: "in",
        },
      ],
    };
  }

  if (graph === "deleted") {
    return { nodes: [log], edges: [] };
  }

  // A workflow from scratch saves an empty graph.
  return { nodes: [], edges: [] };
}

// Every save the page sends: what it changed, in order.
window.__builderSaves = [];

export function installBuilderPage() {
  Navigation.getLastParamAsObjectID = () => {
    return new ObjectID(BUILDER_WORKFLOW_ID);
  };

  ProjectUtil.getCurrentProjectId = () => {
    return new ObjectID(BUILDER_PROJECT_ID);
  };

  // A project admin: may edit, run, and turn the workflow on and off.
  PermissionUtil.getAllPermissions = () => {
    return [Permission.ProjectAdmin];
  };

  PermissionUtil.getProjectPermissions = () => {
    return null;
  };

  PermissionUtil.getGlobalPermissions = () => {
    return null;
  };

  UserUtil.getUserId = () => {
    return new ObjectID(BUILDER_USER_ID);
  };

  UserUtil.isMasterAdmin = () => {
    return false;
  };

  ModelAPI.getItem = async (data) => {
    if (data.modelType !== WorkflowModel) {
      return null;
    }

    const workflow = new WorkflowModel();
    workflow.id = new ObjectID(BUILDER_WORKFLOW_ID);
    workflow.name = "Deploy notifications";
    workflow.isEnabled = params.get("enabled") === "1";
    workflow.isArchived = false;
    workflow.graph = savedGraph();

    return workflow;
  };

  ModelAPI.getList = async (data) => {
    return { data: [], count: 0, skip: 0, limit: data.limit || 10 };
  };

  ModelAPI.count = async () => {
    return 0;
  };

  ModelAPI.updateById = async (data) => {
    window.__builderSaves.push(Object.keys(data.data || {}));

    return new HTTPResponse(200, {}, {});
  };
}

// What App.tsx does for every page: the router's hooks, handed to Navigation.
function Shell(props) {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return props.children;
}

export function BuilderPage() {
  const column = Number(params.get("column")) || 0;

  return (
    <BrowserRouter>
      <Shell>
        <div style={{ padding: "16px" }}>
          <div
            data-testid="builder-column"
            style={{ maxWidth: column ? `${column}px` : undefined }}
          >
            <Builder />
          </div>
        </div>
      </Shell>
    </BrowserRouter>
  );
}
