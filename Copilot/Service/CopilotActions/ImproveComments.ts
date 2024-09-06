import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionBase from "./CopilotActionsBase";
import CodeRepositoryUtil from "../../Utils/CodeRepository";
import TechStack from "Common/Types/ServiceCatalog/TechStack";
import { CopilotPromptResult } from "../LLM/LLMBase";
import Text from "Common/Types/Text";
import { CopilotActionPrompt, CopilotProcess } from "./Types";
import { PromptRole } from "../LLM/Prompt";
import logger from "Common/Server/Utils/Logger";
import FileActionProp from "Common/Types/Copilot/CopilotActionProps/FileActionProp";
import CodeRepositoryFile from "Common/Server/Utils/CodeRepository/CodeRepositoryFile";
import CopilotActionUtil from "../../Utils/CopilotAction";
import ObjectID from "Common/Types/ObjectID";
import CopilotAction from "Common/Models/DatabaseModels/CopilotAction";
import ServiceRepositoryUtil from "../../Utils/ServiceRepository";
import Dictionary from "Common/Types/Dictionary";
import ArrayUtil from "Common/Utils/Array";
import CopilotActionProp from "Common/Types/Copilot/CopilotActionProps/Index";
import BadDataException from "Common/Types/Exception/BadDataException";

export default class ImproveComments extends CopilotActionBase {
  public isRequirementsMet: boolean = false;

  public constructor() {
    super();
    this.copilotActionType = CopilotActionType.IMPROVE_COMMENTS;
    this.acceptFileExtentions = CodeRepositoryUtil.getCodeFileExtentions();
  }

  protected override async isActionRequired(data: {
    serviceCatalogId: ObjectID;
    serviceRepositoryId: ObjectID;
    copilotActionProp: FileActionProp;
  }): Promise<boolean> {
    // check if the action has already been processed for this file.
    const existingAction: CopilotAction | null =
      await CopilotActionUtil.getExistingAction({
        serviceCatalogId: data.serviceCatalogId,
        actionType: this.copilotActionType,
        actionProps: {
          filePath: data.copilotActionProp.filePath, // has this action run on this file before?
        },
      });

    if (!existingAction) {
      return true;
    }

    return false;
  }

  public override async getActionPropsToQueue(data: {
    serviceCatalogId: ObjectID;
    serviceRepositoryId: ObjectID;
    maxActionsToQueue: number;
  }): Promise<Array<CopilotActionProp>> {
    // get files in the repo.
    logger.debug(
      `${this.copilotActionType} - Getting files to queue for improve comments.`,
    );

    let totalActionsToQueue: number = 0;

    logger.debug(`${this.copilotActionType} - Reading files in the service.`);

    const files: Dictionary<CodeRepositoryFile> =
      await ServiceRepositoryUtil.getFilesByServiceCatalogId({
        serviceCatalogId: data.serviceCatalogId,
      });

    logger.debug(
      `${this.copilotActionType} - Files read. ${Object.keys(files).length} files found.`,
    );

    // get keys in random order.
    let fileKeys: string[] = Object.keys(files);

    //randomize the order of the files.
    fileKeys = ArrayUtil.shuffle(fileKeys);

    const actionsPropsQueued: Array<CopilotActionProp> = [];

    for (const fileKey of fileKeys) {
      const file: CodeRepositoryFile = files[fileKey]!;

      logger.debug(
        `${this.copilotActionType} - Checking file: ${file.filePath}`,
      );

      if (
        await this.isActionRequired({
          serviceCatalogId: data.serviceCatalogId,
          serviceRepositoryId: data.serviceRepositoryId,
          copilotActionProp: {
            filePath: file.filePath,
          },
        })
      ) {
        actionsPropsQueued.push({
          filePath: file.filePath,
        });

        totalActionsToQueue++;
      }

      if (totalActionsToQueue >= data.maxActionsToQueue) {
        break;
      }
    }

    return actionsPropsQueued;
  }

  public override async getCommitMessage(
    data: CopilotProcess,
  ): Promise<string> {
    return (
      "Improved comments on " + (data.actionProp as FileActionProp).filePath
    );
  }

  public override async getPullRequestTitle(
    data: CopilotProcess,
  ): Promise<string> {
    return (
      "Improved comments on " + (data.actionProp as FileActionProp).filePath
    );
  }

  public override async getPullRequestBody(
    data: CopilotProcess,
  ): Promise<string> {
    return `Improved comments on ${(data.actionProp as FileActionProp).filePath}
    
    ${await this.getDefaultPullRequestBody()}
    `;
  }

  public override isActionComplete(_data: CopilotProcess): Promise<boolean> {
    return Promise.resolve(this.isRequirementsMet);
  }

  public override async onExecutionStep(
    data: CopilotProcess,
  ): Promise<CopilotProcess> {
    const filePath: string = (data.actionProp as FileActionProp).filePath;

    if (!filePath) {
      throw new BadDataException("File Path is not set in the action prop.");
    }

    const fileContent: string = await ServiceRepositoryUtil.getFileContent({
      filePath: filePath,
    });

    const codeParts: string[] = await this.splitInputCode({
      code: fileContent,
      itemSize: 500,
    });

    let newContent: string = "";

    let isWellCommented: boolean = true;

    for (const codePart of codeParts) {
      const codePartResult: {
        newCode: string;
        isWellCommented: boolean;
      } = await this.commentCodePart({
        data: data,
        codePart: codePart,
        currentRetryCount: 0,
        maxRetryCount: 3,
      });

      if (!codePartResult.isWellCommented) {
        isWellCommented = false;
        newContent += codePartResult.newCode + "\n";
      } else {
        newContent += codePart + "\n";
      }
    }

    if (isWellCommented) {
      this.isRequirementsMet = true;
      return data;
    }

    newContent = newContent.trim();

    logger.debug("New Content:");
    logger.debug(newContent);

    const fileActionProps: FileActionProp = data.actionProp as FileActionProp;

    // add to result.
    data.result.files[fileActionProps.filePath] = {
      fileContent: newContent,
    } as CodeRepositoryFile;

    this.isRequirementsMet = true;
    return data;
  }

  private async didPassValidation(data: CopilotPromptResult): Promise<boolean> {
    const validationResponse: string = data.output as string;
    if (validationResponse === "--no--") {
      return true;
    }

    return false;
  }

  private async isFileAlreadyWellCommented(content: string): Promise<boolean> {
    if (content.includes("--all-good--")) {
      return true;
    }

    return false;
  }

  private async commentCodePart(options: {
    data: CopilotProcess;
    codePart: string;
    currentRetryCount: number;
    maxRetryCount: number;
  }): Promise<{
    newCode: string;
    isWellCommented: boolean;
  }> {
    let isWellCommented: boolean = true;

    const codePart: string = options.codePart;
    const data: CopilotProcess = options.data;

    const actionPrompt: CopilotActionPrompt = await this.getPrompt(
      data,
      codePart,
    );

    const copilotResult: CopilotPromptResult =
      await this.askCopilot(actionPrompt);

    const newCodePart: string = await this.cleanupCode({
      inputCode: codePart,
      outputCode: copilotResult.output as string,
    });

    if (!(await this.isFileAlreadyWellCommented(newCodePart))) {
      isWellCommented = false;
    }

    const validationPrompt: CopilotActionPrompt =
      await this.getValidationPrompt({
        oldCode: codePart,
        newCode: newCodePart,
      });

    const validationResponse: CopilotPromptResult =
      await this.askCopilot(validationPrompt);

    const didPassValidation: boolean =
      await this.didPassValidation(validationResponse);

    if (
      !didPassValidation &&
      options.currentRetryCount < options.maxRetryCount
    ) {
      return await this.commentCodePart({
        data: data,
        codePart: codePart,
        currentRetryCount: options.currentRetryCount + 1,
        maxRetryCount: options.maxRetryCount,
      });
    }

    if (!didPassValidation) {
      return {
        newCode: codePart,
        isWellCommented: false,
      };
    }

    return {
      newCode: newCodePart,
      isWellCommented: isWellCommented,
    };
  }

  private async getValidationPrompt(data: {
    oldCode: string;
    newCode: string;
  }): Promise<CopilotActionPrompt> {
    const oldCode: string = data.oldCode;
    const newCode: string = data.newCode;

    const prompt: string = `
        I've asked to improve comments in the code. 

        This is the old code: 

        ${oldCode}

        ---- 
        This is the new code: 

        ${newCode}

        Was anything changed in the code except comments? If yes, please reply with the following text: 
        --yes--

        If the code was NOT changed EXCEPT comments, please reply with the following text:
        --no--
      `;

    const systemPrompt: string = await this.getSystemPrompt();

    return {
      messages: [
        {
          content: systemPrompt,
          role: PromptRole.System,
        },
        {
          content: prompt,
          role: PromptRole.User,
        },
      ],
    };
  }

  public override async getPrompt(
    _data: CopilotProcess,
    inputCode: string,
  ): Promise<CopilotActionPrompt> {
    // const fileLanguage: TechStack = data.input.files[data.input.currentFilePath]
    //   ?.fileLanguage as TechStack;

    const fileLanguage: TechStack = TechStack.TypeScript;

    const prompt: string = `Please improve the comments in this code. Please only add minimal comments and comment code which is hard to understand. Please add comments in new line and do not add inline comments. 

    If you think the code is already well commented, please reply with the following text:
    --all-good--
    
    Here is the code. This is in ${fileLanguage}: 
    
    ${inputCode}
                `;

    const systemPrompt: string = await this.getSystemPrompt();

    return {
      messages: [
        {
          content: systemPrompt,
          role: PromptRole.System,
        },
        {
          content: prompt,
          role: PromptRole.User,
        },
      ],
    };
  }

  public async getSystemPrompt(): Promise<string> {
    const systemPrompt: string = `You are an expert programmer. Here are your instructions:
- You will follow the instructions given by the user strictly.
- You will not deviate from the instructions given by the user.
- You will not change the code. You will only improve the comments.`;

    return systemPrompt;
  }

  public async cleanupCode(data: {
    inputCode: string;
    outputCode: string;
  }): Promise<string> {
    // this code contains text as well. The code is in betwen ```<type> and ```. Please extract the code and return it.
    // for example code can be in the format of
    // ```python
    // print("Hello World")
    // ```

    // so the code to be extracted is print("Hello World")

    // the code can be in multiple lines as well.

    let extractedCode: string = data.outputCode; // this is the code in the file

    if (extractedCode.includes("```")) {
      extractedCode = extractedCode.match(/```.*\n([\s\S]*?)```/)?.[1] ?? "";
    }

    // get first line of input code.

    const firstWordOfInputCode: string = Text.getFirstWord(data.inputCode);
    extractedCode = Text.trimStartUntilThisWord(
      extractedCode,
      firstWordOfInputCode,
    );

    const lastWordOfInputCode: string = Text.getLastWord(data.inputCode);

    extractedCode = Text.trimEndUntilThisWord(
      extractedCode,
      lastWordOfInputCode,
    );

    extractedCode = Text.trimUpQuotesFromStartAndEnd(extractedCode);

    // check for quotes.

    return extractedCode;
  }
}
