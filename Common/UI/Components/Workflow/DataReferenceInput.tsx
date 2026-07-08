import VariableModal from "./VariableModal";
import {
  ParsedToken,
  appendToken,
  buildComponentToken,
  describeToken,
  parseTokens,
  removeTokenOccurrence,
  TokenDescription,
} from "./TokenUtils";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp, ReturnValue } from "../../../Types/Workflow/Component";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * The data-reference helper shown beneath a text argument. It renders the
 * {{ … }} tokens already in the value as friendly, removable chips (red when
 * the referenced step/output no longer exists), and lets you insert a new
 * reference from an inline menu scoped to UPSTREAM steps — the ones whose
 * output actually exists when this step runs.
 *
 * The value stays a plain string (tokens are appended / spliced), so the
 * workflow round-trips byte-for-byte. All parsing lives in TokenUtils.
 */

export interface ComponentProps {
  value: string;
  onChange: (value: string) => void;
  components: Array<NodeDataProp>;
  upstreamComponentIds?: Set<string> | undefined;
  currentComponentId?: string | undefined;
  workflowId: ObjectID;
}

const DataReferenceInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showInsertMenu, setShowInsertMenu] = useState<boolean>(false);
  const [showAllSteps, setShowAllSteps] = useState<boolean>(false);
  const [showVariableModal, setShowVariableModal] = useState<boolean>(false);

  const canFilterUpstream: boolean = Boolean(props.upstreamComponentIds);

  const parsedTokens: Array<ParsedToken> = parseTokens(props.value || "");

  /*
   * Steps that can be referenced: those with outputs, minus this step, scoped
   * to upstream unless "Show all steps" is toggled on.
   */
  const availableComponents: Array<NodeDataProp> = props.components.filter(
    (component: NodeDataProp) => {
      if (!component.id || component.id === props.currentComponentId) {
        return false;
      }
      if (
        !component.metadata.returnValues ||
        component.metadata.returnValues.length === 0
      ) {
        return false;
      }
      if (!canFilterUpstream || showAllSteps) {
        return true;
      }
      return props.upstreamComponentIds!.has(component.id);
    },
  );

  type InsertReferenceFunction = (token: string) => void;

  const insertReference: InsertReferenceFunction = (token: string): void => {
    props.onChange(appendToken(props.value || "", token));
  };

  return (
    <div className="mt-1">
      {parsedTokens.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {parsedTokens.map((parsed: ParsedToken) => {
            const described: TokenDescription = describeToken(
              parsed.token,
              props.components,
            );
            const chipClass: string = described.isBroken
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-indigo-200 bg-indigo-50 text-indigo-700";

            return (
              <span
                key={parsed.occurrence}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${chipClass}`}
                title={
                  described.isBroken
                    ? "This reference points to a step or output that no longer exists."
                    : described.label
                }
              >
                {described.isBroken && <span aria-hidden="true">⚠</span>}
                <span className="max-w-[16rem] truncate">
                  {described.label}
                </span>
                <button
                  type="button"
                  aria-label={`Remove reference ${described.label}`}
                  className="ml-0.5 text-current opacity-60 hover:opacity-100 cursor-pointer"
                  onClick={() => {
                    props.onChange(
                      removeTokenOccurrence(
                        props.value || "",
                        parsed.occurrence,
                      ),
                    );
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="relative flex items-center gap-3">
        <button
          type="button"
          data-testid="insert-data-toggle"
          className="text-sm font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
          onClick={() => {
            setShowInsertMenu((open: boolean) => {
              return !open;
            });
          }}
        >
          + Insert data from a step
        </button>
        <button
          type="button"
          className="text-sm font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
          onClick={() => {
            setShowVariableModal(true);
          }}
        >
          Use a variable
        </button>

        {showInsertMenu && (
          <div className="absolute left-0 top-7 z-10 max-h-72 w-80 overflow-y-auto rounded-md border border-gray-200 bg-white p-2 shadow-lg">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {showAllSteps
                  ? "All steps in this workflow"
                  : "Steps that run before this one"}
              </span>
              {canFilterUpstream && (
                <button
                  type="button"
                  className="text-xs font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
                  onClick={() => {
                    setShowAllSteps((all: boolean) => {
                      return !all;
                    });
                  }}
                >
                  {showAllSteps ? "Upstream only" : "Show all steps"}
                </button>
              )}
            </div>

            {availableComponents.length === 0 ? (
              <p className="p-2 text-sm text-gray-500">
                {canFilterUpstream && !showAllSteps
                  ? "No earlier steps are connected yet."
                  : "No other steps produce data yet."}
              </p>
            ) : (
              availableComponents.map((component: NodeDataProp) => {
                return (
                  <div key={component.id} className="mb-2">
                    <p className="text-xs font-semibold text-gray-600">
                      {component.metadata.title}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(component.metadata.returnValues || []).map(
                        (returnValue: ReturnValue) => {
                          return (
                            <button
                              key={returnValue.id}
                              type="button"
                              className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
                              onClick={() => {
                                insertReference(
                                  buildComponentToken(
                                    component.id,
                                    returnValue.id,
                                  ),
                                );
                                setShowInsertMenu(false);
                              }}
                            >
                              {returnValue.name}
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {showVariableModal && (
        <VariableModal
          workflowId={props.workflowId}
          onClose={() => {
            setShowVariableModal(false);
          }}
          onSave={(variableToken: string) => {
            insertReference(variableToken);
            setShowVariableModal(false);
          }}
        />
      )}
    </div>
  );
};

export default DataReferenceInput;
