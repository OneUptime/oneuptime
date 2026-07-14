import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Input from "../Input/Input";
import Modal, { ModalWidth } from "../Modal/Modal";
import Pill from "../Pill/Pill";
import { Black } from "../../../Types/BrandColors";
import { NodeDataProp, ReturnValue } from "../../../Types/Workflow/Component";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  onClose: () => void;
  onSave: (componentValueId: string) => void;
  components: Array<NodeDataProp>;
  /*
   * Data ids of steps upstream of the one being edited. When provided, only
   * these are offered by default — you can't reference data that won't exist
   * at runtime. Undefined means "no graph context, show everything".
   */
  upstreamComponentIds?: Set<string> | undefined;
  // The step being edited — never offer it as a source of its own value.
  currentComponentId?: string | undefined;
}

const ComponentValuePickerModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedReturnValue, setSelectedReturnValue] =
    useState<ReturnValue | null>(null);
  const [selectedComponent, setSelectedComponent] =
    useState<NodeDataProp | null>(null);

  const [searchText, setSearchText] = useState<string>("");

  // When true, ignore the upstream filter and list every step in the graph.
  const [showAllSteps, setShowAllSteps] = useState<boolean>(false);

  type SearchReturnValuesFunction = (
    components: Array<NodeDataProp>,
    searchText: string,
  ) => Array<NodeDataProp>;

  const searchReturnValues: SearchReturnValuesFunction = (
    components: Array<NodeDataProp>,
    searchText: string,
  ): Array<NodeDataProp> => {
    if (!searchText) {
      return components;
    }

    const query: string = searchText.toLowerCase();
    const searched: Array<NodeDataProp> = [];

    for (const component of components) {
      if (
        component.metadata.title.toLowerCase().includes(query) ||
        component.metadata.description.toLowerCase().includes(query)
      ) {
        searched.push(component);
        continue;
      }

      for (const returnVal of component.metadata.returnValues || []) {
        if (
          returnVal.name.toLowerCase().includes(query) ||
          returnVal.description.toLowerCase().includes(query)
        ) {
          searched.push(component);
          break;
        }
      }
    }

    return searched;
  };

  /*
   * Restrict the choices to steps whose output actually exists when this step
   * runs: the upstream set, minus the step itself. "Show all steps" lifts the
   * restriction for loops / fan-out where a strict backward walk isn't enough.
   */
  const canFilterUpstream: boolean = Boolean(props.upstreamComponentIds);

  const availableComponents: Array<NodeDataProp> = props.components.filter(
    (component: NodeDataProp) => {
      // Skip the placeholder trigger node (empty id, no return values).
      if (!component.id) {
        return false;
      }
      if (component.id === props.currentComponentId) {
        return false;
      }
      if (!canFilterUpstream || showAllSteps) {
        return true;
      }
      return props.upstreamComponentIds!.has(component.id);
    },
  );

  // Derived during render — no effect/state, so no blank first frame or churn.
  const searchedComponents: Array<NodeDataProp> = searchReturnValues(
    availableComponents,
    searchText,
  );

  return (
    <Modal
      modalWidth={ModalWidth.Large}
      title={"Use a value from an earlier step"}
      description={
        "Pick an output from a step that runs before this one. Its value is filled in when the workflow runs."
      }
      onClose={props.onClose}
      disableSubmitButton={!selectedReturnValue}
      onSubmit={() => {
        if (!selectedReturnValue) {
          return props.onClose();
        }

        if (!selectedComponent) {
          return props.onClose();
        }

        props.onSave(
          `{{local.components.${selectedComponent.id}.returnValues.${selectedReturnValue.id}}}`,
        );
      }}
    >
      <div>
        {props.components && props.components.length > 0 && (
          <div className="p-2">
            <Input
              placeholder="Search..."
              onChange={(value: string) => {
                setSearchText(value);
              }}
            />
          </div>
        )}

        {canFilterUpstream && (
          <div className="px-2 pb-1 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {showAllSteps
                ? "Showing every step in this workflow."
                : "Showing steps that run before this one."}
            </p>
            <button
              type="button"
              onClick={() => {
                setShowAllSteps((value: boolean) => {
                  return !value;
                });
              }}
              className="text-xs font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
            >
              {showAllSteps ? "Show upstream only" : "Show all steps"}
            </button>
          </div>
        )}

        <div className="max-h-96 mt-5 mb-5 overflow-y-auto">
          {props.components.length === 0 ? (
            <ErrorMessage message={"No components in this workflow."} />
          ) : (
            <></>
          )}

          {props.components.length > 0 &&
          !searchText &&
          availableComponents.length === 0 ? (
            <div className="p-3 text-sm text-gray-500">
              {canFilterUpstream && !showAllSteps ? (
                <span>
                  No earlier steps are connected to this one yet. Connect it to
                  a previous step, or{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setShowAllSteps(true);
                    }}
                    className="font-medium text-blue-500 hover:text-blue-600 cursor-pointer"
                  >
                    show all steps
                  </button>
                  .
                </span>
              ) : (
                "There are no other steps in this workflow yet."
              )}
            </div>
          ) : (
            <></>
          )}

          {props.components.length > 0 &&
          searchText &&
          searchedComponents.length === 0 ? (
            <ErrorMessage message={"No components match your search"} />
          ) : (
            <></>
          )}

          {searchedComponents &&
            searchedComponents.length > 0 &&
            searchedComponents.map(
              (component: NodeDataProp, i: number): ReactElement => {
                return (
                  <div className="p-3 pl-1" key={`component-${i}`}>
                    <h2 className="text-base font-medium text-gray-500">
                      {component.metadata.title} ({component.id})
                    </h2>
                    <p className="text-sm font-medium text-gray-400">
                      {component.metadata.description}
                    </p>

                    {component.metadata.returnValues &&
                      component.metadata.returnValues.length === 0 && (
                        <ErrorMessage message="This component does not have any return values." />
                      )}
                    {component.metadata.returnValues &&
                      component.metadata.returnValues.map(
                        (returnValue: ReturnValue, i: number) => {
                          const isSelected: boolean = Boolean(
                            selectedComponent &&
                              component.id === selectedComponent.id &&
                              selectedReturnValue &&
                              selectedReturnValue.id === returnValue.id,
                          );

                          return (
                            <div
                              key={i}
                              onClick={() => {
                                setSelectedComponent(component);
                                setSelectedReturnValue(returnValue);
                              }}
                              className={`cursor-pointer mt-2 mb-2 relative flex items-center space-x-3 rounded-lg border border-gray-300 bg-white px-6 py-5 shadow-sm focus-within:ring-2 focus-within:ring-pink-500 focus-within:ring-offset-2 hover:border-gray-400 ${
                                isSelected ? "ring ring-indigo-500" : ""
                              }`}
                            >
                              <div className="min-w-0 flex-1 flex justify-between">
                                <div className="focus:outline-none">
                                  <span
                                    className="absolute inset-0"
                                    aria-hidden="true"
                                  ></span>
                                  <p className="text-sm font-medium text-gray-900">
                                    {returnValue.name}{" "}
                                    <span className="text-gray-500 font-normal">
                                      (ID: {returnValue.id})
                                    </span>
                                  </p>
                                  <p className="truncate text-sm text-gray-500">
                                    {returnValue.description}
                                  </p>
                                </div>
                                <div>
                                  <Pill color={Black} text={returnValue.type} />
                                </div>
                              </div>
                            </div>
                          );
                        },
                      )}
                  </div>
                );
              },
            )}
        </div>
      </div>
    </Modal>
  );
};

export default ComponentValuePickerModal;
