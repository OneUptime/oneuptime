from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

def load_model(model_name):
    """
    Function to load the model and tokenizer.
    """
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
    return tokenizer, model

def generate_text(input_text, tokenizer, model):
    """
    Function to generate text using the model.
    """
    inputs = tokenizer.encode(input_text, return_tensors='pt')
    outputs = model.generate(inputs, max_length=250, num_return_sequences=3)
    generated_text = tokenizer.batch_decode(outputs, skip_special_tokens=True)
    return generated_text

def main():
    model_name = "allenai/longformer-base-4096"  # replace with your model name
    tokenizer, model = load_model(model_name)
    
    input_text = "Hello, world!"  # replace with your input text
    generated_text = generate_text(input_text, tokenizer, model)
    
    for i, text in enumerate(generated_text):
        print(f"Generated text {i+1}: {text}")

if __name__ == "__main__":
    main()
