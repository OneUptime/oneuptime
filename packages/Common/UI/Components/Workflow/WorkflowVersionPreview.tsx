import Workflow from "./Workflow";
import {
  WorkflowCanvasGraph,
  toWorkflowCanvasGraph,
} from "./WorkflowCanvasGraph";
import { WorkflowVersionCopy } from "./WorkflowVersionPresentation";
import { WorkflowViewOnlyContext } from "./WorkflowViewOnly";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Modal, { ModalWidth } from "../Modal/Modal";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import WorkflowVersion from "../../../Models/DatabaseModels/WorkflowVersion";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentMetadata from "../../../Types/Workflow/Component";
import {
  WorkflowComponentLookup,
  WorkflowGraphChanges,
  getWorkflowGraphChanges,
} from "../../../Utils/Workflow/WorkflowGraphChanges";
import { SavedWorkflowGraph } from "../../../Utils/Workflow/WorkflowGraphSnapshot";
import React, {
  FunctionComponent,
  ReactElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * AN EARLIER VERSION OF A WORKFLOW, LOOKED AT BEFORE IT IS RESTORED: what
 * restoring it would change, in the version history's lines, and the version
 * itself on a canvas of its own where nothing moves (a step still opens, to
 * be read). Restore puts it on the builder's canvas as a step Undo takes
 * back, and saves it (UseWorkflowEditing.restoreVersion). Someone who may
 * not change the workflow looks, and is told why they cannot restore it.
 */

export const WorkflowVersionPreviewCopy: {
  readonly cannotDraw: string;
  readonly close: string;
} = {
  cannotDraw: translationKey(
    "This version cannot be shown: it has a step OneUptime no longer has.",
  ),
  close: translationKey("Close"),
};

// How tall the preview's canvas is.
const PREVIEW_CANVAS_HEIGHT: string = "min(420px, 50vh)";

export interface ComponentProps {
  workflowId: ObjectID;
  versionId: ObjectID;
  versionNumber: number;
  // Who saved it and when, as its row says it.
  description: string;
  // The graph on the builder's canvas, as it is saved.
  currentGraph: SavedWorkflowGraph;
  components: Array<ComponentMetadata>;
  // Why the reader may not restore it (the builder's edit gate), if they may not.
  restoreDisabledReason?: string | undefined;
  onRestore: (graph: JSONObject) => void;
  onClose: () => void;
}

const WorkflowVersionPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * In a view (WorkflowViewOnly, which the version history provides) the
   * version is there to be read: the dialog has no Restore, as it has none
   * while the builder says why the reader may not restore it.
   */
  const isViewOnly: boolean = useContext(WorkflowViewOnlyContext);
  const isRestoreLocked: boolean =
    isViewOnly || Boolean(props.restoreDisabledReason);
  const [graph, setGraph] = useState<JSONObject | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");

      try {
        const version: WorkflowVersion | null = await ModelAPI.getItem({
          modelType: WorkflowVersion,
          id: props.versionId,
          select: {
            graph: true,
          },
        });

        if (!isCurrent) {
          return;
        }

        setGraph((version?.graph as JSONObject | undefined) || null);
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [props.versionId.toString()]);

  const lookup: WorkflowComponentLookup = useMemo(() => {
    const byId: Map<string, ComponentMetadata> = new Map<
      string,
      ComponentMetadata
    >(
      props.components.map(
        (component: ComponentMetadata): [string, ComponentMetadata] => {
          return [component.id, component];
        },
      ),
    );

    return (componentId: string): ComponentMetadata | undefined => {
      return byId.get(componentId);
    };
  }, [props.components]);

  // The version as the canvas draws it, or null when it cannot be drawn.
  const canvasGraph: WorkflowCanvasGraph | null = useMemo(() => {
    if (!graph) {
      return null;
    }

    try {
      return toWorkflowCanvasGraph({ graph, components: props.components });
    } catch {
      return null;
    }
  }, [graph, props.components]);

  // What restoring it would change on the canvas as it is now.
  const changes: WorkflowGraphChanges | null = useMemo(() => {
    if (!graph) {
      return null;
    }

    return getWorkflowGraphChanges({
      before: props.currentGraph,
      after: graph,
      lookup,
      includeMoves: true,
    });
  }, [graph, props.currentGraph, lookup]);

  const isSameAsNow: boolean = Boolean(changes && changes.totalChanges === 0);
  const canRestore: boolean = Boolean(
    graph &&
      canvasGraph &&
      !isSameAsNow &&
      !isRestoreLocked &&
      !isLoading,
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (!graph || !canvasGraph) {
      return (
        <ErrorMessage
          message={
            translator.translateText(WorkflowVersionPreviewCopy.cannotDraw) ||
            WorkflowVersionPreviewCopy.cannotDraw
          }
        />
      );
    }

    return (
      <div className="space-y-4" data-testid="workflow-version-preview">
        <p
          className="text-sm text-gray-600"
          data-testid="workflow-version-preview-note"
        >
          {props.restoreDisabledReason ||
            translator.translateText(WorkflowVersionCopy.restoreNote)}
        </p>

        {changes && !isSameAsNow ? (
          <div>
            <h3 className="text-sm font-medium text-gray-900">
              {translator.translateText(
                WorkflowVersionCopy.previewChangesTitle,
              )}
            </h3>
            <ul
              className="mt-2 list-disc space-y-1 ps-5 text-sm text-gray-700"
              data-testid="workflow-version-preview-changes"
            >
              {changes.lines.map((line: string, index: number) => {
                return (
                  <li key={index} dir="auto" className="break-words">
                    {line}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p
            className="text-sm text-gray-700"
            data-testid="workflow-version-preview-same"
          >
            {translator.translateText(WorkflowVersionCopy.sameAsNow)}
          </p>
        )}

        <div className="overflow-hidden rounded-lg">
          <Workflow
            workflowId={props.workflowId}
            initialNodes={canvasGraph.nodes}
            initialEdges={canvasGraph.edges}
            canvasHeight={PREVIEW_CANVAS_HEIGHT}
            // A view: nothing on it moves, and nothing it reports is kept.
            editDisabledReason={
              translator.translateText(WorkflowVersionCopy.previewReadOnly) ||
              WorkflowVersionCopy.previewReadOnly
            }
            runDisabledReason={
              translator.translateText(WorkflowVersionCopy.previewRunRefused) ||
              WorkflowVersionCopy.previewRunRefused
            }
            onWorkflowUpdated={() => {}}
            showComponentsPickerModal={false}
            onComponentPickerModalUpdate={() => {}}
            showRunModal={false}
            onRunModalUpdate={() => {}}
            onRun={() => {}}
          />
        </div>
      </div>
    );
  };

  return (
    <Modal
      title={translator.translateTemplate(WorkflowVersionCopy.versionTitle, {
        number: translator.formatNumber(props.versionNumber),
      })}
      description={props.description}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText={WorkflowVersionPreviewCopy.close}
      submitButtonText={
        isRestoreLocked ? undefined : WorkflowVersionCopy.restoreButton
      }
      disableSubmitButton={!canRestore}
      onSubmit={
        isRestoreLocked
          ? undefined
          : () => {
              if (graph && canRestore) {
                props.onRestore(graph);
              }
            }
      }
    >
      {getBody()}
    </Modal>
  );
};

export default WorkflowVersionPreview;
