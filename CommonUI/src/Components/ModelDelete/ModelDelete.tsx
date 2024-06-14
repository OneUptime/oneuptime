import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ConfirmModal from "../Modal/ConfirmModal";
import BaseModel from "Common/Models/BaseModel";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import React, { ReactElement, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  onDeleteSuccess: () => void;
}

const ModelDelete: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const model: TBaseModel = new props.modelType();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  const deleteItem: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      await ModelAPI.deleteItem<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
      });
      props.onDeleteSuccess && props.onDeleteSuccess();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setShowErrorModal(true);
    }

    setIsLoading(false);
  };

  return (
    <>
      <Card
        title={`Delete ${model.singularName}`}
        description={`Are you sure you want to delete this ${model.singularName?.toLowerCase()}?`}
        buttons={[
          {
            title: `Delete ${model.singularName}`,
            buttonStyle: ButtonStyleType.DANGER,
            onClick: () => {
              setShowModal(true);
            },
            isLoading: isLoading,
            icon: IconProp.Trash,
          },
        ]}
      />

      {showModal ? (
        <ConfirmModal
          description={`Are you sure you want to delete this ${model.singularName?.toLowerCase()}?`}
          title={`Delete ${model.singularName}`}
          onSubmit={async () => {
            setShowModal(false);
            await deleteItem();
          }}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={`Delete ${model.singularName}`}
          submitButtonType={ButtonStyleType.DANGER}
        />
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
