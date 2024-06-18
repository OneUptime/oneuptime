from transformers import AutoTokenizer
import transformers
import torch
from fastapi import FastAPI
from pydantic import BaseModel


# Declare a Pydantic model for the request body
class Prompt(BaseModel):
   prompt: str

model_id = "meta-llama/Meta-Llama-3-8B-Instruct"

pipeline = transformers.pipeline(
    "text-generation",
    model=model_id,
    model_kwargs={"torch_dtype": torch.bfloat16},
    device_map="auto",
)

app = FastAPI()

@app.post("/prompt/")
async def create_item(prompt: Prompt):

    # If not prompt then return bad request error
    if not prompt:
        return {"error": "Prompt is required"}

    messages = [
        {"role": "system", "content": "You are a pirate chatbot who always responds in pirate speak!"},
        {"role": "user", "content": "Who are you?"},
    ]

    terminators = [
        pipeline.tokenizer.eos_token_id,
        pipeline.tokenizer.convert_tokens_to_ids("<|eot_id|>")
    ]

    outputs = pipeline(
        messages,
        max_new_tokens=256,
        eos_token_id=terminators,
        do_sample=True,
        temperature=0.6,
        top_p=0.9,
    )
   

    output = outputs[0]["generated_text"][-1]

    # return prompt response
    return {"response": output}


