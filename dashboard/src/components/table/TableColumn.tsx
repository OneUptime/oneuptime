import React, { Component } from 'react';
import RenderBasedOnRole from '../basic/RenderBasedOnRole';
import PropTypes from 'prop-types';

export interface ComponentProps {
    title: string;
    onClick?: Function;
    visibleForOwner?: boolean;
    visibleForAdmin?: boolean;
    visibleForViewer?: boolean;
    visibleForMember?: boolean;
    visibleForAll?: boolean;
}

export default class TableColumn extends Component<TableColumnProps>{
    public static displayName = '';
    public static propTypes = {};
    constructor(props: $TSFixMe) {
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

    override render() {
        const {

            visibleForOwner,

            visibleForAdmin,

            visibleForViewer,

            visibleForMember,

            visibleForAll,
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
    visibleForAll: PropTypes.bool,
};
