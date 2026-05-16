class HTTPError(Exception):
    def __init__(self, status_code, message=None):
        self.status_code = status_code
        self.message = message or self._default_message(status_code)
        super().__init__(self.message)

    @staticmethod
    def _default_message(code):
        messages = {
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Not Found",
            405: "Method Not Allowed",
            408: "Request Timeout",
            413: "Payload Too Large",
            415: "Unsupported Media Type",
            500: "Internal Server Error",
            502: "Bad Gateway",
            503: "Service Unavailable",
        }
        return messages.get(code, "Error")


class BadRequestError(HTTPError):
    def __init__(self, message="Bad Request"):
        super().__init__(400, message)


class UnauthorizedError(HTTPError):
    def __init__(self, message="Unauthorized"):
        super().__init__(401, message)


class ForbiddenError(HTTPError):
    def __init__(self, message="Forbidden"):
        super().__init__(403, message)


class NotFoundError(HTTPError):
    def __init__(self, message="Not Found"):
        super().__init__(404, message)


class MethodNotAllowedError(HTTPError):
    def __init__(self, message="Method Not Allowed"):
        super().__init__(405, message)


class PayloadTooLargeError(HTTPError):
    def __init__(self, message="Payload Too Large"):
        super().__init__(413, message)


class InternalServerError(HTTPError):
    def __init__(self, message="Internal Server Error"):
        super().__init__(500, message)
