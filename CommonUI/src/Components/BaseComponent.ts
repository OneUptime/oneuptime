import { Component } from 'react';

export default class BaseComponent<ComponentProps> extends Component<ComponentProps>{
    public static displayName = '';
    public static propTypes = {};

    constructor(props: ComponentProps) {
        super(props);
    }
}


BaseComponent.propTypes = {};

BaseComponent.displayName = 'BaseComponent';
