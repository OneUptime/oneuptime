import path from "path";
import { LlamaModel, LlamaContext, LlamaChatSession } from "node-llama-cpp";

const model = new LlamaModel({
    modelPath: path.join(__dirname, "ggml-model-q4_0.gguf")
});

const context = new LlamaContext({ model });
const session = new LlamaChatSession({ context });

const init: Function = async () => {
    const q1 = "Hi there, how are you?";
    console.log("User: " + q1);

    const a1 = await session.prompt(q1);
    console.log("AI: " + a1);


    const q2 = "Summerize what you said";
    console.log("User: " + q2);

    const a2 = await session.prompt(q2);
    console.log("AI: " + a2);
};


init();
