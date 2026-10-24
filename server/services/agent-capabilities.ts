/**
 * FrameFlow's explicit tool registry.
 * The planner may only select operations listed here. Keep this registry aligned
 * with the renderer implementation; tests and UI can use it as the source of truth.
 */
export const AGENT_CAPABILITIES = {
  effects: ['none', 'grayscale', 'warm', 'cool', 'vintage', 'brighten', 'contrast'],
  transitions: ['none', 'fade'],
  audioModes: ['keep_original', 'mute'],
  outputResolutions: ['720p', '1080p'],
  outputFps: [24, 25, 30],
} as const

export type SupportedEffect = typeof AGENT_CAPABILITIES.effects[number]
export type SupportedTransition = typeof AGENT_CAPABILITIES.transitions[number]

export const CAPABILITY_NOTES = [
  'Butterfly transitions are not supported in this version.',
  'Captions are not rendered in this version.',
  'External music, speech-aware silence removal, object removal, and generative scene changes are not supported.',
] as const
