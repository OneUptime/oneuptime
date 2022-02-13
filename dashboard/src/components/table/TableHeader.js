import React, { Component } from 'react';

import TableDescription from './TableDescription';
import TableTitle from './TableTitle';
import Button from '../basic/Button';

export default class TableHeader extends Component {

    constructor(props) {
        super(props);
    }

    render() {
        const {
            title,
            description,
            headerButtons
        } = this.props;

        return (<div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
            <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">

                <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                    <TableTitle title={title} />
                    <TableDescription description={description} />
                </div>

                {headerButtons && headerButtons.length > 0 && <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                    <div className="Box-root">
                        {headerButtons && headerButtons.map((button) => {
                            return (<Button
                                title={button.title}
                                shortcutKey={button.shortcutKey}
                                id={button.tiidtle}
                                onClick={button.onClick}
                                visibleForOwner={button.visibleForOwner}
                                visibleForAdmin={button.visibleForAdmin}
                                visibleForViewer={button.visibleForViewer}
                                visibleForMember={button.visibleForMember}
                            />)
                        })}
                    </div>
                </div>}
            </div>
        </div>
        )
    }
}
