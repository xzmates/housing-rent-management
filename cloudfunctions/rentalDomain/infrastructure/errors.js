class DomainError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.details = details
  }
}

function invariant(condition, code, message, details) {
  if (!condition) throw new DomainError(code, message, details)
}

module.exports = { DomainError, invariant }
