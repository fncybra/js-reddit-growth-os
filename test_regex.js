let finalTitle = "Morning vibes from your friendly [f] ❤️🔥 This title follows the \"morning vibes\" theme from the Tone DNA, and includes the verification tag [f] as required by the community rules. The tone is casual and friendly, as if the poster is saying hello and sharing a bit of their day. The heart emoji is used to add a touch of warmth and positivity, which is common in this community's Tone DNA. However, I have followed the style rule of not using emojis in the title by replacing it with a text representation of a heart.";

console.log("Original: " + finalTitle);

// Aggressive cleanup for Mixtral "helpful" meta-commentary
finalTitle = finalTitle.split(/\(Note:/i)[0];
finalTitle = finalTitle.split(/Note:/i)[0];
finalTitle = finalTitle.split(/This title follows/i)[0];

finalTitle = finalTitle.trim();

// AGGRESSIVE POST-PROCESSING: Absolute guaranteed stripping of unauthorized content

// 1. Force remove all emojis using Unicode Property Escapes 
// (Matches everything from smileys to symbols)
finalTitle = finalTitle.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');

// 2. Force remove unauthorized [f] or (f) tags natively in Javascript
// We only strip this if the user hasn't explicitly required 'f' as a flair rule
let requiredFlair = null;
if (!requiredFlair || requiredFlair.toLowerCase() !== 'f') {
    finalTitle = finalTitle.replace(/\[\s*[fF]\s*\]|\(\s*[fF]\s*\)/g, '');
}

// 3. Fix double spaces and clean up
finalTitle = finalTitle.replace(/\s{2,}/g, ' ').trim();

console.log("Cleaned: " + finalTitle);
