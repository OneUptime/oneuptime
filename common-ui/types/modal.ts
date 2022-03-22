export type OpenModalAction = {
    id: string;
    onClose: Function;
    content: string;
};

export type CloseModalAction = {
    id: string;
};
