import React, { ReactElement } from "react";
import Icon, { IconProp } from "../Basic/Icon/Icon";

export interface ComponentProps {
    onChange: (search: string) => void
}

const SearchBox = (props: ComponentProps): ReactElement => {
    return (<form className="app-search d-none d-lg-block">
        <div className="position-relative"><input type="text" className="form-control" placeholder="Search..." onChange={(e) => {
            props.onChange(e.target.value);
        }} /><Icon icon={IconProp.Search} /></div>
    </form>)
}


export default SearchBox;