import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Input from "../Input/Input";
import Modal, { ModalWidth } from "../Modal/Modal";
import Pill from "../Pill/Pill";
import { Black } from "../../../Types/BrandColors";
import {
  ComponentInputType,
  NodeDataProp,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import { componentReturnValueReference } from "../../../Types/Workflow/TemplateSyntax";
import {
  ModelSchemaColumn,
  ModelSchemaState,
  useModelSchema,
} from "./ModelSchema";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  onClose: () => void;
  onSave: (componentValueId: string) => void;
  components: Array<NodeDataProp>;
}

/*
 * A return value that holds one record can be drilled into: the useful
 * reference is almost never the record itself but a column on it, and deeper
 * paths already resolve at run time. An array of records cannot - there is no
 * single row to take a column from.
 */
type CanDrillIntoFunction = (
  component: NodeDataProp | null,
  returnValue: ReturnValue | null,
) => boolean;

export const canDrillIntoReturnValue: CanDrillIntoFunction = (
  component: NodeDataProp | null,
  returnValue: ReturnValue | null,
): boolean => {
  if (!component || !returnValue) {
    return false;
  }

  if (!component.metadata?.tableName) {
    return false;
  }

  return returnValue.type === ComponentInputType.BaseModel;
};

const ComponentValuePickerModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedReturnValue, setSelectedReturnValue] =
    useState<ReturnValue | null>(null);
  const [selectedComponent, setSelectedComponent] =
    useState<NodeDataProp | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [searchedComponents, setSearchedComponents] = useState<
    Array<NodeDataProp>
  >([]);

  const [searchText, setSearchText] = useState<string>("");

  const canDrillIn: boolean = canDrillIntoReturnValue(
    selectedComponent,
    selectedReturnValue,
  );

  /*
   * Passing undefined keeps the hook idle, so this costs nothing until a
   * record-shaped return value is actually selected.
   */
  const drillInSchema: ModelSchemaState = useModelSchema(
    canDrillIn ? (selectedComponent?.metadata.tableName as string) : undefined,
  );

  useEffect(() => {
    setSearchedComponents(searchReturnValues(props.components, searchText));
  }, [props.components, searchText]);

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

    // Case-sensitive matching meant "monitor" never found "Find One Monitor".
    const needle: string = searchText.trim().toLowerCase();

    const searched: Array<NodeDataProp> = [];

    for (const component of components) {
      if (
        (component.metadata.title || "").toLowerCase().includes(needle) ||
        (component.metadata.description || "").toLowerCase().includes(needle)
      ) {
        searched.push(component);
        continue;
      }

      /*
       * Not every node carries return values. The placeholder trigger node has
       * a partial metadata object with none, and this loop ran inside an effect,
       * so reading through it threw past the nearest error boundary and took the
       * whole builder page down - along with any unsaved graph edits.
       */
      for (const returnVal of component.metadata.returnValues || []) {
        if (
          (returnVal.name || "").toLowerCase().includes(needle) ||
          (returnVal.description || "").toLowerCase().includes(needle)
        ) {
          searched.push(component);
          break;
        }
      }
    }

    return searched;
  };

  return (
    <Modal
      modalWidth={ModalWidth.Large}
      title={"Select return value from another component"}
      description={
        "Select a return value from the component this component is connected to."
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
          componentReturnValueReference(
            selectedComponent.id,
            selectedReturnValue.id,
            canDrillIn && selectedColumnId ? [selectedColumnId] : undefined,
          ),
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

        <div className="max-h-96 mt-5 mb-5 overflow-y-auto">
          {props.components.length === 0 ? (
            <ErrorMessage message={"No components in this workflow."} />
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
                                // A new selection is a new record — drop any column picked off the last one.
                                setSelectedColumnId(null);
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

        {/*
         * Second step, only for a return value that holds one record. Without
         * it the picker could only ever emit a reference to the whole record —
         * and for a Find One or an On Create step the whole record is the single
         * return value, so the one path it produced was never the useful one.
         */}
        {canDrillIn && (
          <div className="border-t border-gray-200 pt-4">
            <h2 className="text-base font-medium text-gray-500">
              Which field of {selectedReturnValue?.name}?
            </h2>
            <p className="text-sm font-medium text-gray-400 mb-3">
              Pick a column to reference just that value, or leave this to
              reference the whole record.
            </p>

            {drillInSchema.isLoading && <p className="text-sm">Loading…</p>}

            {drillInSchema.error && (
              <p className="text-sm text-amber-600">
                Couldn&apos;t load this model&apos;s columns (
                {drillInSchema.error}). The whole record will be referenced.
              </p>
            )}

            <div className="max-h-48 overflow-y-auto flex flex-wrap gap-2">
              {(drillInSchema.columns || []).map(
                (column: ModelSchemaColumn) => {
                  const isSelected: boolean = selectedColumnId === column.id;

                  return (
                    <button
                      type="button"
                      key={column.id}
                      title={column.description || column.title}
                      onClick={() => {
                        setSelectedColumnId(isSelected ? null : column.id);
                      }}
                      className={`rounded-md border px-2 py-1 text-xs cursor-pointer ${
                        isSelected
                          ? "border-indigo-500 ring-1 ring-indigo-500 text-indigo-700"
                          : "border-gray-300 text-gray-600 hover:border-gray-400"
                      }`}
                    >
                      {column.id}
                    </button>
                  );
                },
              )}
            </div>

            {selectedComponent && selectedReturnValue && (
              <code className="mt-3 block text-xs text-gray-500 break-all">
                {componentReturnValueReference(
                  selectedComponent.id,
                  selectedReturnValue.id,
                  selectedColumnId ? [selectedColumnId] : undefined,
                )}
              </code>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ComponentValuePickerModal;
