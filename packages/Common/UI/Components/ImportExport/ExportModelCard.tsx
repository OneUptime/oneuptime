import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import ModelAPI from "../../Utils/ModelAPI/ModelAPI";
import ModelImportExportUtil from "../../Utils/ModelImportExport";
import { ButtonStyleType } from "../Button/Button";
import Card from "../Card/Card";
import ConfirmModal from "../Modal/ConfirmModal";
import React, { ReactElement, useState } from "react";

export interface ComponentProps<TBaseModel extends BaseModel> {
  modelType: { new (): TBaseModel };
  modelId: ObjectID;
  modelAPI?: typeof ModelAPI | undefined;
}

const ExportModelCard: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const model: TBaseModel = new props.modelType();
  const singularName: string = model.singularName || "Resource";

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  type ExportItemFunction = () => Promise<void>;

  const exportItem: ExportItemFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const item: TBaseModel =
        await ModelImportExportUtil.fetchItemForExport<TBaseModel>({
          modelType: props.modelType,
          modelId: props.modelId,
          modelAPI: props.modelAPI,
        });

      ModelImportExportUtil.downloadExportFile({
        modelType: props.modelType,
        items: [item],
      });
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  return (
    <>
      <Card
        title={`Export ${singularName} as JSON`}
        description={`Download this ${singularName.toLowerCase()} as a JSON file. You can import it later to re-create this ${singularName.toLowerCase()}. Only this ${singularName.toLowerCase()}'s own settings are included - related resources (like owners, labels, or other linked resources) are not exported, and references to resources from this project may need to be re-selected after importing into another project.`}
        buttons={[
          {
            title: `Export ${singularName}`,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              exportItem().catch((err: Error) => {
                setError(API.getFriendlyMessage(err));
              });
            },
            isLoading: isLoading,
            icon: IconProp.Download,
          },
        ]}
      />

      {error ? (
        <ConfirmModal
          description={error}
          title={`Export Error`}
          onSubmit={() => {
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

export default ExportModelCard;
