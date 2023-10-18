from transformers import AutoTokenizer
import transformers
import torch
from fastapi import FastAPI
from pydantic import BaseModel


# Declare a Pydantic model for the request body
class Prompt(BaseModel):
   prompt: str

model_path = "./Models/Llama-2-7b-chat-hf"

tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
pipeline = transformers.pipeline(
    "text-generation",
    model=model_path,
    # torch_dtype=torch.float32, # for CPU
    torch_dtype=torch.float16, # for GPU
    device_map="auto",
)

app = FastAPI()


@app.post("/prompt/")
async def create_item(prompt: Prompt):

    # If not prompt then return bad request error
    if not prompt:
        return {"error": "Prompt is required"}

    sequences = pipeline(
        prompt.prompt,
        do_sample=True,
        top_k=10,
        num_return_sequences=1,
        eos_token_id=tokenizer.eos_token_id,
        max_length=200,
    )

    prompt_response_array = []

    for seq in sequences:
        print(f"Result: {seq['generated_text']}")
        prompt_response_array.append(seq["generated_text"])

    # return prompt response
    return {"response": prompt_response_array}


