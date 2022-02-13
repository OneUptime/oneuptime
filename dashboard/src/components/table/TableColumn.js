import React, { Component } from 'react';
import RenderIfAdmin from '../basic/RenderIfAdmin';
import RenderIfOwner from '../basic/RenderIfOwner';
import RenderIfMember from '../basic/RenderIfMember';
import RenderIfViewer from '../basic/RenderIfViewer';
import PropTypes from 'prop-types';

export default class TableColumn extends Component {
    constructor(props) {
        super(props);
    }

    getElement() {
        const { title, onClick } = this.props;

        return (
            <td onClick={onClick}>
                <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                    {title}
                </div>
            </td>
        );
    }

    render() {
        const {
            visibleForOwner,
            visibleForAdmin,
            visibleForViewer,
            visibleForMember,
            visibleForAll
        } = this.props;

        return (
            <RenderBasedOnRole
                visibleForOwner={visibleForOwner}
                visibleForAdmin={visibleForAdmin}
                visibleForViewer={visibleForViewer}
                visibleForMember={visibleForMember}
                visibleForAll={visibleForAll}
            >
                {this.getElement()}
            </RenderBasedOnRole>
        );
    }
}

TableColumn.propTypes = {
    title: PropTypes.string.isRequired,
    onClick: PropTypes.func,
   

    visibleForOwner: PropTypes.bool,
    visibleForAdmin: PropTypes.bool,
    visibleForViewer: PropTypes.bool,
    visibleForMember: PropTypes.bool,
};
