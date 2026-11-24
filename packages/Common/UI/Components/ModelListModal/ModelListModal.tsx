import Query from "../../../Types/BaseDatabase/Query";
import Modal from "../Modal/Modal";
import ModelList from "../ModelList/ModelList";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import React, { ReactElement, useState } from "react";
import Select from "../../../Types/BaseDatabase/Select";

export interface ComponentProps<TBaseModel extends BaseModel> {
  query?: Query<TBaseModel>;
  onClose: () => void;
  onSave: (modals: Array<TBaseModel>) => void;
  modelType: { new (): TBaseModel };
  titleField: string;
  isSearchEnabled?: boolean | undefined;
  // Searched on the server as the person types (ModelList's searchesServer).
  searchesServer?: boolean | undefined;
  descriptionField?: string | undefined;
  selectMultiple?: boolean | undefined;
  select: Select<TBaseModel>;
  modalTitle: string;
  // The modalTitle is in the reader's words already, drawn as given (Modal's isTitleTranslated).
  isModalTitleTranslated?: boolean | undefined;
  modalDescription: string;
  noItemsMessage: string;
  headerField?: string | ((item: TBaseModel) => ReactElement) | undefined;
}

const ModelListModal: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const [selectedList, setSelectedList] = useState<Array<TBaseModel>>([]);

  return (
    <Modal
      title={props.modalTitle}
      isTitleTranslated={props.isModalTitleTranslated}
      description={props.modalDescription}
      onClose={props.onClose}
      disableSubmitButton={selectedList.length === 0}
      onSubmit={() => {
        if (selectedList && selectedList.length === 0) {
          props.onClose();
        }

        props.onSave(selectedList);
      }}
    >
      <ModelList<TBaseModel>
        {...props}
        id="model-list-modal"
        onSelectChange={(list: Array<TBaseModel>) => {
          setSelectedList([...list]);
        }}
      />
    </Modal>
  );
};

export default ModelListModal;
