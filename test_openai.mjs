import OpenAI from "openai";

async function main() {
    const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: "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",
    });

    const completion = await openai.chat.completions.create({
        model: "mistralai/mixtral-8x7b-instruct",
        messages: [{ role: "user", content: "Say this is a test" }],
    });

    console.log(completion.choices[0].message.content);
}

main();
