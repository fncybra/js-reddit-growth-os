fetch('https://js-reddit-growth-os.vercel.app/')
    .then(res => res.text())
    .then(text => console.log(text.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)[0]));
