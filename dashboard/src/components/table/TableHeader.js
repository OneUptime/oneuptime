import React, { Component } from 'react';

import TableDescription from './TableDescription';
import TableTitle from './TableTitle';
import TableButton from './TableButton';

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

                <div className="ContentHeader-end Box-root Flex-flex Flex-alignItems--center Margin-left--16">
                    <div className="Box-root">
                        <RenderIfAdmin
                            subProjectId={props.subProjectStatusPage._id}
                        >
                            <button
                                id={`btnCreateStatusPage_${props.subProjectName}`}
                                onClick={() => {
                                    props.openModal({
                                        id: props.statusPageModalId,
                                        content: DataPathHoC(
                                            StatusPageForm,
                                            {
                                                projectId:
                                                    props
                                                        .subProjectStatusPage
                                                        ._id,
                                            }
                                        ),
                                    });
                                }}
                                className="Button bs-ButtonLegacy ActionIconParent"
                                type="button"
                            >
                                <div className="bs-ButtonLegacy-fill Box-root Box-background--white Flex-inlineFlex Flex-alignItems--center Flex-direction--row Padding-horizontal--8 Padding-vertical--4">
                                    <div className="Box-root Margin-right--8">
                                        <div className="SVGInline SVGInline--cleaned Button-icon ActionIcon ActionIcon--color--inherit Box-root Flex-flex"></div>
                                    </div>
                                    {props.allStatusPageLength === 1 ? (
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new keycode__wrapper">
                                            <span>Create Status Page</span>
                                            <span className="new-btn__keycode">
                                                N
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="bs-Button bs-FileUploadButton bs-Button--icon bs-Button--new">
                                            <span>Create Status Page</span>
                                        </span>
                                    )}
                                </div>
                            </button>
                        </RenderIfAdmin>
                    </div>
                </div>
            </div>
        </div>
        )
    }
}
