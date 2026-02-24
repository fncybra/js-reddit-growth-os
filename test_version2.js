fetch('https://js-reddit-growth-os.vercel.app/assets/index-C7f1Lad_.js')
    .then(res => res.text())
    .then(text => {
        if (text.includes('Emoji_Presentation')) {
            console.log("YES - Vercel has the code!");
        } else {
            console.log("NO!");
        }
    });
