if(localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-mode');
    document.querySelector('.theme-btn').classList.add('light-mode');
}
window.toggleTheme = function() {
    var body = document.body;
    var btn = document.querySelector('.theme-btn');
    body.classList.toggle('light-mode');
    btn.classList.toggle('light-mode');
    if(body.classList.contains('light-mode')) {
        localStorage.setItem('theme', 'light');
    } else {
        localStorage.setItem('theme', 'dark');
    }
}