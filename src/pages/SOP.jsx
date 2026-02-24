import React, { useState } from 'react';

export function SOP() {
    const [speaking, setSpeaking] = useState(false);

    const steps = [
        {
            title: "Phase 1: Admin - Creating a New Model",
            content: `Start by going to the 'Models' page and clicking the blue 'New Model' button. 
            Enter the alias of your model, assign them a 4-digit VA PIN code, and establish their weekly growth targets. 
            Most importantly, paste the unique Google Drive folder ID where this model's raw content will be stored. 
            Once everything is filled out, click 'Save Model'.`
        },
        {
            title: "Phase 2: Admin - Syncing Content to the Vault",
            content: `Go to the 'Visual Gallery' page using the sidebar. 
            Select the specific model you just created from the dropdown menu at the top. 
            Click the 'Sync from Google Drive' button. 
            The system will automatically import hundreds of photos and videos from that model's Drive folder directly into the database, tagging them by folder niche automatically.`
        },
        {
            title: "Phase 3: Admin - Generating the Daily Plan",
            content: `The manager logs into the 'Task Planning' page every morning or night. 
            Select the model from the dropdown. 
            Click the massive 'Generate Daily Plan' button.
            The system will scan the content vault, analyze the anti-ban cooldown timers, scrape live Reddit subreddits, and magically generate 5 to 15 fully completed posts complete with AI titles that perfectly match the explicit tone of the subreddits.`
        },
        {
            title: "Phase 4: VA - Executing the Tasks",
            content: `The Virtual Assistant logs into the VA Dashboard. 
            They are presented with a secure terminal and must type in the 4-digit PIN code assigned to their specific model. 
            The system downloads the daily plan from the cloud. 
            The VA linearly executes the queue. For each task, they click 'Download Media', paste the exact title given to them into the exact Reddit URL provided, and then paste the final live Reddit URL back into the system to verify completion. 
            Once they hit 'I Have Posted This', the system's anti-ban timer will pause the VA, forcing them to wait 3 minutes before executing the next post.`
        }
    ];

    function stopSpeaking() {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            setSpeaking(false);
        }
    }

    function speakText(text) {
        if (!('speechSynthesis' in window)) {
            alert("Your browser does not support text-to-speech functionality.");
            return;
        }

        window.speechSynthesis.cancel(); // Stop any current speech

        const utterance = new SpeechSynthesisUtterance(text.trim().replace(/\s+/g, ' '));

        // Settings for a natural reading voice
        utterance.rate = 0.95;
        utterance.pitch = 1.0;

        // Attempt to find a good English voice
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.name.includes('Google US English') || v.lang.includes('en-US')) || voices[0];
        if (preferredVoice) utterance.voice = preferredVoice;

        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);

        window.speechSynthesis.speak(utterance);
        setSpeaking(true);
    }

    return (
        <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
            <header style={{ marginBottom: '32px', textAlign: 'center' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Standard Operating Procedure</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Step-by-step masterclass on scaling models from A-Z using the JS Reddit Growth OS.</p>
                {speaking && (
                    <button onClick={stopSpeaking} style={{ marginTop: '16px', padding: '8px 16px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', animation: 'pulse 2s infinite' }}>
                        ⏹️ Stop Audio Playback
                    </button>
                )}
            </header>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {steps.map((step, index) => (
                    <div key={index} style={{ backgroundColor: '#1a1d24', border: '1px solid #2d313a', borderRadius: '8px', padding: '24px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2d313a', paddingBottom: '16px', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '1.2rem', color: '#6366f1' }}>{step.title}</h2>
                            <button
                                onClick={() => speakText(step.content)}
                                style={{ backgroundColor: 'transparent', border: '1px solid #6366f1', color: '#6366f1', padding: '6px 12px', borderRadius: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 'bold' }}
                            >
                                🔊 Read Aloud
                            </button>
                        </div>
                        <div style={{ color: '#d1d5db', lineHeight: '1.6', fontSize: '0.95rem' }}>
                            {step.content.split('\n').map((line, i) => (
                                <p key={i} style={{ marginBottom: '12px' }}>{line.trim()}</p>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: '48px', padding: '24px', backgroundColor: '#0f1115', border: '1px dashed #6366f1', borderRadius: '8px', textAlign: 'center' }}>
                <h3 style={{ color: '#818cf8', marginBottom: '12px' }}>🎥 Training Videos Notice</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Due to the highly explicit/NSFW core nature of the subreddit targeting titles and specific content assets passing through this system, automated video recording systems and cloud-screensharing platforms block hosting this content natively. Virtual Assistants should rely heavily on the Text-To-Speech audio guides mapping the exact visual interface above.
                </p>
            </div>
        </div>
    );
}
