import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import KubernetesImageReferenceView from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesImageReferenceView";

afterEach(() => {
  cleanup();
});

describe("KubernetesImageReferenceView", () => {
  test("keeps a registry port in an untagged image name", () => {
    const reference: string = "registry.example:10443/team/api";

    render(<KubernetesImageReferenceView reference={reference} />);

    expect(
      screen.getByTestId("kubernetes-image-reference-name"),
    ).toHaveTextContent(reference);
    expect(
      screen.queryByTestId("kubernetes-image-reference-tag"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kubernetes-image-reference-digest"),
    ).not.toBeInTheDocument();
  });

  test("renders a normal tag as a separate badge", () => {
    render(
      <KubernetesImageReferenceView reference="registry.example/team/api:v2" />,
    );

    expect(
      screen.getByTestId("kubernetes-image-reference-name"),
    ).toHaveTextContent("registry.example/team/api");
    expect(
      screen.getByTestId("kubernetes-image-reference-tag"),
    ).toHaveTextContent("v2");
    expect(
      screen.queryByTestId("kubernetes-image-reference-digest"),
    ).not.toBeInTheDocument();
  });

  test("renders a full SHA-256 digest without allowing it to force overflow", () => {
    const digest: string = `sha256:${"a".repeat(64)}`;

    render(
      <KubernetesImageReferenceView
        reference={`registry.k8s.io/pause@${digest}`}
      />,
    );

    expect(
      screen.getByTestId("kubernetes-image-reference-name"),
    ).toHaveTextContent("registry.k8s.io/pause");
    expect(
      screen.getByTestId("kubernetes-image-reference-digest"),
    ).toHaveTextContent(`@${digest}`);
    expect(screen.getByTestId("kubernetes-image-reference")).toHaveClass(
      "flex",
      "min-w-0",
      "max-w-full",
      "flex-wrap",
    );
    expect(screen.getByTestId("kubernetes-image-reference-digest")).toHaveClass(
      "min-w-0",
      "max-w-full",
      "break-all",
      "whitespace-normal",
    );
  });

  test("separates the name, tag, and digest in a combined reference", () => {
    const digest: string = `sha256:${"b".repeat(64)}`;

    render(
      <KubernetesImageReferenceView
        reference={`registry.example:10443/team/api:v2@${digest}`}
      />,
    );

    expect(
      screen.getByTestId("kubernetes-image-reference-name"),
    ).toHaveTextContent("registry.example:10443/team/api");
    expect(
      screen.getByTestId("kubernetes-image-reference-tag"),
    ).toHaveTextContent("v2");
    expect(
      screen.getByTestId("kubernetes-image-reference-digest"),
    ).toHaveTextContent(`@${digest}`);
  });

  test("allows a maximum-length tag badge to wrap within its card", () => {
    const tag: string = `v${"1".repeat(127)}`;

    render(<KubernetesImageReferenceView reference={`busybox:${tag}`} />);

    expect(tag).toHaveLength(128);
    expect(
      screen.getByTestId("kubernetes-image-reference-tag"),
    ).toHaveTextContent(tag);
    expect(screen.getByTestId("kubernetes-image-reference")).toHaveClass(
      "min-w-0",
      "max-w-full",
      "flex-wrap",
    );
    expect(screen.getByTestId("kubernetes-image-reference-tag")).toHaveClass(
      "min-w-0",
      "max-w-full",
      "break-all",
      "whitespace-normal",
    );
  });
});
