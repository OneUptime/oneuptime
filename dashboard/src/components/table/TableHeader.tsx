import React, { Component } from 'react';

import TableDescription from './TableDescription';
import TableTitle from './TableTitle';
import Button from '../basic/Button';
import PropTypes from 'prop-types';
export default class TableHeader extends Component {
    constructor(props: $TSFixMe) {
        super(props);
    }

    render() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'title' does not exist on type 'Readonly<... Remove this comment to see the full error message
        const { title, description, headerButtons } = this.props;

        return (
            <div className="ContentHeader Box-root Box-background--white Box-divider--surface-bottom-1 Flex-flex Flex-direction--column Padding-horizontal--20 Padding-vertical--16">
                <div className="Box-root Flex-flex Flex-direction--row Flex-justifyContent--spaceBetween">
                    <div className="ContentHeader-center Box-root Flex-flex Flex-direction--column Flex-justifyContent--center">
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ title: any; }' is not assignable to type '... Remove this comment to see the full error message
                        <TableTitle title={title} />
                        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ description: any; }' is not assignable to ... Remove this comment to see the full error message
                        <TableDescription description={description} />
                    </div>

                    {headerButtons && headerButtons.length > 0 && (
                        <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                            <div className="Box-root">
                                {headerButtons &&
                                    headerButtons.map((button: $TSFixMe, i: $TSFixMe) => {
                                        return (
                                            <Button
                                                key={i}
                                                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ key: any; title: any; shortcutKey: any; id... Remove this comment to see the full error message
                                                title={button.title}
                                                shortcutKey={button.shortcutKey}
                                                id={button.tiidtle}
                                                onClick={button.onClick}
                                                visibleForOwner={
                                                    button.visibleForOwner
                                                }
                                                visibleForAdmin={
                                                    button.visibleForAdmin
                                                }
                                                visibleForViewer={
                                                    button.visibleForViewer
                                                }
                                                visibleForMember={
                                                    button.visibleForMember
                                                }
                                            />
                                        );
                                    })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }
}

// @ts-expect-error ts-migrate(2339) FIXME: Property 'propTypes' does not exist on type 'typeo... Remove this comment to see the full error message
TableHeader.propTypes = {
    title: PropTypes.string.isRequired,
    description: PropTypes.string,
    headerButtons: PropTypes.array,
};
