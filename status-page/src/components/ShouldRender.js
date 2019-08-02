/*
 * ShouldRender
 * Description: Renders the children component if the view resolves to TRUE
 * Params
 * params 1: props
 * returns JSX.Element or NULL
 */
export default function ShouldRender(props) {
    return props.if ? props.children : null;
}