import ComponentMetadata from 'Common/Types/Workflow/Component';
import Entities from 'Model/Models/Index';
import BaseModelComponentFactory from 'Common/Types/Workflow/Components/BaseModel';
import Components from 'Common/Types/Workflow/Components';
import Dictionary from 'Common/Types/Dictionary';

export const loadAllComponentMetadata: Function =
    (): Dictionary<ComponentMetadata> => {
        const initComponents: Dictionary<ComponentMetadata> = {};

        for (const componentMetadata of Components) {
            initComponents[componentMetadata.id] = componentMetadata;
        }

        for (const model of Entities) {
            const baseModelComponentMetadata =
                BaseModelComponentFactory.getComponents(new model());

            for (const componentMetadata of baseModelComponentMetadata) {
                initComponents[componentMetadata.id] = componentMetadata;
            }
        }

        return initComponents;
    };
