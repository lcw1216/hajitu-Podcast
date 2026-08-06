(function() {
    var THEME_KEY = 'podcast_theme';
    var ZOOM_KEY = 'podcast_zoom';

    function getNativeZoom() {
        if (window.outerWidth && window.innerWidth) {
            return window.outerWidth / window.innerWidth;
        }
        return 1;
    }

    function applyTheme(theme) {
        var body = document.body;
        var btn = document.querySelector('.theme-btn');
        if (!body) return;
        if (theme === 'light') {
            body.classList.add('light-mode');
            if (btn) btn.classList.add('light-mode');
        } else {
            body.classList.remove('light-mode');
            if (btn) btn.classList.remove('light-mode');
        }
    }

    function applyZoom(targetRatio) {
        if (!targetRatio || targetRatio <= 0) return;
        var current = getNativeZoom();
        if (Math.abs(targetRatio - current) > 0.005) {
            document.body.style.zoom = (targetRatio / current).toFixed(4);
        } else {
            document.body.style.zoom = '';
        }
    }

    function saveZoom() {
        localStorage.setItem(ZOOM_KEY, getNativeZoom());
    }

    // ========== 初始化主题 ==========
    var savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(savedTheme);

    window.toggleTheme = function() {
        var isLight = document.body.classList.contains('light-mode');
        var newTheme = isLight ? 'dark' : 'light';
        applyTheme(newTheme);
        localStorage.setItem(THEME_KEY, newTheme);
    };

    // ========== 初始化缩放 ==========
    var savedZoom = parseFloat(localStorage.getItem(ZOOM_KEY));
    if (savedZoom && !isNaN(savedZoom) && savedZoom > 0) {
        applyZoom(savedZoom);
    }

    window.addEventListener('beforeunload', saveZoom);

    var resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(saveZoom, 300);
    });

    // ========== 跨标签页实时同步 ==========
    window.addEventListener('storage', function(e) {
        if (e.key === THEME_KEY) {
            applyTheme(e.newValue || 'dark');
        }
        if (e.key === ZOOM_KEY && e.newValue) {
            var zoom = parseFloat(e.newValue);
            if (!isNaN(zoom) && zoom > 0) {
                applyZoom(zoom);
            }
        }
    });
})();