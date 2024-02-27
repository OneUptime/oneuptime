import GenericFunction from "../GenericFunction";

export interface EnableDocumentationProps {
    isMasterAdminApiDocs?: boolean | undefined;
}

export default (props?: EnableDocumentationProps | undefined) => {
    return (ctr: GenericFunction) => {
        ctr.prototype.enableDocumentation = true;
        ctr.prototype.isMasterAdminApiDocs =
            props?.isMasterAdminApiDocs || false;
    };
};
