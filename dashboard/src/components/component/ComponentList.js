import React from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import RenderIfUserInSubProject from '../basic/RenderIfUserInSubProject';
import ComponentDetail from './ComponentDetail';
import sortByName from '../../utils/sortByName';
export function ComponentList(props) {
    let componentDetails = null;

    const components = props.components ? sortByName(props.components) : [];

    if (components && components.length > 0) {
        componentDetails = components.map((component, i) => (
            <div id={`component${i}`} key={component._id}>
                <RenderIfUserInSubProject
                    subProjectId={
                        component.projectId._id || component.projectId
                    }
                >
                    <ComponentDetail
                        shouldRenderProjectType={props.shouldRenderProjectType}
                        projectId={props.projectId}
                        projectName={props.projectName}
                        projectType={props.projectType}
                        component={component}
                        index={component._id}
                        key={component._id}
                    />
                </RenderIfUserInSubProject>
            </div>
        ));
    }

    return componentDetails;
}

ComponentList.displayName = 'ComponentList';

const mapDispatchToProps = dispatch =>
    bindActionCreators({}, dispatch);

const mapStateToProps = state => ({
    currentProject: state.project.currentProject,
});

export default connect(mapStateToProps, mapDispatchToProps)(ComponentList);
