import React, { FunctionComponent, ReactElement } from 'react';
import URL from 'Common/Types/API/URL';
import Navigation from '../../Utils/Navigation';

export interface ImageTile {
    image: ReactElement; 
    navigateToUrl: URL
}

export interface ComponentProps {
    tiles: Array<ImageTile>;
}

const ImageTilesElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className='grid'>
            {/** Generate a squares in a grid in tailwind. One square for each tile */}
            {props.tiles.map((tile: ImageTile, i: number) => {
                return (
                    <div className='grid-item' key={i} onClick={()=>{
                        Navigation.navigate(tile.navigateToUrl, {
                            openInNewTab: true
                        });
                    }}>
                        {tile.image}
                    </div>
                );
            })}
        </div>
    );
};

export default ImageTilesElement;
