import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import IncidentCustomField from 'Model/Models/IncidentCustomField';

const IncidentCustomFields: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <CustomFieldsPageBase
            {...props}
            title="Incident Custom Fields"
            modelType={IncidentCustomField}
        />
    );
};

export default IncidentCustomFields;
