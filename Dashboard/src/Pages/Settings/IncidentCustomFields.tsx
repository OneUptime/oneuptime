import PageComponentProps from '../PageComponentProps';
import CustomFieldsPageBase from './Base/CustomFieldsPageBase';
import IncidentCustomField from 'Model/Models/IncidentCustomField';
import React, { FunctionComponent, ReactElement } from 'react';

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
