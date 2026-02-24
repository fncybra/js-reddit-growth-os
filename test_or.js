async function main() {
    const prompt = "Hello, testing.";
    const key = process.argv[2] || "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";
    console.log("Using key:", key);

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key}`,
                "HTTP-Referer": "http://localhost:5173",
                "X-Title": "Growth OS",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "cognitivecomputations/dolphin-mixtral-8x22b",
                "messages": [
                    { "role": "user", "content": prompt }
                ]
            })
        });

        const text = await response.text();
        console.log("Status:", response.status);
        console.log("Response:", text);
    } catch (e) {
        console.error("Error:", e);
    }
}
main();
