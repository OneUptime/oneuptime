import TriggerCode from "../TriggerCode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ComponentMetadata from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import ManualComponents from "../../../../Types/Workflow/Components/Manual";

export default class ManualTrigger extends TriggerCode {
  public constructor() {
    super();
    const Component: ComponentMetadata | undefined = ManualComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.Manual;
      },
    );

    if (!Component) {
      throw new BadDataException("Component not found.");
    }
    this.setMetadata(Component);
  }
}
