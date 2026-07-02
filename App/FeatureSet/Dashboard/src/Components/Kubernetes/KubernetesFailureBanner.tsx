import React, { Fragment, FunctionComponent, ReactElement } from "react";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
import {
  KubernetesFailureEvidence,
  KubernetesFailureExplanation,
} from "Common/Types/Kubernetes/KubernetesFailureExplainer";

export interface ComponentProps {
  explanations: Array<KubernetesFailureExplanation>;
}

/*
 * Renders one AlertBanner per failure explanation produced by the
 * KubernetesFailureExplainer rules — title, plain-English summary,
 * compact evidence rows, and an actionable recommendation. Renders
 * nothing when there are no explanations.
 */
const KubernetesFailureBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.explanations.length === 0) {
    return <Fragment />;
  }

  return (
    <div className="space-y-4 mb-5">
      {props.explanations.map(
        (explanation: KubernetesFailureExplanation): ReactElement => {
          return (
            <AlertBanner
              key={explanation.id}
              title={explanation.title}
              type={
                explanation.severity === "critical"
                  ? AlertBannerType.Danger
                  : AlertBannerType.Warning
              }
            >
              <div>
                <p className="text-sm text-gray-700">{explanation.summary}</p>
                {explanation.evidence.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {explanation.evidence.map(
                      (
                        evidence: KubernetesFailureEvidence,
                        index: number,
                      ): ReactElement => {
                        return (
                          <div
                            key={`${explanation.id}-evidence-${index}`}
                            className="text-xs text-gray-600 break-words"
                          >
                            <span className="font-medium text-gray-700">
                              {evidence.label}:
                            </span>{" "}
                            {evidence.value}
                          </div>
                        );
                      },
                    )}
                  </div>
                )}
                {explanation.recommendation && (
                  <p className="mt-2 text-sm italic text-gray-600">
                    <span className="font-medium not-italic text-gray-700">
                      Recommendation:
                    </span>{" "}
                    {explanation.recommendation}
                  </p>
                )}
              </div>
            </AlertBanner>
          );
        },
      )}
    </div>
  );
};

export default KubernetesFailureBanner;
