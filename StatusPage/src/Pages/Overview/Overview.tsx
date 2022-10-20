import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import Accordian from 'CommonUI/src/Components/Accordian/Accordian';
import AccordianGroup from 'CommonUI/src/Components/Accordian/AccordianGroup';
import Alert, { AlertSize, AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import ActiveEvent from 'CommonUI/src/Components/ActiveEvent/ActiveEvent';
// import OneUptimeDate from 'Common/Types/Date';

const Overview: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {


    // const [data, setData] = useState<Array<MonitorStatusTimeline>>([]);
    // const [error, setError] = useState<string>('');
    // const [isLoading, setIsLoading] = useState<boolean>(false);
    // const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
    // const endDate: Date = OneUptimeDate.getCurrentDate();


    return (
        <Page>

            {/* Load Active Anouncement */}
            <ActiveEvent/>

            {/* Load Active Incident */}

            {/* Load Active ScheduledEvent */}

            <div>
                <Alert
                    title='All Systems Operatonal'
                    type={AlertType.SUCCESS}
                    doNotShowIcon={true}
                    size={AlertSize.Large}
                />
            </div>

            <div>
                <AccordianGroup>
                    <Accordian title="EU Region">
                        <div>
                            
                        </div>
                    </Accordian>
                    <Accordian title="US Region" isLastElement={true}>
                        <div>
                            US
                        </div>
                    </Accordian>
                </AccordianGroup>
            </div>
        </Page>
    );
};

export default Overview;
