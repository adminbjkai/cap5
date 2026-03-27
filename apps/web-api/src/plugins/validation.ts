import { type ZodSchema } from "zod"

/**
 * Parse and validate `input` against `schema`.
 * Throws a 400 Fastify-compatible error with a human-readable Zod message on failure.
 */
export function parseBody<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    const message = result.error.errors
      .map((e) => `${e.path.join(".") || "body"}: ${e.message}`)
      .join("; ")
    const err = Object.assign(new Error(message), { statusCode: 400 })
    throw err
  }
  return result.data
}

/**
 * Parse query string / URL params against `schema`.
 * Same behaviour as parseBody.
 */
export function parseQuery<T>(schema: ZodSchema<T>, input: unknown): T {
  return parseBody(schema, input)
}

export function parseParams<T>(schema: ZodSchema<T>, input: unknown): T {
  return parseBody(schema, input)
}
