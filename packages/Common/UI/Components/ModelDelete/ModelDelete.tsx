import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import {
  getDisplayNameColumn,
  getRecordDisplayName,
  shortenDisplayName,
} from "../../Utils/ModelDisplayName";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import DeleteConfirmationMessage from "../DeleteConfirmation/DeleteConfirmationMessage";
import TypeToConfirmDelete, {
  isTypedNameConfirmed,
} from "../DeleteConfirmation/TypeToConfirmDelete";
import ConfirmModal from "../Modal/ConfirmModal";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../../Types/BaseDatabase/Select";
import { PromiseVoidFunction } from "../../../Types/FunctionTypes";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import {
  translateNamedAction,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
  onDeleteSuccess: () => void;
  /*
   * Extra content for the confirmation modal - a field to fill in before
   * confirming, for example. State for it belongs to the caller.
   */
  confirmationContent?: ReactElement | undefined;
  /*
   * Replaces the delete request itself, for models whose delete needs more
   * than an id (see confirmationContent). Throwing surfaces the error in the
   * same dialog the default request uses.
   */
  onDelete?: (() => Promise<void>) | undefined;
  /*
   * What the record is called, when the page already has it loaded. Without
   * it the card reads the name itself, one column of one record.
   */
  itemName?: string | undefined;
  /*
   * The column to read the name from, where the model's own would not be the
   * one the page goes by - the Admin Dashboard knows a user by their email,
   * as its page header does. Defaults to the model's display name column
   * (UI/Utils/ModelDisplayName).
   */
  modelNameField?: string | undefined;
  /*
   * Keep Delete locked until the record's name has been typed into the
   * confirmation. Only for deletes that take everything with them - see
   * TypeToConfirmDelete. Without a name to type, the dialog asks as usual.
   */
  requireTypedName?: boolean | undefined;
}

/*
 * The name read for one record, stamped with the id it was read for so that a
 * slow answer about the record the page has since moved on from is never
 * shown for the next one.
 */
interface LoadedName {
  modelId: string;
  name: string;
}

const ModelDelete: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const model: TBaseModel = new props.modelType();
  /*
   * The delete card used to be rendered for everybody: a viewer got a live
   * "Delete <X>" button, a confirmation dialog, and then a refusal from the
   * API. It now stays visible but locked, and says which permission is
   * missing.
   */
  const deleteGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Delete,
  );
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
  const [typedName, setTypedName] = useState<string>("");
  const [loadedName, setLoadedName] = useState<LoadedName | null>(null);

  /*
   * Keyed on the id's string, not the ObjectID: pages build a new ObjectID
   * from the route params on every render.
   */
  const modelIdString: string = props.modelId.toString();

  const nameColumn: string | null =
    props.modelNameField || getDisplayNameColumn(model);

  /*
   * "Are you sure you want to delete this workflow?" was true of every
   * workflow in the project. The page already shows which one it is in its
   * header, but the card and the dialog are where the decision is made, so
   * they say it too. One column of one record - the cheapest read there is -
   * and if it fails, or the record has no name, the card falls back to the
   * sentence about its kind rather than holding the Delete button back.
   */
  useEffect(() => {
    if (props.itemName !== undefined || !nameColumn) {
      return;
    }

    let isCurrent: boolean = true;
    const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

    modelAPI
      .getItem<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: { [nameColumn]: true } as Select<TBaseModel>,
        requestOptions: {},
      })
      .then((item: TBaseModel | null) => {
        if (!isCurrent) {
          return;
        }

        setLoadedName({
          modelId: modelIdString,
          name: getRecordDisplayName(item, {
            column: nameColumn,
            model: model,
            maxLength: 0,
          }),
        });
      })
      .catch(() => {
        // No name to show; the card says "this <kind>" instead.
      });

    return () => {
      isCurrent = false;
    };
  }, [modelIdString, nameColumn, props.itemName]);

  // The whole name - what has to be typed, and what the hover shows.
  const fullName: string =
    props.itemName !== undefined
      ? getRecordDisplayName({ name: props.itemName }, { maxLength: 0 })
      : loadedName && loadedName.modelId === modelIdString
        ? loadedName.name
        : "";

  const shownName: string = fullName ? shortenDisplayName(fullName) : "";

  const typeLabel: string = model.singularName || "item";

  const isTypedNameRequired: boolean = Boolean(
    props.requireTypedName && fullName,
  );

  const isConfirmed: boolean =
    !isTypedNameRequired ||
    isTypedNameConfirmed({ typed: typedName, name: fullName });

  const deleteItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      if (props.onDelete) {
        await props.onDelete();
      } else {
        const modelAPI: typeof ModelAPI = props.modelAPI || ModelAPI;

        await modelAPI.deleteItem<TBaseModel>({
          modelType: props.modelType,
          id: props.modelId,
        });
      }
      props.onDeleteSuccess?.();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setShowErrorModal(true);
    }

    setIsLoading(false);
  };

  type ConfirmFunction = () => Promise<void>;

  const confirm: ConfirmFunction = async (): Promise<void> => {
    if (!isConfirmed) {
      return;
    }

    setShowModal(false);
    setTypedName("");
    await deleteItem();
  };

  return (
    <>
      <Card
        title={translateNamedAction(translator, {
          template: "Delete {{itemName}}",
          itemName: model.singularName || "",
        })}
        description={
          <DeleteConfirmationMessage
            dataTestId="model-delete-card-message"
            kind="statement"
            name={shownName}
            fullName={fullName}
            typeLabel={typeLabel}
          />
        }
        buttons={[
          {
            title: translateNamedAction(translator, {
              template: "Delete {{itemName}}",
              itemName: model.singularName || "",
            }),
            buttonStyle: ButtonStyleType.DANGER,
            disabled: !deleteGate.isAllowed,
            tooltip: deleteGate.disabledReason,
            onClick: () => {
              if (!deleteGate.isAllowed) {
                return;
              }

              setTypedName("");
              setShowModal(true);
            },
            isLoading: isLoading,
            icon: IconProp.Trash,
          },
        ]}
      />

      {showModal ? (
        <ConfirmModal
          description={
            <DeleteConfirmationMessage
              kind="question"
              name={shownName}
              fullName={fullName}
              typeLabel={typeLabel}
            />
          }
          title={translateNamedAction(translator, {
            template: "Delete {{itemName}}",
            itemName: model.singularName || "",
          })}
          onSubmit={async () => {
            await confirm();
          }}
          onClose={() => {
            setShowModal(false);
            setTypedName("");
          }}
          submitButtonText={translateNamedAction(translator, {
            template: "Delete {{itemName}}",
            itemName: model.singularName || "",
          })}
          submitButtonType={ButtonStyleType.DANGER}
          disableSubmitButton={!isConfirmed}
        >
          {props.confirmationContent || isTypedNameRequired ? (
            <div className="space-y-4">
              {props.confirmationContent || <></>}
              {isTypedNameRequired ? (
                <TypeToConfirmDelete
                  name={fullName}
                  value={typedName}
                  onChange={(value: string) => {
                    setTypedName(value);
                  }}
                  onConfirm={() => {
                    void confirm();
                  }}
                />
              ) : (
                <></>
              )}
            </div>
          ) : undefined}
        </ConfirmModal>
      ) : (
        <></>
      )}

      {showErrorModal ? (
        <ConfirmModal
          description={error}
          title={`Delete Error`}
          onSubmit={() => {
            setShowErrorModal(false);
            setError("");
          }}
          submitButtonText={`Close`}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default ModelDelete;
