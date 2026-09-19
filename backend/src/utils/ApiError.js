class ApiError extends Error {
    constructor(
        statusCode,
        message = "Something went wrong",
        errors = [],
        stack = "",
        code = "API_ERROR"
    ) {
        super(message);
        this.statusCode = statusCode;
        this.data = null;
        this.message = message;
        this.success = false;
        this.errors = errors;
        this.code = code;
        this.isOperational = true;

        if (stack) this.stack = stack;
        else Error.captureStackTrace(this, this.constructor);
    }
}

export { ApiError };
