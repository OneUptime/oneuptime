import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp, SizeProp } from '../../Icon/Icon';
import { VeryLightGrey } from 'Common/Types/BrandColors';
export interface ComponentProps {
    onChange: (search: string) => void;
}

const ProjectPickerFilterBox: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <form className="app-search d-none d-lg-block p-0">
            <div className="position-relative">
                <input
                    type="text"
                    className="form-control"
                    placeholder="Search..."
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        props.onChange(e.target.value);
                    }}
                />
                <button
                    className="btn"
                    type="button"
                    disabled={true}
                    style={{
                        border: 'none',
                        color: VeryLightGrey.toString(),
                    }}
                >
                    <Icon
                        className="light"
                        icon={IconProp.Search}
                        size={SizeProp.Large}
                    />
                </button>
            </div>
        </form>
    );
};

export default ProjectPickerFilterBox;
