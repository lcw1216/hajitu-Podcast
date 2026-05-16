import re
import logging
from errors import NotFoundError, MethodNotAllowedError

logger = logging.getLogger(__name__)


class Route:
    def __init__(self, method, pattern, handler, name=None):
        self.method = method.upper()
        self.pattern = pattern
        self.handler = handler
        self.name = name or handler.__name__
        self._regex = None
        self._param_names = []
        self._compile_pattern(pattern)

    def _compile_pattern(self, pattern):
        param_pattern = re.compile(r":(\w+)")
        self._param_names = param_pattern.findall(pattern)
        regex_str = param_pattern.sub(r"(?P<\1>[^/]+)", pattern)
        regex_str = "^" + regex_str + "$"
        self._regex = re.compile(regex_str)

    def match(self, method, path):
        if self.method != method.upper() and self.method != "ANY":
            return None
        m = self._regex.match(path)
        if m:
            return m.groupdict()
        return None

    def __repr__(self):
        return f"<Route {self.method} {self.pattern} -> {self.name}>"


class Router:
    def __init__(self):
        self.routes = []
        self._method_routes = {}

    def add_route(self, method, pattern, handler, name=None):
        route = Route(method, pattern, handler, name)
        self.routes.append(route)
        if method not in self._method_routes:
            self._method_routes[method] = []
        self._method_routes[method].append(route)
        return route

    def route(self, pattern, method="GET", name=None):
        def decorator(handler):
            self.add_route(method, pattern, handler, name)
            return handler
        return decorator

    def get(self, pattern, name=None):
        return self.route(pattern, method="GET", name=name)

    def post(self, pattern, name=None):
        return self.route(pattern, method="POST", name=name)

    def put(self, pattern, name=None):
        return self.route(pattern, method="PUT", name=name)

    def delete(self, pattern, name=None):
        return self.route(pattern, method="DELETE", name=name)

    def any(self, pattern, name=None):
        return self.route(pattern, method="ANY", name=name)

    def resolve(self, method, path):
        method = method.upper()
        candidates = self._method_routes.get(method, []) + self._method_routes.get("ANY", [])
        for route in candidates:
            params = route.match(method, path)
            if params is not None:
                return route.handler, params

        all_paths = set()
        for route in self.routes:
            all_paths.add(route.pattern)
            m = route._regex.match(path)
            if m:
                raise MethodNotAllowedError(f"Method {method} not allowed for {path}")

        raise NotFoundError(f"No route matches {path}")

    def url_for(self, name, **params):
        for route in self.routes:
            if route.name == name:
                url = route.pattern
                for key, value in params.items():
                    url = url.replace(f":{key}", str(value))
                return url
        raise ValueError(f"No route named '{name}'")

    def __repr__(self):
        lines = [f"Router({len(self.routes)} routes):"]
        for route in self.routes:
            lines.append(f"  {route.method:6s} {route.pattern} -> {route.name}")
        return "\n".join(lines)
