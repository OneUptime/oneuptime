
import Dropdown, { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
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

    const dropdownOptions: Array<DropdownOption> = props.probes.map(probe => ({ label: probe.name?.toString() || 'Unknown', value: probe._id?.toString() || '' }));

    return (
        <div>
            <FieldLabelElement title='Probes' />
            <Dropdown
                value={dropdownOptions.find(option => option.value === props.selectedProbe?._id?.toString())}
                options={dropdownOptions}
                onChange={(value) => {
                    value = value?.toString() || '';

                    const probe = props.probes.find(p => p._id?.toString() === value);

                    if (props.onProbeSelected && probe) {
                        props.onProbeSelected(probe);
                    }
                }}
            />

        </div>
    );
};

export default ProbePicker;
