import File from "../../Models/BaseModels/BaseModel/FileModel";
import { describe, expect, it } from "@jest/globals";
import BaseModel from "../../Models/BaseModels/BaseModel/BaseModel";


describe("File", () => {
  it("should be an instance of BaseModel", () => {
    const file: File = new File();
    expect(file).toBeInstanceOf(BaseModel);
  });
});
