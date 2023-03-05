import React, { ReactElement, useState } from 'react';
import Modal from '../Modal/Modal';
import Query from '../../Utils/ModelAPI/Query';
import BaseModel from 'Common/Models/BaseModel';
import Select from '../../Utils/ModelAPI/Select';
import ModelList from '../ModelList/StaticModelList';

export interface ComponentProps<TBaseModel extends BaseModel> {
    query?: Query<TBaseModel>;
    onClose: () => void;
    onSave: (modals: Array<TBaseModel>) => void;
    modelType: { new(): TBaseModel };
    titleField: string;
    isSearchEnabled?: boolean | undefined;
    descriptionField?: string | undefined;
    selectMultiple?: boolean | undefined;
    select: Select<TBaseModel>;
    modalTitle: string;
    modalDescription: string;
    noItemsMessage: string;
    headerField?: string | ((item: TBaseModel) => ReactElement) | undefined;
}

const ModelListModal: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
   
    const [selectedList, setSelectedList] = useState<Array<TBaseModel>>([]);

    return (
        <Modal
            title={props.modalTitle}
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
            <ModelList {...props} onSelectChange={(list: Array<TBaseModel>)=>{
                setSelectedList([...list]);
            }} />
        </Modal>
    );
};

export default ModelListModal;
