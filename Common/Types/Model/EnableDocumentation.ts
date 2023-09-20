export interface EnableDocumentationProps {
    isMasterAdminApiDocs?: boolean | undefined;
}

export default (props?: EnableDocumentationProps | undefined) => {
    return (ctr: Function) => {
        ctr.prototype.enableDocumentation = true;
        ctr.prototype.isMasterAdminApiDocs =
            props?.isMasterAdminApiDocs || false;
    };
};
