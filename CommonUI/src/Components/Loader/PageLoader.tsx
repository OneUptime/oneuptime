import React, { FunctionComponent, ReactElement } from "../../Utils/React";
import Loader, { LoaderType } from "./Loader";
import { Black } from "../../Utils/BrandColors";

export interface ComponentProps { 
    isVisible: boolean
}

const PageLoader: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
    if (props.isVisible) {
        return (
            <div><Loader loaderType={LoaderType.Bar} color={Black} /></div>
        )
    } else {
        return <></>
    }
};

export default PageLoader;