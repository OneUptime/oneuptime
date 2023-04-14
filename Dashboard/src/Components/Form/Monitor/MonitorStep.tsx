import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import Button from 'CommonUI/src/Components/Button/Button';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import Input from 'CommonUI/src/Components/Input/Input';
import MonitorCriteriaElement from './MonitorCriteria';
import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import URL from 'Common/Types/API/URL';

export interface ComponentProps {
    monitorStatusDropdownOptions: Array<DropdownOption>;
    initialValue?: undefined | MonitorStep;
    onChange?: undefined | ((value: MonitorStep) => void);
    onDelete?: undefined | (() => void);
}

const MonitorStepElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [monitorStep, setMonitorStep] = useState<MonitorStep | undefined>(
        props.initialValue
    );

    useEffect(() => {
        if (props.onChange && monitorStep) {
            props.onChange(monitorStep);
        }
    }, [monitorStep]);

    return (
        <div>
            <div>
                <FieldLabelElement title="URL" />
                <Input
                    initialValue={
                        monitorStep?.data?.monitorDestination.toString() || ''
                    }
                    onChange={(value: string) => {
                        setMonitorStep(
                            new MonitorStep().fromJSON({
                                monitorDestination: URL.fromString(
                                    value.toString()
                                ),
                                monitorCriteria: value,
                            })
                        );
                    }}
                />
            </div>
            <div>
                <FieldLabelElement title="Monitor Criteria" />
                <MonitorCriteriaElement
                    monitorStatusDropdownOptions={
                        props.monitorStatusDropdownOptions
                    }
                    initialValue={monitorStep?.data?.monitorCriteria}
                    onChange={(value: MonitorCriteria) => {
                        setMonitorStep(
                            new MonitorStep().fromJSON({
                                monitorDestination:
                                    monitorStep?.data?.monitorDestination || '',
                                monitorCriteria: value,
                            })
                        );
                    }}
                />
            </div>

            <div>
                <Button
                    onClick={() => {
                        if (props.onDelete) {
                            props.onDelete();
                        }
                    }}
                    title="Delete"
                />
            </div>
        </div>
    );
};

export default MonitorStepElement;
