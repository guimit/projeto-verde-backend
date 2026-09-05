import { z } from 'zod'
import { phoneLookup } from './common'

export const phoneQuery = z.object({ phone: phoneLookup })
