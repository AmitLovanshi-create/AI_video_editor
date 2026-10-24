import { z } from 'zod'

const videoIdSchema = z.string().regex(/^[0-9a-f-]{36}$/i, 'Invalid video ID')

const effectSchema = z.enum([
  'none',
  'grayscale',
  'warm',
  'cool',
  'vintage',
  'brighten',
  'contrast',
])

const transitionSchema = z.enum(['none', 'fade'])

const clipSchema = z.object({
  videoId: videoIdSchema,
  start: z.number().finite().min(0),
  end: z.number().finite().positive(),
  effects: z.array(effectSchema).max(7).default(['none']),
  transitionIn: transitionSchema.default('none'),
}).refine((clip) => clip.end > clip.start, {
  message: 'Clip end must be greater than clip start',
  path: ['end'],
})

export const editPlanSchema = z.object({
  goal: z.string().trim().min(1).max(1000),
  clips: z.array(clipSchema).min(1, 'At least one clip is required')
    .max(20, 'A maximum of 20 clips is allowed'),
  audio: z.object({
    mode: z.enum(['keep_original', 'mute']).default('keep_original'),
    volume: z.number().finite().min(0).max(2).default(1),
  }).default({ mode: 'keep_original', volume: 1 }),
  captions: z.object({
    enabled: z.boolean().default(false),
    text: z.string().max(2000).default(''),
    position: z.enum(['top', 'center', 'bottom']).default('bottom'),
  }).default({ enabled: false, text: '', position: 'bottom' }),
  output: z.object({
    format: z.literal('mp4'),
    resolution: z.enum(['720p', '1080p']).default('720p'),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).default(30),
  }),
})

export type EditPlan = z.infer<typeof editPlanSchema>
