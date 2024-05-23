import Dropdown, {
    DropdownOption,
} from 'CommonUI/src/Components/Dropdown/Dropdown';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import Probe from 'Model/Models/Probe';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    onProbeSelected?: (probe: Probe) => void;
    probes: Array<Probe>;
    selectedProbe?: Probe;
}

const ProbePicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const dropdownOptions: Array<DropdownOption> = props.probes.map((probe) => {
        return {
            label: probe.name?.toString() || 'Unknown',
            value: probe._id?.toString() || '',
        };
    });

    return (
        <div className="flex">
            <div className="w-fit mr-2 flex h-full align-middle items-center">
                <FieldLabelElement title="Select Probe:" required={true} />
            </div>
            <div>
                <Dropdown
                    value={dropdownOptions.find(option => {
                        return (
                            option.value ===
                            props.selectedProbe?._id?.toString()
                        );
                    })}
                    options={dropdownOptions}
                    onChange={(value) => {
                        value = value?.toString() || '';

                        const probe = props.probes.find(p => {
                            return p._id?.toString() === value;
                        });

                        if (props.onProbeSelected && probe) {
                            props.onProbeSelected(probe);
                        }
                    }}
                />
            </div>
        </div>
    );
};

export default ProbePicker;
