import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ConfirmModal from "../Modal/ConfirmModal";
import BaseModel from "Common/Models/BaseModel";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import React, { ReactElement, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  fieldName: keyof TBaseModel;
  title: string;
  description: string | ReactElement;
  modelId: ObjectID;
  onUpdateComplete?: undefined | ((updatedValue: ObjectID) => void);
}

const ResetObjectID: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const model: TBaseModel = new props.modelType();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
  const [showResultModal, setShowResultModal] = useState<boolean>(false);

  const [newId, setNewId] = useState<ObjectID | null>(null);

  const resetKey: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const resetIdTo: ObjectID = ObjectID.generate();
      setNewId(resetIdTo);
      await ModelAPI.updateById<TBaseModel>({
        modelType: props.modelType,
        id: props.modelId,
        data: {
          [props.fieldName]: resetIdTo.toString(),
        },
      });
      setNewId(resetIdTo);
      setShowModal(false);
      setShowResultModal(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setShowErrorModal(true);
    }

    setIsLoading(false);
  };

  const tableColumn: TableColumnMetadata | undefined = props.fieldName
    ? model.getTableColumnMetadata(props.fieldName as string)
    : undefined;
  const tableColumnName: string =
    tableColumn?.title || (props.fieldName as string);

  return (
    <>
      <Card
        title={`${props.title}`}
        description={props.description}
        buttons={[
          {
            title: `${props.title}`,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setShowModal(true);
            },
            isLoading: isLoading,
            icon: IconProp.Reload,
          },
        ]}
      />

      {showModal ? (
        <ConfirmModal
          description={`Are you sure you want to reset ${tableColumnName}?`}
          title={`Reset ${tableColumnName}`}
          onSubmit={async () => {
            await resetKey();
          }}
          isLoading={isLoading}
          onClose={() => {
            setShowModal(false);
          }}
          submitButtonText={`Reset`}
          submitButtonType={ButtonStyleType.DANGER}
        />
      ) : (
        <></>
      )}

      {showErrorModal ? (
        <ConfirmModal
          description={error}
          title={`Reset Error`}
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

      {showResultModal ? (
        <ConfirmModal
          description={`Your new ${tableColumnName} is ${
            newId?.toString() || ""
          }`}
          title={`New ${tableColumnName}`}
          onSubmit={() => {
            if (props.onUpdateComplete && newId) {
              props.onUpdateComplete(newId);
            }
            setShowResultModal(false);
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

export default ResetObjectID;
