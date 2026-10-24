import { GoogleGenAI } from '@google/genai'
import { editPlanSchema } from '../schemas/edit-plan.schema'
import { AGENT_CAPABILITIES, CAPABILITY_NOTES } from './agent-capabilities'

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) throw new Error('GEMINI_API_KEY is missing from server environment.')

const ai = new GoogleGenAI({ apiKey })

export type VideoInput = {
  videoId: string
  durationSeconds: number
  width: number | null
  height: number | null
  hasAudio: boolean
}

/**
 * Phase 1 agent loop: plan against an explicit capability registry, validate the
 * returned plan, and disclose unsupported requested operations instead of pretending.
 * This is intentionally not an autonomous retry loop yet; execution verification is next.
 */
export async function generateEditPlan(instruction: string, videos: VideoInput[]) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{
        text: `You are the editing planner for FrameFlow AI Video Studio.
Convert the user's request into a concrete plan using only the registered capabilities.

Return only JSON with this exact shape:
{
  "goal": "concise description of intended edit",
  "clips": [{
    "videoId": "one supplied ID",
    "start": 0,
    "end": 5,
    "effects": ["grayscale"],
    "transitionIn": "none"
  }],
  "audio": {"mode":"keep_original","volume":1},
  "output": {"format":"mp4","resolution":"720p","fps":30},
  "unsupportedRequests": []
}

AVAILABLE CAPABILITIES (use exact values):
${JSON.stringify(AGENT_CAPABILITIES)}

KNOWN LIMITATIONS:
${JSON.stringify(CAPABILITY_NOTES)}

Rules:
- Use only the supplied video IDs; use 1-20 clips.
- start >= 0; end > start and must not exceed the source duration.
- If user asks black-and-white, put "grayscale" in effects for every selected clip.
- If user specifies a target duration, select valid ranges whose total duration matches it when footage allows.
- "fade" means a basic fade-in on that clip, not a crossfade.
- Butterfly transitions are NOT supported. If requested, add a clear item such as "Butterfly transition (not supported)" to unsupportedRequests; never substitute "none" without disclosing this.
- Captions are not rendered. If requested, disclose them in unsupportedRequests and set captions nowhere (captions are not part of the schema).
- External music, speech-aware silence removal, object removal, background replacement, and generative scene changes are unsupported; disclose them if requested.
- Never claim an unsupported operation was applied.
- output format must be mp4, resolution 720p or 1080p, fps 24/25/30.
- Keep original audio unless user explicitly asks to mute it.
- Return valid JSON only, no markdown fences.

USER REQUEST:
${instruction}

AVAILABLE VIDEOS:
${JSON.stringify(videos)}
`,
      }],
    }],
    config: { responseMimeType: 'application/json' },
  })

  if (!response.text) throw new Error('Gemini returned an empty response.')

  const parsed: unknown = JSON.parse(response.text)
  return editPlanSchema.parse(parsed)
}
