import React, { FunctionComponent, ReactElement } from 'react';
import URL from 'Common/Types/API/URL';
import Navigation from '../../Utils/Navigation';
import Image from '../Image/Image';
import FieldLabelElement from '../Detail/FieldLabel';

export interface ImageTile {
    image: ReactElement;
    navigateToUrl: URL;
    title: string;
}

export interface ComponentProps {
    tiles: Array<ImageTile>;
    title: string;
    description: string;
}

const ImageTilesElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            <div>
                <FieldLabelElement
                    title={props.title}
                    description={props.description}
                />
            </div>
            <div className="flex mt-5 mb-5 space-x-5">
                {/** Generate a squares in a grid in tailwind. One square for each tile */}
                {props.tiles.map((tile: ImageTile, i: number) => {
                    return (
                        <div
                            key={i}
                            className="p-3 cursor-pointer pb-5"
                            onClick={() => {
                                Navigation.navigate(tile.navigateToUrl, {
                                    openInNewTab: true,
                                });
                            }}
                        >
                            <div>
                                <Image
                                    className="h-20 w-20"
                                    imageUrl={tile.image}
                                />
                            </div>
                            <div className="text-sm text-gray-400 w-full text-center mt-2">
                                {tile.title}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ImageTilesElement;
