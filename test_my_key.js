// test_my_key.js
// Run this file in your terminal to see exactly what OpenRouter thinks of your API key!
// Type: node test_my_key.js

const { OpenAI } = require('openai');

async function testMyKey() {
    console.log("---------------------------------------");
    console.log("TESTING YOUR OPENROUTER API KEY DIRECTLY");
    console.log("---------------------------------------");

    // The exact key you asked me to hardcode
    const myKey = "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";
    const myModel = "cognitivecomputations/dolphin-mistral-24b-venice-edition:free";

    console.log("API Key:", myKey);
    console.log("Model:", myModel);
    console.log("Base URL: https://openrouter.ai/api/v1\n");
    console.log("Sending request to OpenRouter now...");

    const openai = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: myKey,
    });

    try {
        const response = await openai.chat.completions.create({
            model: myModel,
            messages: [{ role: "user", content: "Say the word: success" }]
        });

        console.log("\n✅ SUCCESS! OPENROUTER ACCEPTED YOUR KEY!");
        console.log("AI Says:", response.choices[0].message.content);

    } catch (error) {
        console.log("\n❌ OPENROUTER REJECTED YOUR KEY!");
        console.log("Exact Error from OpenRouter's Servers:");
        console.error(error.message);

        if (error.message.includes("User not found") || error.message.includes("401")) {
            console.log("\n⚠️ WHAT DOES THIS MEAN? ⚠️");
            console.log("This means OpenRouter has PERMANENTLY DELETED OR REVOKED this specific API key.");
            console.log("Even though you pasted it correctly, OpenRouter itself is refusing to let the key work.");
            console.log("You must go back into your OpenRouter Account and generate a brand-new API key, then paste it in.");
        }
    }
}

testMyKey();
