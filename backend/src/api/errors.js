'use strict';

class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.code).json({ error: { code: err.code, message: err.message } });
  }
  
  if (err.name === 'ZodError') {
    return res.status(422).json({ 
      error: { code: 422, message: 'Validation failed', details: err.errors } 
    });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 500, message: 'Internal server error' } });
}

module.exports = {
  AppError,
  errorHandler
};
