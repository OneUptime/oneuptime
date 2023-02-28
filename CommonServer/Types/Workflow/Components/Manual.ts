import BadDataException from 'Common/Types/Exception/BadDataException';
import ComponentMetadata from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import ManualComponents from 'Common/Types/Workflow/Components/Manual';
import TriggerCode from '../TriggerCode';

export default class ManualTrigger extends TriggerCode {
    public constructor() {
        super();
        const Component: ComponentMetadata | undefined =
            ManualComponents.find((i: ComponentMetadata) => {
                return i.id === ComponentID.Manual;
            });

        if (!Component) {
            throw new BadDataException('Component not found.');
        }
        this.setMetadata(Component);
    }
}
