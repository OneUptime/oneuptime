import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import {
  CodeHost,
  CodeHostCapability,
} from "Common/Types/CodeRepository/CodeHost";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * A repository's menu in Code: its tasks first - that is where AI is asked
 * and where its work is read - then its pull requests' production reviews,
 * its settings, its Developer pages and, apart, removing it.
 *
 * Production reviews are GitHub's (its App reviews each pull request): a
 * repository on GitLab, Forgejo, Gitea or a Git server has none, so its
 * menu does not offer them once it is known where it is hosted.
 */
const CodeRepositorySideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [provider, setProvider] = useState<CodeRepositoryType | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    ModelAPI.getItem({
      modelType: CodeRepository,
      id: props.modelId,
      select: {
        repositoryHostedAt: true,
      },
    })
      .then((item: CodeRepository | null): void => {
        if (isCurrent && item) {
          setProvider(CodeHost.readType(item.repositoryHostedAt));
        }
      })
      .catch((): void => {
        // Production Reviews stays, as it always was; its page says the rest.
      });

    return (): void => {
      isCurrent = false;
    };
  }, [props.modelId.toString()]);

  const hasProductionReviews: boolean =
    provider === null ||
    CodeHost.can(provider, CodeHostCapability.ProductionReview);

  return (
    <SideMenu>
      <SideMenuSection title="Repository">
        <SideMenuItem
          link={{
            title: "Tasks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CODE_REPOSITORY_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Sparkles}
        />
        {hasProductionReviews ? (
          <SideMenuItem
            link={{
              title: "Production Reviews",
              to: RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS
                ] as Route,
                { modelId: props.modelId },
              ),
            }}
            icon={IconProp.DocumentMagnifyingGlass}
          />
        ) : (
          <></>
        )}
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CODE_REPOSITORY_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: CodeRepository,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Repository",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CODE_REPOSITORY_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default CodeRepositorySideMenu;
