import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import Navigation from "../../Utils/Navigation";
import { ButtonStyleType } from "../Button/Button";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import Card from "../Card/Card";
import BasicFormModal from "../FormModal/BasicFormModal";
import { ModelField } from "../Forms/ModelForm";
import ConfirmModal from "../Modal/ConfirmModal";
import {
  translatableTerm,
  translateNamedAction,
  Translator,
} from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import React, { ReactElement, useState } from "react";
import Select from "../../../Types/BaseDatabase/Select";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  onDuplicateSuccess?: (item: TBaseModel) => Promise<void> | void;
  fieldsToDuplicate: Select<TBaseModel>;
  fieldsToChange: Array<ModelField<TBaseModel>>;
  navigateToOnSuccess?: Route | undefined;
}

const DuplicateModel: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const model: TBaseModel = new props.modelType();
  const duplicateTitle: string = translateNamedAction(translator, {
    template: "Duplicate {{itemName}}",
    itemName: model.singularName || "",
  });

  /* Duplicating writes a brand new record, so it needs create permission. */
  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
  );
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  type DuplicateItemFunction = (partialModel: TBaseModel) => void;

  const duplicateItem: DuplicateItemFunction = async (
    partialModel: TBaseModel,
  ) => {
    setIsLoading(true);
    try {
      const item: TBaseModel | null = await ModelAPI.getItem<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        select: props.fieldsToDuplicate,
      });

      if (!item) {
        throw new Error(
          `Could not find ${model.singularName} with id ${props.modelId}`,
        );
      }

      for (const field of props.fieldsToChange) {
        const key: string | undefined = Object.keys(field.field || {})[0];

        if (!key) {
          continue;
        }

        const value: string = partialModel.getValue(key);
        item.setValue(key, value);
      }

      item.removeValue("_id");

      // now we have the item, we need to remove the id and then save it

      const newItem: HTTPResponse<TBaseModel> =
        (await ModelAPI.create<TBaseModel>({
          model: item,
          modelType: props.modelType,
        })) as HTTPResponse<TBaseModel>;

      if (!newItem) {
        throw new Error(`Could not create ${model.singularName}`);
      }

      if (props.onDuplicateSuccess) {
        await props.onDuplicateSuccess(newItem.data);
      }

      if (props.navigateToOnSuccess) {
        Navigation.navigate(
          new Route(props.navigateToOnSuccess.toString()).addRoute(
            `/${newItem.data.id!.toString()}`,
          ),
          {
            forceNavigate: true,
          },
        );
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setShowErrorModal(true);
    }

    setIsLoading(false);
  };

  return (
    <>
      <Card
        title={duplicateTitle}
        description={translator.translateTemplate(
          "Duplicating this {{itemName}} will create another {{itemName}} exactly like this one.",
          {
            itemName: translatableTerm(model.singularName || "", {
              inSentence: true,
            }),
          },
        )}
        buttons={[
          {
            title: duplicateTitle,
            buttonStyle: ButtonStyleType.NORMAL,
            disabled: !createGate.isAllowed,
            tooltip: createGate.disabledReason,
            onClick: () => {
              if (!createGate.isAllowed) {
                return;
              }

              setShowModal(true);
            },
            isLoading: isLoading,
            icon: IconProp.Copy,
          },
        ]}
      />

      {showModal ? (
        <BasicFormModal<TBaseModel>
          description={translator.translateTemplate(
            "Are you sure you want to duplicate this {{itemName}}?",
            {
              itemName: translatableTerm(model.singularName || "", {
                inSentence: true,
              }),
            },
          )}
          title={duplicateTitle}
          onSubmit={(item: TBaseModel) => {
            setShowModal(false);
            duplicateItem(
              BaseModel.fromJSONObject(item, props.modelType) as TBaseModel,
            );
          }}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={duplicateTitle}
          formProps={{
            fields: props.fieldsToChange,
          }}
        />
      ) : (
        <></>
      )}

      {showErrorModal ? (
        <ConfirmModal
          description={error}
          title={`Duplicate Error`}
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

export default DuplicateModel;
