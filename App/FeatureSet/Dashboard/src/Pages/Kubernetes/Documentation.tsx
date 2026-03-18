import PageComponentProps from "../PageComponentProps";
import Card from "Common/UI/Components/Card/Card";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import { getKubernetesInstallationMarkdown } from "./Utils/DocumentationMarkdown";

const KubernetesDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const installationMarkdown: string =
    getKubernetesInstallationMarkdown("my-cluster");

  return (
    <Fragment>
      <Card
        title="Agent Installation Guide"
        description="Install the OneUptime Kubernetes Agent using Helm to connect your cluster. Once installed, the cluster will appear automatically."
      >
        <div className="px-4 pb-6">
          <MarkdownViewer text={installationMarkdown} />
        </div>
      </Card>
    </Fragment>
  );
};

export default KubernetesDocumentation;
