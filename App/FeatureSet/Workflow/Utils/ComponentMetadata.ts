import Dictionary from "Common/Types/Dictionary";
import ComponentMetadata from "Common/Types/Workflow/Component";
import Components from "Common/Types/Workflow/Components";
import BaseModelComponentFactory from "Common/Types/Workflow/Components/BaseModel";
import Entities from "Model/Models/Index";

type LoadAllComponentMetadataFunction = () => Dictionary<ComponentMetadata>;

export const loadAllComponentMetadata: LoadAllComponentMetadataFunction =
  (): Dictionary<ComponentMetadata> => {
    const initComponents: Dictionary<ComponentMetadata> = {};

    for (const componentMetadata of Components) {
      initComponents[componentMetadata.id] = componentMetadata;
    }

    for (const model of Entities) {
      const baseModelComponentMetadata: Array<ComponentMetadata> =
        BaseModelComponentFactory.getComponents(new model());

      for (const componentMetadata of baseModelComponentMetadata) {
        initComponents[componentMetadata.id] = componentMetadata;
      }
    }

    return initComponents;
  };
