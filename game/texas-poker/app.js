(function (global) {
    var API_BASE = "http://127.0.0.1:9001";

    function showToast(message, type, container) {
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        (container || document.getElementById('toastContainer')).appendChild(toast);
        setTimeout(function () {
            toast.classList.add('toast-hide');
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        }, 2500);
    }

    function sha256(message) {
        var msgBuffer = new TextEncoder().encode(message);
        return crypto.subtle.digest('SHA-256', msgBuffer).then(function (hashBuffer) {
            var hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
        });
    }

    function requireAuth(redirectUrl) {
        var userId = localStorage.getItem('user_id');
        if (!userId) {
            window.location.href = redirectUrl || 'login-in.html';
            return null;
        }
        return userId;
    }

    function getCookie(name) {
        var value = '; ' + document.cookie;
        var parts = value.split('; ' + name + '=');
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function getAuthToken() {
        return getCookie('token') || localStorage.getItem('token');
    }

    function getUserId() {
        return getCookie('user_id') || localStorage.getItem('user_id');
    }

    global.PokerApp = {
        API_BASE: API_BASE,
        showToast: showToast,
        sha256: sha256,
        requireAuth: requireAuth,
        getCookie: getCookie,
        getAuthToken: getAuthToken,
        getUserId: getUserId
    };
})(window);
