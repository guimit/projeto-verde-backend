import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

interface Schemas {
  body?: ZodSchema
  params?: ZodSchema
  query?: ZodSchema
}

function isSchema(x: unknown): x is ZodSchema {
  return !!x && typeof (x as ZodSchema).safeParse === 'function'
}

function firstMessage(err: ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'Dados inválidos'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

// validate(schema) valida o body (uso original). validate({ body, params, query })
// valida cada parte. O body validado substitui req.body (com defaults e
// transformações do zod). params/query são só verificados — no Express 5 são
// getters e não podem ser reatribuídos — e os valores validados ficam em
// res.locals.params / res.locals.query para quem precisar dos defaults.
export function validate(input: ZodSchema | Schemas) {
  const s: Schemas = isSchema(input) ? { body: input } : input
  return (req: Request, res: Response, next: NextFunction) => {
    if (s.params) {
      const r = s.params.safeParse(req.params)
      if (!r.success) return res.status(400).json({ error: firstMessage(r.error) })
      res.locals.params = r.data
    }
    if (s.query) {
      const r = s.query.safeParse(req.query)
      if (!r.success) return res.status(400).json({ error: firstMessage(r.error) })
      res.locals.query = r.data
    }
    if (s.body) {
      const r = s.body.safeParse(req.body ?? {})
      if (!r.success) return res.status(400).json({ error: firstMessage(r.error) })
      req.body = r.data
    }
    next()
  }
}
