import { describe, expect, test } from "@jest/globals";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOIDC from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "../../../Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import StatusPageOIDC from "../../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import StatusPageSSO from "../../../Models/DatabaseModels/StatusPageSso";
import TeamComplianceSetting from "../../../Models/DatabaseModels/TeamComplianceSetting";
import Project from "../../../Models/DatabaseModels/Project";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";

type ModelType = { new (): BaseModel };

/*
 * The facade owns the model -> feature map so the eleven model files stay
 * unchanged. These guards keep that map and the models'
 * @TableEditionAccessControl({ requiresEnterprise: true }) decorators from
 * drifting apart: a new enterprise model with no feature would otherwise be
 * gated by nothing, or by the wrong license feature.
 */
describe("EnterpriseEdition.getModelFeature against the real models", () => {
  test.each([
    [GlobalSSO, EnterpriseFeature.SSO],
    [GlobalOIDC, EnterpriseFeature.SSO],
    [GlobalSSOProject, EnterpriseFeature.SSO],
    [GlobalOIDCProject, EnterpriseFeature.SSO],
    [ProjectSSO, EnterpriseFeature.SSO],
    [ProjectOIDC, EnterpriseFeature.SSO],
    [StatusPageSSO, EnterpriseFeature.SSO],
    [StatusPageOIDC, EnterpriseFeature.SSO],
    [ProjectSCIM, EnterpriseFeature.SCIM],
    [StatusPageSCIM, EnterpriseFeature.SCIM],
    [TeamComplianceSetting, EnterpriseFeature.TeamCompliance],
  ] as Array<[ModelType, EnterpriseFeature]>)(
    "%p is gated by the expected feature",
    (modelType: ModelType, feature: EnterpriseFeature) => {
      expect(EnterpriseEdition.getModelFeature(modelType)).toBe(feature);
      expect(new modelType().requiresEnterprise).toBe(true);
    },
  );

  test("ordinary models map to no feature", () => {
    expect(EnterpriseEdition.getModelFeature(Project)).toBeNull();
    expect(EnterpriseEdition.getModelFeature(Monitor)).toBeNull();
  });

  test("every model marked requiresEnterprise has a feature", () => {
    const unmapped: Array<string> = [];

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: BaseModel = new modelType();

      if (!model.requiresEnterprise) {
        continue;
      }

      if (!EnterpriseEdition.getModelFeature(modelType)) {
        unmapped.push(model.tableName || modelType.name);
      }
    }

    expect(unmapped).toEqual([]);
  });

  test("every mapped table belongs to a registered model marked requiresEnterprise", () => {
    const enterpriseTables: Set<string> = new Set<string>();

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: BaseModel = new modelType();

      if (model.requiresEnterprise && model.tableName) {
        enterpriseTables.add(model.tableName);
      }
    }

    expect(
      EnterpriseEdition.getMappedTableNames().filter((tableName: string) => {
        return !enterpriseTables.has(tableName);
      }),
    ).toEqual([]);
    expect(enterpriseTables.size).toBe(
      EnterpriseEdition.getMappedTableNames().length,
    );
  });
});
