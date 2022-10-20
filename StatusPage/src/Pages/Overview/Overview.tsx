import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import Accordian from 'CommonUI/src/Components/Accordian/Accordian';
import AccordianGroup from 'CommonUI/src/Components/Accordian/AccordianGroup';


const Overview: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page title={'Overview'}>
            <p>Overview</p>

            <div>
                <AccordianGroup>
                    <Accordian title="EU Region">
                        <div>
                            EU
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
