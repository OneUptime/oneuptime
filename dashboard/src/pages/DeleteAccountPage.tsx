import React from 'react';

import { PropTypes } from 'prop-types';

import { Fade } from 'react-awesome-reveal';
import BreadCrumbItem from '../components/breadCrumb/BreadCrumbItem';
import DeleteAccountBox from '../components/profileSettings/DeleteAccountBox';
import BreadCrumbs from '../components/breadCrumb/BreadCrumbs';

const DeleteAccountPage = (props: $TSFixMe) => {
    const {
        location: { pathname },
    } = props;

    return (
        <Fade>
            <div className="Profile-Pages--view">
                <BreadCrumbs styles="breadCrumbContainer Card-shadow--medium db-mb" />
                <BreadCrumbItem route={pathname} name="Advanced" />
                <div>
                    <div className="db-BackboneViewContainer">
                        <div className="react-settings-view react-view">
                            <span data-reactroot="">
                                <div>
                                    <div>
                                        <div className="Box-root Margin-bottom--12">
                                            <DeleteAccountBox />
                                        </div>
                                    </div>
                                </div>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Fade>
    );
};

DeleteAccountPage.displayName = 'DeleteAccountPage';

DeleteAccountPage.propTypes = {
    location: PropTypes.shape({
        pathname: PropTypes.string,
    }),
};

export default DeleteAccountPage;
