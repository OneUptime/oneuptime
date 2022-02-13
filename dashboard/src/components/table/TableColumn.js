import React, { Component } from 'react';
import RenderIfAdmin from '../basic/RenderIfAdmin';
import RenderIfOwner from  '../basic/RenderIfOwner';
import RenderIfMember from '../basic/RenderIfMember';
import RenderIfViewer from '../basic/RenderIfViewer';


export default class TableButton extends Component {

    constructor(props) {
        super(props);
    }

    getColumnElement() {
        const { title, onClick } = this.props;

        return (<td onClick={onClick}>
            <div className="bs-ObjectList-cell Text-typeface--upper Text-fontWeight--medium">
                {title}
            </div>
        </td>)
    }

    render() {
        const { visibleForOwner, visibleForAdmin, visibleForViewer, visibleForMember } = this.props;

        if(visibleForAdmin){
            return (
                <RenderIfAdmin>
                    {this.getColumnElement()}
                </RenderIfAdmin>
            )
        }

        if(visibleForViewer){
            return (
                <RenderIfViewer>
                    {this.getColumnElement()}
                </RenderIfViewer>
            )
        }
        
        if(visibleForMember){
            return (
                <RenderIfMember>
                    {this.getColumnElement()}
                </RenderIfMember>
            )
        }

        if(visibleForOwner){
            return (
                <RenderIfOwner>
                    {this.getColumnElement()}
                </RenderIfOwner>
            )
        }


        return this.getColumnElement();

    }
}
