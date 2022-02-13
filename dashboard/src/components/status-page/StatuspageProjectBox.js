import React, { useEffect } from 'react';
import StatusPageForm from './StatusPageForm';
import ShouldRender from '../basic/ShouldRender';
import RenderIfSubProjectAdmin from '../basic/RenderIfSubProjectAdmin';
import DataPathHoC from '../DataPathHoC';
import StatusPage from './RowData';
import PropTypes from 'prop-types';
import { ListLoader } from '../basic/Loader';
import sortByName from '../../utils/sortByName';

const StatusPageProjectBox = props => {

};

StatusPageProjectBox.displayName = 'StatusPageProjectBox';

StatusPageProjectBox.propTypes = {
    switchStatusPages: PropTypes.func.isRequired,
    openModal: PropTypes.func.isRequired,
    nextClicked: PropTypes.func.isRequired,
    prevClicked: PropTypes.func.isRequired,
    subProjectStatusPage: PropTypes.object.isRequired,
    statusPages: PropTypes.array.isRequired,
    canPaginateBackward: PropTypes.bool.isRequired,
    canPaginateForward: PropTypes.bool.isRequired,
    skip: PropTypes.oneOfType([
        PropTypes.number.isRequired,
        PropTypes.string.isRequired,
    ]),
    limit: PropTypes.oneOfType([
        PropTypes.number.isRequired,
        PropTypes.string.isRequired,
    ]),
    // currentProject: PropTypes.object.isRequired,
    subProjectName: PropTypes.string.isRequired,
    currentProjectId: PropTypes.string.isRequired,
    statusPageModalId: PropTypes.string.isRequired,
    statusPage: PropTypes.object.isRequired,
    allStatusPageLength: PropTypes.number,
    modalList: PropTypes.array,
    project: PropTypes.object,
    pages: PropTypes.number,
    switchToProjectViewerNav: PropTypes.bool,
    showProjectName: PropTypes.bool,
};

export default StatusPageProjectBox;
