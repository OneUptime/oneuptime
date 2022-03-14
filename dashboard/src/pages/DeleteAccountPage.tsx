import React from 'react';
// @ts-expect-error ts-migrate(2305) FIXME: Module '"prop-types"' has no exported member 'Prop... Remove this comment to see the full error message
import { PropTypes } from 'prop-types';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Fade from 'react-awesome-reveal/Fade';
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
